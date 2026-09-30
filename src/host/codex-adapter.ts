import { createHash } from "node:crypto";
import type { ContextPreset } from "../shared/protocol.js";
import { codexCommands, codexSkills } from "./codex/skills.js";
import { NativeQuestions } from "./native/questions.js";
import { nativeEnvironment } from "./native/process.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  CommandInfo,
  ExtensionInfo,
  ImageInput,
  JsonValue,
  RateLimits,
  RateLimitWindow,
  SessionState,
  SessionStats,
  UiResponse,
} from "../shared/protocol.js";
import {
  buildHostChildEnv,
  type PiHistory,
  type PiModels,
  type PiSession,
  type PiSessionFactory,
  type PiSessionListing,
} from "./pi-adapter.js";
import { CodexAppServer, type Json, type Obj, type PendingServerRequest } from "./codex/rpc.js";
import { countMessages, projectTurns, toIso, toolCallOf, toolResultOf, toUserInput } from "./codex/translate.js";

export { projectTurns } from "./codex/translate.js";

/** Refresh the account meters at most this often between pushes. */
const RATE_LIMIT_TTL_MS = 60_000;

/**
 * Codex CLI behind the same seam as the original Pi (ADR-0011).
 *
 * `codex app-server` speaks newline-delimited JSON-RPC on stdio. One server
 * process serves one Browser User (one factory = one cwd); each conversation
 * is a Codex *thread*. Everything the Host and browser see is translated into
 * the small Pi event vocabulary the shell already renders — `agent_start`,
 * `message_update` deltas, `tool_execution_start/end`, `message_end`,
 * `agent_settled`, `extension_ui_request` — so nothing above this file knows
 * which agent is running.
 *
 * Login is Codex's own (`codex login` once in the VM, credentials in
 * `CODEX_HOME`); every user's server process shares it.
 */export interface CodexSessionFactoryOptions {
  /** The user's working directory; also the `thread/list` filter. */
  cwd: string;
  /** `codex` executable; `codex` on PATH by default. */
  cliPath?: string;
  commandArgs?: string[];
  onBound?: (sessionId:string,threadId:string)=>Promise<void>;
  /** Shared Codex home (auth, config, session rollouts); Codex's default when omitted. */
  codexHome?: string;
  model?: string;
  reasoningEffort?: string;
  /** Codex sandbox for the agent's own tools; full access mirrors Pi's Execution Seam (ADR-0005). */
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  /** `never` runs unattended; `on-request` / `untrusted` route approvals to the browser as confirm dialogs. */
  approvalPolicy?: "never" | "on-request" | "untrusted";
  /** Extra `codex app-server` arguments (e.g. `-c key=value`). */
  args?: string[];
  env?: Record<string, string>;
  /** Where PI Coffee session ids that predate their Codex thread are remembered (keep it beside the session store, not in the agent's cwd). */
  mappingFile?: string;
  /** Stop the user's app-server after this long with no open session; 0 keeps it for the Host's lifetime. */
  idleTimeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_PAGE_SIZE = 100;
/** Safety stop for a server that keeps handing out cursors (10k threads). */
const MAX_LIST_PAGES = 100;

export class CodexSessionFactory implements PiSessionFactory {
  private readonly options: CodexSessionFactoryOptions;
  private server?: CodexAppServer;
  private readonly mappingFile: string;
  /** PI Coffee session id → Codex thread id, for conversations the Host named before Codex did. */
  private mapping?: Map<string, string>;
  private readonly live = new Set<CodexSession>();
  private idleTimer?: ReturnType<typeof setTimeout>;
  /** Account meters are per login, not per thread: one cache for every session of this user. */
  private rateLimits?: RateLimits;
  private rateLimitsReadAt = 0;
  private rateLimitsUnavailable = false;
  private unsubscribeAccount?: () => void;

  constructor(options: CodexSessionFactoryOptions) {
    this.options = options;
    this.mappingFile = options.mappingFile ?? join(options.cwd, ".pi-coffee", "codex-threads.json");
  }

  /** Whether this user's app-server process is currently up (diagnostics and tests). */
  get serverRunning(): boolean {
    return this.server?.alive === true;
  }

  private async connection(): Promise<CodexAppServer> {
    this.cancelIdleStop();
    if (this.server && this.server.alive) return this.server;
    const args = [...(this.options.commandArgs ?? []), "app-server", ...(this.options.args ?? [])];
    const env: Record<string, string | undefined> = {
      ...nativeEnvironment(this.options.env),
      ...(this.options.codexHome === undefined ? {} : { CODEX_HOME: this.options.codexHome }),
    };
    const server = new CodexAppServer({
      cliPath: this.options.cliPath ?? "codex",
      args,
      cwd: this.options.cwd,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    });
    await server.start(this.options.clientName ?? "pi_coffee", this.options.clientVersion ?? "0.1.0");
    this.server = server;
    this.rateLimits = undefined;
    this.rateLimitsReadAt = 0;
    this.rateLimitsUnavailable = false;
    this.unsubscribeAccount?.();
    this.unsubscribeAccount = server.subscribeGlobal((method, params) => {
      if (method !== "account/rateLimits/updated") return;
      const parsed = parseRateLimits(params.rateLimits);
      if (parsed) { this.rateLimits = parsed; this.rateLimitsReadAt = Date.now(); }
    });
    // The VM admin logs Codex in, not the users: say so loudly when nobody has.
    void server.request("getAuthStatus", {}).then((status) => {
      const method = (status as Obj | null)?.authMethod;
      if (method === null || method === undefined) {
        console.warn(`[codex] ${this.options.cwd}: no Codex login in ${this.options.codexHome ?? "~/.codex"}; run \`codex login\` as the VM owner or set an API key`);
      }
    }).catch(() => undefined);
    return server;
  }

  async modelCatalog(engine:"pi" | "codex"):Promise<PiModels> {
    if(engine!=="codex")throw new Error("This adapter only discovers Codex models");
    // A short-lived native connection lists models only: no thread/start or turn/start.
    const server=new CodexAppServer({cliPath:this.options.cliPath ?? "codex",args:[...(this.options.commandArgs??[]),"app-server",...(this.options.args??[])],cwd:this.options.cwd,
      env:Object.fromEntries(Object.entries({...nativeEnvironment(this.options.env),...(this.options.codexHome?{CODEX_HOME:this.options.codexHome}:{})}).filter((entry):entry is [string,string]=>entry[1]!==undefined))});
    try {
      await server.start("pi_coffee_models","0.1.0");
      const configResult=await server.request("config/read",{includeLayers:false}) as Obj;
      const config=configResult.config as Obj | undefined;
      const model=this.options.model ?? (typeof config?.model==="string" ? config.model : undefined);
      const effort=this.options.reasoningEffort ?? (typeof config?.model_reasoning_effort==="string" ? config.model_reasoning_effort : undefined);
      return {...codexModelChoices(await server.request("model/list",{}) as Obj,model,effort),context:{preset:"272k"}};
    }finally{await server.stop();}
  }

  private commandDiscovery?: Promise<CommandInfo[]>;
  async commandCatalog(engine:"pi" | "codex"):Promise<CommandInfo[]> {
    if(engine!=="codex")throw new Error("This adapter only discovers Codex Skills");
    if(this.commandDiscovery)return this.commandDiscovery;
    this.commandDiscovery=this.discoverCommands().finally(()=>{this.commandDiscovery=undefined;});
    return this.commandDiscovery;
  }
  private async discoverCommands():Promise<CommandInfo[]> {
    const server=new CodexAppServer({cliPath:this.options.cliPath ?? "codex",args:[...(this.options.commandArgs??[]),"app-server",...(this.options.args??[])],cwd:this.options.cwd,
      env:Object.fromEntries(Object.entries({...nativeEnvironment(this.options.env),...(this.options.codexHome?{CODEX_HOME:this.options.codexHome}:{})}).filter((entry):entry is [string,string]=>entry[1]!==undefined))});
    try {
      await server.start("pi_coffee_skills","0.1.0");
      return await codexCommands(server,this.options.cwd);
    }finally{await server.stop();}
  }

  private contextFile(id:string):string{return join(dirname(this.mappingFile),'codex-context',createHash('sha256').update(id).digest('hex')+'.json');}
  private async readContextPreset(id:string):Promise<ContextPreset>{
    try{return JSON.parse(await readFile(this.contextFile(id),'utf8')).preset==='maximum'?'maximum':'272k';}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return '272k';}
  }

  private async loadMapping(): Promise<Map<string, string>> {
    if (this.mapping) return this.mapping;
    try {
      const parsed = JSON.parse(await readFile(this.mappingFile, "utf8")) as Record<string, string>;
      this.mapping = new Map(Object.entries(parsed).filter(([k, v]) => typeof k === "string" && typeof v === "string"));
    } catch {
      this.mapping = new Map();
    }
    return this.mapping;
  }

  private async remember(sessionId: string, threadId: string): Promise<void> {
    const mapping = await this.loadMapping();
    mapping.set(sessionId, threadId);
    await mkdir(dirname(this.mappingFile), { recursive: true });
    await writeFile(this.mappingFile, JSON.stringify(Object.fromEntries(mapping), null, 2));
  }

  /** Every thread recorded under this user's cwd, following `nextCursor` to the end. */
  private async threads(cwd=this.options.cwd): Promise<Obj[]> {
    const server = await this.connection();
    const threads: Obj[] = [];
    let cursor: Json | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await server.request("thread/list", {
        cwd,
        limit: LIST_PAGE_SIZE,
        sortKey: "updated_at",
        sourceKinds: ["appServer", "vscode", "cli", "exec"],
        ...(cursor === undefined ? {} : { cursor }),
      }) as Obj;
      const data = Array.isArray(result.data) ? (result.data as Obj[]) : [];
      threads.push(...data);
      const next = result.nextCursor;
      if (data.length === 0 || next === null || next === undefined || next === cursor) break;
      cursor = next;
    }
    return threads;
  }

  async create(options: { sessionId: string; requireExisting?: boolean }): Promise<PiSession> {
    const server = await this.connection();
    const mapping = await this.loadMapping();
    const known = options.requireExisting ? options.sessionId : mapping.get(options.sessionId) ?? options.sessionId;
    const preset=await this.readContextPreset(known);
    const common = {
      config:contextConfig(preset),
      cwd: this.options.cwd,
      ...(this.options.sandbox === undefined ? {} : { sandbox: this.options.sandbox }),
      approvalPolicy: this.options.approvalPolicy ?? "never",
      ...(this.options.model === undefined ? {} : { model: this.options.model }),
    };
    // Check metadata before resuming: a caller-supplied UUID may name another
    // user's thread in the shared native store. Listing by cwd is not authorization.
    let response: Obj | undefined;
    if (UUID_LIKE.test(known)) {
      const owned = await this.ownsThread(server, known).catch((error) => {
        if (options.requireExisting) throw new Error("Native conversation is unavailable. Its binding and local files were retained; create a new task if the native history was never saved.");
        if (mapping.has(options.sessionId)) throw error;
        return undefined; // A newly generated Host id has no native thread yet.
      });
      if (owned === false) throw new Error("No such conversation");
      if (owned) response = await server.request("thread/resume", { threadId: known, ...common }) as Obj;
    }
    if (!response) {
      if (options.requireExisting) throw new Error("Native conversation is unavailable; no replacement was created");
      response = await server.request("thread/start", { ...common, threadSource: null }) as Obj;
      const thread = response.thread as Obj;
      if (typeof thread.id === "string" && thread.id !== options.sessionId) await this.remember(options.sessionId, thread.id);
    }
    const thread = response.thread as Obj;
    await this.options.onBound?.(options.sessionId,String(thread.id));
    const session = new CodexSession(server, String(thread.id), {
      cwd: this.options.cwd,
      preset,
      sandbox:this.options.sandbox,
      savePreset:async(id,preset)=>{const file=this.contextFile(id);await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify({preset}),{mode:0o600});},
      rebind:async(id)=>{await this.remember(options.sessionId,id);await this.options.onBound?.(options.sessionId,id);},
      model: typeof response.model === "string" ? response.model : this.options.model,
      reasoningEffort: typeof response.reasoningEffort === "string" ? response.reasoningEffort : this.options.reasoningEffort,
      approvalPolicy: this.options.approvalPolicy ?? "never",
      rateLimits: () => this.readRateLimits(),
    });
    session.absorbThread(thread);
    this.live.add(session);
    session.onStop = () => this.release(session);
    return session;
  }

  private release(session: CodexSession): void {
    this.live.delete(session);
    if (this.live.size > 0 || !this.options.idleTimeoutMs) return;
    this.cancelIdleStop();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (this.live.size === 0) void this.close();
    }, this.options.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  private cancelIdleStop(): void {
    if (this.idleTimer === undefined) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  /** Rejects when Codex cannot answer: an empty sidebar must mean "no conversations", not "app-server down". */
  async list(): Promise<PiSessionListing[]> {return this.listForCwd(this.options.cwd);}

  /** Host-owned workspace paths only; never accepts a browser-supplied directory. */
  async listForCwd(cwd:string): Promise<PiSessionListing[]> {
    const threads = await this.threads(cwd);
    const mapping = await this.loadMapping();
    const reverse = new Map<string, string>();
    for (const [sessionId, threadId] of mapping) reverse.set(threadId, sessionId);
    return threads
      .filter((thread) => typeof thread.id === "string" && thread.parentThreadId == null)
      .map((thread) => {
        const id = String(thread.id);
        const preview = typeof thread.preview === "string" ? thread.preview.replace(/\s+/g, " ").trim().slice(0, 120) : "";
        const name = typeof thread.name === "string" && thread.name.length > 0 ? thread.name : undefined;
        // Where the thread came from: ours (appServer) or the VM admin's terminal (cli/exec).
        const source = typeof thread.source === "string" ? thread.source : undefined;
        return {
          id: reverse.get(id) ?? id,
          ...(name === undefined ? {} : { name }),
          ...(source === undefined ? {} : { source }),
          createdAt: toIso(thread.createdAt),
          updatedAt: toIso(thread.updatedAt),
          // thread/list carries no message counts; the sidebar only needs
          // "empty or not", so this is 0 / 1, never a real count.
          messageCount: preview.length > 0 ? 1 : 0,
          preview,
        };
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async delete(sessionId: string): Promise<boolean> {
    const mapping = await this.loadMapping();
    const threadId = mapping.get(sessionId) ?? sessionId;
    try {
      const server = await this.connection();
      if (!(await this.ownsThread(server, threadId))) return false;
      await server.request("thread/delete", { threadId });
    } catch {
      return false;
    }
    if (mapping.delete(sessionId)) await writeFile(this.mappingFile, JSON.stringify(Object.fromEntries(mapping), null, 2)).catch(() => undefined);
    return true;
  }

  private async ownsThread(server: CodexAppServer, threadId: string): Promise<boolean> {
    const result = await server.request("thread/read", { threadId, includeTurns: false }) as Obj;
    const thread = result.thread as Obj | undefined;
    return typeof thread?.cwd === "string" && resolve(thread.cwd) === resolve(this.options.cwd);
  }

  /**
   * The account's rolling usage windows (5h / weekly), cached briefly and
   * refreshed by `account/rateLimits/updated`. Undefined when the login has
   * none (API key) or the server cannot answer.
   */
  async readRateLimits(): Promise<RateLimits | undefined> {
    if (this.rateLimitsUnavailable) return undefined;
    if (this.rateLimits && Date.now() - this.rateLimitsReadAt < RATE_LIMIT_TTL_MS) return this.rateLimits;
    try {
      const server = await this.connection();
      const result = await server.request("account/rateLimits/read", {}) as Obj;
      const parsed = parseRateLimits(result.rateLimits);
      if (parsed) { this.rateLimits = parsed; this.rateLimitsReadAt = Date.now(); }
      return parsed ?? this.rateLimits;
    } catch {
      // API-key logins have no meters; do not ask again for this server process.
      if (!this.rateLimits) this.rateLimitsUnavailable = true;
      return this.rateLimits;
    }
  }

  /** Stop the user's app-server; sessions resume from Codex's rollouts next time. */
  async close(): Promise<void> {
    this.cancelIdleStop();
    this.unsubscribeAccount?.();
    this.unsubscribeAccount = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.stop();
  }
}

function contextConfig(preset:ContextPreset):Obj {
  return preset==='272k'?{model_context_window:272000,model_auto_compact_token_limit:258400}:{};
}
interface CodexSessionSettings {
  preset:ContextPreset;
  sandbox?:string;
  savePreset:(id:string,preset:ContextPreset)=>Promise<void>;
  rebind:(id:string)=>Promise<void>;
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  approvalPolicy: string;
  /** Account meters, owned by the factory (one login per user server). */
  rateLimits?: () => Promise<RateLimits | undefined>;
}

class CodexSession implements PiSession {
  private readonly server: CodexAppServer;
  threadId: string;
  /** Set by the factory so it can count open sessions. */
  onStop?: () => void;
  private readonly listeners = new Set<(event: unknown) => void>();
  private unsubscribe: () => void;
  private settings:CodexSessionSettings;
  private preset:ContextPreset;
  private model?: string;
  private effort?: string;
  private sessionName?: string;
  private activeTurnId?: string;
  private streaming = false;
  private messageCount = 0;
  private tokenUsage?: Obj;
  /** agentMessage items that streamed deltas; the completed item must not be re-emitted as text. */
  private readonly streamedItems = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  /** Command output streamed so far per item, so the browser can show it live. */
  private readonly toolOutput = new Map<string, string>();
  private readonly followUps: Array<{ text: string; images?: ImageInput[] }> = [];
  private readonly questions = new NativeQuestions(event=>this.emit(event as Json));
  private readonly pendingApprovals = new Map<string, PendingServerRequest>();
  private readonly readRateLimits?: () => Promise<RateLimits | undefined>;
  private stopped = false;
  private compactionPending?: {resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;observed:boolean};
  private readonly cwd: string;

  constructor(server: CodexAppServer, threadId: string, settings: CodexSessionSettings) {
    this.settings=settings;this.preset=settings.preset;
    this.server = server;
    this.cwd = settings.cwd;
    this.threadId = threadId;
    this.model = settings.model;
    this.effort = settings.reasoningEffort;
    this.readRateLimits = settings.rateLimits;
    this.unsubscribe = server.subscribe(threadId, {
      notification: (method, params) => this.onNotification(method, params),
      request: (request) => this.onServerRequest(request),
      exit: () => this.onServerExit(),
    });
  }

  /** Seed state from a thread object (resume/start response). */
  absorbThread(thread: Obj): void {
    if (typeof thread.name === "string" && thread.name.length > 0) this.sessionName = thread.name;
    if (typeof thread.model === "string") this.model = thread.model;
    if (typeof thread.reasoningEffort === "string") this.effort = thread.reasoningEffort;
    const turns = Array.isArray(thread.turns) ? (thread.turns as Obj[]) : [];
    this.messageCount = countMessages(turns);
    const status = thread.status as Obj | undefined;
    this.streaming = status?.type === "active";
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Json): void {
    for (const listener of this.listeners) listener(event);
  }

  private turnOverrides(): Obj {
    return {
      ...(this.model === undefined ? {} : { model: this.model }),
      ...(this.effort === undefined ? {} : { effort: this.effort }),
    };
  }

  private async input(text: string, images?: ImageInput[]): Promise<Json[]> {
    const input=toUserInput(text,images);
    const mention=/^\$([a-zA-Z0-9_-]+)(?=\s|$)/.exec(text);
    if(mention){
      const matches=(await codexSkills(this.server,this.cwd)).filter(skill=>skill.name===mention[1]);
      if(matches.length===1)input.push({type:'skill',name:matches[0].name,path:matches[0].path});
    }
    return input;
  }

  async prompt(text: string, images?: ImageInput[]): Promise<void> {
    const result = await this.server.request("turn/start", {
      threadId: this.threadId,
      input: await this.input(text, images),
      ...this.turnOverrides(),
    }) as Obj;
    const turn = result.turn as Obj | undefined;
    if (turn && typeof turn.id === "string") this.activeTurnId = turn.id;
  }

  async steer(text: string, images?: ImageInput[]): Promise<void> {
    if (this.activeTurnId === undefined) return this.prompt(text, images);
    await this.server.request("turn/steer", {
      threadId: this.threadId,
      input: await this.input(text, images),
      expectedTurnId: this.activeTurnId,
    });
    this.emit({ type: "queue_update", steering: [text], followUp: this.followUps.map((item) => item.text) });
  }

  async followUp(text: string, images?: ImageInput[]): Promise<void> {
    if (!this.streaming) return this.prompt(text, images);
    this.followUps.push({ text, ...(images === undefined ? {} : { images }) });
    this.emit({ type: "queue_update", steering: [], followUp: this.followUps.map((item) => item.text) });
  }

  async abort(): Promise<void> {
    this.followUps.length = 0;
    if (this.activeTurnId === undefined) return;
    await this.server.request("turn/interrupt", { threadId: this.threadId, turnId: this.activeTurnId });
  }

  async backgroundState():Promise<{known:boolean;active:number}> {
    const result=await this.server.request("thread/read",{threadId:this.threadId,includeTurns:true}) as Obj;
    const thread=result.thread as Obj;
    let active=this.streaming?1:0,known=(thread.status as Obj)?.type==="idle";
    for(const turn of (Array.isArray(thread.turns)?thread.turns:[]) as Obj[]){
      if(turn.status==="inProgress"){known=false;active++;}
      for(const item of (Array.isArray(turn.items)?turn.items:[]) as Obj[]){
        if(item.type==="commandExecution" && (item.status==="inProgress" || item.processId && item.exitCode==null)){known=false;active++;}
        if(item.type==="collabAgentToolCall")for(const child of Object.values((item.agentsStates??{}) as Obj))if(!["completed","shutdown"].includes(String((child as Obj)?.status))){known=false;active++;}
      }
    }
    return {known,active};
  }

  async getState(): Promise<SessionState> {
    // A turn we did not start (the VM admin's terminal on the same thread)
    // sends us no turn/completed; ask the thread itself whether it is still busy.
    if (this.streaming && this.activeTurnId === undefined) {
      const result = await this.server.request("thread/read", { threadId: this.threadId, includeTurns: false }).catch(() => undefined) as Obj | undefined;
      const status = (result?.thread as Obj | undefined)?.status as Obj | undefined;
      if (status && status.type !== "active") this.streaming = false;
    }
    return {
      isStreaming: this.streaming,
      messageCount: this.messageCount,
      ...(this.sessionName === undefined ? {} : { sessionName: this.sessionName }),
    };
  }

  /**
   * Full history via the paginated `thread/turns/list` (oldest first, items
   * loaded); `thread/read {includeTurns}` still works but is deprecated.
   */
  async getHistory(): Promise<PiHistory> {
    const turns: Obj[] = [];
    let cursor: Json | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await this.server.request("thread/turns/list", {
        threadId: this.threadId,
        limit: LIST_PAGE_SIZE,
        sortDirection: "asc",
        itemsView: "full",
        ...(cursor === undefined ? {} : { cursor }),
      }).catch((error: unknown) => {
        // A freshly started native thread has no persisted history until its
        // first user turn. Only this explicit native response means empty;
        // transport/store errors and later-page failures must still surface.
        const unmaterialized = `thread ${this.threadId} is not materialized yet; thread/turns/list is unavailable before first user message`;
        if (page === 0 && error instanceof Error && error.message === unmaterialized) {
          return { data: [], nextCursor: null };
        }
        throw error;
      }) as Obj;
      const data = Array.isArray(result.data) ? (result.data as Obj[]) : [];
      turns.push(...data);
      const next = result.nextCursor;
      if (data.length === 0 || next === null || next === undefined || next === cursor) break;
      cursor = next;
    }
    this.messageCount = countMessages(turns);
    const entries = projectTurns(turns);
    return { entries, leafId: entries.at(-1)?.id ?? null };
  }

  async rename(name: string): Promise<void> {
    await this.server.request("thread/name/set", { threadId: this.threadId, name });
    this.sessionName = name;
  }

  async getModels(): Promise<PiModels> {
    const result = await this.server.request("model/list", {}) as Obj;
    return {...codexModelChoices(result,this.model,this.effort),context:{preset:this.preset,...(this.preset==='272k'?{limit:272000}:{})}};
  }

  async setModel(_provider: string, id: string): Promise<void> {
    // Applied as an override on the next turn; Codex has no per-thread setter.
    this.model = id;
  }

  async setContextPreset(preset:ContextPreset):Promise<void>{
    if(preset===this.preset)return;
    if((await this.getState()).isStreaming)throw new Error('Wait for the current turn before changing context');
    const history=await this.getHistory(),oldId=this.threadId;
    const common={cwd:this.cwd,model:this.model??null,approvalPolicy:this.settings.approvalPolicy,config:contextConfig(preset),...(this.settings.sandbox?{sandbox:this.settings.sandbox}:{})};
    // Native resume ignores changed config on a subscribed thread. Release only
    // this idle thread; no model turn is replayed and other threads keep running.
    let response:Obj;
    if(history.entries.length){
      await this.server.request('thread/unsubscribe',{threadId:oldId});
      try{response=await this.server.request('thread/resume',{...common,threadId:oldId}) as Obj;}
      catch(error){await this.server.request('thread/resume',{...common,threadId:oldId,config:contextConfig(this.preset)}).catch(()=>undefined);throw error;}
    }else{response=await this.server.request('thread/start',common) as Obj;}
    const thread=response.thread as Obj;
    const id=String(thread.id);
    if(id!==oldId){await this.settings.rebind(id);await this.server.request('thread/unsubscribe',{threadId:oldId});this.unsubscribe();this.threadId=id;
      this.unsubscribe=this.server.subscribe(id,{notification:(method,params)=>this.onNotification(method,params),request:request=>this.onServerRequest(request),exit:()=>this.onServerExit()});}
    await this.settings.savePreset(id,preset);this.preset=preset;this.tokenUsage=undefined;
    this.absorbThread(thread);
  }

  async setThinkingLevel(level: string): Promise<void> {
    this.effort = level;
  }

  async getCommands(): Promise<CommandInfo[]> {
    return codexCommands(this.server,this.cwd);
  }

  async getExtensions(): Promise<ExtensionInfo[]> {
    return [{ name: "codex app-server", kind: "extension", origin: "package", commands: [] }];
  }

  async getStats(): Promise<SessionStats> {
    const total = (this.tokenUsage?.total ?? {}) as Obj;
    const num = (value: Json | undefined) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    const contextWindow = this.tokenUsage?.modelContextWindow;
    const last = (this.tokenUsage?.last ?? {}) as Obj;
    const used = num(last.totalTokens);
    const rateLimits = await this.readRateLimits?.();
    return {
      userMessages: Math.ceil(this.messageCount / 2),
      assistantMessages: Math.floor(this.messageCount / 2),
      toolCalls: 0,
      tokens: {
        input: num(total.inputTokens),
        output: num(total.outputTokens),
        cacheRead: num(total.cachedInputTokens),
        cacheWrite: num(total.cacheWriteInputTokens),
        total: num(total.totalTokens),
      },
      cost: 0,
      ...(typeof contextWindow === "number" && contextWindow > 0
        ? { contextUsage: { tokens: used, contextWindow, percent: Math.round((used / contextWindow) * 1000) / 10 } }
        : {}),
      ...(rateLimits === undefined ? {} : { rateLimits }),
    };
  }

  async compact(): Promise<void> {
    if(this.compactionPending)throw new Error('Codex compaction already running');
    const completion=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>this.finishCompaction(new Error('Codex compaction outcome is still unknown; inspect the native task before retrying')),300000);
      this.compactionPending={resolve,reject,timer,observed:false};
    });
    void completion.catch(()=>undefined);
    try{await this.server.request("thread/compact/start", { threadId: this.threadId });}
    catch(error){this.finishCompaction(error instanceof Error?error:new Error('Compaction request failed'));}
    await completion;
  }

  private finishCompaction(error?:Error):void{
    const pending=this.compactionPending;if(!pending)return;this.compactionPending=undefined;clearTimeout(pending.timer);
    if(error)pending.reject(error);else pending.resolve();
  }

  async respondUi(response: UiResponse): Promise<void> {
    if(this.questions.answer(response))return;
    const pending = this.pendingApprovals.get(response.id);
    if (!pending) return;
    this.pendingApprovals.delete(response.id);
    const approved = response.confirmed === true && response.cancelled !== true;
    this.server.respond(pending.id, { decision: decisionFor(pending.method, approved) });
  }

  async stop(): Promise<void> {
    this.finishCompaction(new Error('Codex stopped before compaction completed'));
    this.questions.clear();
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    // Decline whatever Codex is still waiting on so its turn can end.
    for (const pending of this.pendingApprovals.values()) {
      this.server.respond(pending.id, { decision: decisionFor(pending.method, false) });
    }
    this.pendingApprovals.clear();
    if (this.server.alive) {
      await this.server.request("thread/unsubscribe", { threadId: this.threadId }).catch(() => undefined);
    }
    this.onStop?.();
  }

  // ---- Codex → Pi event translation -----------------------------------

  private onNotification(method: string, params: Obj): void {
    switch (method) {
      case "turn/started": {
        const turn = params.turn as Obj | undefined;
        if (turn && typeof turn.id === "string") this.activeTurnId = turn.id;
        this.streaming = true;
        this.emit({ type: "agent_start" });
        return;
      }
      case "item/agentMessage/delta":
        if (typeof params.itemId === "string") this.streamedItems.add(params.itemId);
        this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: String(params.delta ?? "") } });
        return;
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        this.emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: String(params.delta ?? "") } });
        return;
      case "item/commandExecution/outputDelta": {
        const itemId = typeof params.itemId === "string" ? params.itemId : undefined;
        if (itemId === undefined) return;
        const text = (this.toolOutput.get(itemId) ?? "") + String(params.delta ?? "");
        this.toolOutput.set(itemId, text);
        this.emit({
          type: "tool_execution_update",
          toolCallId: itemId,
          toolName: this.toolNames.get(itemId) ?? "bash",
          partialResult: { content: [{ type: "text", text }] },
        });
        return;
      }
      case "turn/diff/updated":
        // The turn's cumulative unified diff: what this run has changed so far.
        this.emit({ type: "turn_diff", diff: typeof params.diff === "string" ? params.diff : "" });
        return;
      case "item/started":
        this.onItemStarted(params.item as Obj);
        return;
      case "item/completed":
        this.onItemCompleted(params.item as Obj);
        return;
      case "thread/tokenUsage/updated":
        this.tokenUsage = params.tokenUsage as Obj;
        return;
      case "thread/name/updated":
        if (typeof params.threadName === "string") this.sessionName = params.threadName;
        return;
      case "error": {
        const error = params.error as Obj | undefined;
        const message = typeof error?.message === "string" ? error.message : "Codex error";
        if (params.willRetry === true) {
          const match = /(\d+)\s*\/\s*(\d+)/.exec(message);
          this.emit({ type: "auto_retry_start", attempt: match ? Number(match[1]) : 1, maxAttempts: match ? Number(match[2]) : 1 });
        }
        return;
      }
      case "turn/completed": {
        const turn = params.turn as Obj | undefined;
        if(this.compactionPending)this.finishCompaction(turn?.status==='completed'&&this.compactionPending.observed?undefined:new Error('Codex compaction did not complete successfully'));
        if (turn?.status === "failed") {
          const error = turn.error as Obj | null | undefined;
          const message = typeof error?.message === "string" ? error.message : "Codex turn failed";
          const details = typeof error?.additionalDetails === "string" && error.additionalDetails.length > 0 ? ` (${error.additionalDetails})` : "";
          this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: `${message}${details}` } });
        }
        this.activeTurnId = undefined;
        this.streaming = false;
        this.streamedItems.clear();
        this.toolNames.clear();
        this.toolOutput.clear();
        this.emit({ type: "agent_settled" });
        const next = this.followUps.shift();
        if (next) {
          this.emit({ type: "queue_update", steering: [], followUp: this.followUps.map((item) => item.text) });
          void this.prompt(next.text, next.images).catch((error) => {
            this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: error instanceof Error ? error.message : String(error) } });
          });
        }
        return;
      }
      default:
        return;
    }
  }

  private onItemStarted(item: Obj | undefined): void {
    if (!item || typeof item.type !== "string" || typeof item.id !== "string") return;
    const tool = toolCallOf(item);
    if (!tool) return;
    this.toolNames.set(item.id, tool.name);
    this.emit({ type: "tool_execution_start", toolCallId: item.id, toolName: tool.name, args: tool.args });
  }

  private onItemCompleted(item: Obj | undefined): void {
    if (!item || typeof item.type !== "string" || typeof item.id !== "string") return;
    switch (item.type) {
      case "userMessage":
        this.messageCount += 1;
        return;
      case "agentMessage": {
        const text = typeof item.text === "string" ? item.text : "";
        // Older servers (or opted-out deltas) deliver the message only here.
        if (!this.streamedItems.has(item.id) && text.length > 0) {
          this.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
        }
        this.streamedItems.delete(item.id);
        this.messageCount += 1;
        this.emit({ type: "message_end", message: { role: "assistant" } });
        return;
      }
      case "plan": {
        const text = typeof item.text === "string" ? item.text : "";
        if (text.trim().length > 0) this.emit({ type: "message_end", message: { role: "custom", display: true, content: [{ type: "text", text }] } });
        return;
      }
      case "contextCompaction":
        if(this.compactionPending)this.compactionPending.observed=true;
        this.emit({ type: "compaction_end" });
        return;
      default: {
        const tool = toolCallOf(item);
        if (!tool) return;
        if (!this.toolNames.has(item.id)) {
          this.emit({ type: "tool_execution_start", toolCallId: item.id, toolName: tool.name, args: tool.args });
        }
        this.toolNames.delete(item.id);
        this.toolOutput.delete(item.id);
        const outcome = toolResultOf(item);
        this.emit({ type: "tool_execution_end", toolCallId: item.id, toolName: tool.name, result: outcome.result, isError: outcome.isError });
      }
    }
  }

  private onServerRequest(request: PendingServerRequest): boolean {
    const params = request.params;
    let title: string;
    let message: string;
    switch (request.method) {
      case "item/tool/requestUserInput":
        this.questions.ask(Array.isArray(params.questions)?params.questions:[],(answers)=>this.server.respond(request.id,{answers:Object.fromEntries(Object.entries(answers).map(([id,answer])=>[id,{answers:[answer]}]))}));
        return true;
      case "item/commandExecution/requestApproval":
      case "execCommandApproval": {
        const command = typeof params.command === "string" ? params.command : Array.isArray(params.command) ? (params.command as Json[]).map(String).join(" ") : "";
        title = "Codex 请求执行命令";
        message = [command.length > 0 ? `$ ${command}` : "", typeof params.reason === "string" ? params.reason : ""].filter((part) => part.length > 0).join("\n");
        break;
      }
      case "item/fileChange/requestApproval":
      case "applyPatchApproval": {
        title = "Codex 请求修改文件";
        const reason = typeof params.reason === "string" ? params.reason : "";
        const grant = typeof params.grantRoot === "string" ? `写入目录：${params.grantRoot}` : "";
        message = [reason, grant].filter((part) => part.length > 0).join("\n") || "允许 Codex 应用这次修改？";
        break;
      }
      case "item/permissions/requestApproval":
        title = "Codex 请求额外权限";
        message = typeof params.reason === "string" ? params.reason : JSON.stringify(params.permissions ?? params).slice(0, 2000);
        break;
      default:
        return false;
    }
    const id = `codex-${String(request.id)}`;
    this.pendingApprovals.set(id, request);
    this.emit({ type: "extension_ui_request", id, method: "confirm", title, message });
    return true;
  }

  private onServerExit(): void {
    this.finishCompaction(new Error("Codex app-server exited during compaction"));
    this.questions.clear();
    if (this.streaming) {
      this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Codex app-server exited" } });
      this.streaming = false;
      this.activeTurnId = undefined;
      this.emit({ type: "agent_settled" });
    }
  }
}

