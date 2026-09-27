import { HostServer } from '../src/host/server.js';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { mkdirSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CodexSessionFactory, projectTurns } from "../src/host/codex-adapter.js";
import type { PiSession } from "../src/host/pi-adapter.js";

const fixture = fileURLToPath(new URL("./fixtures/fake-codex-app-server.mjs", import.meta.url));

interface Bench {
  root: string;
  cwd: string;
  codexHome: string;
  cliPath: string;
  factories: CodexSessionFactory[];
  factory(overrides?: { approvalPolicy?: "never" | "on-request"; cwd?: string; mappingFile?: string }): CodexSessionFactory;
}

function bench(): Bench {
  const root = mkdtempSync(join(tmpdir(), "pi-coffee-codex-"));
  const cliPath = join(root, "codex");
  writeFileSync(cliPath, `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
  chmodSync(cliPath, 0o755);
  const cwd = join(root, "work", "alice");
  const codexHome = join(root, "codex-home");
  const factories: CodexSessionFactory[] = [];
  return {
    root, cwd, codexHome, cliPath, factories,
    factory(overrides = {}) {
      const factory = new CodexSessionFactory({ cwd: overrides.cwd ?? cwd, cliPath, codexHome, approvalPolicy: overrides.approvalPolicy ?? "never", mappingFile: overrides.mappingFile });
      factories.push(factory);
      return factory;
    },
  };
}

type Event = { type: string } & Record<string, unknown>;

function recorder(session: PiSession) {
  const events: Event[] = [];
  const waiters: Array<{ predicate: (event: Event) => boolean; resolve: (event: Event) => void }> = [];
  session.onEvent((raw) => {
    const event = raw as Event;
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  return {
    events,
    until(predicate: (event: Event) => boolean, timeoutMs = 5000): Promise<Event> {
      const hit = events.find(predicate);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting; saw ${events.map((event) => event.type).join(",")}`)), timeoutMs);
        waiters.push({ predicate, resolve: (event) => { clearTimeout(timer); resolve(event); } });
      });
    },
  };
}

const settled = (event: Event) => event.type === "agent_settled";
const text = (events: Event[]) => events
  .filter((event) => event.type === "message_update")
  .map((event) => (event.assistantMessageEvent as { delta: string }).delta)
  .join("");

