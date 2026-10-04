import { mkdtemp, mkdir, readFile, writeFile, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcPiSessionFactory } from "../src/host/pi-adapter.js";
import { CodexSessionFactory } from "../src/host/codex-adapter.js";
import { readClaudeHistory } from "../src/host/native/claude.js";
import { NativeAgentFactory } from "../src/host/native/factory.js";
import { sourceHash, unknownHistory } from "../src/host/native/history-source.js";
import type { AgentSessionFactory } from "../src/host/agent-adapter.js";
import type { Workspaces } from "../src/host/workspaces.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function root() { const value = await mkdtemp(join(tmpdir(), "coffee-readonly-native-")); roots.push(value); return value; }
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
const at = "2026-10-03T00:00:00.000Z";
const piRows = (id: string) => [
  { type: "session", version: 3, id, timestamp: at, cwd: "/synthetic" },
  { type: "message", id: "user-1", parentId: null, timestamp: at, message: { role: "user", content: [{ type: "text", text: "question" }] } },
  { type: "message", id: "assistant-1", parentId: "user-1", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "answer-a" }] } },
];

describe("native source audits without runtime ownership", () => {
  it("reads Pi with no executable or runtime hooks, detects same-size edits and deletion, and keeps binding stable across restart", async () => {
    const sessionDir = await root(), id = "pi-read-only", path = join(sessionDir, `2026-10-03_${id}.jsonl`);
    const initial = jsonl(piRows(id)); await writeFile(path, initial);
    const instructions = vi.fn(() => { throw new Error("must not request instructions"); });
    const factory = new RpcPiSessionFactory({ sessionDir, cliPath: "/no-runtime-allowed", instructions });
    const first = await factory.readHistory(id), originalStat = await stat(path);
    expect(first).toMatchObject({ sourceFreshness: "current", sourceGeneration: sourceHash(initial), history: { entries: [{ id: "user-1" }, { id: "assistant-1", text: "answer-a" }] } });
    expect(instructions).not.toHaveBeenCalled();
    expect((await new RpcPiSessionFactory({ sessionDir }).readHistory(id)).binding).toBe(first.binding);
    await writeFile(path, initial.replace("answer-a", "answer-b")); await utimes(path, originalStat.atime, originalStat.mtime);
    const edited = await factory.readHistory(id);
    expect(edited.sourceFreshness).toBe("current"); expect(edited.sourceGeneration).not.toBe(first.sourceGeneration); expect(edited.binding).toBe(first.binding);
    expect(edited.history.entries.at(-1)).toMatchObject({ id: "assistant-1", text: "answer-b" });
    await rm(path); expect((await factory.readHistory(id)).sourceFreshness).toBe("unknown");
  });

  it("keeps ordinary Pi append in its epoch but changes binding on a native branch", async () => {
    const sessionDir = await root(), id = "pi-branch", path = join(sessionDir, `2026-10-03_${id}.jsonl`), rows = piRows(id);
    await writeFile(path, jsonl(rows)); const factory = new RpcPiSessionFactory({ sessionDir }), first = await factory.readHistory(id);
    rows.push({ type: "message", id: "user-2", parentId: "assistant-1", timestamp: at, message: { role: "user", content: [{ type: "text", text: "continue" }] } });
    await writeFile(path, jsonl(rows)); expect((await factory.readHistory(id)).binding).toBe(first.binding);
    rows.push({ type: "message", id: "branch-answer", parentId: "user-1", timestamp: at, message: { role: "assistant", content: [{ type: "text", text: "new branch" }] } });
    await writeFile(path, jsonl(rows)); const branched = await factory.readHistory(id);
    expect(branched.sourceFreshness).toBe("current"); expect(branched.binding).not.toBe(first.binding);
    expect(branched.history.entries.map(entry => entry.id)).toEqual(["user-1", "branch-answer"]);
    await writeFile(path, jsonl(rows) + '{"type":'); expect((await factory.readHistory(id)).sourceFreshness).toBe("unknown");
  });

  it("preserves full Pi tool output, diff and arguments for separately bounded content reads", async () => {
    const sessionDir = await root(), id = "pi-tool", path = join(sessionDir, `2026-10-03_${id}.jsonl`);
    const output = "x".repeat(45_000), diff = "d".repeat(22_000), argument = "a".repeat(12_000);
    await writeFile(path, jsonl([
      piRows(id)[0],
      { type: "message", id: "call-message", parentId: null, timestamp: at, message: { role: "assistant", content: [{ type: "toolCall", id: "tool-call", name: "edit", arguments: { content: argument } }] } },
      { type: "message", id: "result-message", parentId: "call-message", timestamp: at, message: { role: "toolResult", toolCallId: "tool-call", content: [{ type: "text", text: output }], details: { diff } } },
    ]));
    const result = await new RpcPiSessionFactory({ sessionDir }).readHistory(id);
    expect(result.sourceFreshness).toBe("current");
    expect(result.history.entries).toEqual([{ kind: "tool", id: "tool-call", at, name: "edit", args: { content: argument }, result: output, diff, isError: false }]);
  });

  it("reads Claude's own file and merges split assistant blocks using the live native message ID", async () => {
    const home = await root(), cwd = "/synthetic/work", id = "claude-native", directory = join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
    await mkdir(directory, { recursive: true }); const path = join(directory, `${id}.jsonl`);
    const rows = [
      { type: "user", uuid: "u-1", sessionId: id, message: { content: "hello" } },
      { type: "assistant", uuid: "a-part1", sessionId: id, message: { id: "msg-native", content: [{ type: "text", text: "part-a" }, { type: "tool_use", id: "call-native", name: "Read", input: { file: "one" } }] } },
      { type: "assistant", uuid: "a-part2", sessionId: id, message: { id: "msg-native", content: [{ type: "text", text: "part-b" }] } },
      { type: "user", uuid: "u-tool", sessionId: id, message: { content: [{ type: "tool_result", tool_use_id: "call-native", content: "result-a" }] } },
    ];
    const command = { command: "/no-runtime-allowed", env: { CLAUDE_CONFIG_DIR: home } };
    await writeFile(path, jsonl(rows)); const initial = await readClaudeHistory(command, cwd, id);
    expect(initial.sourceFreshness).toBe("current"); expect(initial.history.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "msg-native", text: "part-a\npart-b" }), expect.objectContaining({ id: "call-native", result: "result-a" }),
    ]));
    await writeFile(path, jsonl(rows).replace("result-a", "result-b")); const edited = await readClaudeHistory(command, cwd, id);
    expect(edited.sourceGeneration).not.toBe(initial.sourceGeneration); expect(edited.binding).toBe(initial.binding);
    await writeFile(path, jsonl(rows).replaceAll(id, "wrong-session")); expect((await readClaudeHistory(command, cwd, id)).sourceFreshness).toBe("unknown");
    await rm(path); expect((await readClaudeHistory(command, cwd, id)).sourceFreshness).toBe("unknown");
  });

  it("reads canonical Codex rollout IDs without starting app-server and detects complete-source edits", async () => {
    const home = await root(), cwd = join(home, "work"), id = "11111111-2222-4333-8444-555555555555", directory = join(home, "sessions", "2026", "10", "03");
    await mkdir(directory, { recursive: true }); const path = join(directory, `rollout-2026-10-03T00-00-00-${id}.jsonl`);
    const rows = [
      { type: "session_meta", payload: { id, cwd } },
      { type: "event_msg", timestamp: at, payload: { type: "item_completed", thread_id: id, turn_id: "turn-1", item: { type: "UserMessage", id: "user-native", content: [{ type: "text", text: "hello" }] } } },
      { type: "event_msg", timestamp: at, payload: { type: "item_completed", thread_id: id, turn_id: "turn-1", item: { type: "AgentMessage", id: "assistant-native", content: [{ type: "Text", text: "answer-a" }] } } },
      { type: "event_msg", timestamp: at, payload: { type: "item_completed", thread_id: id, turn_id: "turn-1", item: { type: "CommandExecution", id: "tool-native", command: ["cat", "note.txt"], aggregated_output: "output-a", exit_code: 0, status: "completed" } } },
    ];
    await writeFile(path, jsonl(rows)); const factory = new CodexSessionFactory({ cwd, codexHome: home, cliPath: "/no-runtime-allowed" });
    const initial = await factory.readHistory(id);
    expect(initial.sourceFreshness).toBe("current"); expect(factory.serverRunning).toBe(false);
    expect(initial.history.entries.map(entry => entry.id)).toEqual(["user-native", "assistant-native", "tool-native"]);
    await writeFile(path, jsonl(rows).replace("answer-a", "answer-b")); const edited = await factory.readHistory(id);
    expect(edited.sourceFreshness).toBe("current"); expect(edited.sourceGeneration).not.toBe(initial.sourceGeneration); expect(edited.binding).toBe(initial.binding);
    const beforeDelete = await stat(path);
    const withoutAssistant = rows.map((row, index) => index === 2 ? " ".repeat(JSON.stringify(row).length) : JSON.stringify(row)).join("\n") + "\n";
    expect(Buffer.byteLength(withoutAssistant)).toBe(Buffer.byteLength(jsonl(rows)));
    await writeFile(path, withoutAssistant); await utimes(path, beforeDelete.atime, beforeDelete.mtime);
    const deleted = await factory.readHistory(id);
    expect(deleted.sourceFreshness).toBe("current"); expect(deleted.sourceGeneration).not.toBe(initial.sourceGeneration);
    expect(deleted.history.entries.map(entry => entry.id)).toEqual(["user-native", "tool-native"]);
    const otherUser = new CodexSessionFactory({ cwd: join(home, "other-user"), codexHome: home }); expect((await otherUser.readHistory(id)).sourceFreshness).toBe("unknown");
    await writeFile(path, jsonl([rows[0], { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "legacy without durable live ID" }] } }]));
    expect((await factory.readHistory(id)).sourceFreshness).toBe("unknown");
    await rm(path); expect((await factory.readHistory(id)).sourceFreshness).toBe("unknown");
  });

  it("composes takeover history read-only, retaining the segment and never touching runtime or workspace setup", async () => {
    const directory = await root(); await mkdir(join(directory, "takeover"));
    await writeFile(join(directory, "takeover", "switch-id-history.json"), JSON.stringify({ entries: [{ kind: "user", id: "old-user", text: "old question" }], leafId: "old-user" }));
    const task = { id: "task", engine: "pi", cwd: "/missing-workspace", taskRoot: directory, nativeBinding: { state: "bound", id: "native-new" }, takeoverSegments: [{ id: "switch-id", from: "codex", to: "pi", at }] };
    const forbidden = vi.fn(() => { throw new Error("Read route reached execution path"); });
    const nativeRead = vi.fn(async () => ({ ...unknownHistory("pi:native-new"), history: { entries: [{ kind: "assistant" as const, id: "answer", text: "ready\n[TAKEOVER_READY]" }], leafId: "answer" }, sourceFreshness: "current" as const, sourceGeneration: "generation" }));
    const pi = { readHistory: nativeRead, create: forbidden, list: forbidden, delete: forbidden } as AgentSessionFactory;
    const workspaces = { lookup: async () => task, file: forbidden, dataRoot: forbidden, setNativeBinding: forbidden } as unknown as Workspaces;
    const factory = new NativeAgentFactory({ pi, workspaces });
    const history = await factory.readHistory("task");
    expect(history.sourceFreshness).toBe("current"); expect(history.binding).toBe("pi:native-new:switch-id"); expect(nativeRead).toHaveBeenCalledWith("native-new");
    expect(history.history.entries).toEqual(expect.arrayContaining([expect.objectContaining({ id: "switch-id:old-user" }), expect.objectContaining({ id: "answer", text: "ready" })]));
    expect(forbidden).not.toHaveBeenCalled();
    const saved = await readFile(join(directory, "takeover", "switch-id-history.json"), "utf8"); expect(saved).toContain("old question");
  });

  it("rejects an audit when its native binding changes before the result can be published", async () => {
    const task = { engine: "pi", cwd: "/synthetic", nativeBinding: { state: "bound", id: "old" }, takeoverSegments: [{ id: "switch", from: "codex", to: "pi", at }] };
    const pi = { readHistory: async () => { task.nativeBinding.id = "new"; return { ...unknownHistory("pi:old"), sourceFreshness: "current" as const }; } } as AgentSessionFactory;
    const factory = new NativeAgentFactory({ pi, workspaces: { lookup: async () => task } as unknown as Workspaces });
    expect((await factory.readHistory("task")).sourceFreshness).toBe("unknown");
  });
});

