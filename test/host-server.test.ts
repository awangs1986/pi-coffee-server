import { Workspaces } from "../src/host/workspaces.js";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { TransferServer } from "../src/host/transfer.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry, ImageInput } from "../src/shared/protocol.js";
import { decodeServerFrame, encodeFrame, type ServerFrame } from "../src/shared/protocol.js";
import { HostServer } from "../src/host/server.js";
import { RpcPiSessionFactory, type PiSession, type PiSessionFactory } from "../src/host/pi-adapter.js";

const exec=promisify(execFile);
async function workspaceConversation(root:string,name:string) {
  const source=join(root,`${name}-source`),remote=join(root,`${name}.git`);await mkdir(source);
  await exec("git",["-c","user.name=Test","-c","user.email=test@localhost","init","-b","main"],{cwd:source});await writeFile(join(source,"README.md"),"base\n");
  await exec("git",["-c","user.name=Test","-c","user.email=test@localhost","add","."],{cwd:source});await exec("git",["-c","user.name=Test","-c","user.email=test@localhost","commit","-m","base"],{cwd:source});await exec("git",["clone","--bare",source,remote],{cwd:root});
  const workspaces=new Workspaces(join(root,`${name}-workspaces`),{ownerId:"vm-test"});const project=await workspaces.registerProject(name,remote);const conversation=await workspaces.createConversation(project.id);return {workspaces,project,conversation};
}

class FakePiSession implements PiSession {
  private readonly listeners = new Set<(event: unknown) => void>();
  private state = { isStreaming: false, messageCount: 0, sessionName: undefined as string | undefined };
  readonly history: HistoryEntry[] = [];
  /** When set, prompt() stops after the first delta so the message stays in flight. */
  holdAfterDelta = false;

  /** Simulates a turn driven by another process (terminal): state says streaming, no events arrive. */
  externallyBusy = false;

  background={known:true,active:0};
  async backgroundState(){return this.background;}


  async prompt(text: string, _images?: ImageInput[]): Promise<void> {
    this.state = { ...this.state, isStreaming: true };
    this.emit({ type: "agent_start" });
    this.history.push({ kind: "user", id: `u${this.history.length}`, text });
    this.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `echo: ${text}` },
    });
    if (this.holdAfterDelta) return;
    this.finish(text);
  }

  finish(text: string): void {
    this.history.push({ kind: "assistant", id: `a${this.history.length}`, text: `echo: ${text}` });
    this.emit({ type: "message_end", message: { role: "assistant" } });
    this.state = { ...this.state, isStreaming: false, messageCount: this.state.messageCount + 2 };
    this.emit({ type: "agent_settled" });
  }

  async getHistory() {
    return { entries: [...this.history], leafId: this.history.at(-1)?.id ?? null };
  }

  readonly queued: Array<{ mode: string; text: string }> = [];
  async steer(text: string): Promise<void> {
    this.queued.push({ mode: "steer", text });
    this.emit({ type: "queue_update", steering: [text], followUp: [] });
  }
  async followUp(text: string): Promise<void> {
    this.queued.push({ mode: "follow_up", text });
    this.emit({ type: "queue_update", steering: [], followUp: [text] });
  }
  name?: string;
  async rename(name: string): Promise<void> { this.name = name; this.state = { ...this.state, sessionName: name }; }
  model = { provider: "fake", id: "fake-mini" };
  thinking = "medium";
  async getModels() {
    return { models: [{ provider: "fake", id: "fake-mini" }, { provider: "fake", id: "fake-large" }], current: this.model, thinkingLevel: this.thinking, thinkingLevels: ["off", "low", "medium", "high"] };
  }
  async setModel(provider: string, id: string): Promise<void> { this.model = { provider, id }; }
  async setThinkingLevel(level: string): Promise<void> { this.thinking = level; }
  async getCommands() { return [{ name: "harness", description: "Switch harness mode", source: "extension" as const }]; }
  async getExtensions() { return [{ name: "harness/extension.js", kind: "extension" as const, path: "/opt/x/harness/extension.js", origin: "configured", commands: [{ name: "harness", description: "Switch harness mode" }] }]; }
  async getStats() {
    return { userMessages: 1, assistantMessages: 1, toolCalls: 0, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.001, contextUsage: { tokens: 15, contextWindow: 1000, percent: 1.5 } };
  }
  compacted = 0;
  async compact(): Promise<void> { this.compacted += 1; }

  /** Simulates an extension dialog: emits the request, resolves on respondUi. */
  readonly uiAnswers: unknown[] = [];
  askUser(id: string): void {
    this.emit({ type: "extension_ui_request", id, method: "confirm", title: "Proceed?", message: "fake extension asks" });
  }
  async respondUi(response: unknown): Promise<void> {
    this.uiAnswers.push(response);
    this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "echo: asked" } });
    this.finish("asked");
  }

  async abort(): Promise<void> {
    this.state = { ...this.state, isStreaming: false };
    this.emit({ type: "agent_settled" });
  }

  async getState() {
    return this.externallyBusy ? { ...this.state, isStreaming: true } : this.state;
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stopped = false;
  startedTwice = false;

  async stop(): Promise<void> {
    this.stopped = true;
  }

  private emit(event: unknown): void {
    for (const listener of this.listeners) listener(event);
  }
}

class FakeFactory implements PiSessionFactory {
  readonly sessions = new Map<string, FakePiSession>();
  /** Conversations "on disk" that no live session has been created for yet. */
  readonly stored: Array<{ id: string; preview: string }> = [];

  async create(options: { sessionId: string }): Promise<PiSession> {
    const existing = this.sessions.get(options.sessionId);
    if (existing) {
      existing.startedTwice = true;
      existing.stopped = false;
      return existing;
    }
    const session = new FakePiSession();
    this.sessions.set(options.sessionId, session);
    return session;
  }

  async list() {
    const now = new Date().toISOString();
    return [
      ...this.stored.map((item) => ({ id: item.id, createdAt: now, updatedAt: now, messageCount: 2, preview: item.preview })),
      // Like Pi, a conversation gets a file only once it has a message.
      ...[...this.sessions.entries()]
        .filter(([id, session]) => !this.stored.some((item) => item.id === id) && session.history.length > 0)
        .map(([id, session]) => ({
          id,
          ...(session.name === undefined ? {} : { name: session.name }),
          createdAt: now,
          updatedAt: now,
          messageCount: session.history.length,
          preview: session.history.find((entry) => entry.kind === "user")?.text ?? "",
        })),
    ];
  }

