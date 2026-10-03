import type { HistoryEntry, ImageInput } from "../../shared/protocol.js";
import type { Json, Obj } from "./rpc.js";

/**
 * Pure projections from Codex app-server shapes (threads, turns, items) to
 * what the seam and the browser already understand. No I/O lives here.
 */


export function toUserInput(text: string, images?: ImageInput[]): Json[] {
  const input: Json[] = [{ type: "text", text, text_elements: [] }];
  for (const image of images ?? []) {
    input.push({ type: "image", url: `data:${image.mimeType};base64,${image.data}` });
  }
  return input;
}

export function toIso(value: Json | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date(0).toISOString();
}

export function countMessages(turns: Obj[]): number {
  let count = 0;
  for (const turn of turns) {
    for (const item of Array.isArray(turn.items) ? (turn.items as Obj[]) : []) {
      if (item.type === "userMessage" || item.type === "agentMessage") count += 1;
    }
  }
  return count;
}

/** Map a Codex item to the tool name/args the shell knows how to summarise. */
export function toolCallOf(item: Obj): { name: string; args: Obj } | undefined {
  switch (item.type) {
    case "commandExecution":
      return { name: "bash", args: { command: String(item.command ?? ""), ...(typeof item.cwd === "string" ? { cwd: item.cwd } : {}) } };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? (item.changes as Obj[]) : [];
      const paths = changes.map((change) => String(change.path ?? "")).filter((path) => path.length > 0);
      return { name: "edit", args: { path: paths.join(", ") } };
    }
    case "mcpToolCall":
      return { name: `${String(item.server ?? "mcp")}.${String(item.tool ?? "tool")}`, args: asObj(item.arguments) };
    case "dynamicToolCall":
      return { name: String(item.tool ?? "tool"), args: asObj(item.arguments) };
    case "webSearch":
      return { name: "web_search", args: { query: String(item.query ?? "") } };
    case "imageView":
      return { name: "read", args: { path: String(item.path ?? "") } };
    case "collabAgentToolCall":
      return { name: "subagent", args: { tool: String(item.tool ?? ""), ...(typeof item.prompt === "string" ? { prompt: item.prompt } : {}) } };
    default:
      return undefined;
  }
}

export function toolResultOf(item: Obj): { result: Json; isError: boolean } {
  const text = (value: string) => ({ content: [{ type: "text", text: value }] });
  switch (item.type) {
    case "commandExecution": {
      const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
      const exitCode = typeof item.exitCode === "number" ? item.exitCode : undefined;
      const failed = item.status === "failed" || item.status === "declined" || (exitCode !== undefined && exitCode !== 0);
      const suffix = exitCode !== undefined && exitCode !== 0 ? `\n[exit ${exitCode}]` : item.status === "declined" ? "\n[declined]" : "";
      return { result: text(`${output}${suffix}`), isError: failed };
    }
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? (item.changes as Obj[]) : [];
      const patch = changes.map((change) => {
        const path = String(change.path ?? "");
        const diff = typeof change.diff === "string" ? change.diff : "";
        return diff.startsWith("---") || diff.startsWith("diff ") ? diff : `--- a/${path}\n+++ b/${path}\n${diff}`;
      }).join("\n");
      const failed = item.status === "failed" || item.status === "declined";
      return {
        result: { content: [{ type: "text", text: failed ? `修改未应用（${String(item.status)}）` : `已修改 ${changes.length} 个文件` }], details: { patch } },
        isError: failed,
      };
    }
    case "mcpToolCall": {
      const error = item.error as Obj | null | undefined;
      if (error && typeof error.message === "string") return { result: text(error.message), isError: true };
      return { result: text(stringify(item.result)), isError: item.status === "failed" };
    }
    case "dynamicToolCall": {
      const parts = Array.isArray(item.contentItems) ? (item.contentItems as Obj[]) : [];
      const joined = parts.map((part) => (typeof part.text === "string" ? part.text : stringify(part))).join("\n");
      return { result: text(joined), isError: item.success === false || item.status === "failed" };
    }
    case "webSearch":
      return { result: text(stringify(item.action ?? item)), isError: false };
    default:
      return { result: text(stringify(item)), isError: false };
  }
}

/** Completed Codex turns → the shell's history entries. */
export function projectTurns(turns: Obj[]): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const turn of turns) {
    const at = typeof turn.startedAt === "number" ? toIso(turn.startedAt) : undefined;
    for (const item of Array.isArray(turn.items) ? (turn.items as Obj[]) : []) {
      if (typeof item.id !== "string" || !item.id) throw new Error("Native Codex history item is missing its durable ID");
      const id = item.id;
      const stamp = at === undefined ? {} : { at };
      switch (item.type) {
        case "userMessage": {
          const content = Array.isArray(item.content) ? (item.content as Obj[]) : [];
          const text = content.filter((part) => part.type === "text").map((part) => String(part.text ?? "")).join("\n");
          const imageCount = content.filter((part) => part.type === "image" || part.type === "localImage").length;
          entries.push({ kind: "user", id, ...stamp, text, ...(imageCount > 0 ? { imageCount } : {}) });
          break;
        }
        case "agentMessage":
          entries.push({ kind: "assistant", id, ...stamp, text: String(item.text ?? "") });
          break;
        case "plan": {
          const text = String(item.text ?? "");
          if (text.trim()) entries.push({ kind: "note", id, ...stamp, text: `计划：\n${text}` });
          break;
        }
        case "contextCompaction":
          entries.push({ kind: "note", id, ...stamp, text: "已压缩上下文。" });
          break;
        default: {
          const tool = toolCallOf(item);
          if (!tool) break;
          const outcome = toolResultOf(item);
          const result = outcome.result as Obj;
          const content = Array.isArray(result.content) ? (result.content as Obj[]) : [];
          const details = result.details as Obj | undefined;
          entries.push({
            kind: "tool",
            id,
            ...stamp,
            name: tool.name,
            args: tool.args,
            result: content.map((part) => String(part.text ?? "")).join("\n"),
            ...(outcome.isError ? { isError: true } : {}),
            ...(typeof details?.patch === "string" && details.patch.length > 0 ? { diff: details.patch } : {}),
          });
        }
      }
    }
    if (turn.status === "failed") {
      const error = turn.error as Obj | null | undefined;
      entries.push({ kind: "note", id: `${String(turn.id)}-error`, ...(at === undefined ? {} : { at }), text: `模型调用失败：${typeof error?.message === "string" ? error.message : "未知错误"}` });
    }
  }
  return entries;
}

export function asObj(value: Json | undefined): Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : { value: value ?? null };
}

export function stringify(value: Json | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}