describe("Codex app-server adapter", () => {
  const benches: Bench[] = [];
  const setup = () => { const b = bench(); benches.push(b); return b; };
  afterEach(async () => {
    for (const b of benches.splice(0)) {
      for (const factory of b.factories) await factory.close();
      rmSync(b.root, { recursive: true, force: true });
    }
  });

  it("exposes the native model catalog over authenticated WS without creating a thread",async()=>{
    const b=setup();mkdirSync(b.cwd,{recursive:true});const factory=b.factory();
    const host=new HostServer({port:0,token:'catalog-test',factory});await host.start();
    const ws=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer catalog-test'}});
    try {
      await once(ws,'open');const response=once(ws,'message');
      ws.send(JSON.stringify({v:1,type:'get_model_catalog',engine:'codex',requestId:'draft'}));
      const [raw]=await response;const frame=JSON.parse(raw.toString());
      expect(frame).toMatchObject({type:'model_catalog',engine:'codex',requestId:'draft',models:expect.arrayContaining([expect.objectContaining({provider:'codex',id:'gpt-fake'})])});
      expect(frame.current).toEqual({provider:'codex',id:'gpt-fake-mini'});
      expect(await factory.list()).toEqual([]);
    }finally{ws.close();await host.close();}
  });

  it("creates a thread per PI Coffee session id, lists it under that id, and resumes it from a fresh server", async () => {
    const b = setup();
    const factory = b.factory();
    const session = await factory.create({ sessionId: "s-1" });
    const rec = recorder(session);
    await session.prompt("hello codex");
    await rec.until(settled);
    expect(text(rec.events)).toBe("echo: hello codex");
    expect(rec.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["agent_start", "message_update", "message_end", "agent_settled"]),
    );
    const listing = await factory.list();
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ id: "s-1", preview: "hello codex", messageCount: 1 });
    await session.stop();
    await factory.close();

    // A second factory (new app-server process) sees the same thread and its history.
    const again = b.factory();
    const resumed = await again.create({ sessionId: "s-1" });
    const history = await resumed.getHistory();
    expect(history.entries).toEqual([
      expect.objectContaining({ kind: "user", text: "hello codex" }),
      expect.objectContaining({ kind: "assistant", text: "echo: hello codex" }),
    ]);
    const state = await resumed.getState();
    expect(state.messageCount).toBe(2);
  });

  it("never creates a replacement when a durable task binding points to unavailable native history", async () => {
    const b = setup();
    const factory = b.factory();
    await expect(factory.create({ sessionId: "11111111-1111-4111-8111-111111111111", requireExisting: true })).rejects.toThrow(/Native conversation is unavailable/);
    expect(await factory.list()).toEqual([]);
  });

  it("delivers structured native questions and returns the browser answer to Codex",async()=>{
    const b=setup(),session=await b.factory().create({sessionId:"question-task"});
    const rec=recorder(session);await session.prompt("ask structured");
    const question=await rec.until(event=>event.type==="native_request");
    expect(question).toMatchObject({method:"input",title:"Choose a color"});
    await session.respondUi({id:String(question.id),value:"Blue"});
    await rec.until(settled);
    expect((await session.getHistory()).entries).toEqual(expect.arrayContaining([expect.objectContaining({kind:"assistant",text:"echo: ask structured Blue"})]));
  });

  it("follows thread/list cursors so old conversations stay in the sidebar", async () => {
    const b = setup();
    const factory = b.factory();
    // Fake pages at the adapter's page size; 3 pages worth of empty threads plus one that spoke.
    const total = 250;
    for (let i = 0; i < total; i += 1) await (await factory.create({ sessionId: `p-${i}` })).stop();
    expect((await factory.list()).length).toBe(total);
  }, 30000);

  it("opens a new conversation before native history exists and reads the first completed turn afterwards", async () => {
    const b = setup();
    const session = await b.factory().create({ sessionId: "new-empty" });
    expect(await session.getHistory()).toEqual({ entries: [], leafId: null });
    const rec = recorder(session);
    await session.prompt("first message");
    await rec.until(settled);
    expect((await session.getHistory()).entries).toEqual([
      expect.objectContaining({ kind: "user", text: "first message" }),
      expect.objectContaining({ kind: "assistant", text: "echo: first message" }),
    ]);
    // Losing the native process must still report a failure, not empty history.
    await b.factories[0].close();
    await expect(session.getHistory()).rejects.toThrow(/not running/);
  });

  it("rejects list() when the app-server is gone instead of pretending the store is empty", async () => {
    const b = setup();
    writeFileSync(b.cliPath, "#!/bin/sh\nexit 3\n");
    const factory = b.factory();
    await expect(factory.list()).rejects.toThrow(/codex app-server/);
  });

  it("stops the app-server once every session has been closed for the idle period", async () => {
    const b = setup();
    const factory = new CodexSessionFactory({ cwd: b.cwd, cliPath: b.cliPath, codexHome: b.codexHome, idleTimeoutMs: 50 });
    b.factories.push(factory);
    const session = await factory.create({ sessionId: "idle-1" });
    expect(factory.serverRunning).toBe(true);
    await session.stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(factory.serverRunning).toBe(false);
    // Next use starts a fresh server transparently.
    expect((await factory.list()).map((entry) => entry.id)).toEqual(["idle-1"]);
    expect(factory.serverRunning).toBe(true);
  });

  it("lists only threads of its own working directory", async () => {
    const b = setup();
    const alice = b.factory();
    const bob = b.factory({ cwd: join(b.root, "work", "bob") });
    const a = await alice.create({ sessionId: "a-1" });
    const bs = await bob.create({ sessionId: "b-1" });
    const recA = recorder(a); const recB = recorder(bs);
    await a.prompt("from alice"); await bs.prompt("from bob");
    await recA.until(settled); await recB.until(settled);
    expect((await alice.list()).map((s) => s.id)).toEqual(["a-1"]);
    expect((await bob.list()).map((s) => s.id)).toEqual(["b-1"]);
  });

  it("refuses another user's native thread id for resume and delete even when it is known", async () => {
    const b = setup();
    const alice = b.factory({ mappingFile: join(b.root, "alice-map.json") });
    const session = await alice.create({ sessionId: "alice-local" });
    const rec = recorder(session);
    await session.prompt("alice history");
    await rec.until(settled);
    await alice.close();
    // A native session discovered without PI Coffee's alias map has its native id.
    const nativeView = b.factory();
    const [listed] = await nativeView.list();
    expect(listed.id).not.toBe("alice-local");
    await nativeView.close();
    const bob = b.factory({ cwd: join(b.root, "work", "bob") });
    expect(await bob.list()).toEqual([]);
    expect(await bob.create({ sessionId: listed.id }).then(() => "resumed", (error: Error) => error.message)).toBe("No such conversation");
    expect(await bob.delete(listed.id)).toBe(false);
    await bob.close();
    const resumed = await b.factory().create({ sessionId: listed.id });
    expect((await resumed.getHistory()).entries).toContainEqual(expect.objectContaining({ kind: "user", text: "alice history" }));
  });

  it("translates command and file-change items into tool events with results", async () => {
    const b = setup();
    const session = await b.factory().create({ sessionId: "s-tools" });
    const rec = recorder(session);
    await session.prompt("run ls -la");
    await rec.until(settled);
    const start = rec.events.find((event) => event.type === "tool_execution_start");
    const end = rec.events.find((event) => event.type === "tool_execution_end");
    expect(start).toMatchObject({ toolName: "bash", args: { command: "ls -la" } });
    expect(end).toMatchObject({ toolName: "bash", isError: false });
    expect(JSON.stringify(end?.result)).toContain("ran: ls -la");
    // Output streamed while the command ran, accumulated per call.
    const updates = rec.events.filter((event) => event.type === "tool_execution_update");
    expect(updates.length).toBe(2);
    expect(updates[1]).toMatchObject({ toolCallId: start?.toolCallId, toolName: "bash" });
    expect(JSON.stringify(updates[1]?.partialResult)).toContain("ran: ls -la");

    const rec2 = recorder(session);
    await session.prompt("edit src/x.ts");
    await rec2.until(settled);
    const edit = rec2.events.find((event) => event.type === "tool_execution_end");
    expect(edit).toMatchObject({ toolName: "edit", isError: false });
    expect(JSON.stringify(edit?.result)).toContain("+new");
    // The turn's cumulative diff is surfaced for the "本轮改动" view.
    const diff = rec2.events.find((event) => event.type === "turn_diff");
    expect(String(diff?.diff)).toContain("+++ b/src/x.ts");
  });

  it("surfaces a failed turn as an assistant error and settles", async () => {
    const b = setup();
    const session = await b.factory().create({ sessionId: "s-fail" });
    const rec = recorder(session);
    await session.prompt("fail please");
    await rec.until(settled);
    const end = rec.events.find((event) => event.type === "message_end") as { message: { stopReason?: string; errorMessage?: string } };
    expect(end.message).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("fake upstream failure") });
  });

  it("routes command approvals to the browser as confirm dialogs and forwards the answer", async () => {
    const b = setup();
    const session = await b.factory({ approvalPolicy: "on-request" }).create({ sessionId: "s-approve" });
    const rec = recorder(session);
    await session.prompt("run rm -rf build");
    const ask = await rec.until((event) => event.type === "extension_ui_request");
    expect(ask).toMatchObject({ method: "confirm", message: expect.stringContaining("rm -rf build") });
    expect(String(ask.id)).toMatch(/^codex-/);
    await session.respondUi({ id: String(ask.id), confirmed: false });
    await rec.until(settled);
    const end = rec.events.find((event) => event.type === "tool_execution_end");
    expect(end).toMatchObject({ isError: true });

    const rec2 = recorder(session);
    await session.prompt("run make");
    const ask2 = await rec2.until((event) => event.type === "extension_ui_request");
    await session.respondUi({ id: String(ask2.id), confirmed: true });
    await rec2.until(settled);
    expect(rec2.events.find((event) => event.type === "tool_execution_end")).toMatchObject({ isError: false });
  });

  it("aborts a running turn and flushes follow-ups after the turn ends", async () => {
    const b = setup();
    const session = await b.factory().create({ sessionId: "s-abort" });
    const rec = recorder(session);
    await session.prompt("first");
    await rec.until((event) => event.type === "agent_start");
    await session.abort();
    await rec.until(settled);
    expect(text(rec.events)).toBe("");

    const rec2 = recorder(session);
    await session.prompt("second");
    await rec2.until((event) => event.type === "agent_start");
    await session.followUp("third");
    await rec2.until((event) => event.type === "queue_update");
    await rec2.until((event) => event.type === "agent_settled" && text(rec2.events).includes("echo: third"));
    expect(text(rec2.events)).toContain("echo: second");
  });

  it("renames, reports models and stats, and deletes", async () => {
    const b = setup();
    const factory = b.factory();
    const session = await factory.create({ sessionId: "s-misc" });
    const rec = recorder(session);
    await session.rename("Kitchen sink");
    expect((await factory.list())[0]).toMatchObject({ id: "s-misc", name: "Kitchen sink" });

    const models = await session.getModels();
    expect(models.models.map((m) => m.id)).toEqual(["gpt-fake", "gpt-fake-mini"]);
    // A model configured outside the catalog (custom provider) is still offered and current.
    await session.setModel("codex", "gpt-custom-terra");
    const custom = await session.getModels();
    expect(custom.current).toEqual({ provider: "codex", id: "gpt-custom-terra" });
    expect(custom.models[0]).toEqual({ provider: "codex", id: "gpt-custom-terra" });
    expect(models.current).toEqual({ provider: "codex", id: "gpt-fake" });
    await session.setModel("codex", "gpt-fake-mini");
    expect((await session.getModels()).current?.id).toBe("gpt-fake-mini");

    await session.prompt("count me");
    await rec.until(settled);
    const stats = await session.getStats();
    expect(stats.tokens.total).toBeGreaterThan(0);

    expect(await factory.delete("s-misc")).toBe(true);
    expect(await factory.list()).toEqual([]);
    expect(await factory.delete("s-misc")).toBe(false);
  });
});

