import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitHubClient, githubWebHost, parseGitHubRepository } from "../src/host/github.js";
import { HostServer } from "../src/host/server.js";
import { Workspaces, type CodeForge } from "../src/host/workspaces.js";

const exec = promisify(execFile);
const git = (cwd: string, args: string[]) => exec("git", ["-c", "user.name=Test", "-c", "user.email=test@localhost", ...args], { cwd });
const TOKEN = "gh-fixture-token";

async function bareRepository(root: string, name: string) {
  const source = join(root, name + "-source"), remote = join(root, name + ".git");
  await mkdir(source);
  await git(source, ["init", "-b", "main"]);
  await writeFile(join(source, "README.md"), "base\n");
  await git(source, ["add", "README.md"]);
  await git(source, ["commit", "-m", "base"]);
  await git(root, ["clone", "--bare", source, remote]);
  return remote;
}

interface FakeRepo { id: number; full_name: string; default_branch: string; clone_url: string; html_url: string; private: boolean; archived?: boolean; permissions: { push: boolean } }
/** Minimal GitHub REST fake mounted under /api/v3 (the GitHub Enterprise prefix). */
function fakeGitHub(repos: FakeRepo[], filler = 0) {
  const requests: Array<{ method: string; url: string; body: string; headers: IncomingMessage["headers"] }> = [];
  const pulls: Array<{ number: number; html_url: string; state: string; head: { ref: string; repo: { id: number } }; base: { ref: string; repo: { id: number } } }> = [];
  const listed = [...Array.from({ length: filler }, (_, index) => ({ id: 5000 + index, full_name: `acme/filler-${index}`, default_branch: "main", clone_url: "https://example.invalid/x.git", html_url: "https://example.invalid/x", private: true, permissions: { push: true } })), ...repos];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://fake");
      requests.push({ method: request.method ?? "", url: url.pathname + url.search, body, headers: request.headers });
      response.setHeader("content-type", "application/json");
      const send = (status: number, value: unknown) => { response.statusCode = status; response.end(JSON.stringify(value)); };
      if (request.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: "Bad credentials" });
      if (url.pathname === "/api/v3/user/repos") {
        const page = Number(url.searchParams.get("page")), size = Number(url.searchParams.get("per_page"));
        return send(200, listed.slice((page - 1) * size, page * size));
      }
      const byName = /^\/api\/v3\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (byName) { const repo = repos.find((item) => item.full_name === `${byName[1]}/${byName[2]}`); return repo ? send(200, repo) : send(404, { message: "Not Found" }); }
      const byId = /^\/api\/v3\/repositories\/(\d+)$/.exec(url.pathname);
      if (byId) { const repo = repos.find((item) => String(item.id) === byId[1]); return repo ? send(200, repo) : send(404, { message: "Not Found" }); }
      const pullPath = /^\/api\/v3\/repos\/([^/]+)\/([^/]+)\/pulls$/.exec(url.pathname);
      if (pullPath && request.method === "GET") {
        const [owner, ref] = String(url.searchParams.get("head")).split(":");
        return send(200, owner === pullPath[1] ? pulls.filter((pull) => pull.head.ref === ref && pull.base.ref === url.searchParams.get("base")) : []);
      }
      if (pullPath && request.method === "POST") {
        const input = JSON.parse(body) as { head: string; base: string; title: string };
        const repo = repos.find((item) => item.full_name === `${pullPath[1]}/${pullPath[2]}`)!;
        if (input.head === "no-commits") return send(422, { message: "Validation Failed", errors: [{ message: `No commits between ${input.base} and ${input.head}` }] });
        const pull = { number: 41 + pulls.length, html_url: `https://github.com/${repo.full_name}/pull/${41 + pulls.length}`, state: "open", head: { ref: input.head, repo: { id: repo.id } }, base: { ref: input.base, repo: { id: repo.id } } };
        pulls.push(pull);
        return send(201, pull);
      }
      send(404, { message: "Not Found" });
    });
  });
  return { server, requests, pulls };
}

let servers: Server[] = [];
let roots: string[] = [];
let hosts: HostServer[] = [];
afterEach(async () => {
  for (const host of hosts) await host.close();
  for (const server of servers) { server.close(); await once(server, "close"); }
  for (const root of roots) await rm(root, { recursive: true, force: true });
  servers = []; roots = []; hosts = [];
});
async function listen(server: Server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening"); servers.push(server);
  const address = server.address(); if (!address || typeof address === "string") throw new Error("missing address");
  return `http://127.0.0.1:${address.port}/api/v3`;
}
async function tempRoot(prefix: string) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }

