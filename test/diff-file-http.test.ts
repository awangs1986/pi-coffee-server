import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import { FILE_CONTENTS_LIMIT, FILE_PATCH_LIMIT, Workspaces } from "../src/host/workspaces.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd, maxBuffer: 32 * 1024 * 1024 });
const lines = (count: number, label = "line") => Array.from({ length: count }, (_, index) => `${label} ${index + 1}`).join("\n") + "\n";
const APP = lines(40);
const OLD_DOC = "# Old\n\nThis page is removed.\n";

type FileResult = { scope: string; path: string; base: string; patch: string; truncated: boolean; oldContents?: string | null; newContents?: string | null; contentsUnavailable?: string; error?: string };

async function fixture(root: string) {
  const source = join(root, "source"), remote = join(root, "remote.git");
  await mkdir(join(source, "src"), { recursive: true });
  await mkdir(join(source, "docs"));
  await git(source, ["init", "-b", "main"]);
  await writeFile(join(source, "src", "app.ts"), APP);
  await writeFile(join(source, "docs", "old.md"), OLD_DOC);
  await writeFile(join(source, "logo.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  await writeFile(join(source, "huge-tracked.txt"), "seed\n");
  await writeFile(join(source,".env"),"TOKEN=baseline\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "base"]);
  await git(root, ["clone", "--bare", source, remote]);
  const workspaces = new Workspaces(join(root, "workspaces"), { ownerId: "vm-a" });
  const project = await workspaces.registerProject("demo", remote);
  const task = await workspaces.createConversation(project.id, "main", "diff-file-task", "pi");
  return { workspaces, task };
}

describe("per-file Diff loading (change_file)", () => {
  it("serves one file's whole patch and both sides' text for the Branch and 最近一轮 scopes, read-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-change-file-"));
    let server: HostServer | undefined;
    try {
      const { workspaces, task } = await fixture(root);
      const cwd = task.cwd;
      // A committed edit on the task branch, then uncommitted work on top of it.
      await writeFile(join(cwd, "src", "app.ts"), APP.replace("line 5\n", "line five\n"));
      await git(cwd, ["commit", "-am", "committed on the task branch"]);
      await writeFile(join(cwd, "src", "app.ts"), APP.replace("line 5\n", "line five\n").replace("line 30\n", "line thirty\n"));
      await mkdir(join(cwd, "notes"));
      await writeFile(join(cwd, "notes", "new.md"), "# New\n\nwritten in the task\n");
      await rm(join(cwd, "docs", "old.md"));
      await writeFile(join(cwd, "logo.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x09]));
      await writeFile(join(cwd, "huge-untracked.txt"), "x".repeat(FILE_PATCH_LIMIT + 1024));
      await writeFile(join(cwd, "huge-tracked.txt"), "y".repeat(80) + "\n" + "z".repeat(FILE_PATCH_LIMIT));
      await writeFile(join(cwd, "wide.txt"), "w".repeat(FILE_CONTENTS_LIMIT + 10));
      await writeFile(join(cwd, ".env"), "TOKEN=private\n");

      const factory = { list: async () => [], delete: async () => false, create: async () => { throw new Error("Must not start an Agent"); } };
      server = new HostServer({ port: 0, host: "127.0.0.1", token: "diff-file", factory, workspaces });
      await server.start();
      const port = server.address().port;
      const post = async (body: Record<string, unknown>) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/workspace`, { method: "POST", headers: { authorization: "Bearer diff-file", "content-type": "application/json" }, body: JSON.stringify({ id: task.id, ...body }) });
        return { status: response.status, body: await response.json() as FileResult };
      };
      const changes = await (await fetch(`http://127.0.0.1:${port}/api/workspace`, { method: "POST", headers: { authorization: "Bearer diff-file", "content-type": "application/json" }, body: JSON.stringify({ action: "changes", id: task.id }) })).json() as { base: string };
      const base = changes.base;
      const file = (path: string, extra: Record<string, unknown> = {}) => post({ action: "change_file", path, base, ...extra });

      // Committed and uncommitted edits of a tracked file, measured from the merge-base.
      const app = await file("src/app.ts");
      expect(app.status).toBe(200);
      expect(app.body).toMatchObject({ scope: "branch", path: "src/app.ts", base, truncated: false });
      expect(app.body.patch).toContain("-line 5\n+line five");
      expect(app.body.patch).toContain("-line 30\n+line thirty");
      expect(app.body).not.toHaveProperty("oldContents");
      const expanded = await file("src/app.ts", { contents: true });
      expect(expanded.body.oldContents).toBe(APP);
      expect(expanded.body.newContents).toContain("line five\n");
      expect(expanded.body.newContents).toContain("line thirty\n");
      expect(expanded.body.contentsUnavailable).toBeUndefined();

      // New (untracked) and deleted files each have one side.
      const created = await file("notes/new.md", { contents: true });
      expect(created.body.patch).toContain("+++ b/notes/new.md");
      expect(created.body.patch).toContain("+written in the task");
      expect(created.body).toMatchObject({ oldContents: null, newContents: "# New\n\nwritten in the task\n" });
      const deleted = await file("docs/old.md", { contents: true });
      expect(deleted.body.patch).toContain("deleted file mode");
      expect(deleted.body).toMatchObject({ oldContents: OLD_DOC, newContents: null });

      // Binary and oversized sides are not offered for expansion; oversized patches are not sent.
      expect((await file("logo.bin", { contents: true })).body).toMatchObject({ oldContents: null, newContents: null, contentsUnavailable: "binary" });
      expect((await file("wide.txt", { contents: true })).body).toMatchObject({ truncated: false, oldContents: null, newContents: null, contentsUnavailable: "too_large" });
      for (const path of ["huge-untracked.txt", "huge-tracked.txt"]) {
        const huge = await file(path, { contents: true });
        expect(huge.status, path).toBe(200);
        expect(huge.body, path).toMatchObject({ truncated: true, patch: "" });
        expect(huge.body, path).not.toHaveProperty("oldContents");
      }

      // Private, escaping and malformed requests are refused before Git runs.
      for (const path of [".env", ".git/config", ".pi-coffee/inbox/a.txt", "../outside.txt", "/etc/passwd", "", 42, "*", ":(glob)**", ".", "src"]) {
        const refused = await post({ action: "change_file", path, base });
        expect(refused.status, String(path)).toBe(409);
        expect(refused.body.error, String(path)).toContain("Invalid or private path");
      }
      expect((await post({ action: "change_file", path: "src/app.ts" })).body.error).toContain("Diff base missing");
      expect((await post({ action: "change_file", path: "src/app.ts", base: "HEAD" })).body.error).toContain("Diff base missing");
      expect((await post({ action: "change_file", path: "src/app.ts", base: "f".repeat(40) })).body.error).toContain("no longer part of the task branch");

      // 最近一轮: only what changed since the turn started, through a throwaway index.
      expect((await file("src/app.ts", { scope: "turn" })).body.error).toContain("No turn recorded yet");
      await workspaces.markRun(task.id, "running", "req-1");
      await writeFile(join(cwd, "src", "app.ts"), APP.replace("line 5\n", "line five\n").replace("line 30\n", "line thirty\n").replace("line 38\n", "line 38 (turn)\n"));
      await writeFile(join(cwd, "notes", "turn.md"), "added during the turn\n");
      for(const path of ['*',':(glob)**','.','src'])expect((await post({action:'change_file',path,scope:'turn'})).status,path).toBe(409);
      const turn = await post({ action: "change_file", path: "src/app.ts", scope: "turn", contents: true });
      expect(turn.status).toBe(200);
      expect(turn.body.scope).toBe("turn");
      expect(turn.body.patch).toContain("+line 38 (turn)");
      expect(turn.body.patch).not.toContain("line five");
      expect(turn.body.oldContents).toContain("line thirty\n");
      expect(turn.body.oldContents).not.toContain("(turn)");
      expect(turn.body.newContents).toContain("line 38 (turn)\n");
      const turnNew = await post({ action: "change_file", path: "notes/turn.md", scope: "turn" });
      expect(turnNew.body.patch).toContain("+added during the turn");
      expect((await post({ action: "change_file", path: "notes/new.md", scope: "turn" })).body.patch).toBe("");
      expect((await git(cwd, ["diff", "--cached", "--name-only"])).stdout).toBe("");
      expect((await git(cwd, ["status", "--porcelain"])).stdout).toContain("?? notes/");
    } finally {
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
