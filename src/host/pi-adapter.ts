import type { HostPiRuntime } from './pi-runtime.js';
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSourceLines, readStableSource, sourceHash, unknownHistory } from "./native/history-source.js";
import { nativeHistoryJob, nativeHistoryNeedsWorker } from "./native/history-pool.js";
import type { AgentHistoryRead } from "./agent-adapter.js";
import { RpcClient, SessionManager, parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import type {
  CommandInfo,
  ContextBreakdown,
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

import type { AgentHistory as PiHistory, AgentSessionListing as PiSessionListing, AgentModels as PiModels, AgentSession as PiSession, AgentSessionFactory as PiSessionFactory } from "./agent-adapter.js";
export type { AgentHistory as PiHistory, AgentSessionListing as PiSessionListing, AgentModels as PiModels, AgentSession as PiSession, AgentSessionFactory as PiSessionFactory } from "./agent-adapter.js";


export interface RpcPiSessionFactoryOptions {
  runtime?: HostPiRuntime;
  instructions?:(id?:string)=>Promise<string|undefined>;
  runtimeIdForSession?: (id:string)=>string;
  cwd?: string;
  agentDir?: string;
  sessionDir?: string;
  cliPath?: string;
  provider?: string;
  model?: string;
  /** Exact provider/model IDs selectable through this Host; absent means unrestricted. */
  allowedModels?: string[];
  args?: string[];
  /** Additional native Pi extensions loaded for every Host session. */
  extensions?: string[];
  /** Additional Pi skills loaded for every Host session. */
  skills?: string[];
  env?: Record<string, string>;
  extensionsForSession?: (id:string)=>Promise<string[]>;
  envForSession?: (id:string) => Promise<Record<string,string>>;
  cwdForSession?: (id: string, existing: boolean) => Promise<string>;
}

/**
 * Environment entries that belong to the Control Plane Relay. They must not
 * cross the Host boundary into a child Pi process, especially when the local
 * `all` mode co-locates Relay and Host for smoke testing.
 */
export const HOST_STRIPPED_ENV_KEYS = [
  "PI_COFFEE_UPSTREAM_KEY",
  "PI_COFFEE_SERPER_KEY",
  "PI_COFFEE_RELAY_TOKENS",
  "SERPER_API_KEY",
  "PI_COFFEE_GITEA_CLIENT_SECRET",
  // The Host's GitHub API token (ADR-0022); Agents push with the VM's own Git credentials.
  "PI_COFFEE_GITHUB_TOKEN",
  "PI_COFFEE_GITHUB_CLIENT_SECRET",
  "PI_COFFEE_HOST_TOKEN",
] as const;

/**
 * Build the RpcClient env overlay. RpcClient merges this object over its own
 * process.env; explicit undefined values therefore remove Relay credentials
 * from the spawned child without mutating the parent process environment.
 */
export function buildHostChildEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  // Provider registration is needed for Gemini, not its optional search/image tools.
  const env: Record<string, string | undefined> = { ANTIGRAVITY_NO_EXTRA_TOOLS: '1', ...overrides };
  for (const key of HOST_STRIPPED_ENV_KEYS) env[key] = undefined;
  // Upstream child launcher resolves the same installed Pi, never a legacy PATH shim.
  env.PI_SUBAGENT_PI_BINARY = undefined;
  env.PI_COFFEE_PI_CLI = undefined;
  env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = dirname(dirname(resolvePiCliPath()));
  return env as Record<string, string>;
}

/** Adapter around the original Pi agent's documented RPC client. */
export class RpcPiSessionFactory implements PiSessionFactory {
  private readonly options: RpcPiSessionFactoryOptions;

  constructor(options: RpcPiSessionFactoryOptions = {}) {
    if(options.allowedModels && (options.allowedModels.length===0 || options.allowedModels.some(id=>!/^([^\s/]+)\/(\S+)$/.test(id))))throw new Error("Pi allowedModels must contain exact provider/model IDs");
    this.options = options;
  }

  private extensions(): string[] { return this.options.runtime?.extensions() ?? this.options.extensions ?? []; }
  private async startWithRecovery<T>(start: () => Promise<T>): Promise<T> {
    const startedInEmergency = this.options.runtime?.status().mode === 'emergency';
    try { return await start(); }
    catch (error) {
      if (!this.options.runtime?.recoverStartup(error, startedInEmergency)) throw error;
      return start(); // At most one retry, before any prompt has been submitted.
    }
  }

  private commandDiscovery?:Promise<CommandInfo[]>;
  async commandCatalog(engine:"pi"):Promise<CommandInfo[]> {
    if(engine!=="pi")throw new Error("This adapter only discovers Pi commands");
    if(this.commandDiscovery)return this.commandDiscovery;
    this.commandDiscovery=this.startWithRecovery(()=>this.discoverCommands());
    try{return await this.commandDiscovery;}finally{this.commandDiscovery=undefined;}
  }
  private async discoverCommands():Promise<CommandInfo[]> {
    const args=appendSkillArgs(appendExtensionArgs([...(this.options.args??[])],this.extensions()),this.options.skills??[]);
    args.push("--no-session");
    const client=new RpcClient({cliPath:this.options.cliPath??resolvePiCliPath(),cwd:this.options.cwd,
      provider:this.options.provider,model:this.options.model,args,
      env:{PI_COFFEE_CONTEXT_CONTROL:"1",...(this.options.agentDir?{PI_CODING_AGENT_DIR:this.options.agentDir}:{}),...buildHostChildEnv(this.options.env)}});
    const session=new RpcPiSession(client,extensionPathsFromArgs(args),this.options.allowedModels);
    try{await session.start();return await session.getCommands();}finally{await session.stop();}
  }
  async modelCatalog(engine:"pi" | "codex"):Promise<PiModels> {
    if(engine!=="pi")throw new Error("This adapter only discovers Pi models");
    return this.startWithRecovery(()=>this.discoverModels());
  }
  private async discoverModels():Promise<PiModels> {
    const args=appendSkillArgs(appendExtensionArgs([...(this.options.args??[])],this.extensions()),this.options.skills??[]);
    // Native ephemeral mode: discover configured providers without a task or saved transcript.
    args.push("--no-session");
    const client=new RpcClient({cliPath:this.options.cliPath??resolvePiCliPath(),cwd:this.options.cwd,
      provider:this.options.provider,model:this.options.model,args,
      env:{PI_COFFEE_CONTEXT_CONTROL:"1",...(this.options.agentDir?{PI_CODING_AGENT_DIR:this.options.agentDir}:{}),...buildHostChildEnv(this.options.env)}});
    const session=new RpcPiSession(client,extensionPathsFromArgs(args),this.options.allowedModels);
    try{await session.start();return await session.getModels();}finally{await session.stop();}
  }

  async create(options: { sessionId: string; workspaceSessionId?:string; requireExisting?:boolean }): Promise<PiSession> {
    return this.startWithRecovery(()=>this.createOnce(options));
  }
  private async createOnce(options: { sessionId: string; workspaceSessionId?:string; requireExisting?:boolean }): Promise<PiSession> {
    const args = appendSkillArgs(
      appendExtensionArgs([...(this.options.args ?? [])], [...this.extensions(),...await this.options.extensionsForSession?.(options.workspaceSessionId??options.sessionId)??[]]),
      this.options.skills ?? [],
    );
    const environment={...this.options.env,...await this.options.envForSession?.(options.workspaceSessionId??options.sessionId)};
    const instructions=environment.PI_COFFEE_INITIAL_MODE==='chat'?undefined:await this.options.instructions?.(options.workspaceSessionId??options.sessionId);
    if(instructions)args.push("--append-system-prompt",instructions);
    // Final integration hook enforces zero-system Chat; Work retains Host guidance.
    appendExtensionArgs(args, [fileURLToPath(new URL(`./pi-environment-extension.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url))]);
    // Resume from the durable store when the conversation already exists there;
    // only a genuinely new conversation gets a fresh file with our id.
    const existing = (await this.listWithPaths()).find((session) => session.id === options.sessionId);
    if(options.requireExisting&&!existing)throw new Error("Native Pi history is missing; restore its original store before reopening this task");
    const resumeContext=options.requireExisting&&existing?.path?SessionManager.open(existing.path).buildSessionContext():undefined;
    if (!args.includes("--session") && !args.includes("--session-id")) {
      if (existing?.path !== undefined) args.push("--session", existing.path);
      else args.push("--session-id", options.sessionId);
    }
    if (this.options.sessionDir !== undefined) {
      args.push("--session-dir", this.options.sessionDir);
    }
    const client = new RpcClient({
      cliPath: this.options.cliPath ?? resolvePiCliPath(),
      cwd: this.options.cwdForSession ? await this.options.cwdForSession(options.workspaceSessionId ?? options.sessionId, existing !== undefined) : this.options.cwd,
      provider: this.options.provider,
      model: this.options.model,
      env: {
        ...(this.options.agentDir === undefined ? {} : { PI_CODING_AGENT_DIR: this.options.agentDir }),
        ...buildHostChildEnv(environment),
        PI_COFFEE_CONTEXT_CONTROL: "1",
        PI_COFFEE_ROOT_SESSION: this.options.runtimeIdForSession?.(options.workspaceSessionId ?? options.sessionId) ?? options.sessionId,
      },
      args,
    });
    const session = new RpcPiSession(client, extensionPathsFromArgs(args), this.options.allowedModels);
    try{
      await session.start();
      // Pi applies defaults when resuming a branch with no messages. Restore the
      // native branch settings captured before startup, without injecting text.
      if(resumeContext&&!resumeContext.messages.length){
        if(resumeContext.model)await session.setModel(resumeContext.model.provider,resumeContext.model.modelId);
        if(resumeContext.thinkingLevel)await session.setThinkingLevel(resumeContext.thinkingLevel);
      }
      return session;
    }catch(error){await session.stop().catch(()=>undefined);throw error;}
  }

  async resetNative(sourceNativeId:string,options:{sessionId:string;cwd:string;workspaceSessionId:string}):Promise<PiSession>{
    const source=(await this.listWithPaths()).find(row=>row.id===sourceNativeId);
    if(!source)throw new Error('Native Pi history is unavailable; no context was cleared');
    if((await this.listWithPaths()).some(row=>row.id===options.sessionId))throw new Error('Reset destination already exists');
    // Native tree APIs preserve evidence while creating an empty active branch.
    const copy=SessionManager.forkFrom(source.path,options.cwd,this.options.sessionDir,{id:options.sessionId});
    copy.resetLeaf();copy.appendSessionInfo('Chat');
    return this.create({sessionId:options.sessionId,workspaceSessionId:options.workspaceSessionId,requireExisting:true});
  }
  async forkNative(sourceNativeId:string,options:{sessionId:string;cwd:string;sourceCwd:string}):Promise<PiSession>{
    const source=(await this.listWithPaths()).find(row=>row.id===sourceNativeId);
    if(!source)throw new Error('Native Pi source history is unavailable; no replacement was created');
    if((await this.listWithPaths()).some(row=>row.id===options.sessionId))throw new Error('Native Fork destination already exists');
    SessionManager.forkFrom(source.path,options.cwd,this.options.sessionDir,{id:options.sessionId});
    return new RpcPiSessionFactory({...this.options,cwd:options.cwd,cwdForSession:undefined}).create({sessionId:options.sessionId,workspaceSessionId:options.sessionId,requireExisting:true});
  }

  async list(): Promise<PiSessionListing[]> {
    return (await this.listWithPaths()).map(({ path: _path, ...listing }) => listing);
  }

  async readHistory(sessionId: string): Promise<AgentHistoryRead> {
    const binding = `pi:${sessionId}`;
    if (nativeHistoryNeedsWorker) return nativeHistoryJob("pi", { sessionId, options: { cwd: this.options.cwd, sessionDir: this.options.sessionDir } }).catch(() => unknownHistory(binding));
    try {
      const found = (await this.listWithPaths()).filter(session => session.id === sessionId);
      if (found.length !== 1) return unknownHistory(binding);
      const source = await readStableSource(found[0].path);
      const rows = await parseSourceLines(source.text);
      const header = rows[0];
      if (header?.type !== "session" || header.id !== sessionId || ![2, 3].includes(header.version)) return unknownHistory(binding);
      const entries = rows.slice(1);
      // Native v2/v3 tree records have durable IDs. Never invent positional IDs.
      if (entries.some(entry => typeof entry.id !== "string" || !entry.id)) return unknownHistory(binding);
      const leafId = entries.at(-1)?.id ?? null;
      const byId = new Map(entries.map(entry => [entry.id, entry]));
      if (byId.size !== entries.length) return unknownHistory(binding);
      const children = new Map<string | null, number>();
      for (const entry of entries) children.set(entry.parentId ?? null, (children.get(entry.parentId ?? null) ?? 0) + 1);
      const branches: string[] = [], seen = new Set<string>();
      let entry = leafId === null ? undefined : byId.get(leafId);
      while (entry) {
        if (seen.has(entry.id)) return unknownHistory(binding);
        seen.add(entry.id);
        if ((children.get(entry.parentId ?? null) ?? 0) > 1) branches.push(entry.id);
        if (entry.parentId != null && !byId.has(entry.parentId)) return unknownHistory(binding);
        entry = entry.parentId == null ? undefined : byId.get(entry.parentId);
      }
      return { history: projectHistory(entries, leafId, { preserveToolContent: true }), binding: `${binding}:${source.identity}:${sourceHash(JSON.stringify(branches.reverse()))}`, sourceGeneration: source.generation, sourceFreshness: "current", checkedAt: new Date().toISOString() };
    } catch { return unknownHistory(binding); }
  }

  async readRunEvidence(sessionId:string,runId?:string):Promise<import('./agent-adapter.js').AgentRunEvidence> {
    const unknown={supported:true,freshness:'unknown' as const,state:'uncertain' as const,runId,reason:'Native run evidence unavailable; no execution replay'};
    try{
      const found=(await this.listWithPaths()).filter(s=>s.id===sessionId);if(found.length!==1)return unknown;
      const source=await readStableSource(found[0].path),rows=await parseSourceLines(source.text);
      if(rows[0]?.type!=='session'||rows[0].id!==sessionId||![2,3].includes(rows[0].version))return unknown;
      const byId=new Map(rows.slice(1).map(e=>[e.id,e]));if(byId.size!==rows.length-1)return unknown;
      const branch:Record<string,any>[]=[],seen=new Set<string>();let leaf=rows.at(-1);
      while(leaf?.id){if(seen.has(leaf.id))return unknown;seen.add(leaf.id);branch.unshift(leaf);if(leaf.parentId&&!byId.has(leaf.parentId))return unknown;leaf=byId.get(leaf.parentId);}
      const markers=branch.filter(e=>e.type==='custom'&&e.customType==='coffee-native-run'&&e.data?.version===1);
      const marker=runId?markers.find(e=>e.data.runId===runId):markers.at(-1);
      if(marker&&markers.filter(e=>e.data.runId===marker.data.runId).length!==1)return unknown;
      if(!marker||typeof marker.data.runId!=='string'||marker.parentId!==marker.data.baselineId||(marker.data.baselineId!==null&&!byId.has(marker.data.baselineId)))return {...unknown,reason:'This run has no provable native correlation marker'};
      const report=marker.data.origin==='task-report';
      const start=branch.indexOf(marker),range=[];let settled=false,inputSeen=false,closedByBoundary=false;
      for(const e of branch.slice(start+1)){
        if(e.type==='custom'&&e.customType==='coffee-native-run'){closedByBoundary=true;break;}
        if(report&&e.type==='custom_message'&&e.customType==='coffee-task-report'&&e.details?.processingId===marker.data.runId){inputSeen=true;continue;}
        if(e.type==='message'&&e.message?.role==='user'){if(inputSeen||report){closedByBoundary=true;break;}inputSeen=true;continue;}
        if(e.type==='custom'&&e.customType==='coffee-native-settled'&&e.data?.runId===marker.data.runId){settled=true;break;}
        range.push(e);
      }
      if(!inputSeen)return unknown;
      const messages=range.filter(e=>e.type==='message'&&e.message?.role==='assistant');
      const entries=messages.map(e=>({id:e.id,revision:sourceHash(JSON.stringify(e.message)),text:Array.isArray(e.message.content)?e.message.content.filter((p:any)=>p.type==='text').map((p:any)=>p.text).join('\n'):''})).filter(e=>e.text);
      const final=messages.at(-1)?.message;
      return {supported:true,freshness:'current',runId:marker.data.runId,binding:`pi:${sessionId}:${source.identity}`,watermark:sourceHash(JSON.stringify([marker.id,entries,settled])),state:settled||report&&final?.stopReason==='stop'?(final?.stopReason==='stop'&&entries.length?'reply-available':'incomplete'):closedByBoundary?'uncertain':'running',entries};
    }catch{return unknown;}
  }

  async delete(sessionId: string): Promise<boolean> {
    const existing = (await this.listWithPaths()).find((session) => session.id === sessionId);
    if (existing === undefined) return false;
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId)) {
      await rm(join(dirname(existing.path), "artifacts", sessionId), { recursive: true, force: true });
    }
    await rm(existing.path, { force: true });
    return true;
  }

  /**
   * Reads Pi's own session store (one JSONL file per conversation). The Host
   * runs beside Pi in the User VM, so this is the same filesystem Pi writes
   * to; nothing here is ever copied off the VM except the summaries.
   */
  private async listWithPaths(): Promise<Array<PiSessionListing & { path: string }>> {
    const sessionDir = this.options.sessionDir;
    let infos: Awaited<ReturnType<typeof SessionManager.listAll>>;
    try {
      infos = sessionDir === undefined
        ? await SessionManager.list(this.options.cwd ?? process.cwd())
        : await SessionManager.listAll(sessionDir);
    } catch {
      // A missing or empty store is an empty list, not a broken Host.
      return [];
    }
    return infos
      .map((info) => ({
        id: info.id,
        ...(info.name === undefined || info.name.length === 0 ? {} : { name: info.name }),
        createdAt: info.created.toISOString(),
        updatedAt: info.modified.toISOString(),
        messageCount: info.messageCount,
        preview: piSessionPreview(info.firstMessage),
        path: info.path,
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }
}

/** Unwrap native Skill expansion before truncation; never edit the native transcript. */
function piSessionPreview(firstMessage: string): string {
  const text = firstMessage.trim();
  const skill = parseSkillBlock(text);
  const userText = skill ? skill.userMessage || `/skill:${skill.name}` : text;
  return userText.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** Add `--extension path` pairs without duplicating explicitly supplied paths. */
export function appendExtensionArgs(args: string[], extensions: readonly string[]): string[] {
  for (const extension of extensions) {
    const trimmed = extension.trim();
    if (trimmed.length === 0) continue;
    const alreadyPresent = args.some((arg, index) =>
      (arg === "--extension" || arg === "-e") && args[index + 1] === trimmed,
    ) || args.includes(`--extension=${trimmed}`);
    if (!alreadyPresent) args.push("--extension", trimmed);
  }
  return args;
}

/** Add `--skill path` pairs without duplicating explicitly supplied paths. */
export function appendSkillArgs(args: string[], skills: readonly string[]): string[] {
  for (const skill of skills) {
    const trimmed = skill.trim();
    if (trimmed.length === 0) continue;
    const alreadyPresent = args.some((arg, index) => arg === "--skill" && args[index + 1] === trimmed)
      || args.includes(`--skill=${trimmed}`);
    if (!alreadyPresent) args.push("--skill", trimmed);
  }
  return args;
}

/** `--extension <path>` / `--extension=<path>` / `-e <path>` entries from a CLI arg list. */
export function extensionPathsFromArgs(args: readonly string[]): string[] {
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--extension" || arg === "-e") && args[i + 1]) paths.push(args[++i]);
    else if (arg.startsWith("--extension=")) paths.push(arg.slice("--extension=".length));
  }
  return paths;
}

class RpcPiSession implements PiSession {
  private readonly client: RpcClient;
  private readonly configuredExtensions: readonly string[];
  private readonly listeners = new Set<(event: unknown) => void>();
  private unsubscribe?: () => void;
  private healthTimer?: ReturnType<typeof setTimeout>;
  private runGeneration = 0;
  private running = false;
  private handoffActive = false;

  constructor(client: RpcClient, configuredExtensions: readonly string[] = [], private readonly allowedModels?: readonly string[]) {
    this.client = client;
    this.configuredExtensions = configuredExtensions;
    this.unsubscribe = client.onEvent((event) => {
      if (event.type === "agent_start") {
        this.running = true;
        this.watchActiveProcess();
      } else if (event.type === "agent_settled") {
        this.stopWatching();
      }
      for (const listener of this.listeners) listener(event);
    });
  }

  // Pinned RpcClient has no public process-exit callback. Probe only active runs
  // through its public RPC seam; transient RPC timeouts do not prove Pi died.
  private watchActiveProcess(): void {
    if (!this.running || this.healthTimer) return;
    const generation = this.runGeneration;
    this.healthTimer = setTimeout(async () => {
      this.healthTimer = undefined;
      try { await this.client.getState(); }
      catch (error) {
        if (this.running && generation === this.runGeneration && error instanceof Error && /^Agent process exited \(/.test(error.message)) {
          this.stopWatching();
          for (const listener of this.listeners) listener({type:"agent_interrupted"});
          return;
        }
      }
      if (generation === this.runGeneration) this.watchActiveProcess();
    }, 1000);
    this.healthTimer.unref();
  }

  private stopWatching(): void {
    this.running = false;
    this.runGeneration++;
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = undefined;
  }

  async start(): Promise<void> {
    try {
      await this.client.start();
      // RpcClient.start only waits 100 ms; a package can fail after it returns.
      // Do not expose a session (or allow a prompt) before native RPC is ready.
      await this.client.getState();
    } catch (error) {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      await this.client.stop().catch(()=>undefined);
      throw error;
    }
  }

  private modelAllowed(provider:unknown,id:unknown):boolean {
    return !this.allowedModels || (typeof provider==='string' && typeof id==='string' && this.allowedModels.includes(`${provider}/${id}`));
  }

  async prompt(text: string, images?: ImageInput[]): Promise<void> {
    if(this.allowedModels && /^\/model(?:\s|$)/.test(text.trim())){
      const match=/^\/model\s+([^\s/]+)\/(\S+)\s*$/.exec(text.trim());
      if(!match)throw new Error('Use /model provider/model-id or the model menu. Allowed: '+this.allowedModels.join(', '));
      if(images?.length)throw new Error('Send attachments separately from a model selection command');
      await this.setModel(match[1],match[2]);
      for(const listener of this.listeners)listener({type:'agent_settled'});
      return;
    }
    // The RPC package's wire image shape is intentionally the same compact
    // shape used by PI Coffee.  Keep the cast local to this adapter.
    this.running = true;
    this.watchActiveProcess();
    try {
      const disposition = await this.sendChecked({ type: "prompt", message: text, images });
      // A handled command owns no run. Never settle a run started by an input hook.
      if (disposition === "handled" && !(await this.client.getState()).isStreaming) {
        this.stopWatching();
        for (const listener of this.listeners) listener({type:"agent_settled"});
      }
    }
    catch (error) {this.stopWatching();throw error;}
  }

  async steer(text: string, images?: ImageInput[]): Promise<void> {
    await this.sendChecked({ type: "steer", message: text, images });
  }

  async validateFollowUp(text:string):Promise<void>{
    const command=/^\/(\S+)/.exec(text)?.[1];
    if(command&&(await this.getCommands()).some(c=>c.name===command&&c.source==='extension'))throw new Error('Extension commands cannot be queued.');
    if(this.allowedModels){
      if(/^\/model(?:\s|$)/.test(text.trim()))throw new Error('Change models when the current turn has finished');
      const state=await this.client.getState();
      if(!this.modelAllowed(state.model?.provider,state.model?.id))throw new Error('Current Pi model is not allowed; select an approved model before sending');
    }
  }

  async followUp(text: string, images?: ImageInput[]): Promise<void> {
    await this.sendChecked({ type: "follow_up", message: text, images });
  }

  /** Consume public RPC disposition; failed responses reject in Pi itself. */
  private async sendChecked(command: { type: "prompt" | "steer" | "follow_up"; message: string; images?: ImageInput[] }): Promise<"started" | "queued" | "handled"> {
    if(this.allowedModels){
      if(/^\/model(?:\s|$)/.test(command.message.trim()))throw new Error('Change models when the current turn has finished');
      const state=await this.client.getState();
      if(!this.modelAllowed(state.model?.provider,state.model?.id))throw new Error('Current Pi model is not allowed; select an approved model before sending');
    }
    if (command.type === "steer") return this.client.steer(command.message, command.images);
    if (command.type === "follow_up") return this.client.followUp(command.message, command.images);
    return this.client.prompt(command.message, command.images);
  }

  async abort(): Promise<void> {
    await this.client.abort();
  }

  async getState(): Promise<SessionState> {
    const state = await this.client.getState();
    return {
      isStreaming: state.isStreaming,
      ...(state.pendingMessageCount>0?{pendingMessageCount:state.pendingMessageCount}:{}),
      ...(state.isCompacting?{isCompacting:true}:{}),
      messageCount: state.messageCount,
      ...(state.sessionName === undefined ? {} : { sessionName: state.sessionName }),
    };
  }

  async backgroundState():Promise<{known:boolean;active:number}> {
    const commands=await this.client.getCommands();
    if(!commands.some(c=>c.name==="coffee-workspace-jobs"))return {known:false,active:0};
    const before=await this.client.getEntries();const since=before.entries.at(-1)?.id;
    const nonce=randomUUID();await this.client.prompt(`/coffee-workspace-jobs ${nonce}`);
    const result=await this.client.getEntries(since);
    const entry=result.entries.find(e=>e.type==="custom" && e.customType==="coffee-workspace-jobs" && (e.data as any)?.nonce===nonce);
    const value=entry?.type==="custom" ? entry.data as any : undefined;
    return {known:value?.known===true && Number.isSafeInteger(value.active),active:value?.active ?? 0};
  }

  async getHistory(): Promise<PiHistory> {
    const result = await this.client.getEntries();
    return projectHistory(result.entries as unknown[], result.leafId ?? null);
  }

  async rename(name: string): Promise<void> {
    await this.client.setSessionName(name);
  }

  async getModels(): Promise<PiModels> {
    const [available, state, levels] = await Promise.all([
      this.client.getAvailableModels(),
      this.client.getState(),
      this.client.getAvailableThinkingLevels(),
    ]);
    const commands=await this.client.getCommands();
    const contextSupported=commands.some(c=>c.name==='coffee-context-window');
    const entries=contextSupported?(await this.client.getEntries()).entries:[];
    const setting=entries.filter(e=>e.type==='custom'&&e.customType==='coffee-context-window').at(-1);
    const preset=setting?.type==='custom'&&(setting.data as {preset?:string})?.preset==='maximum'?'maximum' as const:'272k' as const;
    const current = state.model as { provider?: unknown; id?: unknown } | undefined;
    return {
      ...(contextSupported?{context:{preset,limit:state.model?.contextWindow,maximum:available.find(m=>m.provider===state.model?.provider&&m.id===state.model?.id)?.contextWindow}}:{}),
      models: available.filter(model=>this.modelAllowed(model.provider,model.id)).map((model) => ({
        source: (process.env.PI_COFFEE_RELAY_PROVIDERS ?? "cpa").split(",").map(v=>v.trim()).includes(model.provider) ? "relay" as const : "native" as const,
        provider: model.provider,
        id: model.id,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        thinkingLevels: model.provider===current?.provider && model.id===current?.id
          ? levels.map(String)
          // Native RPC returns the model record including thinkingLevelMap;
          // RpcClient's ModelInfo declaration only lists its common fields.
          : getSupportedThinkingLevels(model as Parameters<typeof getSupportedThinkingLevels>[0]),
      })),
      current: current && this.modelAllowed(current.provider,current.id) && typeof current.provider === "string" && typeof current.id === "string"
        ? { provider: current.provider, id: current.id, source: (process.env.PI_COFFEE_RELAY_PROVIDERS ?? "cpa").split(",").map(v=>v.trim()).includes(current.provider) ? "relay" as const : "native" as const }
        : null,
      thinkingLevel: String(state.thinkingLevel),
      thinkingLevels: levels.map(String),
    };
  }

  async setModel(provider: string, id: string): Promise<void> {
    if(!this.modelAllowed(provider,id))throw new Error("Pi model is not allowed: "+provider+"/"+id);
    const context = (await this.getModels()).context;
    await this.client.setModel(provider, id);
    // Native same-model selection restores the registry model without emitting
    // model_select. Reapply the persisted Host preset through the public command.
    if (context) await this.setContextPreset(context.preset);
  }

  async setContextPreset(preset:import('../shared/protocol.js').ContextPreset):Promise<void>{
    if(!(await this.client.getCommands()).some(c=>c.name==='coffee-context-window'))throw new Error('Update Harness to use context settings');
    await this.client.prompt('/coffee-context-window '+preset);
    const settings=await this.getModels();
    if(settings.context?.preset!==preset)throw new Error('Pi did not apply the context preset');
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.client.setThinkingLevel(level as never);
  }

  async getCommands(): Promise<CommandInfo[]> {
    const commands = await this.client.getCommands();
    return commands.filter(command=>command.name!=='coffee-context-window').map((command) => ({
      name: command.name,
      ...(command.description === undefined ? {} : { description: command.description }),
      source: command.source,
    }));
  }

  async getExtensions(): Promise<ExtensionInfo[]> {
    const commands = await this.client.getCommands() as unknown as Array<Record<string, unknown>>;
    return projectExtensions(commands, this.configuredExtensions);
  }

  async getStats(): Promise<SessionStats> {
    const stats = await this.client.getSessionStats() as unknown as Record<string, unknown>;
    let contextBreakdown:ContextBreakdown | undefined;
    const commands=await this.client.getCommands();
    if(!this.handoffActive && commands.some(command=>command.name==='coffee-context-usage')){
      const before=await this.client.getEntries();const since=before.entries.at(-1)?.id;
      const nonce=randomUUID();await this.client.prompt(`/coffee-context-usage ${nonce}`);
      const result=await this.client.getEntries(since);
      const value=result.entries.find(entry=>entry.type==='custom' && entry.customType==='coffee-context-usage' && (entry.data as any)?.nonce===nonce);
      const data=value?.type==='custom'?(value.data as any)?.breakdown:undefined;
      const ids=['system','tools','rules','skills','dynamic','subagents','conversation'] as const;
      if(data?.version===1 && data.method==='o200k_base_estimate' && ['last_request','session_preview'].includes(data.basis)
        && typeof data.model==='string' && data.model.length<=256 && typeof data.capturedAt==='string' && Number.isFinite(Date.parse(data.capturedAt))
        && Number.isSafeInteger(data.contextWindow) && data.contextWindow>0 && data.categories?.length===7
        && ids.every(id=>data.categories.some((c:any)=>c.id===id && Number.isSafeInteger(c.tokens) && c.tokens>=0))){
        const categories=ids.map(id=>({id,tokens:data.categories.find((c:any)=>c.id===id).tokens as number}));
        contextBreakdown={version:1,method:'o200k_base_estimate',basis:data.basis,model:data.model,capturedAt:data.capturedAt,contextWindow:data.contextWindow,totalTokens:categories.reduce((n,c)=>n+c.tokens,0),categories,mediaOmitted:data.mediaOmitted===true};
      }
    }
    const tokens = (stats.tokens ?? {}) as Record<string, unknown>;
    const usage = stats.contextUsage as Record<string, unknown> | undefined;
    const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
    return {
      ...(contextBreakdown ? {contextBreakdown} : {}),
      userMessages: num(stats.userMessages),
      assistantMessages: num(stats.assistantMessages),
      toolCalls: num(stats.toolCalls),
      tokens: {
        input: num(tokens.input),
        output: num(tokens.output),
        cacheRead: num(tokens.cacheRead),
        cacheWrite: num(tokens.cacheWrite),
        total: num(tokens.total),
      },
      cost: num(stats.cost),
      ...(usage === undefined ? {} : {
        contextUsage: {
          tokens: typeof usage.tokens === "number" ? usage.tokens : null,
          contextWindow: num(usage.contextWindow),
          percent: typeof usage.percent === "number" ? usage.percent : null,
        },
      }),
    };
  }

  async compact(): Promise<void> {
    this.handoffActive=true;
    try {await this.performHandoff();}
    catch(error) {
      if(error instanceof Error && /^Agent process exited \(/.test(error.message)) {
        this.stopWatching();for(const listener of this.listeners)listener({type:"agent_interrupted"});
      }
      throw error;
    } finally {this.handoffActive=false;}
  }

  private async performHandoff(): Promise<void> {
    const commands = await this.client.getCommands();
    if (!commands.some(command => command.name === "handoff")) {
      throw new Error("Handoff extension is not loaded; no native fallback was requested.");
    }
    const { HANDOFF_REQUEST, HANDOFF_VERSION } = await import('context-handoff/protocol');
    const state=await this.client.getState();
    if(state.isStreaming || state.isCompacting)throw new Error("Wait for the current Pi operation to finish");
    if(!this.modelAllowed(state.model?.provider,state.model?.id))throw new Error("Current Pi model is not allowed; select an approved model before Handoff");
    const before=await this.client.getEntries(), since=before.entries.at(-1)?.id;
    const deadline=Date.now()+360_000;
    try { await this.client.compact(HANDOFF_REQUEST); }
    catch(error) {
      if(!(error instanceof Error) || !error.message.startsWith("Timeout waiting for response to compact."))throw error;
      // RpcClient waits only 30s. Keep ownership of the original request; never retry it.
      try {
        while((await this.client.getState()).isCompacting) {
          if(Date.now()>=deadline)throw new Error("Handoff exceeded its completion deadline");
          await delay(250);
        }
      } catch(waitError) {
        // If settlement cannot be observed, stop this child before releasing ownership.
        await this.client.stop();
        this.stopWatching();for(const listener of this.listeners)listener({type:"agent_interrupted"});
        throw waitError;
      }
    }
    const after=await this.client.getEntries(since);
    const committed=after.entries.find(entry=>entry.type==="compaction" &&
      (entry.details as any)?.plugin==="pi-handoff" && (entry.details as any)?.pluginVersion===HANDOFF_VERSION &&
      (entry.details as any)?.trigger==="manual");
    if(!committed || (await this.client.getState()).sessionId!==state.sessionId)
      throw new Error("Handoff did not commit in the original session; previous history is preserved.");
  }

  async respondUi(response: UiResponse): Promise<void> {
    // The documented RPC sub-protocol answers a dialog by writing an
    // `extension_ui_response` line to Pi's stdin, and Pi sends nothing back.
    // RpcClient (0.84.4) exposes no method for that one-way write and its
    // `send` waits for a reply, so this is the single place PI Coffee reaches
    // for the child process. It is guarded by the adapter conformance test.
    const child = (this.client as unknown as { process?: { stdin?: { write(chunk: string): boolean } | null } | null }).process;
    const stdin = child?.stdin;
    if (!stdin) throw new Error("Pi process is not running");
    const payload: Record<string, unknown> = { type: "extension_ui_response", id: response.id };
    if (response.cancelled === true) payload.cancelled = true;
    else if (response.confirmed !== undefined) payload.confirmed = response.confirmed;
    else payload.value = response.value ?? "";
    stdin.write(`${JSON.stringify(payload)}\n`);
  }

  onEvent(listener: (event: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    this.stopWatching();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.listeners.clear();
    await this.client.stop();
  }
}

const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * Turn Pi's append-only entry tree into the flat, display-ready list the
 * browser renders. Follows the active branch (leaf → root) so abandoned
 * branches are not shown; compactions stay visible as notes because the user
 * asked to see the whole past conversation, not the model's current context.
 */
export function projectHistory(rawEntries: unknown[], leafId: string | null, options: { preserveToolContent?: boolean } = {}): PiHistory {
  const entries = rawEntries.filter(isRecord);
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of entries) if (typeof entry.id === "string") byId.set(entry.id, entry);

  let path: Record<string, unknown>[];
  if (leafId !== null && byId.has(leafId)) {
    path = [];
    let current: Record<string, unknown> | undefined = byId.get(leafId);
    const seen = new Set<string>();
    while (current && typeof current.id === "string" && !seen.has(current.id)) {
      seen.add(current.id);
      path.push(current);
      current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
    }
    path.reverse();
  } else {
    path = entries;
  }

  const out: HistoryEntry[] = [];
  const toolsByCallId = new Map<string, Extract<HistoryEntry, { kind: "tool" }>>();
  for (const entry of path) {
    const id = typeof entry.id === "string" ? entry.id : `entry-${out.length}`;
    const at = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    const stamp = at === undefined ? {} : { at };
    if (entry.type === "message" && isRecord(entry.message)) {
      const message = entry.message;
      const content = message.content;
      if (message.role === "user") {
        out.push({ kind: "user", id, ...stamp, text: textOf(content), ...imageCount(content) });
      } else if (message.role === "assistant") {
        const text = textOf(content);
        if (text.length > 0) out.push({ kind: "assistant", id, ...stamp, text });
        for (const block of blocksOf(content)) {
          if (block.type !== "toolCall" && block.type !== "tool_call") continue;
          const callId = stringOr(block.toolCallId, stringOr(block.id, `${id}-tool-${toolsByCallId.size}`));
          const tool: Extract<HistoryEntry, { kind: "tool" }> = {
            kind: "tool",
            id: callId,
            ...stamp,
            name: stringOr(block.toolName, stringOr(block.name, "tool")),
            args: toJson(block.input ?? block.arguments ?? null),
          };
          toolsByCallId.set(callId, tool);
          out.push(tool);
        }
      } else if (message.role === "toolResult" || message.role === "tool_result") {
        const callId = stringOr(message.toolCallId, "");
        const tool = toolsByCallId.get(callId);
        const fullResult = textOf(content);
        const result = options.preserveToolContent ? fullResult : fullResult.slice(0, MAX_TOOL_RESULT_CHARS);
        // Pi's edit tool records the diff it applied; keep it so a reloaded
        // browser shows the same change view as the live one did.
        const details = isRecord(message.details) ? message.details : undefined;
        const diff = details ? stringOr(details.patch, stringOr(details.diff, "")) : "";
        if (tool) {
          tool.result = result;
          tool.isError = message.isError === true;
          if (diff.length > 0) tool.diff = options.preserveToolContent ? diff : diff.slice(0, MAX_TOOL_RESULT_CHARS * 4);
        } else {
          out.push({ kind: "tool", id, ...stamp, name: stringOr(message.toolName, "tool"), args: null, result, isError: message.isError === true });
        }
      } else if ((message.role === "custom" || message.role === "customMessage") && message.display === true) {
        const text = textOf(content);
        if (text.length > 0) out.push({ kind: "note", id, ...stamp, text });
      }
    } else if (entry.type === "compaction") {
      out.push({ kind: "note", id, ...stamp, text: "会话上下文已压缩；更早的消息仍保留在这里，但模型只看到摘要。" });
    } else if (entry.type === "branch_summary") {
      out.push({ kind: "note", id, ...stamp, text: "已从此处切换分支。" });
    }
  }
  return { entries: out, leafId };
}

/**
 * Group Pi's slash commands by the file that registered them. Every extension
 * PI Coffee passed with --extension is listed even when it registers no
 * command, because it is loaded all the same.
 */
export function projectExtensions(commands: Array<Record<string, unknown>>, configured: readonly string[]): ExtensionInfo[] {
  const byKey = new Map<string, ExtensionInfo>();
  const norm = (p: string) => p.replace(/\\/g, "/");
  for (const path of configured) {
    const key = norm(path);
    byKey.set(key, { name: displayName(path), kind: "extension", path, origin: "configured", commands: [] });
  }
  for (const command of commands) {
    const kind = command.source === "skill" ? "skill" : command.source === "prompt" ? "prompt" : "extension";
    const info = isRecord(command.sourceInfo) ? command.sourceInfo : {};
    const rawPath = typeof info.path === "string" ? info.path : typeof command.path === "string" ? command.path : undefined;
    const key = rawPath ? norm(rawPath) : `${kind}:${String(command.name)}`;
    let entry = byKey.get(key);
    if (!entry) {
      const inline = rawPath?.startsWith("<inline:");
      const rawOrigin = typeof info.source === "string" ? info.source : typeof command.location === "string" ? command.location : "unknown";
      entry = {
        name: rawPath ? (inline ? rawPath.slice("<inline:".length, -1) : displayName(rawPath)) : String(command.name),
        kind,
        ...(rawPath && !inline ? { path: rawPath } : {}),
        origin: inline ? "inline" : info.origin === "package" ? "package" : rawOrigin,
        ...(typeof info.scope === "string" ? { scope: info.scope } : {}),
        commands: [],
      };
      byKey.set(key, entry);
    }
    entry.commands.push({
      name: String(command.name),
      ...(typeof command.description === "string" && command.description.length > 0 ? { description: command.description } : {}),
    });
  }
  const order = { extension: 0, skill: 1, prompt: 2 };
  return [...byKey.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

function displayName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const file = parts[parts.length - 1] ?? path;
  // Skills are SKILL.md inside a named directory; extensions are the file itself.
  if (/^skill\.md$/i.test(file) && parts.length >= 2) return parts[parts.length - 2];
  if (/^(index|extension)\.(js|ts|mjs|cjs)$/i.test(file) && parts.length >= 2) return parts[parts.length - 2] + "/" + file;
  return file.replace(/\.(js|ts|mjs|cjs|md)$/i, "");
}

function blocksOf(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function imageCount(content: unknown): { imageCount?: number } {
  const count = blocksOf(content).filter((block) => block.type === "image").length;
  return count > 0 ? { imageCount: count } : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function toJson(value: unknown, depth = 0): JsonValue {
  if (depth > 12) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => toJson(item, depth + 1));
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = toJson(item, depth + 1);
    return output;
  }
  return value === undefined ? null : String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePiCliPath(): string {
  // The published Pi package ships the CLI bundle beside its main module.
  // Keeping resolution here means the rest of the Host does not know how Pi
  // is installed (npm, pnpm, or a future vendored adapter).
  const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(packageEntry), "bundle", "cli.js");
}