describe("GitHub repository names", () => {
  it("accepts owner/repo, page, clone and SSH forms and rejects everything else", () => {
    expect(parseGitHubRepository("acme/app")).toBe("acme/app");
    expect(parseGitHubRepository(" https://github.com/acme/app.js/tree/main/src ")).toBe("acme/app.js");
    expect(parseGitHubRepository("https://github.com/acme/app.git")).toBe("acme/app");
    expect(parseGitHubRepository("git@github.com:acme/app.git")).toBe("acme/app");
    expect(parseGitHubRepository("https://ghe.example/acme/app", "ghe.example")).toBe("acme/app");
    expect(githubWebHost("https://api.github.com")).toBe("github.com");
    expect(githubWebHost("https://ghe.example/api/v3")).toBe("ghe.example");
    for (const bad of ["acme", "acme/app/extra", "../etc/passwd", "acme/.hidden", "-acme/app", "https://gitlab.com/acme/app", "file:///tmp/repo", 42])
      expect(() => parseGitHubRepository(bad)).toThrow();
  });
});

describe("GitHub REST adapter", () => {
  it("lists every page with the API version, bearer token and Enterprise prefix", async () => {
    const fake = fakeGitHub([{ id: 7, full_name: "acme/last", default_branch: "trunk", clone_url: "https://github.com/acme/last.git", html_url: "https://github.com/acme/last", private: false, permissions: { push: false } }], 100);
    const client = new GitHubClient({ token: TOKEN, apiUrl: await listen(fake.server) });
    const repos = await client.listRepositories();
    expect(repos).toHaveLength(101);
    expect(repos.at(-1)).toMatchObject({ id: "7", fullName: "acme/last", defaultBranch: "trunk", canPush: false, private: false });
    expect(fake.requests.map((request) => request.url)).toEqual([
      "/api/v3/user/repos?per_page=100&page=1&sort=pushed&affiliation=owner%2Ccollaborator%2Corganization_member",
      "/api/v3/user/repos?per_page=100&page=2&sort=pushed&affiliation=owner%2Ccollaborator%2Corganization_member",
    ]);
    expect(fake.requests[0].headers).toMatchObject({ authorization: `Bearer ${TOKEN}`, "x-github-api-version": "2022-11-28", accept: "application/vnd.github+json", "user-agent": "pi-coffee-host" });
  });

  it("reports GitHub's reason without echoing the token", async () => {
    const fake = fakeGitHub([]);
    const api = await listen(fake.server);
    const error = await new GitHubClient({ token: "wrong-token", apiUrl: api }).repository("acme/app").catch((e: Error) => e);
    expect(String(error)).toContain("GitHub GET /api/v3/repos/acme/app failed (401): Bad credentials");
    expect(String(error)).not.toContain("wrong-token");
    expect(() => new GitHubClient({ token: TOKEN, apiUrl: "https://user:pass@ghe.example/api/v3" })).toThrow("credential-free");
    expect(() => new GitHubClient({ token: "" })).toThrow("token is required");
  });
});

