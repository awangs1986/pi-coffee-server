/**
 * The deliberately small PI Coffee wire protocol.
 *
 * The browser and Host never exchange Pi implementation objects directly.  Pi
 * events are carried as JSON values so the Host adapter can be replaced later
 * (for example by the native Pi server package) without changing the Web
 * Server seam.
 */

export const PROTOCOL_VERSION = 1 as const;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 64 * 1024;
export const MAX_REQUEST_ID_CHARS = 256;

export type AgentEngine = "pi" | "codex" | "claude";
export function parseAgentEngine(value: unknown): AgentEngine {
  if (value === undefined) return "pi";
  if (value === "pi" || value === "codex" || value === "claude") return value;
  throw new Error("Unknown Agent; choose Pi, Codex or Claude Code");
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ImageInput {
  type: "image";
  data: string;
  mimeType: string;
}

export interface SessionState {
  isCompacting?: boolean;
  isStreaming: boolean;
  messageCount: number;
  sessionName?: string;
}

/**
 * One row of the conversation list. Derived on the Host from Pi's native
 * session store in the User VM; the browser never persists it.
 */
export interface SessionSummary {
  id: string;
  engine?: AgentEngine;
  name?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  running: boolean;
  /**
   * Why this conversation wants the user's eyes: an agent dialog is waiting
   * for an answer, or a run finished while no browser was attached. Absent
   * when nothing is pending; the sidebar sorts these to the top.
   */
  attention?: "waiting" | "finished";
  /**
   * Where the conversation was started, as the agent's own store records it
   * (Codex: `appServer` for ours, `cli` for the VM admin's terminal, …).
   * Absent when the agent does not distinguish.
   */
  source?: string;
}

/**
 * Display-ready projection of completed conversation entries. Produced by the
 * Pi adapter from the durable session file, so a fresh browser sees the whole
 * conversation without ever having cached anything locally.
 */
export type HistoryEntry =
  | { kind: "user"; id: string; at?: string; text: string; imageCount?: number }
  | { kind: "assistant"; id: string; at?: string; text: string }
  | { kind: "tool"; id: string; at?: string; name: string; args: JsonValue; result?: string; isError?: boolean; diff?: string }
  | { kind: "note"; id: string; at?: string; text: string };

/** Model choices as exposed by the Host; never includes credentials. */
export interface ModelChoice {
  source?: "native" | "relay";
  provider: string;
  id: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export type ContextPreset = "272k" | "maximum";
export interface ContextSettings { preset: ContextPreset; limit?: number; maximum?: number; }

export interface CommandInfo {
  name: string;
  /** Native invocation text; Pi defaults to /name. No filesystem paths. */
  invocation?: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
}

/**
 * What the User VM's Pi has loaded for this Session, grouped by source file:
 * extensions (may register slash commands), skills and prompt templates.
 */
export interface ExtensionInfo {
  name: string;
  kind: "extension" | "skill" | "prompt";
  path?: string;
  /** How Pi got it: `configured` (PI Coffee passed --extension), `cli`, `auto` (discovery dirs), `inline` (built into Pi), `package`, or Pi's raw source string. */
  origin: string;
  scope?: string;
  commands: Array<{ name: string; description?: string }>;
}

import type { ContextBreakdown, ContextCategoryId } from "pi-coffee-harness";
export type { ContextBreakdown, ContextCategoryId } from "pi-coffee-harness";

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextBreakdown?: ContextBreakdown;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  /** Account-wide subscription meters (Codex ChatGPT login); absent for API-key or Pi sessions. */
  rateLimits?: RateLimits;
}

/** One rolling usage window of the model account: how much is used and when it resets. */
export interface RateLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  /** ISO time; null when the window is idle and has no reset scheduled. */
  resetsAt: string | null;
}

export interface RateLimits {
  fiveHour?: RateLimitWindow;
  weekly?: RateLimitWindow;
  plan?: string;
}

/**
 * How a prompt joins a busy Session. `prompt` (default) needs an idle Session;
 * `steer` interrupts after the current tool calls; `follow_up` waits for the
 * whole run to finish.
 */
export type PromptMode = "prompt" | "steer" | "follow_up";

export type AckOperation =
  | "prompt"
  | "steer"
  | "follow_up"
  | "abort"
  | "rename_session"
  | "delete_session"
  | "set_model"
  | "set_context"
  | "set_thinking"
  | "compact"
  | "ui_response";

