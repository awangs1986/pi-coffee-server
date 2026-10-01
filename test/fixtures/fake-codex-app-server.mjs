import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import readline from "node:readline";
import { randomUUID } from "node:crypto";

// Stand-in for `codex app-server` (JSON-RPC over stdio, no "jsonrpc" field).
// Threads persist in $CODEX_HOME/fake-threads.json so a second process can
// list and resume them, like Codex's rollout files. A turn runs one command,
// streams two text deltas and completes; with an approval policy other than
// "never" the command first asks the client for approval.
const home = process.env.CODEX_HOME ?? ".";
mkdirSync(home, { recursive: true });
appendFileSync(join(home, "started-pids"), process.pid + "\n");
const store = join(home, "fake-threads.json");
const threads = existsSync(store) ? JSON.parse(readFileSync(store, "utf8")) : {};
const save = () => writeFileSync(store, JSON.stringify(threads));
let counter = 0;
const uid = (prefix) => `${prefix}-${process.pid}-${++counter}`;
const now = () => Math.floor(Date.now() / 1000);
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const notify = (method, params) => send({ method, params });
const pendingServerRequests = new Map();
let nextServerId = 1000;
const settings = new Map(); // threadId -> { approvalPolicy }
const active = new Map();   // threadId -> { turnId, interrupted }
// Account meters as `account/rateLimits/read` reports them (ChatGPT login);
// FAKE_CODEX_NO_LIMITS mimics an API-key login that has none.
const rateLimits = process.env.FAKE_CODEX_NO_LIMITS ? null : {
  primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1788265323 },
  secondary: { usedPercent: 61, windowDurationMins: 10080, resetsAt: 1788765541 },
  planType: "plus",
};

function threadView(thread, withTurns) {
  return {
    id: thread.id, sessionId: thread.id, forkedFromId: null, parentThreadId: null, preview: thread.preview ?? "",
    ephemeral: false, historyMode: "paginated", modelProvider: "openai", model: thread.model ?? "gpt-fake",
    reasoningEffort: thread.effort ?? null, createdAt: thread.createdAt, updatedAt: thread.updatedAt, recencyAt: thread.updatedAt,
    status: { type: active.has(thread.id) || thread.activeExternally ? "active" : "idle" }, path: null, cwd: thread.cwd, cliVersion: "fake", originator: "pi_coffee",
    source: thread.source ?? "appServer", threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: thread.name ?? null,
    turns: withTurns ? thread.turns : [],
  };
}

async function askApproval(threadId, turnId, itemId, command) {
  const id = nextServerId++;
  return new Promise((resolve) => {
    pendingServerRequests.set(id, resolve);
    send({ id, method: "item/commandExecution/requestApproval", params: { kind: "command", threadId, turnId, itemId, startedAtMs: Date.now(), approvalId: null, environmentId: null, command, cwd: "/", reason: "fake needs approval" } });
  });
}

