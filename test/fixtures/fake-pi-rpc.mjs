import './github-env-probe.mjs';
import {writeFileSync,appendFileSync} from "node:fs";
if(process.env.RUNNER_ARGS_LOG)writeFileSync(process.env.RUNNER_ARGS_LOG,JSON.stringify(process.argv));
import readline from "node:readline";

// Stand-in for `pi --mode rpc`. Keeps an append-only entry list shaped like
// Pi's session entries so get_entries / history projection can be exercised
// without a real model. `--session <path>` marks a resumed session by seeding
// one prior exchange, so tests can tell resume from create.
let messageCount = 0;
let streaming = false;
let compacting=false;let unobservable=false;
const entries = [];
let nextEntry = 0;
let sessionName;
let model = { provider: "fake", id: "fake-mini", contextWindow: 200000, reasoning: false };
let thinkingLevel = "medium";
const queue = { steering: [], followUp: [] };
const resumedFrom = process.argv.indexOf("--session") >= 0 ? process.argv[process.argv.indexOf("--session") + 1] : undefined;

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function response(command, id, data = {}) {
  send({ id, type: "response", command, success: true, data });
}

function appendEntry(message) {
  const entry = {
    type: "message",
    id: `e${(nextEntry += 1)}`,
    parentId: entries.length === 0 ? null : entries[entries.length - 1].id,
    timestamp: new Date().toISOString(),
    message,
  };
  entries.push(entry);
  messageCount += 1;
  return entry;
}