/**
 * The browser's answer to an extension dialog (`extension_ui_request` with
 * method select / confirm / input / editor). Mirrors Pi's RPC response shape:
 * exactly one of value, confirmed or cancelled.
 */
export interface AgentCapabilities {
  models:boolean; images:boolean; stop:boolean; questions:boolean; tools:boolean;
  thinking:boolean; steer:boolean; followUp:boolean; stats:boolean;
  commands:boolean; extensions:boolean; compact:boolean; rename:boolean; cleanup:boolean;
}

export function capabilitiesFor(engine:AgentEngine):AgentCapabilities {
  const pi=engine==="pi";
  return {models:true,images:pi,stop:true,questions:true,tools:true,thinking:pi,steer:pi,followUp:pi,stats:pi,commands:pi,extensions:pi,compact:pi,rename:pi,cleanup:pi};
}

export interface UiResponse {
  id: string;
  value?: string;
  confirmed?: boolean;
  cancelled?: boolean;
}

export type ClientFrame =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "open";
      sessionId?: string;
      after?: number;
      nativeProtocol?: 1;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "list_sessions";
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "prompt";
      requestId: string;
      text: string;
      images?: ImageInput[];
      mode?: PromptMode;
    }
  | {
      /** Rename a conversation. Without sessionId, the open one. */
      v: typeof PROTOCOL_VERSION;
      type: "rename_session";
      requestId?: string;
      sessionId?: string;
      name: string;
    }
  | {
      /** Delete a conversation from the User VM's session store. Allowed before open. */
      v: typeof PROTOCOL_VERSION;
      type: "delete_session";
      requestId?: string;
      sessionId: string;
    }
  | { v: typeof PROTOCOL_VERSION; type: "get_model_catalog"; engine: "pi" | "codex"; requestId?: string }
  | { v: typeof PROTOCOL_VERSION; type: "get_models" }
  | { v: typeof PROTOCOL_VERSION; type: "set_model"; requestId?: string; provider: string; id: string }
  | { v: typeof PROTOCOL_VERSION; type: "set_context"; requestId?: string; preset: ContextPreset }
  | { v: typeof PROTOCOL_VERSION; type: "set_thinking"; requestId?: string; level: string }
  | { v: typeof PROTOCOL_VERSION; type: "get_command_catalog"; engine: "pi" | "codex"; requestId?: string }
  | { v: typeof PROTOCOL_VERSION; type: "get_commands" }
  | { v: typeof PROTOCOL_VERSION; type: "get_extensions" }
  | { v: typeof PROTOCOL_VERSION; type: "get_stats" }
  | { v: typeof PROTOCOL_VERSION; type: "compact"; requestId?: string }
  | ({ v: typeof PROTOCOL_VERSION; type: "ui_response"; requestId?: string } & UiResponse)
  | {
      v: typeof PROTOCOL_VERSION;
      type: "abort";
      requestId?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ping";
      nonce: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "close";
    };

export type ServerFrame =
  | {
      v: typeof PROTOCOL_VERSION;
      type: "opened";
      engine?: AgentEngine;
      capabilities?: AgentCapabilities;
      sessionId: string;
      cursor: number;
      state: SessionState;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "event";
      sessionId: string;
      cursor: number;
      event: JsonValue;
      requestId?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "ack";
      operation: AckOperation;
      requestId?: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "models" | "model_catalog";
      engine?: "pi" | "codex";
      requestId?: string;
      models: ModelChoice[];
      current: { provider: string; id: string; source?: "native" | "relay" } | null;
      context?: ContextSettings;
      thinkingLevel: string;
      thinkingLevels: string[];
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "commands" | "command_catalog";
      engine?: "pi" | "codex";
      requestId?: string;
      commands: CommandInfo[];
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "extensions";
      sessionId: string;
      extensions: ExtensionInfo[];
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "stats";
      sessionId: string;
      stats: SessionStats;
    }
  | {
      /**
       * Where this browser transfers files for the open Session: the Host's
       * LocalSend v2 endpoint on the User VM (ADR-0009). Sent after `opened`.
       * Absent when the Host runs without a transfer server.
       */
      v: typeof PROTOCOL_VERSION;
      type: "transfer";
      sessionId: string;
      url: string;
      scope: string;
      token: string;
      inbox: string;
      maxFileBytes: number;
      maxBatchBytes: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "pong";
      nonce: string;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "error";
      code: string;
      message: string;
      requestId?: string;
      fatal?: boolean;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "resync_required";
      sessionId: string;
      oldestCursor: number;
      newestCursor: number;
    }
  | {
      v: typeof PROTOCOL_VERSION;
      type: "sessions";
      sessions: SessionSummary[];
    }
  | {
      /**
       * Sent right after `opened`. Completed entries from the durable session;
       * live `event` frames that follow cover only the in-flight tail.
       */
      v: typeof PROTOCOL_VERSION;
      type: "history";
      sessionId: string;
      entries: HistoryEntry[];
      leafId: string | null;
      truncated: boolean;
    };