describe("Codex app-server adapter: usage meters and native threads", () => {
  const benches: Bench[] = [];
  const setup = () => { const b = bench(); benches.push(b); return b; };
  afterEach(async () => {
    for (const b of benches.splice(0)) {
      for (const factory of b.factories) await factory.close();
      rmSync(b.root, { recursive: true, force: true });
    }
  });

  it("reports the account's 5h / weekly limit windows in stats and refreshes them from account/rateLimits/updated (P1)", async () => {
    const b = setup();
    const session = await b.factory().create({ sessionId: "s-limits" });
    const first = await session.getStats();
    // Classified by window length, not by the primary/secondary slot names.
    expect(first.rateLimits).toEqual({
      fiveHour: { usedPercent: 42, windowMinutes: 300, resetsAt: new Date(1_788_265_323 * 1000).toISOString() },
      weekly: { usedPercent: 61, windowMinutes: 10080, resetsAt: new Date(1_788_765_541 * 1000).toISOString() },
      plan: "plus",
    });
    const rec = recorder(session);
    await session.prompt("burn some quota");
    await rec.until(settled);
    // The fake pushes account/rateLimits/updated after every turn (usedPercent +10).
    const after = await session.getStats();
    expect(after.rateLimits?.fiveHour?.usedPercent).toBe(52);
    expect(after.contextUsage?.contextWindow).toBe(1000);
  });

  it("keeps stats usable when the server has no rate-limit data (API-key login)", async () => {
    const b = setup();
    const factory = new CodexSessionFactory({ cwd: b.cwd, cliPath: b.cliPath, codexHome: b.codexHome, env: { FAKE_CODEX_NO_LIMITS: "1" } });
    b.factories.push(factory);
    const session = await factory.create({ sessionId: "s-nolimits" });
    const stats = await session.getStats();
    expect(stats.rateLimits).toBeUndefined();
    expect(stats.tokens.total).toBe(0);
  });

  it("lists threads the VM admin started from the terminal with their source, and opens them read-only while their turn runs (P3)", async () => {
    const b = setup();
    const factory = b.factory();
    // Seed a thread the way `codex` in a terminal would: same cwd, source cli, one finished turn.
    const cliThread = { id: "11111111-2222-4333-8444-555555555555", cwd: b.cwd, createdAt: 1_700_000_000, updatedAt: 1_700_000_500, source: "cli", preview: "fix the flaky test", turns: [{ id: "t1", items: [{ type: "userMessage", id: "u1", content: [{ type: "text", text: "fix the flaky test" }] }, { type: "agentMessage", id: "a1", text: "done" }], status: "completed" }], activeExternally: true };
    const { mkdirSync, writeFileSync: write } = await import("node:fs");
    mkdirSync(b.codexHome, { recursive: true });
    write(join(b.codexHome, "fake-threads.json"), JSON.stringify({ [cliThread.id]: cliThread }));

    const listed = await factory.list();
    expect(listed).toEqual([expect.objectContaining({ id: cliThread.id, source: "cli", preview: "fix the flaky test" })]);
    // Our own threads carry the app-server source so the sidebar can tell them apart.
    const own = await factory.create({ sessionId: "s-own" });
    const rec = recorder(own);
    await own.prompt("hello");
    await rec.until(settled);
    expect((await factory.list()).find((s) => s.id === "s-own")?.source).toBe("appServer");

    // Taking over = resuming the native thread; while another process drives it we only watch.
    const taken = await factory.create({ sessionId: cliThread.id });
    expect(await taken.getState()).toMatchObject({ isStreaming: true });
    const history = await taken.getHistory();
    expect(history.entries.map((e) => e.kind)).toEqual(["user", "assistant"]);
    // No notification reaches us when the terminal's turn ends; getState re-reads the thread status.
    const stored = JSON.parse(readFileSync(join(b.codexHome, "fake-threads.json"), "utf8"));
    stored[cliThread.id].activeExternally = false;
    write(join(b.codexHome, "fake-threads.json"), JSON.stringify(stored));
    expect(await taken.getState()).toMatchObject({ isStreaming: false });
  });
});

