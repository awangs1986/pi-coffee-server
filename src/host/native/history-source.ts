import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";
import { join } from "node:path";
import type { AgentHistory, AgentHistoryRead } from "../agent-adapter.js";
import type { TakeoverSegment } from "../takeover.js";
import { checkedTaskRoot } from "../task-storage.js";

export const sourceHash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export function unknownHistory(binding: string): AgentHistoryRead {
  return { history: { entries: [], leafId: null }, binding, sourceGeneration: "unknown", sourceFreshness: "unknown", checkedAt: new Date().toISOString() };
}

/** Full-content audit, never mtime/tail equality. Detect concurrent writes and path replacement. */
export async function readStableSource(path: string): Promise<{ text: string; generation: string; identity: string }> {
  const before = await lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > 64n * 1024n * 1024n) throw new Error("Native source is unavailable or exceeds the audit budget");
  const file = await open(path, "r");
  try {
    const opened = await file.stat({ bigint: true });
    if (before.dev !== opened.dev || before.ino !== opened.ino) throw new Error("Native source changed while opening");
    // Read exactly the inspected size, never chase a concurrently growing log.
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (!result.bytesRead) throw new Error("Native source read is incomplete");
      offset += result.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const current = await lstat(path, { bigint: true });
    for (const observed of [after, current]) {
      if (!observed.isFile() || observed.isSymbolicLink() || observed.dev !== before.dev || observed.ino !== before.ino || observed.size !== before.size || observed.mtimeNs !== before.mtimeNs || observed.ctimeNs !== before.ctimeNs) throw new Error("Native source changed during audit");
    }
    if (BigInt(bytes.length) !== before.size) throw new Error("Native source read is incomplete");
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), generation: sourceHash(bytes), identity: `${before.dev}:${before.ino}` };
  } finally { await file.close(); }
}

/** A partial or malformed final record is unknown, never a falsely complete shorter history. */
export async function parseSourceLines(text: string): Promise<Record<string, any>[]> {
  const rows: Record<string, any>[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].trim()) continue;
    const row: unknown = JSON.parse(lines[index]);
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid native history record");
    rows.push(row as Record<string, any>);
    if (index % 250 === 249) await setImmediate();
  }
  return rows;
}

/** Runs only in the audit worker; the retained prefix can itself be large. */
export async function readTakeoverHistory(read: AgentHistoryRead, root: string, segment: TakeoverSegment): Promise<AgentHistoryRead> {
  await checkedTaskRoot(root); await checkedTaskRoot(join(root, "takeover"));
  if (!/^[a-zA-Z0-9-]+$/.test(segment.id)) throw new Error("Invalid takeover segment");
  const previous = await readStableSource(join(root, "takeover", `${segment.id}-history.json`));
  const history = JSON.parse(previous.text) as AgentHistory;
  if (!Array.isArray(history.entries) || history.entries.some(entry => !entry || typeof entry.id !== "string")) throw new Error("Invalid takeover history");
  read.history.entries = [
    ...history.entries.map(entry => ({ ...entry, id: `${segment.id}:${entry.id}` })),
    { kind: "note", id: `${segment.id}:switch`, at: segment.at, text: `Agent 交接：${segment.from === "pi" ? "Pi" : "Codex"} → ${segment.to === "pi" ? "Pi" : "Codex"}。历史保留；新 Agent 使用独立原生会话。` },
    ...read.history.entries.filter(entry => !(entry.kind === "user" && entry.text.startsWith("[PI Coffee automatic takeover v1]"))).map(entry => entry.kind === "assistant" ? { ...entry, text: entry.text.replace(/\n?\[TAKEOVER_(READY|BLOCKED)\]\s*$/, "") } : entry),
  ];
  return { ...read, sourceGeneration: sourceHash(`${read.sourceGeneration}:${previous.generation}`) };
}