export function encodeFrame(frame: ServerFrame | ClientFrame): string {
  const encoded = JSON.stringify(frame);
  if (encoded === undefined) throw new Error("Frame is not JSON serializable");
  assertFrameSize(encoded);
  return encoded;
}

export function decodeClientFrame(input: string | Uint8Array): ClientFrame {
  const encoded = typeof input === "string" ? input : new TextDecoder().decode(input);
  assertFrameSize(encoded);

  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new ProtocolError("invalid_json", "Frame is not valid JSON");
  }

  if (!isRecord(value)) throw new ProtocolError("invalid_frame", "Frame must be a JSON object");
  if (value.v !== PROTOCOL_VERSION) {
    throw new ProtocolError("unsupported_version", `Unsupported protocol version: ${String(value.v)}`);
  }

  switch (value.type) {
    case "open":
      return parseOpen(value);
    case "list_sessions":
      return { v: PROTOCOL_VERSION, type: "list_sessions" };
    case "get_model_catalog":
      if(value.engine!=="codex" && value.engine!=="pi")throw new ProtocolError("invalid_frame","Model catalog requires Pi or Codex");
      return {v:PROTOCOL_VERSION,type:"get_model_catalog",engine:value.engine,...withRequestId(value)};
    case "get_models":
      return { v: PROTOCOL_VERSION, type: "get_models" };
    case "get_command_catalog":
      if(value.engine!=="pi" && value.engine!=="codex")throw new ProtocolError("invalid_frame","Command catalog requires Pi or Codex");
      return {v:PROTOCOL_VERSION,type:"get_command_catalog",engine:value.engine,...withRequestId(value)};
    case "set_context":
      if(value.preset!=="272k" && value.preset!=="maximum")throw new ProtocolError("invalid_frame","Context preset must be 272k or maximum");
      return {v:PROTOCOL_VERSION,type:"set_context",preset:value.preset,...withRequestId(value)};
    case "get_commands":
      return { v: PROTOCOL_VERSION, type: "get_commands" };
    case "get_extensions":
      return { v: PROTOCOL_VERSION, type: "get_extensions" };
    case "get_stats":
      return { v: PROTOCOL_VERSION, type: "get_stats" };
    case "compact":
      return { v: PROTOCOL_VERSION, type: "compact", ...withRequestId(value) };
    case "rename_session": {
      const sessionId = optionalString(value.sessionId, "sessionId", 256);
      return {
        v: PROTOCOL_VERSION,
        type: "rename_session",
        ...withRequestId(value),
        ...(sessionId === undefined ? {} : { sessionId }),
        name: requiredString(value.name, "name", 200),
      };
    }
    case "delete_session":
      return { v: PROTOCOL_VERSION, type: "delete_session", ...withRequestId(value), sessionId: requiredString(value.sessionId, "sessionId", 256) };
    case "set_model":
      return {
        v: PROTOCOL_VERSION,
        type: "set_model",
        ...withRequestId(value),
        provider: requiredString(value.provider, "provider", 128),
        id: requiredString(value.id, "id", 256),
      };
    case "set_thinking":
      return { v: PROTOCOL_VERSION, type: "set_thinking", ...withRequestId(value), level: requiredString(value.level, "level", 32) };
    case "ui_response": {
      const id = requiredString(value.id, "id", 256);
      const hasValue = value.value !== undefined;
      const hasConfirmed = value.confirmed !== undefined;
      const hasCancelled = value.cancelled !== undefined;
      if ([hasValue, hasConfirmed, hasCancelled].filter(Boolean).length !== 1) {
        throw new ProtocolError("invalid_field", "ui_response needs exactly one of value, confirmed, cancelled");
      }
      if (hasValue && typeof value.value !== "string") throw new ProtocolError("invalid_field", "value must be a string");
      if (hasValue && (value.value as string).length > MAX_PROMPT_CHARS) throw new ProtocolError("invalid_field", "value is too long");
      if (hasConfirmed && typeof value.confirmed !== "boolean") throw new ProtocolError("invalid_field", "confirmed must be a boolean");
      if (hasCancelled && value.cancelled !== true) throw new ProtocolError("invalid_field", "cancelled must be true");
      return {
        v: PROTOCOL_VERSION,
        type: "ui_response",
        ...withRequestId(value),
        id,
        ...(hasValue ? { value: value.value as string } : {}),
        ...(hasConfirmed ? { confirmed: value.confirmed as boolean } : {}),
        ...(hasCancelled ? { cancelled: true } : {}),
      };
    }
    case "prompt":
      return parsePrompt(value);
    case "abort":
      return parseAbort(value);
    case "ping":
      return parsePing(value);
    case "close":
      return { v: PROTOCOL_VERSION, type: "close" };
    default:
      throw new ProtocolError("unknown_type", "Unknown client frame type");
  }
}