it.each(['rebound','deleted'])('rechecks a %s workspace binding record rather than the captured object',async change=>{
 let current:any={engine:'pi',cwd:'/synthetic',nativeBinding:{state:'bound',id:'old'}};
 const pi={readHistory:async()=>{current=change==='deleted'?undefined:{...current,nativeBinding:{state:'bound',id:'new'}};return {...unknownHistory('pi:old'),sourceFreshness:'current' as const};}} as AgentSessionFactory;
 const factory=new NativeAgentFactory({pi,workspaces:{lookup:async()=>structuredClone(current)} as unknown as Workspaces});
 expect((await factory.readHistory('task')).sourceFreshness).toBe('unknown');
});

it('does not start Cursor merely to audit passive browser history',async()=>{
 const forbidden=vi.fn(()=>{throw new Error('Passive read cannot start a CLI');});
 const pi={create:forbidden,list:forbidden,delete:forbidden} as unknown as AgentSessionFactory;
 const workspaces={lookup:async()=>({engine:'cursor',cwd:'/synthetic',nativeBinding:{state:'bound',id:'cursor-native'}}),file:forbidden,dataRoot:forbidden} as unknown as Workspaces;
 const factory=new NativeAgentFactory({pi,workspaces,cursor:{command:'/no-executable-allowed'}});
 expect(await factory.readHistory('task')).toMatchObject({sourceFreshness:'unknown',binding:'cursor:cursor-native:original'});expect(forbidden).not.toHaveBeenCalled();
});
