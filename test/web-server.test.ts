import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { get as httpGet, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { HostServer } from "../src/host/server.js";
import { TransferServer } from "../src/host/transfer.js";
import type { PiSession, PiSessionFactory } from "../src/host/pi-adapter.js";
import { WebServer } from "../src/web/server.js";
import { decodeServerFrame, encodeFrame, type HistoryEntry, type ImageInput, type ServerFrame } from "../src/shared/protocol.js";

class FakePiSession implements PiSession {
  private readonly listeners = new Set<(event: unknown) => void>();
  private state = { isStreaming: false, messageCount: 0 };

  readonly history: HistoryEntry[] = [];

  async prompt(text: string, _images?: ImageInput[]): Promise<void> {
    this.state = { ...this.state, isStreaming: true };
    this.emit({ type: "agent_start" });
    this.history.push({ kind: "user", id: `u${this.history.length}`, text });
    this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `echo: ${text}` } });
    this.history.push({ kind: "assistant", id: `a${this.history.length}`, text: `echo: ${text}` });
    this.emit({ type: "message_end", message: { role: "assistant" } });
    this.state = { isStreaming: false, messageCount: this.state.messageCount + 2 };
    this.emit({ type: "agent_settled" });
  }

  async getHistory() {
    return { entries: [...this.history], leafId: this.history.at(-1)?.id ?? null };
  }
  async steer(): Promise<void> {}
  async followUp(): Promise<void> {}
  async rename(): Promise<void> {}
  async getModels() { return { models: [], current: null, thinkingLevel: "medium", thinkingLevels: [] }; }
  async setModel(): Promise<void> {}
  async setThinkingLevel(): Promise<void> {}
  async getCommands() { return []; }
  async getExtensions() { return []; }
  async getStats() { return { userMessages: 0, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }; }
  async compact(): Promise<void> {}
  async respondUi(): Promise<void> {}

  async abort(): Promise<void> {
    this.state = { ...this.state, isStreaming: false };
    this.emit({ type: "agent_settled" });
  }

  async getState() {
    return this.state;
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {}

  private emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeFactory implements PiSessionFactory {
  private readonly sessions = new Map<string, FakePiSession>();

  async create(options: { sessionId: string }): Promise<PiSession> {
    const existing = this.sessions.get(options.sessionId);
    if (existing) return existing;
    const session = new FakePiSession();
    this.sessions.set(options.sessionId, session);
    return session;
  }

  async list() {
    const now = new Date().toISOString();
    return [...this.sessions.entries()].map(([id, session]) => ({ id, createdAt: now, updatedAt: now, messageCount: session.history.length, preview: session.history[0]?.text ?? "" }));
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }
}

/** `sessions` broadcasts can arrive at any time; read them via nextSessions(). */
class FrameQueue {
  private readonly frames: ServerFrame[] = [];
  private readonly sessionFrames: ServerFrame[] = [];
  private readonly waiters: Array<(frame: ServerFrame) => void> = [];
  private readonly sessionWaiters: Array<(frame: ServerFrame) => void> = [];

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const frame = decodeServerFrame(data as Buffer);
      const [queue, waiters] = frame.type === "sessions" ? [this.sessionFrames, this.sessionWaiters] : [this.frames, this.waiters];
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    });
  }

  next(): Promise<ServerFrame> {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  nextSessions(): Promise<ServerFrame> {
    const frame = this.sessionFrames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve) => this.sessionWaiters.push(resolve));
  }
}

let host: HostServer | undefined;
let web: WebServer | undefined;

afterEach(async () => {
  await web?.close();
  await host?.close();
  web = undefined;
  host = undefined;
});

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await once(socket, "open");
  return socket;
}

