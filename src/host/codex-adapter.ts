import {fileURLToPath} from "node:url";
import type {MishuSourceContext} from "./mishu-source.js";
import {LiveRunEvidence} from './native/live-run-evidence.js';
import { createHash, randomUUID } from "node:crypto";
import type { ContextPreset } from "../shared/protocol.js";
import { codexCommands, codexSkills } from "./codex/skills.js";
import { NativeQuestions } from "./native/questions.js";
import { nativeEnvironment } from "./native/process.js";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
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
import { readCodexHistory } from "./codex/history.js";
import { unknownHistory } from "./native/history-source.js";
import type { AgentHistoryRead } from "./agent-adapter.js";

export { projectTurns } from "./codex/translate.js";

/** Refresh the account meters at most this often between pushes. */
const RATE_LIMIT_TTL_MS = 60_000;
export const CODEX_QUESTION_INSTRUCTION = 'In this Web client, ask choices with request_user_input and wait for the user response before continuing. It is available in Default mode. Do not use request_user_input_async; user input is never implied by a default choice, a timeout, or an accepted notification.';

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
  instructions?:()=>Promise<string|undefined>;
  /** Host-proven empty Chat only; revoked durably before any prompt admission. */
  allowEmptyRecovery?:()=>Promise<boolean>;
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
  /** Automatic Fork preparation only; never carries over to normal task execution. */
  preparation?:boolean;
  /** `never` runs unattended; `on-request` / `untrusted` route approvals to the browser as confirm dialogs. */
  approvalPolicy?: "never" | "on-request" | "untrusted";
  /** Extra `codex app-server` arguments (e.g. `-c key=value`). */
  args?: string[];
  env?: Record<string, string>;
  envForSession?:()=>Promise<Record<string,string>>;
  mishuContext?:()=>Promise<MishuSourceContext|undefined>;
  /** Where PI Coffee session ids that predate their Codex thread are remembered (keep it beside the session store, not in the agent's cwd). */
  mappingFile?: string;
  /** Stop the user's app-server after this long with no open session; 0 keeps it for the Host's lifetime. */
  idleTimeoutMs?: number;
  metadataTimeoutMs?: number;
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
  private connecting?: Promise<CodexAppServer>;
  private listingReads = 0;
  private readonly failedListingsUntil=new Map<string,number>();
  private recycleMetadata=false;
  private creating = 0;
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
    this.options = options.preparation?{...options,sandbox:'read-only',approvalPolicy:'never'}:options;
    this.mappingFile = options.mappingFile ?? join(options.cwd, ".pi-coffee", "codex-threads.json");
  }

  /** Whether this user's app-server process is currently up (diagnostics and tests). */
  async mishuSourceCapabilities(){return {coordination:this.options.mishuContext&&!this.options.preparation?'supported' as const:'unavailable' as const,reports:'unavailable' as const,reportOutputRecovery:'unavailable' as const,reason:'Codex 全工具禁用和原生汇报输出恢复尚未验证；可人工联系和查询，自动提醒不可用'};}

  get serverRunning(): boolean {
    return this.server?.alive === true;
  }

  async readHistory(sessionId: string): Promise<AgentHistoryRead> {
    // Re-read the durable mapping: another Host or an external binding update
    // must not be hidden behind the execution factory's in-memory cache.
    let nativeId = sessionId;
    try {
      const mapping = JSON.parse(await readFile(this.mappingFile, "utf8"));
      if (typeof mapping?.[sessionId] === "string") nativeId = mapping[sessionId];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return unknownHistory(`codex:${sessionId}`);
    }
    return readCodexHistory(this.options, nativeId);
  }

  private async connection(): Promise<CodexAppServer> {
    this.cancelIdleStop();
    if (this.server && this.server.alive) return this.server;
    if (this.connecting) return this.connecting;
    this.connecting = this.startConnection();
    try { return await this.connecting; }
    finally { this.connecting = undefined; }
  }

  private async startConnection(): Promise<CodexAppServer> {
    const args = [...(this.options.commandArgs ?? []), "app-server", ...(this.options.args ?? []),...(this.options.preparation?Object.entries(forkPreparationConfig()).flatMap(([key,value])=>['-c',key+'='+JSON.stringify(value)]):[])];
    const env: Record<string, string | undefined> = {
      ...nativeEnvironment({...this.options.env,...await this.options.envForSession?.()}),
      ...(this.options.codexHome === undefined ? {} : { CODEX_HOME: this.options.codexHome }),
    };
    const server = new CodexAppServer({
      cliPath: this.options.cliPath ?? "codex",
      args,
      cwd: this.options.cwd,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
    });
    try { await server.start(this.options.clientName ?? "pi_coffee", this.options.clientVersion ?? "0.1.0"); }
    catch (error) { await server.stop(); throw error; }
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
      const configResult=await server.request("config/read",{includeLayers:false},10000) as Obj;
      const config=configResult.config as Obj | undefined;
      const model=this.options.model ?? (typeof config?.model==="string" ? config.model : undefined);
      const effort=this.options.reasoningEffort ?? (typeof config?.model_reasoning_effort==="string" ? config.model_reasoning_effort : undefined);
      return {...codexModelChoices(await server.request("model/list",{},10000) as Obj,model,effort),context:{preset:"272k"}};
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
  private async readPreferences(id:string):Promise<CodexPreferences>{
    try{
      const saved=JSON.parse(await readFile(this.contextFile(id),'utf8'));
      return {preset:saved.preset==='maximum'?'maximum':'272k',
        ...(typeof saved.emptyContext==='boolean'?{emptyContext:saved.emptyContext}:{}),
        ...(saved.mishuRole===true?{mishuRole:true}:{}),
        ...(typeof saved.model==='string' && saved.model?{model:saved.model}:{}),
        ...(typeof saved.reasoningEffort==='string' && saved.reasoningEffort?{reasoningEffort:saved.reasoningEffort}:{})};
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return {preset:'272k'};}
  }
  private async savePreferences(id:string,preferences:CodexPreferences):Promise<void>{
    const file=this.contextFile(id),temp=file+'.'+randomUUID()+'.tmp';
    await mkdir(dirname(file),{recursive:true,mode:0o700});
    try{await writeFile(temp,JSON.stringify(preferences),{mode:0o600});await rename(temp,file);}
    finally{await rm(temp,{force:true});}
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
        // Sidebar metadata must not scan/repair every rollout on each refresh.
        useStateDbOnly: true,
        limit: LIST_PAGE_SIZE,
        sortKey: "updated_at",
        sourceKinds: ["appServer", "vscode", "cli", "exec"],
        ...(cursor === undefined ? {} : { cursor }),
      },this.options.metadataTimeoutMs??10000) as Obj;
      const data = Array.isArray(result.data) ? (result.data as Obj[]) : [];
      threads.push(...data);
      const next = result.nextCursor;
      if (data.length === 0 || next === null || next === undefined || next === cursor) break;
      cursor = next;
    }
    return threads;
  }

  async create(options: { sessionId: string; requireExisting?: boolean }): Promise<PiSession> {
    this.creating++;
    try {return await this.createSession(options);}
    finally {this.creating--;this.scheduleIdleStop();}
  }

  async forkNative(sourceNativeId:string,options:{sessionId:string;cwd:string;sourceCwd:string}):Promise<PiSession>{
    if(resolve(options.cwd)!==resolve(this.options.cwd))throw new Error('Fork destination does not match its native runtime');
    const server=await this.connection();const mapping=await this.loadMapping();
    if(mapping.has(options.sessionId))throw new Error('Native Fork destination already exists');
    const source=await server.request('thread/read',{threadId:sourceNativeId,includeTurns:false}) as Obj;
    const sourceThread=source.thread as Obj;
    if(typeof sourceThread?.cwd!=='string'||resolve(sourceThread.cwd)!==resolve(options.sourceCwd))throw new Error('Native Fork source does not belong to this task');
    const response=await server.request('thread/fork',{threadId:sourceNativeId,cwd:options.cwd,excludeTurns:true,...(this.options.preparation?{config:await this.preparationConfig(server)}:{}),approvalPolicy:this.options.approvalPolicy??'never',...(this.options.sandbox?{sandbox:this.options.sandbox}:{})}) as Obj;
    const thread=response.thread as Obj;if(typeof thread?.id!=='string'||thread.id===sourceNativeId||typeof thread.cwd!=='string'||resolve(thread.cwd)!==resolve(options.cwd))throw new Error('Native Fork result did not confirm a new task identity');
    await this.remember(options.sessionId,thread.id);await this.options.onBound?.(options.sessionId,thread.id);
    return this.create({sessionId:options.sessionId});
  }

  private async preparationConfig(server:CodexAppServer):Promise<Obj>{
    if(!this.options.preparation)return {};
    // Empty TOML tables merge with user/project config; disable each effective
    // MCP provider explicitly before thread creation, fork or resume.
    const result=await server.request('config/read',{includeLayers:false,cwd:this.options.cwd}) as Obj;
    const configured=(result.config as Obj)?.mcp_servers;
    return {...forkPreparationConfig(),mcp_servers:Object.fromEntries(Object.keys(configured&&typeof configured==='object'?configured:{}).map(name=>[name,{enabled:false}]))};
  }

  private async createSession(options: { sessionId: string; requireExisting?: boolean }): Promise<PiSession> {
    const server = await this.connection();
    const mapping = await this.loadMapping();
    const known = options.requireExisting ? options.sessionId : mapping.get(options.sessionId) ?? options.sessionId;
    const preferences=await this.readPreferences(known),{preset}=preferences;
    // Keep the user's native guidance; override on resume as well to retire a removed runner pointer.
    let developerInstructions:string|undefined;
    {
      const configResult=await server.request('config/read',{includeLayers:false,cwd:this.options.cwd}) as Obj;
      const configured=(configResult.config as Obj)?.developer_instructions;
      developerInstructions=[typeof configured==='string'?configured.replaceAll(CODEX_QUESTION_INSTRUCTION,'').trim():undefined,await this.options.instructions?.(),CODEX_QUESTION_INSTRUCTION].filter(Boolean).join('\n');
    }
    const preparationConfig=await this.preparationConfig(server);
    const common = {
      ...(developerInstructions===undefined?{}:{developerInstructions}),
      config:{...nativeThreadConfig(preset),...preparationConfig},
      cwd: this.options.cwd,
      ...(this.options.sandbox === undefined ? {} : { sandbox: this.options.sandbox }),
      approvalPolicy: this.options.approvalPolicy ?? "never",
    };
    // Check metadata before resuming: a caller-supplied UUID may name another
    // user's thread in the shared native store. Listing by cwd is not authorization.
    let response: Obj | undefined,recoveringEmpty=false;
    const missingEmpty=async(error:unknown)=>{
      if(!options.requireExisting&&!mapping.has(options.sessionId))return false;
      const message=error instanceof Error?error.message:'';
      if(!/^(?:thread not loaded:|no rollout found for thread id|no such thread\b)/i.test(message)&&message!==`invalid paginated history lineage for ${known}: missing source rollout`)return false;
      return await this.options.allowEmptyRecovery?.()===true;
    };
    if (UUID_LIKE.test(known)) {
      const owned = await this.ownsThread(server, known).catch(async(error) => {
        if(await missingEmpty(error)){recoveringEmpty=true;return undefined;}
        if (options.requireExisting) throw new Error("Native conversation is unavailable. Its binding and local files were retained; create a new task if the native history was never saved.");
        if (mapping.has(options.sessionId)) throw error;
        return undefined; // A newly generated Host id has no native thread yet.
      });
      if (owned === false) throw new Error("No such conversation");
      // Deployment defaults only seed new threads. A resumed thread keeps its
      // native selection, unless a confirmed browser choice is pending for it.
      const originalBase=owned&&preferences.mishuRole&&this.options.mishuContext?await originalCodexBase(server,known,this.options.cwd):undefined;
      if (owned) response = await server.request("thread/resume", { threadId: known, ...common,
        ...(originalBase===undefined?{}:{baseInstructions:originalBase}),
        ...(preferences.model?{model:preferences.model}:{}),
        config:{...common.config,...(preferences.reasoningEffort?{model_reasoning_effort:preferences.reasoningEffort}:{})},
      }).catch(async error=>{if(await missingEmpty(error)){recoveringEmpty=true;return undefined;}throw error;}) as Obj|undefined;
    }
    const resumed=Boolean(response);
    if (!response) {
      if (options.requireExisting&&!recoveringEmpty) throw new Error("Native conversation is unavailable; no replacement was created");
      const initialModel=recoveringEmpty?preferences.model??this.options.model:this.options.model;
      const initialEffort=recoveringEmpty?preferences.reasoningEffort??this.options.reasoningEffort:this.options.reasoningEffort;
      response = await server.request("thread/start", { ...common, threadSource: null,
        ...(initialModel?{model:initialModel}:{}),
        config:{...common.config,...(initialEffort?{model_reasoning_effort:initialEffort}:{})},
      }) as Obj;
      const thread = response.thread as Obj;
      if (typeof thread.id === "string" && thread.id !== options.sessionId) await this.remember(options.sessionId, thread.id);
      await this.savePreferences(String(thread.id),{...preferences,emptyContext:true,
        ...(typeof response.model==='string'?{model:response.model}:initialModel?{model:initialModel}:{}),
        ...(typeof response.reasoningEffort==='string'?{reasoningEffort:response.reasoningEffort}:initialEffort?{reasoningEffort:initialEffort}:{}),
      });
    }
    const thread = response.thread as Obj;
    await this.options.onBound?.(options.sessionId,String(thread.id));
    const session = new CodexSession(server, String(thread.id), {
      freshEmpty:!resumed||preferences.emptyContext===true&&(!this.options.allowEmptyRecovery||await this.options.allowEmptyRecovery()),
      cwd: this.options.cwd,
      preset,
      developerInstructions,
      sandbox:this.options.sandbox,
      preparation:this.options.preparation,
      preparationConfig,
      mishuContext:this.options.preparation?undefined:this.options.mishuContext,
      savePreferences:(id,values)=>this.savePreferences(id,values),
      rebind:async(id)=>{await this.remember(options.sessionId,id);await this.options.onBound?.(options.sessionId,id);},
      model: typeof response.model === "string" ? response.model : resumed?preferences.model:this.options.model,
      reasoningEffort: typeof response.reasoningEffort === "string" ? response.reasoningEffort : resumed?preferences.reasoningEffort:this.options.reasoningEffort,
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
    this.scheduleIdleStop();
  }

  private scheduleIdleStop(): void {
    if (this.live.size > 0 || this.creating > 0 || this.listingReads > 0 || !this.options.idleTimeoutMs) return;
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
    if((this.failedListingsUntil.get(cwd)??0)>Date.now())throw new Error('Codex metadata request recently timed out; discovery is cooling down');
    this.listingReads++;
    try { return await this.readListings(cwd); }
    catch(error){
      if(error instanceof Error && error.message.startsWith('Codex metadata request timed out:')){
        this.failedListingsUntil.set(cwd,Date.now()+60000);this.recycleMetadata=true;
      }
      throw error;
    }finally{await this.finishMetadataRead();}
  }

  private async finishMetadataRead():Promise<void>{
    this.listingReads--;
    if(this.recycleMetadata && this.listingReads===0 && this.creating===0 && this.live.size===0){this.recycleMetadata=false;await this.close();}
    else this.scheduleIdleStop();
  }

  /** Direct bound-thread metadata avoids a whole store scan for each task directory. */
  async summaryForCwd(cwd:string,id:string):Promise<PiSessionListing|undefined>{
    this.listingReads++;
    try{
      const server=await this.connection();
      const result=await server.request('thread/read',{threadId:id,includeTurns:false},this.options.metadataTimeoutMs??10000) as Obj;
      const thread=result.thread as Obj|undefined;
      if(!thread || typeof thread.cwd!=='string' || resolve(thread.cwd)!==resolve(cwd))return undefined;
      const preview=typeof thread.preview==='string'?thread.preview.replace(/\s+/g,' ').trim().slice(0,120):'';
      return {id,createdAt:toIso(thread.createdAt),updatedAt:toIso(thread.updatedAt),preview,messageCount:preview?1:0,
        ...(typeof thread.name==='string'?{name:thread.name}:{}),...(typeof thread.source==='string'?{source:thread.source}:{})};
    }finally{await this.finishMetadataRead();}
  }

  private async readListings(cwd:string): Promise<PiSessionListing[]> {
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
      const result = await server.request("account/rateLimits/read", {},10000) as Obj;
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
    if(this.connecting)await this.connecting.catch(() => undefined);
    this.cancelIdleStop();
    this.unsubscribeAccount?.();
    this.unsubscribeAccount = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.stop();
  }
}

// Native restrictions apply before the model sees inherited history. Native
// read-only/no-network remains a backstop even if a future tool is introduced.
async function originalCodexBase(server:CodexAppServer,id:string,cwd:string):Promise<string> {
 const metadata=await server.request('thread/read',{threadId:id,includeTurns:false},10000) as Obj,thread=metadata.thread as Obj;
 if(thread?.id!==id||typeof thread.cwd!=='string'||resolve(thread.cwd)!==resolve(cwd)||typeof thread.path!=='string')throw Error('Native secretary original instructions unavailable; no replacement or role imitation');
 const file=await open(thread.path,'r');
 try {
  const bytes=Buffer.alloc(256*1024),read=await file.read(bytes,0,bytes.length,0),end=bytes.subarray(0,read.bytesRead).indexOf(10);
  if(end<0)throw Error('Native secretary instruction metadata unavailable or exceeds bound');
  const meta=JSON.parse(bytes.subarray(0,end).toString('utf8'));
  if(meta.type!=='session_meta'||meta.payload?.id!==id||resolve(meta.payload?.cwd??'')!==resolve(cwd)||typeof meta.payload?.base_instructions?.text!=='string')throw Error('Native secretary original instruction identity mismatch');
  // This marker is owned by this Adapter. The immutable first native metadata
  // normally has only the original baseline; never accumulate application roles.
  return meta.payload.base_instructions.text.split('\n\n<pi_coffee_mishu_role>\n')[0];
 }finally{await file.close();}
}

function forkPreparationConfig():Obj {
 return {web_search:'disabled',...Object.fromEntries([
  'shell_tool','unified_exec','apply_patch_freeform','js_repl','multi_agent','collab',
  'apps','connectors','plugins','hooks','codex_hooks','plugin_hooks','computer_use',
  'browser_use','remote_control','image_generation','request_permissions_tool',
 ].map(name=>['features.'+name,false]))};
}
function nativeThreadConfig(preset:ContextPreset):Obj {
  const limit=preset==='272k'?272000:500000;
  return {model_context_window:limit,model_auto_compact_token_limit:Math.floor(limit*0.95),'features.default_mode_request_user_input':true};
}
interface CodexPreferences {
  mishuRole?:boolean;
  emptyContext?:boolean;
  preset:ContextPreset;
  model?:string;
  reasoningEffort?:string;
}
interface CodexSessionSettings {
  freshEmpty?:boolean;
  developerInstructions?:string;
  mishuContext?:()=>Promise<MishuSourceContext|undefined>;
  mishuRoleApplied?:boolean;
  preset:ContextPreset;
  sandbox?:string;
  preparation?:boolean;
  preparationConfig:Obj;
  savePreferences:(id:string,preferences:CodexPreferences)=>Promise<void>;
  rebind:(id:string)=>Promise<void>;
  cwd: string;
  model?: string;
  reasoningEffort?: string;
  approvalPolicy: string;
  /** Account meters, owned by the factory (one login per user server). */
  rateLimits?: () => Promise<RateLimits | undefined>;
}

class CodexSession implements PiSession {
  private readonly tracking=new LiveRunEvidence('codex',()=>this.threadId);
  readRunEvidence(runId?:string){return this.tracking.read(runId);}
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
  private preferenceWrites:Promise<void>=Promise.resolve();
  private asyncQuestion?:{questions:Obj[];ready:Promise<void>;resolve:()=>void;reject:(error:Error)=>void;paused:boolean;resuming:boolean};
  private readonly asyncQuestionItems=new Set<string>();
  private sessionName?: string;
  private activeTurnId?: string;
  private streaming = false;
  private messageCount = 0;
  private nativeInputSeen=false;
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

  private async refreshMishuContext():Promise<Obj> {
    if(!this.settings.mishuContext)return {};
    const context=await this.settings.mishuContext();
    if(!context){this.settings.mishuRoleApplied=false;return {};}
    const original=await originalCodexBase(this.server,this.threadId,this.cwd);
    const baseInstructions=original+'\n\n<pi_coffee_mishu_role>\n'+context.instructions+'\n</pi_coffee_mishu_role>';
    const background=await this.backgroundState();
    if(!background.known||background.active)throw Error('MISHU context refresh requires an idle native thread');
    const config:Obj={...nativeThreadConfig(this.preset),...this.settings.preparationConfig,
      ...(this.effort?{model_reasoning_effort:this.effort}:{}),
      mcp_servers:{coffee_mishu:context.endpoint&&context.token?{command:process.execPath,args:[fileURLToPath(new URL('./mishu-mcp.mjs',import.meta.url))],env:{PI_COFFEE_MISHU_URL:context.endpoint,PI_COFFEE_MISHU_TOKEN:context.token,PI_COFFEE_MISHU_CONTEXT:context.instructions},enabled:true,default_tools_approval_mode:'approve'}:{command:process.execPath,args:[fileURLToPath(new URL('./mishu-mcp.mjs',import.meta.url))],enabled:false}}};
    // Resume ignores overrides while a thread remains subscribed. Unload only
    // this idle thread, preserve its binding and native model, then refresh.
    this.settings.mishuRoleApplied=true;await this.updatePreferences({});
    await this.server.request('thread/unsubscribe',{threadId:this.threadId});
    const result=await this.server.request('thread/resume',{threadId:this.threadId,cwd:this.cwd,
      ...(this.settings.developerInstructions===undefined?{}:{developerInstructions:this.settings.developerInstructions}),
      baseInstructions,model:this.model??null,approvalPolicy:this.settings.approvalPolicy,config,...(this.settings.sandbox?{sandbox:this.settings.sandbox}:{})}) as Obj;
    if((result.thread as Obj)?.id!==this.threadId)throw Error('Native secretary binding changed; no replacement accepted');
    if(context.token){
      const inventory=await this.server.request('mcpServerStatus/list',{threadId:this.threadId,serverName:'coffee_mishu'},15000) as Obj;
      const row=(inventory.data as Obj[]|undefined)?.find(row=>row.name==='coffee_mishu');
      if(!row||(row.tools as Obj)?.mishu===undefined||row.toolsError)throw Error('Native MISHU tool connection unavailable');
    }
    this.settings.mishuRoleApplied=true;return {};
  }

  async prompt(text: string, images?: ImageInput[]): Promise<void> {

    if(this.asyncQuestion&&!this.asyncQuestion.resuming)throw new Error('Answer or cancel the pending question before continuing');
    const sourceOverrides=await this.refreshMishuContext();
    this.nativeInputSeen=true;
    await this.updatePreferences({});
    const result = await this.server.request("turn/start", {
      threadId: this.threadId,
      input: await this.input(text, images),
      ...this.turnOverrides(),
      ...sourceOverrides,
      ...(this.settings.preparation?{sandboxPolicy:{type:'readOnly',networkAccess:false},approvalPolicy:'never'}:{}),
    }) as Obj;
    const turn = result.turn as Obj | undefined;
    if (turn && typeof turn.id === "string") {this.activeTurnId = turn.id;this.tracking.start(turn.id);}
  }

  async steer(text: string, images?: ImageInput[]): Promise<void> {
    if(this.asyncQuestion)throw new Error('Answer or cancel the pending question before inserting another instruction');
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
    const question=this.asyncQuestion;this.asyncQuestion=undefined;
    if(question){question.reject(new Error('Question cancelled'));this.questions.clear();}
    if(question&&this.activeTurnId===undefined){this.streaming=false;this.emit({type:'agent_settled'});return;}
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
    if (this.streaming && this.activeTurnId === undefined && !this.asyncQuestion) {
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
        const emptyLineage=`invalid paginated history lineage for ${this.threadId}: missing source rollout`;
        if (page === 0 && this.settings.freshEmpty&&!this.nativeInputSeen&&error instanceof Error && (error.message === unmaterialized||error.message===emptyLineage)) {
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
    const result = await this.server.request("model/list", {},10000) as Obj;
    return {...codexModelChoices(result,this.model,this.effort),context:{preset:this.preset,limit:this.preset==='272k'?272000:500000}};
  }

  async setModel(_provider: string, id: string): Promise<void> {
    // Applied as an override on the next turn; Codex has no per-thread setter.
    await this.updatePreferences({model:id});
  }

  private updatePreferences(change:{model?:string;reasoningEffort?:string}):Promise<void>{
    const write=this.preferenceWrites.then(async()=>{
      const next={mishuRole:this.settings.mishuRoleApplied===true,preset:this.preset,model:this.model,reasoningEffort:this.effort,emptyContext:Boolean(this.settings.freshEmpty&&!this.nativeInputSeen),...change};
      await this.settings.savePreferences(this.threadId,next);
      this.model=next.model;this.effort=next.reasoningEffort;
    });
    this.preferenceWrites=write.catch(()=>undefined);return write;
  }

  async setContextPreset(preset:ContextPreset):Promise<void>{
    if(preset===this.preset)return;
    if((await this.getState()).isStreaming)throw new Error('Wait for the current turn before changing context');
    await this.preferenceWrites;
    const history=await this.getHistory(),oldId=this.threadId;
    const config={...nativeThreadConfig(preset),...this.settings.preparationConfig,...(this.effort?{model_reasoning_effort:this.effort}:{})};
    const common={...(this.settings.developerInstructions===undefined?{}:{developerInstructions:this.settings.developerInstructions}),cwd:this.cwd,model:this.model??null,approvalPolicy:this.settings.approvalPolicy,config,...(this.settings.sandbox?{sandbox:this.settings.sandbox}:{})};
    // Native resume ignores changed config on a subscribed thread. Release only
    // this idle thread; no model turn is replayed and other threads keep running.
    let response:Obj;
    if(history.entries.length){
      await this.server.request('thread/unsubscribe',{threadId:oldId});
      try{response=await this.server.request('thread/resume',{...common,threadId:oldId}) as Obj;}
      catch(error){await this.server.request('thread/resume',{...common,threadId:oldId,config:{...config,...nativeThreadConfig(this.preset)}}).catch(()=>undefined);throw error;}
    }else{response=await this.server.request('thread/start',common) as Obj;}
    const thread=response.thread as Obj;
    const id=String(thread.id);
    if(id!==oldId){await this.settings.rebind(id);await this.server.request('thread/unsubscribe',{threadId:oldId});this.unsubscribe();this.threadId=id;
      this.settings.freshEmpty=history.entries.length===0;
      this.unsubscribe=this.server.subscribe(id,{notification:(method,params)=>this.onNotification(method,params),request:request=>this.onServerRequest(request),exit:()=>this.onServerExit()});}
    await this.settings.savePreferences(id,{mishuRole:this.settings.mishuRoleApplied===true,preset,model:this.model,reasoningEffort:this.effort,emptyContext:Boolean(this.settings.freshEmpty&&!this.nativeInputSeen)});this.preset=preset;this.tokenUsage=undefined;
    this.absorbThread(thread);
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.updatePreferences({reasoningEffort:level});
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
    if(await this.questions.answer(response))return;
    const pending = this.pendingApprovals.get(response.id);
    if (!pending) return;
    this.pendingApprovals.delete(response.id);
    const approved = response.confirmed === true && response.cancelled !== true;
    this.server.respond(pending.id, { decision: decisionFor(pending.method, approved) });
  }

  async stop(): Promise<void> {
    this.finishCompaction(new Error('Codex stopped before compaction completed'));
    this.asyncQuestion?.reject(new Error('Codex stopped while awaiting an answer'));this.asyncQuestion=undefined;
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
        if (turn && typeof turn.id === "string") {this.activeTurnId = turn.id;this.tracking.start(turn.id);}
        this.streaming = true;
        this.emit({ type: "agent_start" });
        return;
      }
      case "item/agentMessage/delta":
        if (typeof params.itemId === "string") this.streamedItems.add(params.itemId);
        this.emit({ type: "message_update", id: params.itemId, assistantMessageEvent: { type: "text_delta", delta: String(params.delta ?? "") } });
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
        const completed=params.item as Obj|undefined;
        // Explicit terminal answers wait for turn outcome in tracking only.
        // Unknown phases and asynchronous user questions retain live compatibility.
        if(completed?.type==='agentMessage'&&typeof params.turnId==='string'&&typeof completed.id==='string'&&typeof completed.text==='string')this.tracking.message(params.turnId,completed.id,completed.text,completed.phase==='final_answer'&&completed.delivery!=='async');
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
        if(this.asyncQuestion&&!this.asyncQuestion.resuming&&turn?.status!=='failed'){
          this.activeTurnId=undefined;this.asyncQuestion.paused=true;this.asyncQuestion.resolve();
          this.streamedItems.clear();this.toolNames.clear();this.toolOutput.clear();
          return; // A native pause is still an unanswered Host run, not completion.
        }
        if(this.asyncQuestion&&!this.asyncQuestion.resuming){
          this.asyncQuestion.reject(new Error('Codex failed before the question could be paused'));
          this.asyncQuestion=undefined;this.questions.clear();
        }
        this.tracking.finish(typeof turn?.id==='string'?turn.id:undefined,String(turn?.status??'unknown'));
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
    this.pauseForAsyncQuestion(item);
    const tool = toolCallOf(item);
    if (!tool) return;
    this.toolNames.set(item.id, tool.name);
    this.emit({ type: "tool_execution_start", toolCallId: item.id, toolName: tool.name, args: tool.args });
  }

  private onItemCompleted(item: Obj | undefined): void {
    if(item)this.pauseForAsyncQuestion(item);
    if (!item || typeof item.type !== "string" || typeof item.id !== "string") return;
    switch (item.type) {
      case "userMessage":
        this.messageCount += 1;
        for (const entry of projectTurns([{ items: [item] }])) this.emit({ type: "sync_entity", entry });
        return;
      case "agentMessage": {
        const text = typeof item.text === "string" ? item.text : "";
        // Older servers (or opted-out deltas) deliver the message only here.
        if (!this.streamedItems.has(item.id) && text.length > 0) {
          this.emit({ type: "message_update", id: item.id, assistantMessageEvent: { type: "text_delta", delta: text } });
        }
        this.streamedItems.delete(item.id);
        this.messageCount += 1;
        this.emit({ type: "message_end", id: item.id, text, message: { role: "assistant" } });
        return;
      }
      case "plan": {
        const text = typeof item.text === "string" ? item.text : "";
        for (const entry of projectTurns([{ items: [item] }])) this.emit({ type: "sync_entity", entry });
        if (text.trim().length > 0) this.emit({ type: "message_end", message: { role: "custom", display: true, content: [{ type: "text", text }] } });
        return;
      }
      case "contextCompaction":
        for (const entry of projectTurns([{ items: [item] }])) this.emit({ type: "sync_entity", entry });
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
    this.tracking.lost();
    this.asyncQuestion?.reject(new Error('Codex exited while awaiting an answer'));this.asyncQuestion=undefined;
    this.finishCompaction(new Error("Codex app-server exited during compaction"));
    this.questions.clear();
    if (this.streaming) {
      this.emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Codex app-server exited" } });
      this.streaming = false;
      this.activeTurnId = undefined;
      this.emit({ type: "agent_settled" });
    }
  }

  /** Older model histories can still call the native fire-and-forget question
   * tool. Keep its structured question visible and pause its turn before waiting
   * for an explicit reply; never interpret the native accepted result as input. */
  private pauseForAsyncQuestion(item:Obj):void {
    if(item.type!=='agentMessage'||item.delivery!=='async'||!Array.isArray(item.questions)||!item.questions.length||typeof item.id!=='string'||this.asyncQuestionItems.has(item.id))return;
    const questions=(item.questions as Obj[]).map((q,index)=>({id:item.id+':'+index,question:String(q.title??''),callId:item.id,index,
      options:Array.isArray(q.options)?q.options.map(label=>({label:String(label),description:''})):[]}));
    this.asyncQuestionItems.add(item.id);
    while(this.asyncQuestionItems.size>64)this.asyncQuestionItems.delete(this.asyncQuestionItems.values().next().value!);
    if(this.asyncQuestion){this.asyncQuestion.questions.push(...questions);return;}
    let resolve!:()=>void,reject!:(error:Error)=>void;
    const ready=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});void ready.catch(()=>undefined);
    const gate={questions,ready,resolve,reject,paused:false,resuming:false};this.asyncQuestion=gate;this.streaming=true;
    // Collect all items already in flight before showing a dialog. An early
    // answer cannot race another question arriving before native settlement.
    void ready.then(()=>{if(this.asyncQuestion!==gate)return;this.questions.ask(questions,async(answers,cancelled)=>{
      if(cancelled){await this.abort();return;}
      await ready;
      const replies=questions.map(q=>({questionItemId:JSON.stringify(['request_user_input_async',q.callId,q.index]),question:q.question,answer:answers[q.id]}));
      gate.resuming=true;
      try{await this.prompt('<send_user_message_question_reply>\n'+JSON.stringify(replies)+'\n</send_user_message_question_reply>');this.asyncQuestion=undefined;}
      catch(error){gate.resuming=false;throw error;}
    });},()=>undefined);
    if(this.activeTurnId===undefined){gate.paused=true;resolve();return;}
    void this.server.request('turn/interrupt',{threadId:this.threadId,turnId:this.activeTurnId},10000).catch(error=>{
      if(gate.paused)return;
      reject(error);this.emit({type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'Could not pause Codex for the question; stop the task before answering.'}});
    });
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
    const choices: PiModels["models"] = data.filter((model) => model.hidden !== true).map((model) => ({
      provider: "codex",
      id: String(model.model ?? model.id),
      thinkingLevels: efforts(model),
      ...(typeof model.defaultReasoningEffort === "string" ? {defaultThinkingLevel:model.defaultReasoningEffort} : {}),
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
