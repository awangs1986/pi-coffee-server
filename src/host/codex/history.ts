import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentHistoryRead } from "../agent-adapter.js";
import type { HistoryEntry } from "../../shared/protocol.js";
import { parseSourceLines, readStableSource, sourceHash, unknownHistory } from "../native/history-source.js";
import { projectTurns } from "./translate.js";
import type { Obj } from "./rpc.js";
import { nativeHistoryJob, nativeHistoryNeedsWorker } from "../native/history-pool.js";

/** Bounded native-store discovery. Never follow directory links or consult credentials. */
async function rolloutPath(home: string, id: string): Promise<string | undefined> {
  const matches: string[] = [];
  let budget = 20_000;
  async function visit(directory: string, depth: number): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      if (--budget < 0) throw new Error("Native source discovery budget exceeded");
      if (entry.isDirectory() && depth > 0) await visit(join(directory, entry.name), depth - 1);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(`-${id}.jsonl`)) matches.push(join(directory, entry.name));
    }
  }
  await visit(join(home, "sessions"), 3);
  await visit(join(home, "archived_sessions"), 3);
  return matches.length === 1 ? matches[0] : undefined;
}

function normalizeItem(item: Record<string, any>): Obj | undefined {
  const type = String(item.type ?? "");
  const lower = type.charAt(0).toLowerCase() + type.slice(1);
  if (typeof item.id !== "string" || !item.id) throw new Error("Native item has no durable ID");
  const base: Obj = { ...item, type: lower };
  switch (lower) {
    case "userMessage": base.content = (item.content ?? []).map((part: any) => ({ ...part, type: String(part.type ?? "").replace(/^./, (letter: string) => letter.toLowerCase()) })); break;
    case "agentMessage": base.text = item.text ?? (item.content ?? []).filter((part: any) => ["Text", "text"].includes(part.type)).map((part: any) => part.text).join(""); break;
    case "commandExecution":
      base.command = Array.isArray(item.command) ? item.command.join(" ") : item.command ?? "";
      base.aggregatedOutput = item.aggregated_output ?? item.aggregatedOutput ?? "";
      base.exitCode = item.exit_code ?? item.exitCode ?? null;
      base.status = String(item.status ?? "").replace("in_progress", "inProgress"); break;
    case "fileChange":
      base.changes = Array.isArray(item.changes) ? item.changes : Object.entries(item.changes ?? {}).map(([path, raw]) => {
        const change = raw as Record<string, any>;
        return { path, diff: change.unified_diff ?? change.diff ?? change.content ?? "" };
      }); break;
    case "dynamicToolCall": base.contentItems = item.content_items ?? item.contentItems ?? []; break;
    case "collabAgentToolCall": base.agentsStates = item.agents_states ?? item.agentsStates ?? {}; break;
    case "plan": case "contextCompaction": case "mcpToolCall": case "webSearch": case "imageView": break;
    // These are intentionally not part of the existing public display projection.
    case "reasoning": case "hookPrompt": case "functionCallOutput": return undefined;
    default: throw new Error("Native rollout contains an unsupported display item");
  }
  return base;
}

/**
 * Canonical persisted lifecycle items preserve the same IDs as App Server live
 * events. Legacy response-only rollouts cannot prove that correspondence and
 * remain unknown instead of inventing IDs or silently truncating their history.
 * Format authority: openai/codex rust-v0.159.1 protocol::{EventMsg,TurnItem}.
 */