describe("Web Server seam", () => {
  it("bridges a browser conversation to Host and serves the shell", async () => {
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();

    const health = await fetch(`http://127.0.0.1:${web.address().port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, role: "web" });
    const shell = await fetch(`http://127.0.0.1:${web.address().port}/`);
    expect(await shell.text()).toContain("PI Coffee");

    const browser = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const frames = new FrameQueue(browser);
    // The sidebar asks for the list before any session exists; the bridge
    // forwards it to the Host without requiring open first.
    browser.send(encodeFrame({ v: 1, type: "list_sessions" }));
    expect(await frames.nextSessions()).toMatchObject({ type: "sessions", sessions: [] });

    browser.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    expect(opened.type).toBe("opened");
    if (opened.type !== "opened") throw new Error("expected opened");
    expect(await frames.next()).toMatchObject({ type: "history", entries: [] });
    browser.send(encodeFrame({ v: 1, type: "prompt", requestId: "web-r1", text: "hello web" }));
    expect(await frames.next()).toMatchObject({ type: "ack", requestId: "web-r1" });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(await frames.next()).toMatchObject({
      type: "event",
      event: { assistantMessageEvent: { delta: "echo: hello web" } },
    });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "message_end" } });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    const sessionId = opened.sessionId;
    browser.close();
    await once(browser, "close");

    // A different browser with no local state sees the conversation through
    // the Web Server purely from what the Host serves.
    const reconnected = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const replay = new FrameQueue(reconnected);
    reconnected.send(encodeFrame({ v: 1, type: "list_sessions" }));
    expect(await replay.nextSessions()).toMatchObject({ type: "sessions", sessions: [{ id: sessionId }] });
    reconnected.send(encodeFrame({ v: 1, type: "open", sessionId }));
    expect(await replay.next()).toMatchObject({ type: "opened", sessionId });
    expect(await replay.next()).toMatchObject({
      type: "history",
      sessionId,
      entries: [{ kind: "user", text: "hello web" }, { kind: "assistant", text: "echo: hello web" }],
    });
    reconnected.close();
  });

  it("serves the shell assets from public/ and nothing else", async () => {
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();
    const base = `http://127.0.0.1:${web.address().port}`;

    const page = await fetch(`${base}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    const html = await page.text();
    expect(html).toContain('href="/app.css"');
    expect(html).toContain('src="/app.js"');

    const css = await fetch(`${base}/app.css`);
    expect(css.status).toBe(200);
    expect(css.headers.get("content-type")).toContain("text/css");
    expect(await css.text()).toContain("color-scheme: light");

    const js = await fetch(`${base}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    const jsText = await js.text();
    expect(jsText).toContain("'/ws'");
    expect(jsText).toContain("extension_ui_request");

    for (const path of ["/app.txt", "/nested/app.js", "/..%2Fpackage.json", "/../package.json", "/package.json", "/app.js.map"]) {
      const blocked = await fetch(`${base}${path}`);
      expect(blocked.status, path).toBe(404);
    }
  });

  it("serves the Diff bundle from public/vendor/: hashed chunks cached for good, the entry revalidated, text gzipped", async () => {
    const publicDir = mkdtempSync(join(tmpdir(), "pi-coffee-public-"));
    try {
      mkdirSync(join(publicDir, "vendor"));
      const entry = `import "./diffs-AB12CD34.js";\n${"export const view = 'diff';\n".repeat(80)}`;
      const chunk = "export const chunk = 1;\n".repeat(200);
      writeFileSync(join(publicDir, "index.html"), "<!doctype html><title>t</title>");
      writeFileSync(join(publicDir, "app.js"), "console.log('app');\n".repeat(100));
      writeFileSync(join(publicDir, "vendor", "diffs.js"), entry);
      writeFileSync(join(publicDir, "vendor", "diffs-AB12CD34.js"), chunk);
      writeFileSync(join(publicDir, "vendor", "notes.txt"), "not served");
      host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
      await host.start();
      web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host`, publicDir });
      await web.start();
      const port = web.address().port;
      const raw = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolveRequest, reject) => {
        httpGet({ host: "127.0.0.1", port, path, headers }, (response) => {
          const parts: Buffer[] = [];
          response.on("data", (part: Buffer) => parts.push(part));
          response.on("end", () => resolveRequest({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts) }));
        }).on("error", reject);
      });

      const hashed = await raw("/vendor/diffs-AB12CD34.js", { "accept-encoding": "gzip, br" });
      expect(hashed.status).toBe(200);
      expect(hashed.headers["content-type"]).toContain("text/javascript");
      expect(hashed.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      expect(hashed.headers["content-encoding"]).toBe("gzip");
      expect(hashed.headers.vary).toBe("accept-encoding");
      expect(hashed.body.length).toBeLessThan(chunk.length / 4);
      expect(gunzipSync(hashed.body).toString()).toBe(chunk);

      const plain = await raw("/vendor/diffs.js");
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.headers["cache-control"]).toBe("no-cache");
      expect(plain.body.toString()).toBe(entry);
      const etag = String(plain.headers.etag);
      expect(etag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
      const revalidated = await raw("/vendor/diffs.js", { "if-none-match": etag });
      expect(revalidated.status).toBe(304);
      expect(revalidated.body.length).toBe(0);
      writeFileSync(join(publicDir, "vendor", "diffs.js"), entry + "// rebuilt\n");
      const rebuilt = await raw("/vendor/diffs.js", { "if-none-match": etag });
      expect(rebuilt.status).toBe(200);
      expect(rebuilt.headers.etag).not.toBe(etag);

      // The shell stays uncacheable, but it is compressed too.
      const shell = await raw("/app.js", { "accept-encoding": "gzip" });
      expect(shell.headers["cache-control"]).toBe("no-store");
      expect(shell.headers.etag).toBeUndefined();
      expect(gunzipSync(shell.body).toString()).toContain("console.log('app');");

      for (const path of ["/vendor/notes.txt", "/vendor/x/diffs.js", "/vendor/..%2Fapp.js", "/vendor/..%2F..%2Fpackage.json", "/vendor/../../package.json", "/vendor/.diffs.js", "/vendor/diffs.css", "/vendor/missing.js", "/vendor/"]) {
        expect((await raw(path)).status, path).toBe(404);
      }
    } finally {
      rmSync(publicDir, { recursive: true, force: true });
    }
  });

  it("serves the shell and the WebSocket over HTTPS when given TLS material (the optional secure route)", async () => {
    const cert = readFileSync(resolve("test/fixtures/tls/test-cert.pem"));
    const key = readFileSync(resolve("test/fixtures/tls/test-key.pem"));
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host`, tls: { cert, key } });
    await web.start();
    expect(web.scheme).toBe("https");

    // The test certificate is the trust anchor here, standing in for an internal CA.
    const page = await new Promise<{ status: number; body: string }>((resolvePromise, reject) => {
      httpsRequest({ host: "127.0.0.1", port: web!.address().port, path: "/", ca: cert }, (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => resolvePromise({ status: response.statusCode ?? 0, body }));
      }).on("error", reject).end();
    });
    expect(page.status).toBe(200);
    expect(page.body).toContain("PI Coffee");

    const browser = new WebSocket(`wss://127.0.0.1:${web.address().port}/ws`, { ca: cert });
    await once(browser, "open");
    const frames = new FrameQueue(browser);
    browser.send(encodeFrame({ v: 1, type: "list_sessions" }));
    expect(await frames.nextSessions()).toMatchObject({ type: "sessions" });
    browser.close();
  });

  it("returns a structured error when the browser sends malformed JSON", async () => {
    host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory() });
    await host.start();
    web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
    await web.start();
    const browser = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
    const frames = new FrameQueue(browser);
    browser.send("not-json");
    await expect(frames.next()).resolves.toMatchObject({ type: "error", code: "invalid_json", fatal: true });
    browser.close();
  });

  it("streams LocalSend v2 uploads and downloads through the same-origin Web gateway (ADR-0010 §4)", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "coffee-web-localsend-"));
    const transfer = new TransferServer({ host: "127.0.0.1", port: 0, workdir });
    await transfer.start();
    try {
      host = new HostServer({ host: "127.0.0.1", port: 0, factory: new FakeFactory(), transfer });
      await host.start();
      web = new WebServer({ host: "127.0.0.1", port: 0, hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
      await web.start();

      const browser = await connect(`ws://127.0.0.1:${web.address().port}/ws`);
      const frames = new FrameQueue(browser);
      browser.send(encodeFrame({ v: 1, type: "open" }));
      const opened = await frames.next();
      expect(opened.type).toBe("opened");
      expect(await frames.next()).toMatchObject({ type: "history" });
      const grant = await frames.next();
      expect(grant.type).toBe("transfer");
      if (grant.type !== "transfer") throw new Error("expected transfer grant");

      const webBase = `http://127.0.0.1:${web.address().port}`;
      const prepare = await fetch(`${webBase}/api/localsend/v2/prepare-upload?scope=${encodeURIComponent(grant.scope)}&token=${encodeURIComponent(grant.token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          info: { alias: "PI Coffee Web", version: "2.0" },
          files: { f1: { id: "f1", fileName: "spec.txt", size: 11, fileType: "text/plain" } },
        }),
      });
      expect(prepare.status).toBe(200);
      const prepared = (await prepare.json()) as { sessionId: string; files: Record<string, string> };
      const uploaded = await fetch(`${webBase}/api/localsend/v2/upload?sessionId=${encodeURIComponent(prepared.sessionId)}&fileId=f1&token=${encodeURIComponent(prepared.files.f1)}`, {
        method: "POST",
        body: "hello world",
      });
      expect(uploaded.status).toBe(200);
      const uploadedJson = (await uploaded.json()) as { path: string };
      expect(uploadedJson.path).toContain("spec.txt");

      const downloaded = await fetch(`${webBase}/api/localsend/v2/download?scope=${encodeURIComponent(grant.scope)}&token=${encodeURIComponent(grant.token)}&fileId=${encodeURIComponent(uploadedJson.path)}`);
      expect(downloaded.status).toBe(200);
      expect(await downloaded.text()).toBe("hello world");
      browser.close();
    } finally {
      await transfer.close();
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