  readonly deleted: string[] = [];
  async delete(sessionId: string): Promise<boolean> {
    this.deleted.push(sessionId);
    const known = this.sessions.delete(sessionId);
    const index = this.stored.findIndex((item) => item.id === sessionId);
    if (index >= 0) this.stored.splice(index, 1);
    return known || index >= 0;
  }
}

let server: HostServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/**
 * Ordered frame reader. `sessions` broadcasts can arrive at any moment, so
 * `next()` skips them and `nextSessions()` waits for one explicitly.
 */
class FrameQueue {
  private readonly frames: ServerFrame[] = [];
  private readonly sessionFrames: ServerFrame[] = [];
  private readonly waiters: Array<(frame: ServerFrame) => void> = [];
  private readonly sessionWaiters: Array<(frame: ServerFrame) => void> = [];

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const frame = decodeServerFrame(data as Buffer);
      if (frame.type === "sessions") {
        const waiter = this.sessionWaiters.shift();
        if (waiter) waiter(frame);
        else this.sessionFrames.push(frame);
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) waiter(frame);
      else this.frames.push(frame);
    });
  }

  next(): Promise<ServerFrame> {
    const frame = this.frames.shift();
    if (frame) return Promise.resolve(frame);
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        const index = this.waiters.indexOf(resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(error);
      };
      this.socket.once("error", onError);
      this.waiters.push((nextFrame) => {
        this.socket.off("error", onError);
        resolve(nextFrame);
      });
    });
  }

  nextSessions(): Promise<Extract<ServerFrame, { type: "sessions" }>> {
    const frame = this.sessionFrames.shift();
    if (frame) return Promise.resolve(frame as Extract<ServerFrame, { type: "sessions" }>);
    return new Promise((resolve) => this.sessionWaiters.push((f) => resolve(f as Extract<ServerFrame, { type: "sessions" }>)));
  }
}