/**
 * Approval answers differ between the current requestApproval requests
 * and the legacy execCommandApproval / applyPatchApproval ones.
 */
function decisionFor(method: string, approved: boolean): string {
  const legacy = method === "execCommandApproval" || method === "applyPatchApproval";
  if (legacy) return approved ? "approved" : "denied";
  return approved ? "accept" : "decline";
}

/**
 * `account/rateLimits/read` shape → protocol shape. Windows are classified by
 * length (300 min ≈ 5h, 10080 = weekly), not by the primary/secondary slot
 * names, which Codex does not guarantee.
 */
export function parseRateLimits(raw: Json | undefined): RateLimits | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Obj;
  const windows = [obj.primary, obj.secondary]
    .map(parseWindow)
    .filter((window): window is RateLimitWindow => window !== undefined);
  if (windows.length === 0) return undefined;
  const fiveHour = windows.find((window) => window.windowMinutes <= 24 * 60);
  const weekly = windows.find((window) => window.windowMinutes > 24 * 60);
  return {
    ...(fiveHour === undefined ? {} : { fiveHour }),
    ...(weekly === undefined ? {} : { weekly }),
    ...(typeof obj.planType === "string" ? { plan: obj.planType } : {}),
  };
}

function parseWindow(raw: Json | undefined): RateLimitWindow | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Obj;
  if (typeof obj.usedPercent !== "number" || typeof obj.windowDurationMins !== "number") return undefined;
  return {
    usedPercent: obj.usedPercent,
    windowMinutes: obj.windowDurationMins,
    resetsAt: typeof obj.resetsAt === "number" ? new Date(obj.resetsAt * 1000).toISOString() : null,
  };
}

