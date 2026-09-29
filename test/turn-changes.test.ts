import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Workspaces } from "../src/host/workspaces.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd });

async function project(root: string) {
  const source = join(root, "source"), remote = join(root, "remote.git");
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await writeFile(join(source, "README.md"), "base\n");
  await writeFile(join(source, "gone.txt"), "remove me\n");
  await git(source, ["add", "."]);
  await git(source, ["commit", "-m", "base"]);
  await git(root, ["clone", "--bare", source, remote]);
  const workspaces = new Workspaces(join(root, "workspaces"), { ownerId: "vm-a" });
  return { workspaces, project: await workspaces.registerProject("demo", remote) };
}

describe("last-turn review", () => {
  it("diffs only what the latest Pi run changed, including new and deleted files, without touching the checkout index", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-turn-"));
    try {
      const { workspaces, project: p } = await project(root);
      const c = await workspaces.createConversation(p.id, "main", "turn-pi", "pi");
      // Changes from before the turn belong to the branch review, not the turn review.
      await writeFile(join(c.cwd, "README.md"), "base\nbefore turn\n");
      await writeFile(join(c.cwd, "earlier.txt"), "made earlier\n");
      await expect(workspaces.turnChanges(c.id)).rejects.toThrow("No turn recorded yet");

      await workspaces.markRun(c.id, "running", "req-1");
      const snapshot = (await workspaces.lookup(c.id))!.turnSnapshot!;
      expect(snapshot.tree).toMatch(/^[0-9a-f]{40}$/);
      expect(snapshot).toMatchObject({ requestId: "req-1" });
      expect((await git(c.cwd, ["status", "--porcelain"])).stdout).toContain("?? earlier.txt");
      expect((await git(c.cwd, ["diff", "--cached", "--name-only"])).stdout).toBe("");

      await writeFile(join(c.cwd, "README.md"), "base\nbefore turn\nduring turn\n");
      await writeFile(join(c.cwd, "src.ts"), "const a = 1;\nconst b = 2;\n");
      await rm(join(c.cwd, "gone.txt"));
      await rm(join(c.cwd, "earlier.txt"));
      await mkdir(join(c.cwd, ".pi-coffee", "inbox"), { recursive: true });
      await writeFile(join(c.cwd, ".pi-coffee", "inbox", "upload.txt"), "runtime upload\n");
      await writeFile(join(c.cwd, ".env"), "TOKEN=private\n");

      const turn = await workspaces.turnChanges(c.id);
      expect(turn).toMatchObject({ scope: "turn", running: true, branch: c.branch, base: snapshot.tree, startedAt: snapshot.startedAt });
      expect(turn.files).toEqual([
        { path: "earlier.txt", status: "D", additions: 0, deletions: 1 },
        { path: "gone.txt", status: "D", additions: 0, deletions: 1 },
        { path: "README.md", status: "M", additions: 1, deletions: 0 },
        { path: "src.ts", status: "A", additions: 2, deletions: 0 },
      ]);
      expect(turn.patch).toContain("+during turn");
      expect(turn.patch).toContain("+const b = 2;");
      expect(turn.patch).not.toContain("+before turn");
      expect(turn.patch).not.toContain("runtime upload");
      expect(turn.patch).not.toContain("TOKEN");
      expect((await git(c.cwd, ["diff", "--cached", "--name-only"])).stdout).toBe("");
      expect((await git(c.cwd, ["ls-files"])).stdout.split("\n").filter(Boolean).sort()).toEqual(["README.md", "gone.txt"]);

      // The finished run stays reviewable; the next run starts a fresh window.
      await workspaces.markRun(c.id, "idle");
      expect((await workspaces.turnChanges(c.id)).running).toBe(false);
      await workspaces.markRun(c.id, "running", "req-2");
      expect((await workspaces.turnChanges(c.id)).files).toEqual([]);
      await writeFile(join(c.cwd, "src.ts"), "const a = 1;\nconst b = 3;\n");
      expect((await workspaces.turnChanges(c.id)).files).toEqual([{ path: "src.ts", status: "M", additions: 1, deletions: 1 }]);

      // Branch review now counts the lines of new files instead of reporting them as unknown.
      const branch = await workspaces.changes(c.id);
      expect(branch.scope).toBe("branch");
      expect(branch.files.find(file => file.path === "src.ts")).toMatchObject({ status: "?", additions: 2, deletions: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records Codex runs, but not Claude Code or Chat runs", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-turn-engines-"));
    try {
      const { workspaces, project: p } = await project(root);
      const codex = await workspaces.createConversation(p.id, "main", "turn-codex", "codex");
      await workspaces.markRun(codex.id, "running", "codex-1");
      await writeFile(join(codex.cwd, "codex.txt"), "native\n");
      expect((await workspaces.turnChanges(codex.id)).files).toEqual([{ path: "codex.txt", status: "A", additions: 1, deletions: 0 }]);

      const claude = await workspaces.createConversation(p.id, "main", "turn-claude", "claude");
      await workspaces.markRun(claude.id, "running", "claude-1");
      expect((await workspaces.lookup(claude.id))!.turnSnapshot).toBeUndefined();
      await expect(workspaces.turnChanges(claude.id)).rejects.toThrow("not available for this Agent");

      const chat = await workspaces.createChatConversation("turn-chat", "pi");
      await workspaces.markRun(chat.id, "running", "chat-1");
      expect((await workspaces.lookup(chat.id))!.turnSnapshot).toBeUndefined();
      await expect(workspaces.turnChanges(chat.id)).rejects.toThrow("Chat workspace has no project Diff");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never blocks a run when the snapshot fails and never keeps an older run's tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "coffee-turn-failure-"));
    try {
      const { workspaces, project: p } = await project(root);
      const c = await workspaces.createConversation(p.id, "main", "turn-failure", "pi");
      await workspaces.markRun(c.id, "running", "ok-1");
      await workspaces.markRun(c.id, "idle");
      const target = workspaces as unknown as { workingTree: (cwd: string) => Promise<unknown> };
      target.workingTree = async () => { throw new Error("simulated snapshot failure"); };
      await workspaces.markRun(c.id, "running", "fail-1");
      const stored = (await workspaces.lookup(c.id))!;
      expect(stored.runState).toBe("running");
      expect(stored.turnSnapshot).toMatchObject({ error: "simulated snapshot failure" });
      expect(stored.turnSnapshot?.tree).toBeUndefined();
      await expect(workspaces.turnChanges(c.id)).rejects.toThrow("Last-turn snapshot unavailable: simulated snapshot failure");
      const state = JSON.parse(await readFile(join(root, "workspaces", ".coffee", "state.json"), "utf8"));
      expect(state.conversations[0].turnSnapshot.error).toBe("simulated snapshot failure");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