async function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/host`);
  await once(socket, "open");
  return socket;
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("Host WebSocket seam", () => {
  it("advertises the external protocol version on its health endpoint", async () => {
    server = new HostServer({ port: 0, host: "127.0.0.1", factory: new FakeFactory() });
    await server.start();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    expect(await response.json()).toMatchObject({ ok: true, role: "host", protocolVersion: 1, capabilities:{ownerEnvironment:true} });
  });

  it("keeps a Pi session alive across browser disconnect and hands a new browser the durable history", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, eventBufferSize: 32 });
    await server.start();
    const port = server.address().port;

    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    expect(opened.type).toBe("opened");
    if (opened.type !== "opened") throw new Error("expected opened");
    // A brand-new session has an empty history; the frame is still sent so the
    // browser can always reset its view from the Host's truth.
    expect(await firstFrames.next()).toMatchObject({ type: "history", sessionId: opened.sessionId, entries: [], truncated: false });

    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "hello" }));
    expect(await firstFrames.next()).toMatchObject({ type: "ack", operation: "prompt", requestId: "r1" });
    expect(await firstFrames.next()).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(await firstFrames.next()).toMatchObject({
      type: "event",
      event: { type: "message_update", assistantMessageEvent: { delta: "echo: hello" } },
    });
    expect(await firstFrames.next()).toMatchObject({ type: "event", event: { type: "message_end" } });
    const settled = await firstFrames.next();
    expect(settled).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    first.close();
    await once(first, "close");

    // A browser that has never seen this session (no cursor) gets the whole
    // completed conversation from the durable store and no replayed deltas:
    // nothing is in flight, so there is nothing to catch up on.
    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", sessionId: opened.sessionId });
    const history = await secondFrames.next();
    expect(history).toMatchObject({
      type: "history",
      entries: [
        { kind: "user", text: "hello" },
        { kind: "assistant", text: "echo: hello" },
      ],
    });
    second.send(encodeFrame({ v: 1, type: "ping", nonce: "after-history" }));
    expect(await secondFrames.next()).toMatchObject({ type: "pong", nonce: "after-history" });
    second.close();
  });

  it("replays only the in-flight tail after the history when a message is still streaming", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, eventBufferSize: 32 });
    await server.start();
    const port = server.address().port;

    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await firstFrames.next(); // history
    const pi = factory.sessions.get(opened.sessionId)!;

    // First turn completes; second turn is held mid-stream.
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "one" }));
    for (let i = 0; i < 5; i++) await firstFrames.next(); // ack, agent_start, delta, message_end, settled
    pi.holdAfterDelta = true;
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r2", text: "two" }));
    await firstFrames.next(); // ack
    const start = await firstFrames.next();
    const delta = await firstFrames.next();
    expect(start).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(delta).toMatchObject({ type: "event", event: { assistantMessageEvent: { delta: "echo: two" } } });
    first.close();
    await once(first, "close");

    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", state: { isStreaming: true } });
    const history = await secondFrames.next();
    expect(history).toMatchObject({ type: "history" });
    if (history.type !== "history") throw new Error("expected history");
    // Completed turn is in the history; the in-flight second turn is not yet.
    expect(history.entries.map((entry) => entry.text)).toEqual(["one", "echo: one", "two"]);
    // Replay covers exactly the in-flight events: agent_start and the delta,
    // never the first turn's deltas that the history already contains.
    const replay1 = await secondFrames.next();
    const replay2 = await secondFrames.next();
    expect(replay1).toMatchObject({ type: "event", event: { type: "agent_start" } });
    expect(replay2).toMatchObject({ type: "event", event: { assistantMessageEvent: { delta: "echo: two" } } });
    if (start.type === "event" && replay1.type === "event") expect(replay1.cursor).toBe(start.cursor);

    pi.finish("two");
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { type: "message_end" } });
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    second.close();
  });

  it("lists durable and live sessions before any session is opened", async () => {
    const factory = new FakeFactory();
    factory.stored.push({ id: "stored-1", preview: "an older conversation" });
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);

    socket.send(encodeFrame({ v: 1, type: "list_sessions" }));
    const listed = await frames.nextSessions();
    expect(listed).toMatchObject({ type: "sessions", sessions: [{ id: "stored-1", preview: "an older conversation", running: false }] });

    // Opening a stored session resumes it through the factory by id.
    socket.send(encodeFrame({ v: 1, type: "open", sessionId: "stored-1" }));
    expect(await frames.next()).toMatchObject({ type: "opened", sessionId: "stored-1" });
    expect(await frames.next()).toMatchObject({ type: "history", sessionId: "stored-1" });
    expect(factory.sessions.has("stored-1")).toBe(true);
    socket.close();
  });

  it("flags conversations that need the user: a pending dialog, or a run that finished with nobody watching (P0)", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const port = server.address().port;
    const socket = await connect(port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await frames.next(); // history
    const pi = factory.sessions.get(opened.sessionId)!;

    // A dialog is waiting for an answer: the list says so while the browser is attached.
    pi.holdAfterDelta = true;
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p1", text: "ask me" }));
    for (let i = 0; i < 3; i++) await frames.next(); // ack, agent_start, delta
    pi.askUser("ui-1");
    await frames.next();
    socket.send(encodeFrame({ v: 1, type: "list_sessions" }));
    let listed = await frames.nextSessions();
    expect(listed.sessions.find((s) => s.id === opened.sessionId)).toMatchObject({ running: true, attention: "waiting" });

    // The browser leaves; the run finishes unattended -> "finished" until someone opens it again.
    socket.close();
    await once(socket, "close");
    pi.finish("ask me");
    const other = await connect(port);
    const otherFrames = new FrameQueue(other);
    other.send(encodeFrame({ v: 1, type: "list_sessions" }));
    listed = await otherFrames.nextSessions();
    expect(listed.sessions.find((s) => s.id === opened.sessionId)).toMatchObject({ running: false, attention: "finished" });

    // Opening the conversation clears the flag.
    other.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    await otherFrames.next(); // opened
    await otherFrames.next(); // history
    other.send(encodeFrame({ v: 1, type: "list_sessions" }));
    listed = await otherFrames.nextSessions();
    expect(listed.sessions.find((s) => s.id === opened.sessionId)?.attention).toBeUndefined();

    // A run that finishes while a browser is attached is not "finished" for the list (the browser saw it).
    other.send(encodeFrame({ v: 1, type: "prompt", requestId: "p2", text: "again" }));
    pi.holdAfterDelta = false;
    for (let i = 0; i < 5; i++) await otherFrames.next(); // ack, agent_start, delta, message_end, settled
    other.send(encodeFrame({ v: 1, type: "list_sessions" }));
    listed = await otherFrames.nextSessions();
    expect(listed.sessions.find((s) => s.id === opened.sessionId)?.attention).toBeUndefined();
    other.close();
  });

  it("watches a turn that another process is driving and settles the browser once it ends (P3 take-over)", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, externalPollMs: 20 });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);
    // Pre-create the session "busy elsewhere": its state says streaming although nothing was prompted here.
    const pi = await factory.create({ sessionId: "cli-thread" }) as FakePiSession;
    pi.externallyBusy = true;
    socket.send(encodeFrame({ v: 1, type: "open", sessionId: "cli-thread" }));
    expect(await frames.next()).toMatchObject({ type: "opened", state: { isStreaming: true } });
    await frames.next(); // history
    // A prompt is refused while the terminal owns the turn.
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p1", text: "me too" }));
    expect(await frames.next()).toMatchObject({ type: "error", code: "busy" });
    // The terminal finishes; the Host notices without any event from the adapter and tells the browser.
    pi.externallyBusy = false;
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p2", text: "now mine" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "prompt" });
    socket.close();
  });

  it("stops an idle Pi process and resumes the conversation from the store on the next open", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, idleTimeoutMs: 60 });
    await server.start();
    const port = server.address().port;

    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await firstFrames.next();
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "r1", text: "hello" }));
    for (let i = 0; i < 5; i++) await firstFrames.next();
    const firstPi = factory.sessions.get(opened.sessionId)!;
    first.close();
    await once(first, "close");

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(firstPi.stopped).toBe(true);

    // The store still has the conversation; reopening creates a fresh Pi
    // process for the same id and the browser sees the same history.
    factory.stored.push({ id: opened.sessionId, preview: "hello" });
    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", sessionId: opened.sessionId });
    expect(await secondFrames.next()).toMatchObject({ type: "history", sessionId: opened.sessionId });
    expect(factory.sessions.get(opened.sessionId)).toBe(firstPi); // same fake object reused by the factory
    expect(firstPi.startedTwice).toBe(true);
    second.close();
  });

  it.each([{ known: true, active: 1 }, { known: false, active: 0 }])("keeps a disconnected parent alive until background work is known idle: %j", async (background) => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, idleTimeoutMs: 30 });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await frames.next();
    const pi = factory.sessions.get(opened.sessionId)!;
    pi.background = background;
    socket.close();
    await once(socket, "close");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(pi.stopped).toBe(false);
    pi.background = { known: true, active: 0 };
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(pi.stopped).toBe(true);
  });

  it("joins a busy run with steer/follow_up and falls back to a plain prompt when idle", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await frames.next(); // history
    const pi = factory.sessions.get(opened.sessionId)!;

    // Idle session + follow_up mode: behaves like a normal prompt.
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p1", text: "first", mode: "follow_up" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "prompt", requestId: "p1" });
    for (let i = 0; i < 4; i++) await frames.next();

    // Busy session: the message is queued through Pi, not rejected as busy.
    pi.holdAfterDelta = true;
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p2", text: "second" }));
    for (let i = 0; i < 3; i++) await frames.next(); // ack, agent_start, delta
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p3", text: "also do this", mode: "follow_up" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "follow_up", requestId: "p3" });
    expect(await frames.next()).toMatchObject({ type: "event", event: { type: "queue_update", followUp: ["also do this"] } });
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p4", text: "actually stop", mode: "steer" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "steer", requestId: "p4" });
    expect(pi.queued).toEqual([{ mode: "follow_up", text: "also do this" }, { mode: "steer", text: "actually stop" }]);
    // A plain prompt while busy is still refused.
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p5", text: "plain" }));
    await frames.next(); // queue_update from steer
    expect(await frames.next()).toMatchObject({ type: "error", code: "busy", requestId: "p5" });
    pi.finish("second");
    socket.close();
  });

  it("exposes models, thinking, commands, stats and compact through the seam", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "get_models" }));
    expect(await frames.next()).toMatchObject({ type: "error", code: "not_open" });
    socket.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await frames.next();
    const pi = factory.sessions.get(opened.sessionId)!;

    socket.send(encodeFrame({ v: 1, type: "get_models" }));
    expect(await frames.next()).toMatchObject({ type: "models", current: { id: "fake-mini" }, thinkingLevel: "medium", thinkingLevels: ["off", "low", "medium", "high"] });
    socket.send(encodeFrame({ v: 1, type: "set_model", requestId: "m1", provider: "fake", id: "fake-large" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "set_model", requestId: "m1" });
    expect(pi.model).toEqual({ provider: "fake", id: "fake-large" });
    socket.send(encodeFrame({ v: 1, type: "set_thinking", level: "high" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "set_thinking" });
    expect(pi.thinking).toBe("high");
    socket.send(encodeFrame({ v: 1, type: "get_commands" }));
    expect(await frames.next()).toMatchObject({ type: "commands", commands: [{ name: "harness", source: "extension" }] });
    socket.send(encodeFrame({ v: 1, type: "get_extensions" }));
    expect(await frames.next()).toMatchObject({ type: "extensions", sessionId: opened.sessionId, extensions: [{ name: "harness/extension.js", kind: "extension", origin: "configured" }] });
    socket.send(encodeFrame({ v: 1, type: "get_stats" }));
    expect(await frames.next()).toMatchObject({ type: "stats", sessionId: opened.sessionId, stats: { cost: 0.001, contextUsage: { percent: 1.5 } } });
    socket.send(encodeFrame({ v: 1, type: "compact", requestId: "c1" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "compact", requestId: "c1" });
    await waitFor(() => pi.compacted === 1);
    pi.compact = async () => { throw new Error("Local compaction unavailable"); };
    socket.send(encodeFrame({ v: 1, type: "compact", requestId: "c-fail" }));
    expect(await frames.next()).toMatchObject({ type: "error", requestId: "c-fail" });
    socket.close();
  });

  it("renames and deletes conversations and pushes the list to every connected browser", async () => {
    const factory = new FakeFactory();
    factory.stored.push({ id: "stored-1", preview: "old one" });
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const port = server.address().port;

    // A second browser that only watches the sidebar.
    const watcher = await connect(port);
    const watcherFrames = new FrameQueue(watcher);
    watcher.send(encodeFrame({ v: 1, type: "list_sessions" }));
    expect((await watcherFrames.nextSessions()).sessions.map((s) => s.id)).toEqual(["stored-1"]);

    const socket = await connect(port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await frames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await frames.next();
    // An empty new conversation is not listed yet (Codex behaviour); the
    // watcher learns about it, without asking, once it has content.
    const emptyPush = await watcherFrames.nextSessions();
    expect(emptyPush.sessions.map((s) => s.id)).not.toContain(opened.sessionId);
    socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "p1", text: "hello" }));
    for (let i = 0; i < 5; i++) await frames.next();
    let pushed = await watcherFrames.nextSessions();
    while (!pushed.sessions.some((s) => s.id === opened.sessionId)) pushed = await watcherFrames.nextSessions();
    expect(pushed.sessions.find((s) => s.id === opened.sessionId)?.messageCount).toBe(2);

    socket.send(encodeFrame({ v: 1, type: "rename_session", requestId: "n1", name: "Coffee plan" }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "rename_session", requestId: "n1" });
    expect(factory.sessions.get(opened.sessionId)!.name).toBe("Coffee plan");
    const afterRename = await watcherFrames.nextSessions();
    expect(afterRename.sessions.find((s) => s.id === opened.sessionId)?.name).toBe("Coffee plan");

    // Deleting a stored conversation from the sidebar, before/without opening it.
    watcher.send(encodeFrame({ v: 1, type: "delete_session", requestId: "d1", sessionId: "stored-1" }));
    expect(await watcherFrames.next()).toMatchObject({ type: "ack", operation: "delete_session", requestId: "d1" });
    expect(factory.deleted).toEqual(["stored-1"]);
    expect((await watcherFrames.nextSessions()).sessions.map((s) => s.id)).not.toContain("stored-1");
    watcher.send(encodeFrame({ v: 1, type: "delete_session", requestId: "d2", sessionId: "nope" }));
    expect(await watcherFrames.next()).toMatchObject({ type: "error", code: "unknown_session", requestId: "d2" });

    // Deleting the live conversation stops its Pi process.
    socket.send(encodeFrame({ v: 1, type: "delete_session", requestId: "d3", sessionId: opened.sessionId }));
    expect(await frames.next()).toMatchObject({ type: "ack", operation: "delete_session", requestId: "d3" });
    await waitFor(() => factory.deleted.includes(opened.sessionId));
    socket.close();
    watcher.close();
  });

  it("carries extension dialogs to the browser, re-delivers them to a reconnecting browser, and routes the answer back", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const port = server.address().port;
    const first = await connect(port);
    const firstFrames = new FrameQueue(first);
    first.send(encodeFrame({ v: 1, type: "open" }));
    const opened = await firstFrames.next();
    if (opened.type !== "opened") throw new Error("expected opened");
    await firstFrames.next();
    const pi = factory.sessions.get(opened.sessionId)!;

    // A run starts and the extension asks a question; the browser goes away.
    pi.holdAfterDelta = true;
    first.send(encodeFrame({ v: 1, type: "prompt", requestId: "p1", text: "do something risky" }));
    for (let i = 0; i < 3; i++) await firstFrames.next(); // ack, agent_start, delta
    pi.askUser("ui-1");
    expect(await firstFrames.next()).toMatchObject({ type: "event", event: { type: "extension_ui_request", id: "ui-1", method: "confirm" } });
    // Answering with an id nobody is waiting on is reported, not swallowed.
    first.send(encodeFrame({ v: 1, type: "ui_response", requestId: "x", id: "nope", confirmed: true }));
    expect(await firstFrames.next()).toMatchObject({ type: "error", code: "unknown_ui_request", requestId: "x" });
    first.close();
    await once(first, "close");

    // A fresh browser opens the same Session: history, the in-flight tail,
    // and the still-pending dialog (once, not twice).
    const second = await connect(port);
    const secondFrames = new FrameQueue(second);
    second.send(encodeFrame({ v: 1, type: "open", sessionId: opened.sessionId }));
    expect(await secondFrames.next()).toMatchObject({ type: "opened", state: { isStreaming: true } });
    expect(await secondFrames.next()).toMatchObject({ type: "history" });
    const tail: ServerFrame[] = [];
    for (let i = 0; i < 3; i++) tail.push(await secondFrames.next()); // agent_start, delta, ui request (from replay)
    const requests = tail.filter((f) => f.type === "event" && (f.event as { type?: string }).type === "extension_ui_request");
    expect(requests).toHaveLength(1);

    second.send(encodeFrame({ v: 1, type: "ui_response", requestId: "a1", id: "ui-1", confirmed: true }));
    expect(await secondFrames.next()).toMatchObject({ type: "ack", operation: "ui_response", requestId: "a1" });
    expect(pi.uiAnswers).toEqual([{ id: "ui-1", confirmed: true }]);
    // The fake finishes the turn once answered.
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { assistantMessageEvent: { delta: "echo: asked" } } });
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { type: "message_end" } });
    expect(await secondFrames.next()).toMatchObject({ type: "event", event: { type: "agent_settled" } });
    // Once settled, the dialog is gone: a second answer is unknown.
    second.send(encodeFrame({ v: 1, type: "ui_response", id: "ui-1", cancelled: true }));
    expect(await secondFrames.next()).toMatchObject({ type: "error", code: "unknown_ui_request" });
    second.close();
  });

  it("tells the browser where to transfer files and relays transfer events on the session stream", async () => {
    const factory = new FakeFactory();
    const workdir = mkdtempSync(join(tmpdir(), "pi-coffee-host-transfer-"));
    const transfer = new TransferServer({ host: "127.0.0.1", port: 0, workdir, advertiseHost: "127.0.0.1", onEvent: (scope, event) => server?.announce(scope, event) });
    await transfer.start();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, transfer });
    await server.start();
    try {
      const socket = await connect(server.address().port);
      const frames = new FrameQueue(socket);
      socket.send(encodeFrame({ v: 1, type: "open" }));
      const opened = await frames.next();
      if (opened.type !== "opened") throw new Error("expected opened");
      await frames.next(); // history
      const info = await frames.next();
      expect(info).toMatchObject({ type: "transfer", sessionId: opened.sessionId, scope: expect.any(String), url: `http://127.0.0.1:${transfer.address().port}`, inbox: `.pi-coffee/inbox/${opened.sessionId}` });
      if (info.type !== "transfer") throw new Error("expected transfer");

      // Upload with the advertised token: the browser talks to the transfer
      // endpoint directly; the Host reports completion on the Session stream.
      const prepared = await fetch(`${info.url}/api/localsend/v2/prepare-upload?scope=${info.scope}&token=${info.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: { a: { id: "a", fileName: "brief.md", size: 5 } } }),
      });
      const { sessionId, files } = await prepared.json() as { sessionId: string; files: Record<string, string> };
      const up = await fetch(`${info.url}/api/localsend/v2/upload?sessionId=${sessionId}&fileId=a&token=${files.a}`, { method: "POST", body: "hello" });
      expect(up.status).toBe(200);
      // Progress events may precede completion; both ride the Session stream.
      let event = await frames.next();
      while (event.type === "event" && (event.event as { type?: string }).type === "transfer_progress") event = await frames.next();
      expect(event).toMatchObject({ type: "event", sessionId: opened.sessionId, event: { type: "transfer_complete", fileName: "brief.md", path: `.pi-coffee/inbox/${opened.sessionId}/brief.md`, size: 5 } });
      expect(existsSync(join(workdir, ".pi-coffee", "inbox", opened.sessionId, "brief.md"))).toBe(true);
      socket.close();
    } finally {
      await transfer.close();
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("keeps two Browser Users apart inside one Host: own store, own list pushes, own inbox root (ADR-0010)", async () => {
    const shared = new FakeFactory();
    const perUser = new Map<string, FakeFactory>();
    const root = mkdtempSync(join(tmpdir(), "pi-coffee-host-users-"));
    const transfer = new TransferServer({ host: "127.0.0.1", port: 0, workdir: root, advertiseHost: "127.0.0.1", onEvent: (scope, event) => server?.announce(scope, event) });
    await transfer.start();
    const scopes: string[] = [];
    server = new HostServer({
      port: 0, host: "127.0.0.1", factory: shared, transfer,
      scopeForUser: (user) => {
        scopes.push(user);
        let factory = perUser.get(user);
        if (!factory) { factory = new FakeFactory(); perUser.set(user, factory); }
        return { factory, workdir: join(root, user) };
      },
    });
    await server.start();
    const connectAs = async (user?: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server!.address().port}/host`, user === undefined ? undefined : { headers: { "x-pi-coffee-user": user } });
      await once(socket, "open");
      return { socket, frames: new FrameQueue(socket) };
    };
    try {
      const alice = await connectAs("Alice");          // header case is not identity
      const bob = await connectAs("bob");
      const bobAgain = await connectAs("bob");

      alice.socket.send(encodeFrame({ v: 1, type: "open" }));
      const aliceOpened = await alice.frames.next();
      if (aliceOpened.type !== "opened") throw new Error("expected opened");
      await alice.frames.next(); // history
      const aliceTransfer = await alice.frames.next();
      if (aliceTransfer.type !== "transfer") throw new Error("expected transfer");
      alice.socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "a1", text: "alice secret" }));
      let frame = await alice.frames.next();
      while (!(frame.type === "event" && (frame.event as { type?: string }).type === "agent_settled")) frame = await alice.frames.next();

      // Alice's conversation is in Alice's factory only, and the push went to Alice only.
      expect(scopes).toEqual(["alice", "bob"]);
      expect(perUser.get("alice")!.sessions.has(aliceOpened.sessionId)).toBe(true);
      expect(perUser.get("bob")!.sessions.size).toBe(0);
      expect(shared.sessions.size).toBe(0);
      const alicePush = await alice.frames.nextSessions();
      expect(alicePush.sessions.map((item) => item.id)).toEqual([aliceOpened.sessionId]);

      bob.socket.send(encodeFrame({ v: 1, type: "list_sessions" }));
      expect((await bob.frames.nextSessions()).sessions).toEqual([]);
      // Bob cannot delete or attach to Alice's conversation by id.
      bob.socket.send(encodeFrame({ v: 1, type: "delete_session", sessionId: aliceOpened.sessionId }));
      expect(await bob.frames.next()).toMatchObject({ type: "error", code: "unknown_session" });
      expect(perUser.get("alice")!.sessions.has(aliceOpened.sessionId)).toBe(true);

      // Bob's own work reaches Bob's other browser but never Alice.
      bob.socket.send(encodeFrame({ v: 1, type: "open" }));
      const bobOpened = await bob.frames.next();
      if (bobOpened.type !== "opened") throw new Error("expected opened");
      await bob.frames.next(); await bob.frames.next(); // history, transfer
      bob.socket.send(encodeFrame({ v: 1, type: "prompt", requestId: "b1", text: "bob secret" }));
      const bobPush = await bobAgain.frames.nextSessions();
      expect(bobPush.sessions.map((item) => item.id)).toEqual([bobOpened.sessionId]);
      alice.socket.send(encodeFrame({ v: 1, type: "list_sessions" }));
      expect((await alice.frames.nextSessions()).sessions.map((item) => item.id)).toEqual([aliceOpened.sessionId]);

      // Uploads for Alice's Session land under Alice's directory.
      const prepared = await fetch(`${aliceTransfer.url}/api/localsend/v2/prepare-upload?scope=${aliceTransfer.scope}&token=${aliceTransfer.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: { a: { id: "a", fileName: "brief.md", size: 5 } } }),
      });
      const { sessionId, files } = await prepared.json() as { sessionId: string; files: Record<string, string> };
      expect((await fetch(`${aliceTransfer.url}/api/localsend/v2/upload?sessionId=${sessionId}&fileId=a&token=${files.a}`, { method: "POST", body: "hello" })).status).toBe(200);
      expect(existsSync(join(root, "alice", ".pi-coffee", "inbox", aliceOpened.sessionId, "brief.md"))).toBe(true);
      expect(existsSync(join(root, ".pi-coffee"))).toBe(false);

      // No identity → the shared (single-user) factory, unchanged behaviour.
      const anon = await connectAs();
      anon.socket.send(encodeFrame({ v: 1, type: "open" }));
      const anonOpened = await anon.frames.next();
      if (anonOpened.type !== "opened") throw new Error("expected opened");
      expect(shared.sessions.has(anonOpened.sessionId)).toBe(true);

      // A name that is not a safe path segment is refused at the upgrade.
      const bad = new WebSocket(`ws://127.0.0.1:${server.address().port}/host`, { headers: { "x-pi-coffee-user": "../etc" } });
      const [error] = await once(bad, "error") as [Error];
      expect(error.message).toContain("400");

      for (const { socket } of [alice, bob, bobAgain, anon]) socket.close();
    } finally {
      await transfer.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps file grants and transfer events separate when users open the same session id", async () => {
    const root = mkdtempSync(join(tmpdir(), "pi-coffee-host-collision-"));
    const transfer = new TransferServer({ host: "127.0.0.1", port: 0, workdir: root, onEvent: (scope, event) => server?.announce(scope, event) });
    await transfer.start();
    server = new HostServer({
      host: "127.0.0.1", port: 0, factory: new FakeFactory(), transfer, requireUser: true,
      scopeForUser: (user) => ({ factory: new FakeFactory(), workdir: join(root, user) }),
    });
    await server.start();
    try {
      const openAs = async (user: string) => {
        const socket = new WebSocket(`ws://127.0.0.1:${server!.address().port}/host`, { headers: { "x-pi-coffee-user": user } });
        await once(socket, "open");
        const frames = new FrameQueue(socket);
        socket.send(encodeFrame({ v: 1, type: "open", sessionId: "same-session" }));
        expect(await frames.next()).toMatchObject({ type: "opened" });
        await frames.next();
        const grant = await frames.next();
        if (grant.type !== "transfer") throw new Error("expected transfer");
        return { socket, frames, grant };
      };
      const alice = await openAs("alice");
      const bob = await openAs("bob");
      expect(alice.grant.scope).not.toBe(bob.grant.scope);
      expect(alice.grant.token).not.toBe(bob.grant.token);
      const base = `http://127.0.0.1:${transfer.address().port}/api/localsend/v2`;
      expect((await fetch(`${base}/prepare-download?scope=${bob.grant.scope}&token=${alice.grant.token}`)).status).toBe(401);
      const prepared = await fetch(`${base}/prepare-upload?scope=${alice.grant.scope}&token=${alice.grant.token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: { a: { id: "a", fileName: "brief.md", size: 5 } } }),
      });
      const upload = await prepared.json() as { sessionId: string; files: Record<string, string> };
      expect((await fetch(`${base}/upload?sessionId=${upload.sessionId}&fileId=a&token=${upload.files.a}`, { method: "POST", body: "hello" })).status).toBe(200);
      let event = await alice.frames.next();
      while (event.type === "event" && (event.event as { type?: string }).type === "transfer_progress") event = await alice.frames.next();
      expect(event).toMatchObject({ type: "event", event: { type: "transfer_complete", path: ".pi-coffee/inbox/same-session/brief.md" } });
      bob.socket.send(encodeFrame({ v: 1, type: "ping", nonce: "after-upload" }));
      expect(await bob.frames.next()).toMatchObject({ type: "pong", nonce: "after-upload" });
      expect(existsSync(join(root, "alice", ".pi-coffee", "inbox", "same-session", "brief.md"))).toBe(true);
      expect(existsSync(join(root, "bob", ".pi-coffee", "inbox", "same-session", "brief.md"))).toBe(false);
      alice.socket.close();
      bob.socket.close();
    } finally {
      await server.close();
      await transfer.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("with requireUser, an identity-less connection is refused at the upgrade", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, requireUser: true, scopeForUser: () => ({ factory }) });
    await server.start();
    const anon = new WebSocket(`ws://127.0.0.1:${server.address().port}/host`);
    const [error] = await once(anon, "error") as [Error];
    expect(error.message).toContain("400");
    const named = new WebSocket(`ws://127.0.0.1:${server.address().port}/host`, { headers: { "x-pi-coffee-user": "alice" } });
    await once(named, "open");
    named.close();
  });

  it("refuses to listen on a non-loopback address without a transport token", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "0.0.0.0", factory });
    await expect(server.start()).rejects.toThrow(/PI_COFFEE_HOST_TOKEN/);
    // Nothing was bound: start() must fail before listen, not after.
    expect(() => server?.address()).toThrow(/not listening/);
    server = undefined;
  });

  it("rejects a Host connection whose bearer token does not match", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory, token: "secret-transport-token" });
    await server.start();
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/host`, {
      headers: { authorization: "Bearer wrong" },
    });
    const [error] = (await once(socket, "error")) as [Error];
    expect(error.message).toMatch(/401/);
  });

  it("requires the open frame before accepting commands", async () => {
    const factory = new FakeFactory();
    server = new HostServer({ port: 0, host: "127.0.0.1", factory });
    await server.start();
    const socket = await connect(server.address().port);
    const frames = new FrameQueue(socket);
    socket.send(encodeFrame({ v: 1, type: "ping", nonce: "n" }));
    await expect(frames.next()).resolves.toMatchObject({ type: "error", code: "not_open" });
    socket.close();
  });
  it("archives without stopping children and refuses deletion until all writers are quiescent",async()=>{
    const root=mkdtempSync(join(tmpdir(),"coffee-lifecycle-"));
    const factory=new FakeFactory();const {workspaces:ws,conversation}=await workspaceConversation(root,"safe");
    const pi=await factory.create({sessionId:conversation.id}) as FakePiSession;
    pi.background={known:true,active:1};
    server=new HostServer({port:0,token:"lifecycle",factory,workspaces:ws});await server.start();
    const post=(action:string,extra={})=>fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:"POST",headers:{authorization:"Bearer lifecycle","content-type":"application/json"},body:JSON.stringify({action,id:conversation.id,...extra})});
    try {
      expect((await post("archive")).status).toBe(200);expect(pi.stopped).toBe(false);
      expect((await post("delete",{confirmation:conversation.id})).status).toBe(409);
      const review=await post("changes");expect(review.status).toBe(200);expect((await review.json() as {sessionId:string}).sessionId).toBe(conversation.id);expect(pi.stopped).toBe(false);
      expect((await post("status")).status).toBe(200);
      pi.background={known:false,active:0};expect((await post("delete",{confirmation:conversation.id})).status).toBe(409);expect(pi.stopped).toBe(false);
      pi.background={known:true,active:0};expect((await ws.lookup(conversation.id))?.archived).toBe(true);
      expect((await post("delete",{confirmation:conversation.id})).status).toBe(200);
      expect(await ws.lookup(conversation.id)).toBeUndefined();
    }finally{await server.close();server=undefined;rmSync(root,{recursive:true,force:true});}
  });

  it('creates a Chat directory idempotently through HTTP and grants its scoped inbox',async()=>{
    const root=mkdtempSync(join(tmpdir(),'coffee-chat-api-')),factory=new FakeFactory(),workspaces=new Workspaces(join(root,'projects'));
    const transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root,workspaces});await transfer.start();
    server=new HostServer({port:0,token:'chat-api',factory,workspaces,transfer});await server.start();
    const post=(value:unknown)=>fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer chat-api','content-type':'application/json'},body:JSON.stringify(value)});
    try{
      const request={action:'conversation',id:'chat-api-task',workspaceKind:'chat'};
      const first=await post(request);expect(first.status).toBe(200);const c=await first.json();expect(c).toMatchObject({id:request.id,workspaceKind:'chat',creationState:'ready',cwd:join(root,'chats',request.id)});
      expect(await (await post(request)).json()).toEqual(c);
      const grant=await (await post({action:'files',id:c.id})).json();expect(grant).toMatchObject({scope:c.id,inbox:'inbox'});
      expect((await post({action:'files',id:'unknown'})).status).toBe(409);
      expect(await (await post({action:'status',id:c.id})).json()).toMatchObject({state:'local'});
    }finally{await server.close();server=undefined;await transfer.close();rmSync(root,{recursive:true,force:true});}
  });

  it("routes Checkout status and legacy migration actions through the Host API",async()=>{
    const root=mkdtempSync(join(tmpdir(),"coffee-migration-api-"));const factory=new FakeFactory();const {workspaces:ws,conversation}=await workspaceConversation(root,"migration-api");
    const plan=vi.spyOn(ws,"migrationPlan").mockResolvedValue({required:true,dirty:true,remoteBound:true,legacyCwd:"/legacy",branch:"coffee/legacy",runState:"idle"});
    const migrate=vi.spyOn(ws,"migrateConversation").mockResolvedValue({...conversation,legacyCwd:"/legacy"});
    server=new HostServer({port:0,token:"migration",factory,workspaces:ws});await server.start();
    const post=(action:string)=>fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:"POST",headers:{authorization:"Bearer migration","content-type":"application/json"},body:JSON.stringify({action,id:conversation.id})});
    try {
      const status=await post("status");expect(status.status).toBe(200);expect(await status.json()).toMatchObject({state:"synced",branch:conversation.branch});
      const preview=await post("migration_plan");expect(preview.status).toBe(200);expect(await preview.json()).toMatchObject({required:true,dirty:true});expect(plan).toHaveBeenCalledWith(conversation.id);
      const migrated=await post("migrate");expect(migrated.status).toBe(200);expect(await migrated.json()).toMatchObject({id:conversation.id,legacyCwd:"/legacy"});expect(migrate).toHaveBeenCalledWith(conversation.id);
    }finally{await server.close();server=undefined;rmSync(root,{recursive:true,force:true});}
  });

  it("correlates a rejected RPC prompt over WebSocket and accepts an explicit retry",async()=>{
    const root=mkdtempSync(join(tmpdir(),"coffee-host-rejection-"));
    const {workspaces,conversation}=await workspaceConversation(root,"rejection");
    const factory=new RpcPiSessionFactory({cliPath:resolve("test/fixtures/fake-pi-rpc.mjs"),sessionDir:join(root,"sessions"),cwd:conversation.cwd});
    server=new HostServer({port:0,host:"127.0.0.1",factory,workspaces});await server.start();
    try {
      const socket=await connect(server.address().port),frames=new FrameQueue(socket);
      socket.send(encodeFrame({v:1,type:"open",sessionId:conversation.id}));
      expect(await frames.next()).toMatchObject({type:"opened"});await frames.next();
      socket.send(encodeFrame({v:1,type:"prompt",requestId:"rejected",text:"reject: no provider key"}));
      expect(await frames.next()).toMatchObject({type:"ack",operation:"prompt",requestId:"rejected"});
      expect(await frames.next()).toMatchObject({type:"error",code:"operation_failed",requestId:"rejected",message:"No API key found for the selected model."});
      socket.send(encodeFrame({v:1,type:"prompt",requestId:"retry",text:"retry explicitly"}));
      expect(await frames.next()).toMatchObject({type:"ack",operation:"prompt",requestId:"retry"});
      expect(await frames.next()).toMatchObject({type:"event",event:{type:"agent_start"}});
      expect(await frames.next()).toMatchObject({type:"event",event:{assistantMessageEvent:{delta:"echo: retry explicitly"}}});
      await frames.next();expect(await frames.next()).toMatchObject({type:"event",event:{type:"agent_settled"}});
      socket.close();
    }finally{await server.close();server=undefined;rmSync(root,{recursive:true,force:true});}
  });

  it.each(["steer","follow_up"] as const)("keeps the original RPC run active after a rejected %s command",async(mode)=>{
    const root=mkdtempSync(join(tmpdir(),"coffee-host-queue-rejection-"));
    const {workspaces,conversation}=await workspaceConversation(root,"queue-rejection");
    const factory=new RpcPiSessionFactory({cliPath:resolve("test/fixtures/fake-pi-rpc.mjs"),sessionDir:join(root,"sessions"),cwd:conversation.cwd});
    server=new HostServer({port:0,host:"127.0.0.1",factory,workspaces});await server.start();
    try {
      const socket=await connect(server.address().port),frames=new FrameQueue(socket);
      socket.send(encodeFrame({v:1,type:"open",sessionId:conversation.id}));
      await frames.next();await frames.next();
      socket.send(encodeFrame({v:1,type:"prompt",requestId:"original",text:"ask: Hold the run"}));
      expect(await frames.next()).toMatchObject({type:"ack",requestId:"original"});
      expect(await frames.next()).toMatchObject({type:"event",event:{type:"agent_start"}});await frames.next();
      socket.send(encodeFrame({v:1,type:"prompt",requestId:"queued",mode,text:"/harness work"}));
      expect(await frames.next()).toMatchObject({type:"ack",operation:mode,requestId:"queued"});
      expect(await frames.next()).toMatchObject({type:"error",code:"operation_failed",requestId:"queued",message:"Extension commands cannot be queued."});
      socket.send(encodeFrame({v:1,type:"prompt",requestId:"parallel",text:"must not replace the active run"}));
      expect(await frames.next()).toMatchObject({type:"error",code:"busy",requestId:"parallel"});
      socket.send(encodeFrame({v:1,type:"abort",requestId:"stop"}));
      expect([await frames.next(),await frames.next()]).toEqual(expect.arrayContaining([
        expect.objectContaining({type:"ack",operation:"abort",requestId:"stop"}),
        expect.objectContaining({type:"event",event:expect.objectContaining({type:"agent_settled"})}),
      ]));
      socket.close();
    }finally{await server.close();server=undefined;rmSync(root,{recursive:true,force:true});}
  });

  it("persists interruption after a real RPC process dies and reopens without replaying its run",async()=>{
    const root=mkdtempSync(join(tmpdir(),"coffee-host-crash-"));
    const {workspaces,conversation}=await workspaceConversation(root,"demo");
    const factory=new RpcPiSessionFactory({cliPath:resolve("test/fixtures/fake-pi-rpc.mjs"),sessionDir:join(root,"sessions"),cwd:conversation.cwd});
    server=new HostServer({port:0,host:"127.0.0.1",factory,workspaces});await server.start();
    try {
      const socket=await connect(server.address().port),frames=new FrameQueue(socket);
      socket.send(encodeFrame({v:1,type:"open",sessionId:conversation.id}));
      expect(await frames.next()).toMatchObject({type:"opened"});await frames.next();
      socket.send(encodeFrame({v:1,type:"prompt",requestId:"crash",text:"crash: after acceptance"}));
      expect(await frames.next()).toMatchObject({type:"ack"});
      expect(await frames.next()).toMatchObject({type:"event",event:{type:"agent_start"}});
      expect(await frames.next()).toMatchObject({type:"error",code:"pi_interrupted",fatal:true});
      await expect.poll(async()=> (await workspaces.list()).conversations.find(c=>c.id===conversation.id)?.runState).toBe("interrupted");
      expect((await new Workspaces(join(root,"demo-workspaces"),{ownerId:"vm-test"}).lookup(conversation.id))?.runState).toBe("interrupted");
      socket.close();await once(socket,"close");
      const reopened=await connect(server.address().port),next=new FrameQueue(reopened);
      reopened.send(encodeFrame({v:1,type:"open",sessionId:conversation.id}));
      expect(await next.next()).toMatchObject({type:"opened",state:{isStreaming:false}});
      expect(await next.next()).toMatchObject({type:"history"});
      reopened.send(encodeFrame({v:1,type:"prompt",requestId:"explicit",text:"retry explicitly"}));
      expect(await next.next()).toMatchObject({type:"ack",requestId:"explicit"});
      for(let i=0;i<4;i++)await next.next();
      await expect.poll(async()=> (await workspaces.lookup(conversation.id))?.runState).toBe("idle");
      reopened.close();
    }finally{await server.close();server=undefined;rmSync(root,{recursive:true,force:true});}
  },10_000);

});

it("Skill reload retains running/background sessions and restarts only a verified idle Agent",async()=>{
 const root=mkdtempSync(join(tmpdir(),"coffee-skill-reload-"));const factory=new FakeFactory();const ws=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});const task=await ws.createChatConversation();
 const pi=await factory.create({sessionId:task.id}) as FakePiSession;
 server=new HostServer({port:0,token:'skills',factory,workspaces:ws,skills:{home:join(root,'home')}});await server.start();
 const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/host`,{headers:{authorization:'Bearer skills'}});await once(socket,'open');const frames=new FrameQueue(socket);
 socket.send(encodeFrame({v:1,type:'open',sessionId:task.id}));await frames.next();
 const reload=()=>fetch(`http://127.0.0.1:${server!.address().port}/api/skills`,{method:'POST',headers:{authorization:'Bearer skills','content-type':'application/json'},body:JSON.stringify({action:'reload',engine:'pi',scope:'user',conversationId:task.id})});
 try{
  pi.background={known:true,active:1};expect((await reload()).status).toBe(409);expect(pi.stopped).toBe(false);
  pi.background={known:false,active:0};expect((await reload()).status).toBe(409);expect(pi.stopped).toBe(false);
  pi.background={known:true,active:0};pi.holdAfterDelta=true;socket.send(encodeFrame({v:1,type:'prompt',requestId:'skill-reload-hold',text:'hold'}));await waitFor(()=>pi.history.length>0);
  expect((await reload()).status).toBe(409);expect(pi.stopped).toBe(false);
  pi.finish('done');expect((await reload()).status).toBe(200);expect(pi.stopped).toBe(true);expect(await ws.lookup(task.id)).toBeDefined();expect(pi.history.length).toBeGreaterThan(0);
 }finally{socket.close();await server.close();server=undefined;rmSync(root,{recursive:true,force:true});}
});
