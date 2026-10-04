import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import type { PiSession, PiSessionFactory } from "../src/host/pi-adapter.js";
import { GiteaAuth } from "../src/web/auth.js";
import { WebServer } from "../src/web/server.js";
import { normalizeUsername, parseAllowedUsers } from "../src/shared/identity.js";
import { decodeServerFrame, encodeFrame, type ServerFrame } from "../src/shared/protocol.js";

/** Minimal Pi stand-in: enough to open a Session and list it. */
class FakePiSession implements PiSession {
  private readonly listeners = new Set<(event: unknown) => void>();
  messages = 0;
  async prompt(text: string): Promise<void> {
    this.messages += 2;
    for (const l of this.listeners) l({ type: "agent_start" });
    for (const l of this.listeners) l({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `echo: ${text}` } });
    for (const l of this.listeners) l({ type: "message_end", message: { role: "assistant" } });
    for (const l of this.listeners) l({ type: "agent_settled" });
  }
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async abort(): Promise<void> {}
  async getState() { return { isStreaming: false, messageCount: this.messages }; }
  async getHistory() { return { entries: [], leafId: null }; }
  async rename(): Promise<void> {}
  async getModels() { return { models: [], current: null, thinkingLevel: "medium", thinkingLevels: [] }; }
  async setModel(): Promise<void> {}
  async setThinkingLevel(): Promise<void> {}
  async getCommands() { return []; }
  async getExtensions() { return []; }
  async getStats() { return { userMessages: 0, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }; }
  async compact(): Promise<void> {}
  async respondUi(): Promise<void> {}
  onEvent(listener: (event: unknown) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async stop(): Promise<void> {}
}

class FakeFactory implements PiSessionFactory {
  readonly sessions = new Map<string, FakePiSession>();
  async create(options: { sessionId: string }): Promise<PiSession> {
    let session = this.sessions.get(options.sessionId);
    if (!session) { session = new FakePiSession(); this.sessions.set(options.sessionId, session); }
    return session;
  }
  async list() {
    const now = new Date().toISOString();
    return [...this.sessions.entries()].filter(([, s]) => s.messages > 0).map(([id, s]) => ({ id, createdAt: now, updatedAt: now, messageCount: s.messages, preview: "" }));
  }
  async delete(id: string) { return this.sessions.delete(id); }
}

/** A pretend Gitea: hands out one access token per code and knows who it belongs to. */
function fakeGitea(users: Record<string, string>): Promise<{ server: Server; url: string; tokenRequests: unknown[] }> {
  const tokenRequests: unknown[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.url === "/login/oauth/access_token" && request.method === "POST") {
        const parsed = JSON.parse(body) as { code: string; client_id: string; client_secret: string; grant_type: string; redirect_uri: string };
        tokenRequests.push(parsed);
        if (parsed.client_secret !== "s3cret" || !(parsed.code in users)) { response.writeHead(400); response.end("{}"); return; }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ access_token: `tok-${parsed.code}`, token_type: "bearer" }));
        return;
      }
      if (request.url === "/api/v1/user") {
        const code = (request.headers.authorization ?? "").replace("token tok-", "");
        if (!(code in users)) { response.writeHead(401); response.end("{}"); return; }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: 1, login: users[code] }));
        return;
      }
      response.writeHead(404); response.end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    const address = server.address() as { port: number };
    resolve({ server, url: `http://127.0.0.1:${address.port}`, tokenRequests });
  }));
}