async function runTurn(thread, input, options) {
  const turnId = uid("turn");
  const state = { turnId, interrupted: false };
  active.set(thread.id, state);
  const text = input.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const images = input.filter((part) => part.type === "image").length;
  const turn = { id: turnId, items: [], itemsView: "full", status: "inProgress", error: null, startedAt: now(), completedAt: null, durationMs: null };
  thread.turns.push(turn);
  if (!thread.preview) thread.preview = text;
  thread.updatedAt = now();
  if (options.model) thread.model = options.model;
  if (options.effort) thread.effort = options.effort;
  save();
  notify("turn/started", { threadId: thread.id, turn: { ...turn, items: [] } });
  const user = { type: "userMessage", id: uid("item"), clientId: null, content: input };
  turn.items.push(user);
  notify("item/started", { item: user, threadId: thread.id, turnId, startedAtMs: Date.now() });
  notify("item/completed", { item: user, threadId: thread.id, turnId, completedAtMs: Date.now() });

  if (text.startsWith("fail")) {
    turn.status = "failed";
    turn.error = { message: "fake upstream failure", codexErrorInfo: null, additionalDetails: null, misalignment: null };
    active.delete(thread.id);
    save();
    notify("turn/completed", { threadId: thread.id, turn: { ...turn, items: [] } });
    return;
  }

  let questionAnswer='';
  if(text==='ask structured'){
    const id='question-'+uid('request');
    const answer=await new Promise(resolve=>{pendingServerRequests.set(id,resolve);send({id,method:'item/tool/requestUserInput',params:{threadId:thread.id,turnId,questions:[{id:'color',question:'Choose a color',options:[{label:'Blue',description:'A blue result'}]}]}});});
    questionAnswer=' '+(answer.answers?.color?.answers?.[0] ?? 'MISSING');
  }
  if (text.startsWith("run ")) {
    const command = text.slice(4);
    const item = { type: "commandExecution", id: uid("item"), pluginId: null, scriptPath: null, command, cwd: thread.cwd, processId: null, source: "agent", status: "inProgress", commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null };
    notify("item/started", { item, threadId: thread.id, turnId, startedAtMs: Date.now() });
    let approved = true;
    if ((settings.get(thread.id)?.approvalPolicy ?? "never") !== "never") {
      const decision = await askApproval(thread.id, turnId, item.id, command);
      approved = decision === "accept" || decision === "acceptForSession";
    }
    if (approved) {
      notify("item/commandExecution/outputDelta", { threadId: thread.id, turnId, itemId: item.id, delta: "ran: " });
      notify("item/commandExecution/outputDelta", { threadId: thread.id, turnId, itemId: item.id, delta: `${command}\n` });
    }
    const done = { ...item, status: approved ? "completed" : "declined", aggregatedOutput: approved ? `ran: ${command}\n` : null, exitCode: approved ? 0 : null, durationMs: 5 };
    turn.items.push(done);
    notify("item/completed", { item: done, threadId: thread.id, turnId, completedAtMs: Date.now() });
  }
  if (text.startsWith("edit ")) {
    const path = text.slice(5);
    const item = { type: "fileChange", id: uid("item"), changes: [{ path, kind: "update", diff: `@@ -1 +1 @@\n-old\n+new\n` }], status: "inProgress" };
    notify("item/started", { item, threadId: thread.id, turnId, startedAtMs: Date.now() });
    const done = { ...item, status: "completed" };
    turn.items.push(done);
    notify("item/completed", { item: done, threadId: thread.id, turnId, completedAtMs: Date.now() });
    notify("turn/diff/updated", { threadId: thread.id, turnId, diff: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n` });
  }

  await new Promise((resolve) => setTimeout(resolve, 20));
  if (state.interrupted) {
    turn.status = "interrupted";
    active.delete(thread.id);
    save();
    notify("turn/completed", { threadId: thread.id, turn: { ...turn, items: [] } });
    return;
  }
  const reply = `echo: ${text}${questionAnswer}${images > 0 ? ` (+${images} image)` : ""}`;
  const message = { type: "agentMessage", id: uid("item"), text: reply, phase: null, memoryCitation: null, delivery: null, questions: null };
  notify("item/started", { item: { ...message, text: "" }, threadId: thread.id, turnId, startedAtMs: Date.now() });
  const half = Math.ceil(reply.length / 2);
  notify("item/agentMessage/delta", { threadId: thread.id, turnId, itemId: message.id, delta: reply.slice(0, half) });
  notify("item/agentMessage/delta", { threadId: thread.id, turnId, itemId: message.id, delta: reply.slice(half) });
  turn.items.push(message);
  notify("item/completed", { item: message, threadId: thread.id, turnId, completedAtMs: Date.now() });
  notify("thread/tokenUsage/updated", { threadId: thread.id, turnId, tokenUsage: { total: { totalTokens: 30, inputTokens: 20, cachedInputTokens: 5, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 }, last: { totalTokens: 30, inputTokens: 20, cachedInputTokens: 5, cacheWriteInputTokens: 0, outputTokens: 10, reasoningOutputTokens: 0 }, modelContextWindow: 1000 } });
  turn.status = "completed";
  turn.completedAt = now();
  active.delete(thread.id);
  save();
  // Codex refreshes the account meters as the turn's usage lands, before the turn closes.
  if (rateLimits) {
    rateLimits.primary.usedPercent += 10;
    notify("account/rateLimits/updated", { rateLimits });
  }
  notify("turn/completed", { threadId: thread.id, turn: { ...turn, items: [] } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === undefined && message.id !== undefined) {
    const resolve = pendingServerRequests.get(message.id);
    if (resolve) { pendingServerRequests.delete(message.id); resolve(message.result?.decision ?? message.result); }
    return;
  }
  const { id, method, params = {} } = message;
  const reply = (result) => send({ id, result });
  const fail = (text) => send({ id, error: { code: -32000, message: text } });
  switch (method) {
    case "initialize": return reply({ userAgent: "fake", codexHome: home, platformFamily: "unix", platformOs: "linux" });
    case "initialized": return;
    case "account/read": return reply(rateLimits ? { account: { type: "chatgpt", email: "vm-owner@example.com", planType: rateLimits.planType }, requiresOpenaiAuth: true } : { account: null, requiresOpenaiAuth: false });
    case "getAuthStatus": return reply({ authMethod: rateLimits ? "chatgpt" : "apiKey", requiresOpenaiAuth: true });
    case "account/rateLimits/read":
      if (!rateLimits) return fail("rate limits unavailable for this auth method");
      return reply({ rateLimits });
    case "thread/list": {
      const all = Object.values(threads).filter((thread) => params.cwd === undefined || thread.cwd === params.cwd).map((thread) => threadView(thread, false));
      const limit = Math.max(1, params.limit ?? 25);
      const offset = params.cursor ? Number(params.cursor) : 0;
      const data = all.slice(offset, offset + limit);
      return reply({ data, nextCursor: offset + limit < all.length ? String(offset + limit) : null, backwardsCursor: null });
    }
    case "thread/start": {
      if(process.env.RUNNER_ARGS_LOG)writeFileSync(process.env.RUNNER_ARGS_LOG,JSON.stringify(params));
      writeFileSync(join(home,"fake-context.json"),JSON.stringify(params.config??{}));
      const thread = { id: randomUUID(), cwd: params.cwd, createdAt: now(), updatedAt: now(), turns: [], model: params.model ?? "gpt-fake" };
      threads[thread.id] = thread;
      settings.set(thread.id, { approvalPolicy: params.approvalPolicy ?? "never" });
      save();
      reply({ thread: threadView(thread, true), model: thread.model, modelProvider: "openai", serviceTier: null, disabledPluginIds: [], cwd: thread.cwd, instructionSources: [], approvalPolicy: params.approvalPolicy ?? "never", approvalsReviewer: "user", sandbox: { type: "dangerFullAccess" }, reasoningEffort: null });
      return notify("thread/started", { thread: threadView(thread, false) });
    }
    case "thread/resume": {
      if(process.env.RUNNER_ARGS_LOG)writeFileSync(process.env.RUNNER_ARGS_LOG,JSON.stringify(params));
      writeFileSync(join(home,"fake-context.json"),JSON.stringify(params.config??{}));
      const thread = threads[params.threadId];
      if (!thread) return fail("no such thread");
      settings.set(thread.id, { approvalPolicy: params.approvalPolicy ?? "never" });
      return reply({ thread: threadView(thread, true), model: thread.model, modelProvider: "openai", serviceTier: null, disabledPluginIds: [], cwd: thread.cwd, instructionSources: [], approvalPolicy: params.approvalPolicy ?? "never", approvalsReviewer: "user", sandbox: { type: "dangerFullAccess" }, reasoningEffort: null, collaborationMode: null, turnsBackwardsCursor: null, itemsBackwardsCursor: null });
    }
    case "thread/read": {
      const thread = threads[params.threadId];
      // Another process (the "terminal") may have finished its turn meanwhile: pick up the flag from disk.
      if (thread && existsSync(store)) {
        const onDisk = JSON.parse(readFileSync(store, "utf8"))[thread.id];
        if (onDisk) thread.activeExternally = onDisk.activeExternally;
      }
      return thread ? reply({ thread: threadView(thread, params.includeTurns === true) }) : fail("no such thread");
    }
    case "thread/name/set": {
      const thread = threads[params.threadId];
      if (!thread) return fail("no such thread");
      thread.name = params.name; save();
      reply({});
      return notify("thread/name/updated", { threadId: thread.id, threadName: params.name });
    }
    case "thread/delete": {
      if (!threads[params.threadId]) return fail("no such thread");
      delete threads[params.threadId]; save();
      reply({});
      return notify("thread/deleted", { threadId: params.threadId });
    }
    case "thread/turns/list": {
      const thread = threads[params.threadId];
      if (!thread) return fail("no such thread");
      // Native Codex 0.156.1 materializes history only after the first user turn.
      if (thread.turns.length === 0) return fail(`thread ${thread.id} is not materialized yet; thread/turns/list is unavailable before first user message`);
      const limit = Math.max(1, params.limit ?? 25);
      const offset = params.cursor ? Number(params.cursor) : 0;
      const ordered = params.sortDirection === "desc" ? [...thread.turns].reverse() : thread.turns;
      const data = ordered.slice(offset, offset + limit).map((turn) => ({ ...turn, items: params.itemsView === "full" ? turn.items : [] }));
      return reply({ data, nextCursor: offset + limit < ordered.length ? String(offset + limit) : null, backwardsCursor: null });
    }
    case "thread/unsubscribe": return reply({});
    case "thread/compact/start": {
      reply({});
      const item = { type: "contextCompaction", id: uid("item") };
      setTimeout(()=>{notify("item/completed", { item, threadId: params.threadId, turnId: "compact", completedAtMs: Date.now() });notify("turn/completed",{threadId:params.threadId,turn:{id:"compact",status:"completed"}});},80);return;
    }
    case "config/read": return reply({config:{model:"gpt-fake-mini",developer_instructions:process.env.FAKE_DEVELOPER_INSTRUCTIONS}});
    case "skills/list": {
      if(params.forceReload!==true)return fail("skills discovery must refresh");
      const entries=existsSync(join(home,"fake-skills.json"))?JSON.parse(readFileSync(join(home,"fake-skills.json"),"utf8")):[];
      return reply({data:entries.filter(e=>params.cwds.includes(e.cwd))});
    }
    case "model/list":
      return reply({ data: [
        { id: "gpt-fake", model: "gpt-fake", displayName: "Fake", description: "", hidden: false, isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "medium", description: "" }, { reasoningEffort: "high", description: "" }], inputModalities: ["text", "image"] },
        { id: "gpt-fake-mini", model: "gpt-fake-mini", displayName: "Fake mini", description: "", hidden: false, isDefault: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [], inputModalities: ["text"] },
      ], nextCursor: null });
    case "turn/start": {
      writeFileSync(join(home,"fake-input.json"),JSON.stringify(params.input));
      const thread = threads[params.threadId];
      if (!thread) return fail("no such thread");
      if (active.has(thread.id)) return fail("turn already active");
      const turnId = uid("turn-pre");
      reply({ turn: { id: turnId, items: [], itemsView: "notLoaded", status: "inProgress", error: null, startedAt: null, completedAt: null, durationMs: null } });
      void runTurn(thread, params.input, { model: params.model, effort: params.effort });
      return;
    }
    case "turn/steer": {
      const state = active.get(params.threadId);
      if (!state) return fail("no active turn");
      state.steered = params.input;
      return reply({ turnId: state.turnId });
    }
    case "turn/interrupt": {
      const state = active.get(params.threadId);
      if (state) state.interrupted = true;
      return reply({});
    }
    default:
      return fail(`unknown method ${method}`);
  }
});
process.stdin.on("end", () => process.exit(0));