function codexModelChoices(result:Obj,configuredModel?:string,configuredEffort?:string):PiModels {
    const data = Array.isArray(result.data) ? (result.data as Obj[]) : [];
    // The configured model wins even when the catalog does not list it (custom provider);
    // only an unconfigured session falls back to Codex's default.
    const current = configuredModel === undefined
      ? data.find((model) => model.isDefault === true)
      : data.find((model) => model.model === configuredModel || model.id === configuredModel);
    const efforts = (model: Obj | undefined) => Array.isArray(model?.supportedReasoningEfforts)
      ? (model!.supportedReasoningEfforts as Obj[]).map((option) => String(option.reasoningEffort))
      : [];
    const currentId = typeof current?.model === "string" ? current.model : configuredModel;
    const levels = efforts(current);
    const level = configuredEffort ?? (typeof current?.defaultReasoningEffort === "string" ? current.defaultReasoningEffort : levels[0] ?? "medium");
    const choices = data.filter((model) => model.hidden !== true).map((model) => ({
      provider: "codex",
      id: String(model.model ?? model.id),
      ...(efforts(model).length > 0 ? { reasoning: true } : {}),
    }));
    // A custom model_provider (config.toml) can name models the built-in
    // catalog does not know; the configured one must still be selectable.
    if (currentId !== undefined && !choices.some((choice) => choice.id === currentId)) choices.unshift({ provider: "codex", id: currentId });
    return {
      models: choices,
      current: currentId === undefined ? null : { provider: "codex", id: currentId },
      thinkingLevel: level,
      thinkingLevels: levels,
    };
}