describe("GitHub-backed Work Projects", () => {
  it("registers once, clones and pushes the task branch, and opens the PR on GitHub (not Gitea)", async () => {
    const root = await tempRoot("coffee-github-");
    const remote = await bareRepository(root, "app");
    const repos: FakeRepo[] = [
      { id: 101, full_name: "acme/app", default_branch: "main", clone_url: remote, html_url: "https://github.com/acme/app", private: true, permissions: { push: true } },
      { id: 102, full_name: "acme/readonly", default_branch: "main", clone_url: remote, html_url: "https://github.com/acme/readonly", private: true, permissions: { push: false } },
      { id: 103, full_name: "acme/old", default_branch: "main", clone_url: remote, html_url: "https://github.com/acme/old", private: true, archived: true, permissions: { push: true } },
    ];
    const fake = fakeGitHub(repos);
    const api = await listen(fake.server);
    const github = new GitHubClient({ token: TOKEN, apiUrl: api });
    const giteaCalls: string[] = [];
    const gitea: CodeForge = { createPullRequest: async () => { giteaCalls.push("pull"); throw new Error("Gitea must not be used for GitHub Projects"); } };
    const workspaces = new Workspaces(join(root, "store"), { ownerId: "alice", forge: gitea, github });

    const project = await workspaces.registerGitHubProject("acme/app");
    expect(project).toEqual({ id: "github-101", name: "acme/app", path: "", branch: "main", repoUrl: remote, repoId: "101", webUrl: "https://github.com/acme/app", forge: "github" });
    // An Enterprise API base accepts repository URLs from its own web host.
    expect(await workspaces.registerGitHubProject(`${new URL(api).origin}/acme/app.git`)).toEqual(project);
    await expect(workspaces.registerGitHubProject("acme/readonly")).rejects.toThrow("cannot push to acme/readonly");
    await expect(workspaces.registerGitHubProject("acme/old")).rejects.toThrow("archived");
    await expect(workspaces.registerGitHubProject("https://github.com/acme/app")).rejects.toThrow(`Only ${new URL(api).host} repositories`);
    // Gitea repository IDs are a different number space: ID 101 on Gitea is not the GitHub Project.
    const gitea101 = await workspaces.registerProject("gitea-app", remote, "main", "101");
    expect(gitea101.id).toBe("101");
    expect((await workspaces.list()).capabilities).toEqual({ chatWorkspaces: true, forges: { gitea: true, github: true } });
    expect((await workspaces.githubRepositories()).map((repo) => [repo.fullName, repo.projectId])).toEqual([["acme/app", "github-101"], ["acme/readonly", undefined], ["acme/old", undefined]]);

    const task = await workspaces.createConversation(project.id, undefined, "task-1");
    expect(task).toMatchObject({ projectId: "github-101", branch: "coffee/alice/task-1", startBranch: "main", creationState: "ready" });
    expect((await git(root, ["--git-dir", remote, "branch", "--list", "coffee/alice/task-1"])).stdout).toContain("coffee/alice/task-1");
    await git(task.cwd, ["config", "user.name", "Test"]);
    await git(task.cwd, ["config", "user.email", "test@localhost"]);
    await writeFile(join(task.cwd, "README.md"), "changed on GitHub\n");
    await workspaces.checkpoint(task.id, ["README.md"], "Update readme");
    const pull = await workspaces.openPullRequest(task.id, "Update readme");
    expect(pull).toEqual({ number: 41, url: "https://github.com/acme/app/pull/41", state: "open", source: "coffee/alice/task-1", target: "main" });
    // Retrying reuses the open PR instead of creating another one.
    expect(await workspaces.openPullRequest(task.id, "Update readme")).toMatchObject({ number: 41 });
    const posts = fake.requests.filter((request) => request.method === "POST");
    expect(posts.map((request) => [request.url, JSON.parse(request.body)])).toEqual([["/api/v3/repos/acme/app/pulls", { title: "Update readme", head: "coffee/alice/task-1", base: "main" }]]);
    expect(giteaCalls).toEqual([]);
    expect((await workspaces.lookup(task.id))?.pullRequest).toMatchObject({ number: 41 });
  });

  it("explains missing VM Git access and a missing GitHub token", async () => {
    const root = await tempRoot("coffee-github-access-");
    const fake = fakeGitHub([{ id: 9, full_name: "acme/unreachable", default_branch: "main", clone_url: join(root, "missing.git"), html_url: "https://github.com/acme/unreachable", private: true, permissions: { push: true } }]);
    const github = new GitHubClient({ token: TOKEN, apiUrl: await listen(fake.server) });
    const workspaces = new Workspaces(join(root, "store"), { ownerId: "alice", github });
    await expect(workspaces.registerGitHubProject("acme/unreachable")).rejects.toThrow("VM Git cannot read acme/unreachable");
    expect((await workspaces.list()).projects).toEqual([]);
    const plain = new Workspaces(join(root, "plain"), { ownerId: "alice" });
    await expect(plain.githubRepositories()).rejects.toThrow("PI_COFFEE_GITHUB_TOKEN");
    await expect(plain.registerGitHubProject("acme/app")).rejects.toThrow("PI_COFFEE_GITHUB_TOKEN");
  });

  it("serves the GitHub picker actions per user through the Host workspace API", async () => {
    const root = await tempRoot("coffee-github-http-");
    const remote = await bareRepository(root, "app");
    const fake = fakeGitHub([{ id: 101, full_name: "acme/app", default_branch: "main", clone_url: remote, html_url: "https://github.com/acme/app", private: true, permissions: { push: true } }]);
    const github = new GitHubClient({ token: TOKEN, apiUrl: await listen(fake.server) });
    const factory = { list: async () => [], delete: async () => false, create: async () => { throw new Error("Must not start an Agent"); } };
    const host = new HostServer({ port: 0, token: "host-token", requireUser: true, factory, scopeForUser: (user) => ({ factory, workspaces: new Workspaces(join(root, user), { ownerId: user, ...(user === "alice" ? { github } : {}) }) }) });
    await host.start(); hosts.push(host);
    const call = async (body: unknown, user = "alice") => {
      const response = await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`, { method: body ? "POST" : "GET", headers: { authorization: "Bearer host-token", "x-pi-coffee-user": user, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    expect(await call({ action: "github_repos" })).toMatchObject({ status: 200, data: [{ fullName: "acme/app", canPush: true }] });
    expect(await call({ action: "github_project", repository: "acme/app" })).toMatchObject({ status: 200, data: { id: "github-101", forge: "github", name: "acme/app" } });
    expect((await call(undefined)).data).toMatchObject({ projects: [{ id: "github-101", forge: "github" }], capabilities: { forges: { github: true } } });
    expect((await call({ action: "github_repos" })).data[0]).toMatchObject({ projectId: "github-101" });
    // Another user's scope has no GitHub adapter and none of alice's Projects.
    expect(await call({ action: "github_repos" }, "bob")).toMatchObject({ status: 409, data: { error: expect.stringContaining("PI_COFFEE_GITHUB_TOKEN") } });
    expect((await call(undefined, "bob")).data.projects).toEqual([]);
    expect(JSON.stringify(fake.requests.map((request) => request.url))).not.toContain(TOKEN);
  });
});