/** Drive the browser half of the OAuth dance and return the session cookie. */
async function login(webUrl: string, code: string, returnTo = ""): Promise<{ status: number; cookie?: string; location?: string; body: string }> {
  const start = await fetch(`${webUrl}/auth/login?returnTo=${encodeURIComponent(returnTo)}`, { redirect: "manual" });
  expect(start.status).toBe(302);
  const authorize = new URL(start.headers.get("location")!);
  expect(authorize.pathname).toBe("/login/oauth/authorize");
  expect(authorize.searchParams.get("client_id")).toBe("coffee");
  expect(authorize.searchParams.get("redirect_uri")).toBe(`${webUrl}/auth/callback`);
  const state = authorize.searchParams.get("state")!;
  const callback = await fetch(`${webUrl}/auth/callback?code=${code}&state=${state}`, {
    redirect: "manual",
    headers: { cookie: start.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") },
  });
  const setCookie = callback.headers.get("set-cookie") ?? undefined;
  return { status: callback.status, cookie: setCookie?.split(";")[0], location: callback.headers.get("location") ?? undefined, body: await callback.text() };
}

let gitea: Server | undefined;
let host: HostServer | undefined;
let web: WebServer | undefined;

afterEach(async () => {
  await web?.close();
  await host?.close();
  await new Promise<void>((resolve) => (gitea ? gitea.close(() => resolve()) : resolve()));
  web = host = undefined;
  gitea = undefined;
});

/** Buffered reader: frames arriving back-to-back must not be lost between awaits. */
function reader(socket: WebSocket): (count: number) => Promise<ServerFrame[]> {
  const buffered: ServerFrame[] = [];
  let wake: (() => void) | undefined;
  socket.on("message", (data) => {
    buffered.push(decodeServerFrame(data as Buffer));
    wake?.();
  });
  return async (count) => {
    const out: ServerFrame[] = [];
    while (out.length < count) {
      const frame = buffered.shift();
      if (frame === undefined) { await new Promise<void>((resolve) => { wake = resolve; }); wake = undefined; continue; }
      if (frame.type !== "sessions") out.push(frame);
    }
    return out;
  };
}

describe("Gitea login on the Web Server (ADR-0004 / ADR-0010)", () => {
  it("preserves a conversation deep link through login without allowing external redirects", async () => {
    const fake=await fakeGitea({"code-alice":"alice"});gitea=fake.server;
    web=new WebServer({host:"127.0.0.1",port:0,hostUrl:"ws://127.0.0.1:1/host",auth:new GiteaAuth({giteaUrl:fake.url,clientId:"coffee",clientSecret:"s3cret",allowedUsers:["alice"]})});await web.start();
    const url=`http://127.0.0.1:${web.address().port}`;
    expect((await login(url,"code-alice","/conversations/abc")).location).toBe("/conversations/abc");
    for(const target of ["https://evil.test/", "//evil.test/", "/conversations/a/../other", "/api/secret"]){
      expect((await login(url,"code-alice",target)).location).toBe("/");
    }
  });
  it("accepts an OAuth callback only in the browser that started that login and only once", async () => {
    const fake = await fakeGitea({ "code-alice": "alice" });
    gitea = fake.server;
    const auth = new GiteaAuth({ giteaUrl: fake.url, clientId: "coffee", clientSecret: "s3cret", allowedUsers: ["alice"] });
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: "ws://127.0.0.1:1/host", auth });
    await web.start();
    const webUrl = `http://127.0.0.1:${web.address().port}`;
    const first = await fetch(`${webUrl}/auth/login`, { redirect: "manual" });
    const other = await fetch(`${webUrl}/auth/login`, { redirect: "manual" });
    const cookies = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const state = new URL(first.headers.get("location")!).searchParams.get("state")!;
    const callback = `${webUrl}/auth/callback?code=code-alice&state=${state}`;
    for (const cookie of ["", cookies(other)]) {
      const refused = await fetch(callback, { redirect: "manual", headers: { cookie } });
      expect(refused.headers.get("location")).toContain("/login?error=");
      expect(refused.headers.get("set-cookie")).toBeNull();
    }
    const accepted = await fetch(callback, { redirect: "manual", headers: { cookie: cookies(first) } });
    expect(accepted.headers.get("location")).toBe("/");
    expect(accepted.headers.get("set-cookie")).toContain("pi_coffee_session=");
    const replay = await fetch(callback, { redirect: "manual", headers: { cookie: cookies(first) } });
    expect(replay.headers.get("location")).toContain("/login?error=");
  });

  it("does not revive a logged-out cookie after Web restarts with the same signing secret", async () => {
    const fake = await fakeGitea({ "code-alice": "alice" });
    gitea = fake.server;
    const options = { giteaUrl: fake.url, clientId: "coffee", clientSecret: "s3cret", allowedUsers: ["alice"], cookieSecret: "stable-test-secret" };
    const start = async () => {
      web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: "ws://127.0.0.1:1/host", auth: new GiteaAuth(options) });
      await web.start();
      return `http://127.0.0.1:${web.address().port}`;
    };
    let url = await start();
    const alice = await login(url, "code-alice");
    await fetch(`${url}/auth/logout`, { method: "POST", headers: { cookie: alice.cookie!, origin: url }, redirect: "manual" });
    const again = await login(url, "code-alice");
    expect((await fetch(`${url}/auth/me`, { headers: { cookie: again.cookie! } })).status).toBe(200);
    await web!.close();
    url = await start();
    expect((await fetch(`${url}/auth/me`, { headers: { cookie: alice.cookie! } })).status).toBe(401);
    const renewed = await login(url, "code-alice");
    expect((await fetch(`${url}/auth/me`, { headers: { cookie: renewed.cookie! } })).status).toBe(200);
  });

  it("rejects malformed multibyte session signatures without disrupting HTTP or WebSocket login checks", async () => {
    const auth = new GiteaAuth({ giteaUrl: "http://127.0.0.1", clientId: "coffee", clientSecret: "fixture", allowedUsers: ["alice"] });
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: "ws://127.0.0.1:1/host", auth });
    await web.start();
    const webUrl = `http://127.0.0.1:${web.address().port}`;
    const cookie = `pi_coffee_session=payload.${"é".repeat(43)}`;
    const response = await fetch(`${webUrl}/auth/me`, { headers: { cookie }, signal: AbortSignal.timeout(1000) });
    expect(response.status).toBe(401);
    const refused = new WebSocket(`${webUrl.replace("http", "ws")}/ws`, { headers: { cookie } });
    const [error] = await once(refused, "error") as [Error];
    expect(error.message).toContain("401");
    expect((await fetch(`${webUrl}/healthz`)).status).toBe(200);
  });

  it("normalises login names into safe path segments and parses the allow-list", () => {
    expect(normalizeUsername("Alice")).toBe("alice");
    expect(normalizeUsername(" bob.smith-2_x ")).toBe("bob.smith-2_x");
    for (const bad of ["", "../x", "a/b", "a b", ".", "..", "-lead", "a".repeat(41), 42, undefined]) {
      expect(normalizeUsername(bad)).toBeUndefined();
    }
    expect(parseAllowedUsers(" Alice, bob ,, ../nope ")).toEqual(["alice", "bob"]);
  });

  it("logs a listed Gitea user in, gates the shell and /ws on the cookie, and forwards the login to the Host", async () => {
    const fake = await fakeGitea({ "code-alice": "Alice", "code-bob": "bob", "code-eve": "eve" });
    gitea = fake.server;
    const perUser = new Map<string, FakeFactory>();
    host = new HostServer({
      host: "127.0.0.1", port: 0, factory: new FakeFactory(),
      scopeForUser: (user) => {
        let factory = perUser.get(user);
        if (!factory) { factory = new FakeFactory(); perUser.set(user, factory); }
        return { factory };
      },
    });
    await host.start();
    const auth = new GiteaAuth({ giteaUrl: fake.url, clientId: "coffee", clientSecret: "s3cret", allowedUsers: ["alice", "BOB"], cookieSecret: "test-secret" });
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host`, auth });
    await web.start();
    const webUrl = `http://127.0.0.1:${web.address().port}`;

    // Anonymous: the shell redirects to /login, /auth/me says "no one", the socket is refused.
    const anonymous = await fetch(`${webUrl}/`, { redirect: "manual" });
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get("location")).toBe("/login");
    expect((await fetch(`${webUrl}/login`)).status).toBe(200);
    expect((await fetch(`${webUrl}/auth/me`)).status).toBe(401);
    const refused = new WebSocket(`${webUrl.replace("http", "ws")}/ws`);
    const [refusal] = await once(refused, "error") as [Error];
    expect(refusal.message).toContain("401");

    // A wrong state or a bad code never yields a cookie.
    const forged = await fetch(`${webUrl}/auth/callback?code=code-alice&state=forged`, { redirect: "manual" });
    expect(forged.status).toBe(303);
    expect(forged.headers.get("set-cookie")).toBeNull();
    expect(forged.headers.get("location")).toContain("/login?error=");

    // Someone Gitea knows but the allow-list does not: 403, no cookie.
    const eve = await login(webUrl, "code-eve");
    expect(eve.status).toBe(403);
    expect(eve.cookie).toBeUndefined();
    expect(eve.body).toContain("eve");

    // Alice logs in; the cookie is HttpOnly and names her lowercased login.
    const alice = await login(webUrl, "code-alice");
    expect(alice.status).toBe(303);
    expect(alice.location).toBe("/");
    expect(alice.cookie).toMatch(/^pi_coffee_session=/);
    expect(fake.tokenRequests[1]).toMatchObject({ client_id: "coffee", grant_type: "authorization_code", redirect_uri: `${webUrl}/auth/callback` });
    const me = await fetch(`${webUrl}/auth/me`, { headers: { cookie: alice.cookie! } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ auth: true, user: "alice" });
    expect((await fetch(`${webUrl}/`, { headers: { cookie: alice.cookie! }, redirect: "manual" })).status).toBe(200);

    // A tampered cookie is just "not logged in".
    const [name, value] = alice.cookie!.split("=");
    const tampered = `${name}=${value.slice(0, -2)}xx`;
    expect((await fetch(`${webUrl}/auth/me`, { headers: { cookie: tampered } })).status).toBe(401);

    // Alice's socket reaches the Host as "alice"; Bob's as "bob"; their lists never mix.
    const bob = await login(webUrl, "code-bob");
    const aliceSocket = new WebSocket(`${webUrl.replace("http", "ws")}/ws`, { headers: { cookie: alice.cookie!,origin:webUrl } });
    const aliceFrames = reader(aliceSocket);
    await once(aliceSocket, "open");
    aliceSocket.send(encodeFrame({ v: 1, type: "open" }));
    const [aliceOpened] = await aliceFrames(2);
    if (aliceOpened.type !== "opened") throw new Error("expected opened");
    aliceSocket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p1", text: "hi" }));
    await aliceFrames(5); // ack + 4 events
    expect([...perUser.keys()]).toEqual(["alice"]);
    expect(perUser.get("alice")!.sessions.has(aliceOpened.sessionId)).toBe(true);

    const bobSocket = new WebSocket(`${webUrl.replace("http", "ws")}/ws`, { headers: { cookie: bob.cookie!,origin:webUrl } });
    await once(bobSocket, "open");
    bobSocket.send(encodeFrame({ v: 1, type: "list_sessions" }));
    const [data] = await once(bobSocket, "message") as [Buffer];
    expect(decodeServerFrame(data)).toEqual({ v: 1, type: "sessions", sessions: [] });
    // Alice's own list does show her conversation.
    aliceSocket.send(encodeFrame({ v: 1, type: "list_sessions" }));
    const [aliceList] = await once(aliceSocket, "message") as [Buffer];
    expect(decodeServerFrame(aliceList)).toMatchObject({ type: "sessions", sessions: [{ id: aliceOpened.sessionId }] });
    expect([...perUser.keys()]).toEqual(["alice", "bob"]);

    // Logout: a GET only shows the confirmation (no cross-site logout); POST clears the cookie.
    const logoutPage = await fetch(`${webUrl}/auth/logout`, { headers: { cookie: alice.cookie! }, redirect: "manual" });
    expect(logoutPage.status).toBe(200);
    expect(logoutPage.headers.get("set-cookie")).toBeNull();
    const aliceClosed=once(aliceSocket,"close");
    const logout = await fetch(`${webUrl}/auth/logout`, { method: "POST", headers: { cookie: alice.cookie!,origin:webUrl }, redirect: "manual" });
    expect(logout.status).toBe(303);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    await aliceClosed;
    expect((await fetch(`${webUrl}/auth/me`,{headers:{cookie:alice.cookie!}})).status).toBe(401);

    aliceSocket.close();
    bobSocket.close();
  });

  it("without Gitea configured the shell stays open and /auth/me reports the default user, if any", async () => {
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host`, defaultUser: "dev" });
    await web.start();
    const webUrl = `http://127.0.0.1:${web.address().port}`;
    expect((await fetch(`${webUrl}/`)).status).toBe(200);
    expect(await (await fetch(`${webUrl}/auth/me`)).json()).toEqual({ auth: false, user: "dev" });
    expect((await fetch(`${webUrl}/login`)).status).toBe(404);
  });
});
