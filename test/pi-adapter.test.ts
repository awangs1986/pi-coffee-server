import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HostSessionRegistry } from "../src/host/session.js";
import type { ServerFrame } from "../src/shared/protocol.js";
import { appendExtensionArgs, appendSkillArgs, buildHostChildEnv, extensionPathsFromArgs, HOST_STRIPPED_ENV_KEYS, projectExtensions, projectHistory, RpcPiSessionFactory } from "../src/host/pi-adapter.js";

describe("original Pi RPC adapter", () => {
  it("reports Pi death after prompt acknowledgement and permits explicit reopening without replay", async () => {
    const sessionDir=mkdtempSync(join(tmpdir(),"coffee-pi-crash-"));
    const factory = new RpcPiSessionFactory({cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"), cwd: process.cwd(),sessionDir});
    const registry = new HostSessionRegistry({factory,idleTimeoutMs:0});
    const {session}=await registry.open("crash-recovery");
    const frames:ServerFrame[]=[];
    session.attach({send:frame=>frames.push(frame)});
    try {
      session.reservePrompt("crash-request");
      await session.prompt("crash-request","crash: after acceptance");
      await waitFor(()=>frames.some(frame=>frame.type==="error" && frame.code==="pi_interrupted"));
      expect(session.isBusy).toBe(false);
      expect(frames).toContainEqual(expect.objectContaining({type:"error",fatal:true,message:expect.stringContaining("not replayed")}));
      const [reopened,otherWindow]=await Promise.all([registry.open(session.id),registry.open(session.id)]);
      expect(otherWindow.session).toBe(reopened.session);
      expect(reopened.session.isBusy).toBe(false);
      expect(reopened.history.entries).toEqual([]);
      expect(reopened.replay).toEqual([]);
      const events:ServerFrame[]=[];reopened.session.attach({send:frame=>events.push(frame)});
      reopened.session.reservePrompt("explicit-request");await reopened.session.prompt("explicit-request","hello after recovery");
      await waitFor(()=>events.some(frame=>frame.type==="event" && isEvent(frame.event,"agent_settled")));
    }finally{await registry.close();rmSync(sessionDir,{recursive:true,force:true});}
  },10_000);
  it("surfaces a rejected prompt (no API key) instead of leaving the Session busy forever", async () => {
    const sessionDir=mkdtempSync(join(tmpdir(),"coffee-pi-reject-"));
    const factory = new RpcPiSessionFactory({cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"), cwd: process.cwd(),sessionDir});
    const registry = new HostSessionRegistry({factory,idleTimeoutMs:0});
    const {session}=await registry.open("reject-recovery");
    const frames:ServerFrame[]=[];
    session.attach({send:frame=>frames.push(frame)});
    try {
      session.reservePrompt("r1");
      // Native RPC rejects failed input; Host must release its reservation.
      await expect(session.prompt("r1","reject: no key")).rejects.toThrow(/No API key/);
      expect(session.isBusy).toBe(false);
      // The next prompt is accepted normally.
      session.reservePrompt("r2");await session.prompt("r2","hello again");
      await waitFor(()=>frames.some(frame=>frame.type==="event" && isEvent(frame.event,"agent_settled")));
    }finally{await registry.close();rmSync(sessionDir,{recursive:true,force:true});}
  },10_000);
  it("does not settle an active run when steering or follow-up input is handled", async()=>{
    const factory=new RpcPiSessionFactory({cliPath:resolve("test/fixtures/fake-pi-rpc.mjs")});
    const registry=new HostSessionRegistry({factory,idleTimeoutMs:0});
    const {session}=await registry.open("handled-during-run");
    const frames:ServerFrame[]=[];session.attach({send:f=>frames.push(f)});
    try{
      session.reservePrompt("active");await session.prompt("active","ask: stay active");
      await waitFor(()=>session.isStreaming);
      await session.enqueue("steer","handled: no new run");await session.enqueue("follow_up","handled: no new run");
      expect(session.isBusy).toBe(true);expect(()=>session.reservePrompt("other")).toThrow(/already running/);
      expect(frames.some(f=>f.type==="event" && isEvent(f.event,"agent_settled"))).toBe(false);
      const dialog=frames.find(f=>f.type==="event" && isEvent(f.event,"extension_ui_request")) as any;
      await session.respondUi({id:dialog.event.id,confirmed:true});await waitFor(()=>!session.isBusy);
    }finally{await registry.close();}
  });

  it("strips Relay credentials from the spawned Host Pi environment", () => {
    const env = buildHostChildEnv({ PI_COFFEE_UPSTREAM_KEY: "override", PI_COFFEE_GITEA_TOKEN: "synthetic-forge-secret", SAFE_SETTING: "kept" });
    expect(env.SAFE_SETTING).toBe("kept");
    expect(env.PI_COFFEE_GITEA_TOKEN).toBeUndefined();
    for (const key of HOST_STRIPPED_ENV_KEYS) expect(env[key]).toBeUndefined();
  });

  it("adds configured Pi extensions once while preserving explicit CLI args", () => {
    expect(appendExtensionArgs(["--extension", "./existing.js"], ["./existing.js", "./harness.js", ""])).toEqual([
      "--extension",
      "./existing.js",
      "--extension",
      "./harness.js",
    ]);
  });

  it("adds configured Pi skills once while preserving explicit CLI args", () => {
    expect(appendSkillArgs(["--skill", "./existing"], ["./existing", "./lsp", ""])).toEqual([
      "--skill",
      "./existing",
      "--skill",
      "./lsp",
    ]);
  });

  it("maps the documented RPC client to the PI Coffee PiSession seam", async () => {
    const factory = new RpcPiSessionFactory({
      cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"),
      cwd: process.cwd(),
      sessionDir: resolve(".tmp-test-sessions"),
    });
    const session = await factory.create({ sessionId: "adapter-test" });
    const events: unknown[] = [];
    const unsubscribe = session.onEvent((event) => events.push(event));
    try {
      expect(await session.getState()).toMatchObject({ isStreaming: false, messageCount: 0 });
      await session.prompt("hello from adapter");
      await waitFor(() => events.some((event) => isEvent(event, "agent_settled")));
      expect(events).toEqual(
        expect.arrayContaining([
          { type: "agent_start" },
          expect.objectContaining({ type: "message_update" }),
          { type: "agent_settled" },
        ]),
      );
      // History comes from the RPC process's durable entries (get_entries).
      const history = await session.getHistory();
      expect(history.entries).toEqual([
        expect.objectContaining({ kind: "user", text: "hello from adapter" }),
        expect.objectContaining({ kind: "assistant", text: "echo: hello from adapter" }),
      ]);
      expect(history.leafId).toBe(history.entries.at(-1)?.id);

      // Conversation controls map one-to-one onto documented RPC commands.
      await session.rename("Adapter run");
      expect((await session.getState()).sessionName).toBe("Adapter run");
      const models = await session.getModels();
      expect(models).toMatchObject({ current: { provider: "fake", id: "fake-mini" }, thinkingLevel: "medium", thinkingLevels: ["off", "low", "medium", "high"] });
      expect(models.models.map((m) => m.id)).toEqual(["fake-mini", "fake-large"]);
      await session.setModel("fake", "fake-large");
      await session.setThinkingLevel("high");
      expect(await session.getModels()).toMatchObject({ current: { id: "fake-large" }, thinkingLevel: "high" });
      expect((await session.getCommands()).map((c) => c.name)).toEqual(["harness", "verify", "llama", "review", "skill:tdd"]);
      // Extensions are grouped by source file; inline/built-in and skills are labelled.
      expect(await session.getExtensions()).toEqual([
        { name: "harness/extension.js", kind: "extension", path: "/opt/pi-coffee/dist/src/harness/extension.js", origin: "cli", scope: "temporary", commands: [{ name: "harness", description: "Switch harness mode" }, { name: "verify", description: "Run verification" }] },
        { name: "llama.cpp", kind: "extension", origin: "inline", scope: "temporary", commands: [{ name: "llama", description: "Manage llama.cpp" }] },
        { name: "pi-environment-extension", kind: "extension", path: resolve("src/host/pi-environment-extension.ts"), origin: "configured", commands: [] },
        { name: "tdd", kind: "skill", path: "/home/u/.agents/skills/tdd/SKILL.md", origin: "auto", scope: "user", commands: [{ name: "skill:tdd", description: "Test-driven development" }] },
        { name: "review", kind: "prompt", path: "/home/u/.pi/agent/prompts/review.md", origin: "auto", scope: "user", commands: [{ name: "review", description: "Review the diff" }] },
      ]);
      expect(await session.getStats()).toMatchObject({ userMessages: 1, assistantMessages: 1, tokens: { total: 1540 }, cost: 0.0042, contextUsage: { percent: 0.77 } });
      await session.steer("focus");
      await session.followUp("then summarize");
      await waitFor(() => events.filter((event) => isEvent(event, "queue_update")).length === 2);
      await expect(session.compact()).rejects.toThrow("Handoff extension is not loaded");

      // Extension dialog round trip: the request arrives as an event, the
      // answer goes back over the RPC sub-protocol and unblocks the run.
      events.length = 0;
      await session.prompt("ask: proceed?");
      await waitFor(() => events.some((event) => isEvent(event, "extension_ui_request")));
      const request = events.find((event) => isEvent(event, "extension_ui_request")) as { id: string; method: string; title: string };
      expect(request).toMatchObject({ method: "confirm", title: "proceed?" });
      await session.respondUi({ id: request.id, confirmed: true });
      await waitFor(() => events.some((event) => isEvent(event, "agent_settled")));
      expect((await session.getHistory()).entries.at(-1)).toMatchObject({ kind: "assistant", text: "answer: confirmed=true" });
    } finally {
      unsubscribe();
      await session.stop();
    }
  }, 10_000);

  it("resumes a conversation that already exists in the session store instead of creating a new one", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "pi-coffee-resume-"));
    const id = "11111111-2222-4333-8444-555555555555";
    // A minimal Pi v3 session file, as Pi itself writes them.
    writeFileSync(
      join(sessionDir, `2026-09-03T00-00-00-000Z_${id}.jsonl`),
      [
        JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-09-03T00:00:00.000Z", cwd: process.cwd() }),
        JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "2026-09-03T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "earlier question" }] } }),
        JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "2026-09-03T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "earlier answer" }] } }),
        "",
      ].join("\n"),
    );
    const factory = new RpcPiSessionFactory({
      cliPath: resolve("test/fixtures/fake-pi-rpc.mjs"),
      cwd: process.cwd(),
      sessionDir,
    });
    try {
      const listed = await factory.list();
      expect(listed).toEqual([
        expect.objectContaining({ id, messageCount: 2, preview: "earlier question" }),
      ]);
      expect(JSON.stringify(listed)).not.toContain(sessionDir); // VM paths never leave the adapter

      const session = await factory.create({ sessionId: id });
      try {
        // The fake CLI seeds a "resumed from <path>" exchange only when it was
        // started with --session <path>, which is how the adapter must resume.
        const history = await session.getHistory();
        expect(history.entries[0]).toMatchObject({ kind: "user", text: expect.stringMatching(/^resumed from .*\.jsonl$/) });
      } finally {
        await session.stop();
      }
      const evidence=join(sessionDir,"artifacts",id);
      const otherEvidence=join(sessionDir,"artifacts","another-session");
      mkdirSync(evidence,{recursive:true});mkdirSync(otherEvidence,{recursive:true});
      writeFileSync(join(evidence,"result.txt"),"retained research");
      // Permanent session deletion removes its evidence without touching other sessions.
      expect(await factory.delete(id)).toBe(true);
      expect(existsSync(evidence)).toBe(false);
      expect(existsSync(otherEvidence)).toBe(true);
      expect(await factory.list()).toEqual([]);
      expect(await factory.delete(id)).toBe(false);
    } finally {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }, 10_000);
});

describe("extension projection", () => {
  it("lists configured extensions even without commands and merges commands from the same file", () => {
    const list = projectExtensions([
      { name: "harness", description: "x", source: "extension", sourceInfo: { path: "C:\\opt\\pi-coffee\\dist\\src\\harness\\extension.js", source: "cli", scope: "temporary", origin: "top-level" } },
      { name: "sub", source: "extension", sourceInfo: { path: "/opt/pi-coffee/node_modules/pi-subagents/index.ts", source: "cli", scope: "temporary", origin: "top-level" } },
    ], ["C:/opt/pi-coffee/dist/src/harness/extension.js", "/opt/pi-coffee/dist/src/subagents/extension.js"]);
    expect(list.map((e) => [e.name, e.origin, e.commands.length])).toEqual([
      ["harness/extension.js", "configured", 1],
      ["pi-subagents/index.ts", "cli", 1],
      ["subagents/extension.js", "configured", 0],
    ]);
    expect(extensionPathsFromArgs(["--session-id", "x", "--extension", "a.js", "-e", "b.ts", "--extension=c.js"])).toEqual(["a.js", "b.ts", "c.js"]);
  });
});

describe("history projection", () => {
  it("follows the active branch and pairs tool calls with their results", () => {
    const entries = [
      { type: "model_change", id: "x0", parentId: null, provider: "cpa", modelId: "m" },
      { type: "message", id: "u1", parentId: "x0", timestamp: "t1", message: { role: "user", content: "list files" } },
      {
        type: "message", id: "a1", parentId: "u1", timestamp: "t2",
        message: { role: "assistant", content: [{ type: "text", text: "Sure." }, { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } }] },
      },
      { type: "message", id: "r1", parentId: "a1", timestamp: "t3", message: { role: "toolResult", toolCallId: "call-1", isError: false, content: [{ type: "text", text: "a.txt\nb.txt" }] } },
      { type: "message", id: "a2", parentId: "r1", timestamp: "t4", message: { role: "assistant", content: [{ type: "text", text: "Two files." }] } },
      // Abandoned branch off u1: must not appear when the leaf is a2.
      { type: "message", id: "alt", parentId: "u1", timestamp: "t5", message: { role: "assistant", content: [{ type: "text", text: "abandoned" }] } },
      { type: "compaction", id: "c1", parentId: "a2", timestamp: "t6", summary: "…" },
      { type: "message", id: "u2", parentId: "c1", timestamp: "t7", message: { role: "user", content: [{ type: "text", text: "thanks" }, { type: "image", data: "…", mimeType: "image/png" }] } },
    ];
    const history = projectHistory(entries, "u2");
    expect(history.entries).toEqual([
      { kind: "user", id: "u1", at: "t1", text: "list files" },
      { kind: "assistant", id: "a1", at: "t2", text: "Sure." },
      { kind: "tool", id: "call-1", at: "t2", name: "bash", args: { command: "ls" }, result: "a.txt\nb.txt", isError: false },
      { kind: "assistant", id: "a2", at: "t4", text: "Two files." },
      expect.objectContaining({ kind: "note", id: "c1" }),
      { kind: "user", id: "u2", at: "t7", text: "thanks", imageCount: 1 },
    ]);
    expect(JSON.stringify(history.entries)).not.toContain("abandoned");
  });

  it("falls back to append order when there is no leaf", () => {
    const entries = [
      { type: "message", id: "u1", parentId: null, message: { role: "user", content: "hi" } },
      { type: "message", id: "a1", parentId: "u1", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
    ];
    expect(projectHistory(entries, null).entries.map((entry) => entry.text)).toEqual(["hi", "hello"]);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for fake Pi event");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}

function isEvent(value: unknown, type: string): boolean {
  return typeof value === "object" && value !== null && "type" in value && value.type === type;
}

 it.each(["success","native","slow"])("verifies committed Handoff through Pi RPC (%s)",async mode=>{
  const factory=new RpcPiSessionFactory({cliPath:resolve("test/fixtures/fake-pi-rpc.mjs"),env:{FAKE_HANDOFF:mode}});
  const session=await factory.create({sessionId:"handoff-adapter"});
  try {if(mode==="native")await expect(session.compact()).rejects.toThrow("did not commit");
    else await expect(session.compact()).resolves.toBeUndefined();
  }finally{await session.stop();}
},40000);

it("reopens the original Conversation after unobservable Handoff stops its child",async()=>{
  const registry=new HostSessionRegistry({factory:new RpcPiSessionFactory({cliPath:resolve("test/fixtures/fake-pi-rpc.mjs"),env:{FAKE_HANDOFF:"unobservable"}})});
  try {const {session}=await registry.open("handoff-stopped");await expect(session.compact()).rejects.toThrow("cannot observe");
    expect(session.wasInterrupted).toBe(true);
    const reopened=await registry.open("handoff-stopped");expect(reopened.session.wasInterrupted).toBe(false);
    expect(reopened.session.isBusy).toBe(false);
  }finally{await registry.close();}
});