describe("projectTurns", () => {
  it("projects Codex turns into display-ready history entries", () => {
    const entries = projectTurns([
      {
        id: "t1", status: "completed", items: [
          { type: "userMessage", id: "u1", content: [{ type: "text", text: "do it" }, { type: "image", url: "data:image/png;base64,AAAA" }] },
          { type: "reasoning", id: "r1", summary: ["thinking"], content: [] },
          { type: "commandExecution", id: "c1", command: "ls", cwd: "/w", status: "completed", aggregatedOutput: "a\nb\n", exitCode: 0, durationMs: 3 },
          { type: "fileChange", id: "f1", status: "failed", changes: [{ path: "x.ts", kind: "update", diff: "@@\n-a\n+b" }] },
          { type: "agentMessage", id: "m1", text: "done" },
        ],
      },
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual(["user", "tool", "tool", "assistant"]);
    expect(entries[0]).toMatchObject({ kind: "user", text: "do it" });
    expect(entries[1]).toMatchObject({ kind: "tool", name: "bash" });
    expect(entries[1]).not.toHaveProperty("isError", true);
    expect(entries[2]).toMatchObject({ kind: "tool", name: "edit", isError: true });
    expect(entries[3]).toMatchObject({ kind: "assistant", text: "done" });
  });
});