export function decodeServerFrame(input: string | Uint8Array): ServerFrame {
  const encoded = typeof input === "string" ? input : new TextDecoder().decode(input);
  assertFrameSize(encoded);
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new ProtocolError("invalid_json", "Frame is not valid JSON");
  }
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION || typeof value.type !== "string") {
    throw new ProtocolError("invalid_frame", "Invalid server frame");
  }
  // The Web Server only needs to validate the common envelope.  Event payloads
  // are intentionally opaque to this module and are validated by Pi adapters.
  return value as unknown as ServerFrame;
}

export class ProtocolError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProtocolError";
    this.code = code;
  }
}

function parseOpen(value: Record<string, unknown>): ClientFrame {
  const sessionId = optionalString(value.sessionId, "sessionId", 256);
  const after = optionalNonNegativeInteger(value.after, "after");
  if(value.nativeProtocol!==undefined && value.nativeProtocol!==1)throw new ProtocolError("unsupported_version","Unsupported native Agent presentation protocol");
  return {
    v: PROTOCOL_VERSION,
    type: "open",
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(after === undefined ? {} : { after }),
    ...(value.nativeProtocol === 1 ? {nativeProtocol:1 as const} : {}),
  };
}

function parsePrompt(value: Record<string, unknown>): ClientFrame {
  const requestId = requiredString(value.requestId, "requestId", MAX_REQUEST_ID_CHARS);
  const text = requiredString(value.text, "text", MAX_PROMPT_CHARS);
  const images = parseImages(value.images);
  const mode = value.mode;
  if (mode !== undefined && mode !== "prompt" && mode !== "steer" && mode !== "follow_up") {
    throw new ProtocolError("invalid_field", "mode must be prompt, steer or follow_up");
  }
  return {
    v: PROTOCOL_VERSION,
    type: "prompt",
    requestId,
    text,
    ...(images === undefined ? {} : { images }),
    ...(mode === undefined || mode === "prompt" ? {} : { mode }),
  };
}

function withRequestId(value: Record<string, unknown>): { requestId?: string } {
  const requestId = optionalString(value.requestId, "requestId", MAX_REQUEST_ID_CHARS);
  return requestId === undefined ? {} : { requestId };
}

function parseAbort(value: Record<string, unknown>): ClientFrame {
  const requestId = optionalString(value.requestId, "requestId", MAX_REQUEST_ID_CHARS);
  return {
    v: PROTOCOL_VERSION,
    type: "abort",
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parsePing(value: Record<string, unknown>): ClientFrame {
  return { v: PROTOCOL_VERSION, type: "ping", nonce: requiredString(value.nonce, "nonce", 256) };
}

function parseImages(value: unknown): ImageInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) {
    throw new ProtocolError("invalid_images", "images must be an array with at most 8 items");
  }
  return value.map((item, index) => {
    if (!isRecord(item) || item.type !== "image") {
      throw new ProtocolError("invalid_images", `images[${index}] must be an image object`);
    }
    const data = requiredString(item.data, `images[${index}].data`, MAX_FRAME_BYTES);
    const mimeType = requiredString(item.mimeType, `images[${index}].mimeType`, 128);
    return { type: "image", data, mimeType };
  });
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProtocolError("invalid_field", `${field} must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new ProtocolError("invalid_field", `${field} is too long`);
  }
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field, maxLength);
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProtocolError("invalid_field", `${field} must be a non-negative integer`);
  }
  return value as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFrameSize(encoded: string): void {
  const bytes = new TextEncoder().encode(encoded).byteLength;
  if (bytes > MAX_FRAME_BYTES) throw new ProtocolError("frame_too_large", "Frame is too large");
}