export async function readCodexHistory(options: { cwd: string; codexHome?: string; env?: Record<string, string> }, nativeId: string): Promise<AgentHistoryRead> {
  const binding = `codex:${nativeId}`;
  if (nativeHistoryNeedsWorker) return nativeHistoryJob("codex", { options: { cwd: options.cwd, codexHome: options.codexHome ?? options.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), ".codex") }, nativeId }).catch(() => unknownHistory(binding));
  if (!/^[a-zA-Z0-9-]+$/.test(nativeId)) return unknownHistory(binding);
  try {
    const path = await rolloutPath(options.codexHome ?? options.env?.CODEX_HOME ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"), nativeId);
    if (!path) return unknownHistory(binding);
    const source = await readStableSource(path), rows = await parseSourceLines(source.text);
    const meta = rows[0];
    if (meta?.type !== "session_meta" || meta.payload?.id !== nativeId || typeof meta.payload.cwd !== "string" || resolve(meta.payload.cwd) !== resolve(options.cwd)) return unknownHistory(binding);
    const items = new Map<string, { item: Obj; turn: string; at?: string }>();
    const turnOrder: string[] = [], activeTurns = new Set<string>(), canonicalTurns = new Set<string>(), legacyTurns = new Set<string>();
    const legacyItems: Array<{ turn: string; role?: string; text?: string; id?: string }> = [];
    const branches: string[] = [];
    let turn = "initial", hasLegacyMessages = false;
    for (const row of rows.slice(1)) {
      const event = row.payload;
      if (!event || typeof event !== "object") throw new Error("Invalid native rollout record");
      if (row.type === "turn_context" && typeof event.turn_id === "string") turn = event.turn_id;
      if (row.type === "response_item" && (event.type === "message" && ["user", "assistant"].includes(event.role) || ["function_call", "custom_tool_call"].includes(event.type))) {
        legacyTurns.add(turn); hasLegacyMessages = true;
        if (event.type !== "message") legacyItems.push({ turn, id: event.call_id ?? event.id });
        else legacyItems.push({ turn, role: event.role, text: (event.content ?? []).filter((part: any) => ["input_text", "output_text", "text"].includes(part.type)).map((part: any) => part.text).join("") });
      }
      if (row.type !== "event_msg") continue;
      if (event.type === "task_started" && typeof event.turn_id === "string") turn = event.turn_id;
      if (event.type === "thread_rolled_back") {
        if (!Number.isSafeInteger(event.num_turns) || event.num_turns < 0) throw new Error("Invalid native rollback");
        const removed = new Set(turnOrder.splice(Math.max(0, turnOrder.length - event.num_turns)));
        for (const id of removed) activeTurns.delete(id);
        for (const [id, value] of items) if (removed.has(value.turn)) items.delete(id);
        branches.push(sourceHash(JSON.stringify(row)));
        continue;
      }
      if (["user_message", "agent_message", "exec_command_begin", "patch_apply_begin"].includes(event.type)) {
        legacyTurns.add(turn); hasLegacyMessages = true;
        legacyItems.push(event.type.endsWith("_message") ? { turn, role: event.type === "user_message" ? "user" : "assistant", text: event.message } : { turn, id: event.call_id });
      }
      if (!["item_started", "item_completed"].includes(event.type)) continue;
      if (event.thread_id && event.thread_id !== nativeId) throw new Error("Native thread identity changed");
      const turnId = event.turn_id;
      if (typeof turnId !== "string" || !event.item || typeof event.item !== "object") throw new Error("Native item identity is missing");
      turn = turnId; canonicalTurns.add(turnId);
      if (!activeTurns.has(turnId)) { activeTurns.add(turnId); turnOrder.push(turnId); }
      const item = normalizeItem(event.item);
      if (item) items.set(String(item.id), { item, turn: turnId, ...(typeof row.timestamp === "string" ? { at: row.timestamp } : {}) });
    }
    // Mixed old/new stores need native migration support before claiming completeness.
    if (hasLegacyMessages && [...legacyTurns].some(id => !canonicalTurns.has(id))) return unknownHistory(binding);
    const canonicalKeys = new Set<string>();
    for (const { item, turn } of items.values()) {
      canonicalKeys.add(JSON.stringify([turn, "id", item.id]));
      if (item.type === "agentMessage") canonicalKeys.add(JSON.stringify([turn, "assistant", sourceHash(String(item.text))]));
      if (item.type === "userMessage") canonicalKeys.add(JSON.stringify([turn, "user", sourceHash((item.content as Obj[]).filter(part => part.type === "text").map(part => part.text).join(""))]));
    }
    if (legacyItems.some(legacy => !canonicalKeys.has(JSON.stringify(legacy.id ? [legacy.turn, "id", legacy.id] : [legacy.turn, legacy.role, sourceHash(legacy.text ?? "")] )))) return unknownHistory(binding);
    const entries: HistoryEntry[] = [];
    for (const { item, at } of items.values()) entries.push(...projectTurns([{ items: [item] }]).map(entry => ({ ...entry, ...(at ? { at } : {}) })));
    return { history: { entries, leafId: entries.at(-1)?.id ?? null }, binding: `${binding}:${source.identity}:${sourceHash(JSON.stringify(branches))}`, sourceGeneration: source.generation, sourceFreshness: "current", checkedAt: new Date().toISOString() };
  } catch { return unknownHistory(binding); }
}
