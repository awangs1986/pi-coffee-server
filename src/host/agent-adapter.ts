import type {
  AgentEngine,
  CommandInfo,
  ExtensionInfo,
  HistoryEntry,
  ImageInput,
  JsonValue,
  ModelChoice,
  SessionState,
  SessionStats,
  SessionSummary,
  UiResponse,
} from "../shared/protocol.js";

export interface EngineAvailability {
  id: "pi" | "codex" | "claude" | "cursor" | "grok";
  name: string;
  available: boolean;
  reason?: string;
  version?: string;
  modelCatalog?: boolean;
  authentication?: "configured" | "required" | "unknown";
}

export const PI_ONLY_ENGINES: EngineAvailability[] = [
  { id: "pi", name: "Pi", available: true },
  { id: "codex", name: "Codex", available: false, reason: "Not configured on this Host" },
  { id: "claude", name: "Claude Code", available: false, reason: "Not configured on this Host" },
  { id: "cursor", name: "Cursor", available: false, reason: "Not configured on this Host" },
  { id: "grok", name: "Grok Build", available: false, reason: "Not configured on this Host" },
];

export interface AgentHistory {
  entries: HistoryEntry[];
  leafId: string | null;
}

/** A read-only native-source audit. Unknown history must never replace a good index. */
export interface AgentHistoryRead {
  history: AgentHistory;
  binding: string;
  sourceGeneration: string;
  sourceFreshness: "current" | "unknown";
  checkedAt: string;
}

/** A conversation known to the durable session store; `running` is added by the Host. */
export type AgentSessionListing = Omit<SessionSummary, "running">;

/**
 * The engine-neutral seam consumed by the Host. Engine protocols and native
 * history stay inside the selected Adapter.
 */
export interface AgentModels {
  context?: import("../shared/protocol.js").ContextSettings;
  models: ModelChoice[];
  current: { provider: string; id: string; source?: "native" | "relay" } | null;
  thinkingLevel: string;
  thinkingLevels: string[];
}

export interface AgentSession {
  /** Reads already observed live evidence without starting or querying a native runtime. */
  readRunEvidence?(runId?:string):AgentRunEvidence|Promise<AgentRunEvidence>;
  backgroundState?(): Promise<{known:boolean;active:number}>;
  prompt(text: string, images?: ImageInput[], correlation?:{runId:string}): Promise<void>;
  /** Interrupt a running turn after its current tool calls. */
  steer(text: string, images?: ImageInput[]): Promise<void>;
  /** Queue a message for after the current run finishes. */
  validateFollowUp?(text:string):Promise<void>;
  followUp(text: string, images?: ImageInput[]): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<SessionState>;
  /** Completed conversation entries from the durable session, display-ready. */
  getHistory(): Promise<AgentHistory>;
  rename(name: string): Promise<void>;
  getModels(): Promise<AgentModels>;
  setModel(provider: string, id: string): Promise<void>;
  setThinkingLevel(level: string): Promise<void>;
  setContextPreset?(preset: import("../shared/protocol.js").ContextPreset): Promise<void>;
  getCommands(): Promise<CommandInfo[]>;
  /** Extensions exposed by the selected engine (Pi only in this release). */
  getExtensions(): Promise<ExtensionInfo[]>;
  getStats(): Promise<SessionStats>;
  compact(): Promise<void>;
  /** Answer a blocking extension dialog (select / confirm / input / editor). */
  respondUi(response: UiResponse): Promise<void>;
  onEvent(listener: (event: unknown) => void): () => void;
  stop(): Promise<void>;
}

export interface AgentRunEvidence {
 capabilities?:{online:'supported'|'unavailable';restartRecovery:'supported'|'unknown';passiveHistory:'supported'|'unknown';detachedWriters:'supported'|'unknown'};
 identity?:'native-run'|'host-invocation';referenceKind?:'native-message'|'host-live-receipt';
 supported:boolean;freshness:'current'|'unknown';runId?:string;binding?:string;watermark?:string;
 state:'running'|'reply-available'|'incomplete'|'uncertain';
 entries?:{id:string;revision:string;text:string;truncated?:boolean}[];reason?:string;
}

export interface AgentSessionFactory {
  mishuSourceCapabilities?(id:string):Promise<import("./mishu-source.js").MishuSourceCapabilities>;
  contextResetEngines?():AgentEngine[];
  /** True only when prompt correlation is persisted and passively recoverable. */
  supportsDispatchCorrelation?(sessionId:string):Promise<boolean>;
 /** Passive exact native run audit; never starts a runtime or replays work. */
 readRunEvidence?(sessionId:string,runId?:string):Promise<AgentRunEvidence>;
  forkModes?(engine:"pi"|"codex"|"claude"|"cursor"|"grok"):import('./fork.js').ForkMode[];
  forkConversation?(sourceId:string,targetId:string,mode:import('./fork.js').ForkMode,history:AgentHistory):Promise<void>;
  resetNative?(sourceNativeId:string,options:{sessionId:string;cwd:string;workspaceSessionId:string}):Promise<AgentSession>;
  prepareContextReset?(id:string,operation:{id:string;expectedNativeId:string;title:string},settings:AgentModels):Promise<{session:AgentSession;commit():Promise<void>;rollback():Promise<void>}>;
  forkNative?(sourceNativeId:string,options:{sessionId:string;cwd:string;sourceCwd:string}):Promise<AgentSession>;
  /** Called after verified-idle sessions are released, before re-opening with changed credentials. */
  resetTaskRuntime?(id:string):Promise<void>;
  /** Read durable native history without starting/resuming a runtime or changing native state. */
  readHistory?(sessionId: string): Promise<AgentHistoryRead>;
  prepareTakeover?(id:string, operation:import("./takeover.js").TakeoverState, history:AgentHistory):Promise<{session:AgentSession;commit():Promise<void>;rollback():Promise<void>}>;
  /** Begin shutdown by cancelling takeover preparation; source sessions remain recoverable until closed. */
  cancelTakeovers?(): Promise<void>;
  close?(): Promise<void>;
  capabilities?(id:string):Promise<import("../shared/protocol.js").AgentCapabilities>;
  engines?(): Promise<EngineAvailability[]>;
  /** Read native choices without creating a conversation or running a turn. */
  commandCatalog?(engine: import("../shared/protocol.js").AgentEngine): Promise<CommandInfo[]>;
  modelCatalog?(engine: import("../shared/protocol.js").AgentEngine): Promise<AgentModels>;
  /** Start (or resume, when the store already has it) the session with this id. */
  create(options: { sessionId: string; workspaceSessionId?: string; requireExisting?: boolean }): Promise<AgentSession>;
  /** Conversations in the durable store, newest first. */
  list(): Promise<AgentSessionListing[]>;
  /** Remove a conversation from the durable store. Resolves false when unknown. */
  delete(sessionId: string): Promise<boolean>;
}