const pendingDialogs = new Map();
function finishTurn(text) {
  send({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
  const assistant = { role: "assistant", content: [{ type: "text", text }] };
  appendEntry(assistant);
  send({ type: "message_end", message: assistant });
  streaming = false;
  send({ type: "agent_settled" });
}

if (resumedFrom !== undefined) {
  appendEntry({ role: "user", content: [{ type: "text", text: `resumed from ${resumedFrom}` }] });
  appendEntry({ role: "assistant", content: [{ type: "text", text: "welcome back" }] });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const command = JSON.parse(line);
  switch (command.type) {
    case "get_state":
      if(unobservable){send({id:command.id,type:"response",command:"get_state",success:false,error:"cannot observe"});break;}
      response("get_state", command.id, {
        model,
        isStreaming: streaming,
        isCompacting: compacting,
        thinkingLevel,
        steeringMode: "all",
        followUpMode: "one-at-a-time",
        sessionId: "fake-session",
        sessionFile: undefined,
        ...(sessionName === undefined ? {} : { sessionName }),
        autoCompactionEnabled: true,
        messageCount,
        pendingMessageCount: queue.steering.length + queue.followUp.length,
      });
      break;
    case "set_session_name":
      sessionName = command.name;
      response("set_session_name", command.id);
      break;
    case "get_available_models":
      response("get_available_models", command.id, {
        models: [model, { provider: "fake", id: "fake-large", contextWindow: 400000, reasoning: true }],
      });
      break;
    case "set_model":
      model = { provider: command.provider, id: command.modelId, contextWindow: 400000, reasoning: true };
      response("set_model", command.id, { model });
      break;
    case "get_available_thinking_levels":
      response("get_available_thinking_levels", command.id, { levels: ["off", "low", "medium", "high"] });
      break;
    case "set_thinking_level":
      thinkingLevel = command.level;
      response("set_thinking_level", command.id);
      break;
    case "get_commands":
      response("get_commands", command.id, {
        commands: [
          ...(process.env.FAKE_HANDOFF ? [{name:"handoff",source:"extension"}] : []),
          ...(process.env.FIXTURE_FORK_RPC_LOG ? [{name:"coffee-workspace-jobs",source:"extension"}] : []),
          { name: "harness", description: "Switch harness mode", source: "extension", sourceInfo: { path: "/opt/pi-coffee/dist/src/harness/extension.js", source: "cli", scope: "temporary", origin: "top-level" } },
          { name: "verify", description: "Run verification", source: "extension", sourceInfo: { path: "/opt/pi-coffee/dist/src/harness/extension.js", source: "cli", scope: "temporary", origin: "top-level" } },
          { name: "llama", description: "Manage llama.cpp", source: "extension", sourceInfo: { path: "<inline:llama.cpp>", source: "inline", scope: "temporary", origin: "top-level" } },
          { name: "review", description: "Review the diff", source: "prompt", sourceInfo: { path: "/home/u/.pi/agent/prompts/review.md", source: "auto", scope: "user", origin: "top-level" } },
          { name: "skill:tdd", description: "Test-driven development", source: "skill", sourceInfo: { path: "/home/u/.agents/skills/tdd/SKILL.md", source: "auto", scope: "user", origin: "top-level", baseDir: "/home/u/.agents" } },
        ],
      });
      break;
    case "get_session_stats":
      response("get_session_stats", command.id, {
        sessionId: "fake-session",
        userMessages: entries.filter((e) => e.message?.role === "user").length,
        assistantMessages: entries.filter((e) => e.message?.role === "assistant").length,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: entries.length,
        tokens: { input: 1200, output: 340, cacheRead: 0, cacheWrite: 0, total: 1540 },
        cost: 0.0042,
        contextUsage: { tokens: 1540, contextWindow: 200000, percent: 0.77 },
      });
      break;
    case "compact":
      if(process.env.FIXTURE_FORK_RPC_LOG)appendFileSync(process.env.FIXTURE_FORK_RPC_LOG,JSON.stringify({path:resumedFrom,command:'compact',marker:command.customInstructions})+'\n');
      if(process.env.FAKE_HANDOFF==="unobservable"){unobservable=true;send({id:command.id,type:"response",command:"compact",success:false,error:"Timeout waiting for response to compact. Stderr: fixture"});break;}
      if(process.env.FAKE_HANDOFF){
        const commit=()=>{compacting=false;
          if(command.customInstructions!=="context-handoff:manual:v1")return response("compact",command.id,{});
          entries.push({type:"compaction",id:`e${++nextEntry}`,parentId:entries.at(-1)?.id??null,summary:"handoff",details:process.env.FAKE_HANDOFF==="native" ? {} : {plugin:"pi-handoff",pluginVersion:"0.2.0-experimental.5",trigger:"manual"}});
          response("compact",command.id,{summary:"handoff"});};
        if(process.env.FAKE_HANDOFF==="slow"){compacting=true;setTimeout(commit,31000);}else commit();
        break;
      }
      response("compact", command.id, { summary: "compacted", firstKeptEntryId: entries.at(-1)?.id ?? null, tokensBefore: 1540 });
      send({ type: "compaction_end" });
      break;
    case "steer":
      if(command.message.startsWith("handled:")){response("steer",command.id,{disposition:"handled"});break;}
      if (command.message.startsWith("/harness")) {
        send({ id: command.id, type: "response", command: "steer", success: false, error: "Extension commands cannot be queued." });
        break;
      }
      queue.steering.push(command.message);
      response("steer", command.id);
      send({ type: "queue_update", steering: [...queue.steering], followUp: [...queue.followUp] });
      break;
    case "follow_up":
      if(command.message.startsWith("handled:")){response("follow_up",command.id,{disposition:"handled"});break;}
      if (command.message.startsWith("/harness")) {
        send({ id: command.id, type: "response", command: "follow_up", success: false, error: "Extension commands cannot be queued." });
        break;
      }
      queue.followUp.push(command.message);
      response("follow_up", command.id);
      send({ type: "queue_update", steering: [...queue.steering], followUp: [...queue.followUp] });
      break;
    case "get_entries": {
      const since = command.since;
      const index = since === undefined ? -1 : entries.findIndex((entry) => entry.id === since);
      response("get_entries", command.id, {
        entries: entries.slice(index + 1),
        leafId: entries.length === 0 ? null : entries[entries.length - 1].id,
      });
      break;
    }
    case "extension_ui_response": {
      // A blocked dialog resolves; finish the turn with the answer as text.
      const waiting = pendingDialogs.get(command.id);
      if (!waiting) break;
      pendingDialogs.delete(command.id);
      const answer = command.cancelled ? "cancelled" : command.confirmed !== undefined ? `confirmed=${command.confirmed}` : `value=${command.value}`;
      finishTurn(`answer: ${answer}`);
      break;
    }
    case "prompt": {
      if(process.env.FIXTURE_FORK_RPC_LOG&&command.message.startsWith('/coffee-workspace-jobs ')){
        entries.push({type:'custom',customType:'coffee-workspace-jobs',id:`e${++nextEntry}`,parentId:entries.at(-1)?.id??null,data:{nonce:command.message.split(' ')[1],known:true,active:0}});response('prompt',command.id);break;
      }
      if (command.message.startsWith("reject:")) {
        // What real Pi does when no provider key is configured: the prompt
        // response itself fails and no agent_start / agent_settled follows.
        send({ id: command.id, type: "response", command: "prompt", success: false, error: "No API key found for the selected model." });
        break;
      }
      response("prompt", command.id);
      if (command.message === "crash: after acceptance") {
        streaming = true;
        send({ type: "agent_start" });
        setTimeout(() => process.kill(process.pid, "SIGKILL"), 30);
        break;
      }
      if (command.message.startsWith("hold:")) {
        streaming=true;appendEntry({role:"user",content:[{type:"text",text:command.message}]});send({type:"agent_start"});break;
      }
      if (command.message.startsWith("ask:") || command.message.startsWith("choose:")) {
        // Simulate an extension calling ctx.ui.confirm() / ctx.ui.select():
        // the run blocks until the client answers.
        setImmediate(() => {
          streaming = true;
          send({ type: "agent_start" });
          appendEntry({ role: "user", content: [{ type: "text", text: command.message }] });
          const id = `ui-${(nextEntry += 1)}`;
          pendingDialogs.set(id, true);
          if (command.message.startsWith("ask:")) {
            send({ type: "extension_ui_request", id, method: "confirm", title: command.message.slice(4).trim(), message: "fake extension asks" });
          } else {
            send({ type: "extension_ui_request", id, method: "select", title: command.message.slice(7).trim(), options: ["Allow", "Block"] });
          }
        });
        break;
      }
      setImmediate(() => {
        streaming = true;
        send({ type: "agent_start" });
        appendEntry({ role: "user", content: [{ type: "text", text: command.message }] });
        send({
          type: "message_update",
          usage: {},
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: `echo: ${command.message}` },
        });
        const assistant = { role: "assistant", content: [{ type: "text", text: `echo: ${command.message}` }] };
        appendEntry(assistant);
        send({ type: "message_end", message: assistant });
        const settle=()=>{streaming=false;send({type:"agent_settled"});};
        if(process.env.FAKE_SETTLE_DELAY_MS)setTimeout(settle,Number(process.env.FAKE_SETTLE_DELAY_MS));
        else settle();
      });
      break;
    }
    case "abort":
      response("abort", command.id);
      streaming = false;
      send({ type: "agent_settled" });
      break;
    default:
      response(command.type, command.id);
  }
}
