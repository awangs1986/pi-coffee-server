import {MishuStateError} from './mishu-state.js';
import {readReleaseCommit} from '../shared/release.js';
import {runLifecycle} from '../shared/run-lifecycle.js';
import {MishuCoordinator} from './mishu.js';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import type {GitHubAccounts} from './github-accounts.js';
import {join} from "node:path";
import {ConversationIndex,ConversationIndexError} from "./conversation-index.js";
import {takeoverId,type TakeoverState} from "./takeover.js";

import type { RunnerManager } from "./runners.js";
import { createHash, randomUUID } from "node:crypto";
import { SkillManager, type SkillManagerOptions } from "./skills.js";
import { capabilitiesFor } from "../shared/protocol.js";
import type { PiRuntimeStatus } from './pi-runtime.js';
import { readJson, json } from "../shared/http.js";
import type { Workspaces } from "./workspaces.js";

import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  decodeClientFrame,
  parseAgentEngine,
  encodeFrame,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  type ClientFrame,
  type HistoryEntry,
  type JsonValue,
  type ServerFrame,
} from "../shared/protocol.js";

import { normalizeUsername, USER_HEADER, taskNamespace } from "../shared/identity.js";

import { PI_ONLY_ENGINES, type AgentSessionFactory as PiSessionFactory } from "./agent-adapter.js";

import { HostSession, HostSessionRegistry, SessionBusyError, type SessionSink } from "./session.js";
import type { TransferServer } from "./transfer.js";
import { inspectExecutionCapability, type ExecutionCapability } from "./execution-capability.js";

/**
 * Everything that is private to one Browser User inside the shared User VM:
 * the Pi factory (its own cwd and session store) and the directory uploads
 * land in. Pi's model account (agent dir / auth) is deliberately not part of
 * this: the VM is logged in once and every user's Pi shares that login.
 */
export interface UserScope {
  factory: PiSessionFactory;
  /** Root for this user's inbox / downloads; the transfer server's workdir when omitted. */
  workdir?: string;
  workspaces?: Workspaces;
  skills?: SkillManagerOptions;
  githubAccounts?: GitHubAccounts;
  runners?: RunnerManager;
  sshme?: RunnerManager;
}

export interface HostServerOptions {
  releaseDir?:string;
  runtimeStatus?: () => PiRuntimeStatus;
  host?: string;
  port?: number;
  token?: string;
  /** Factory for connections that carry no user identity (single-user / local smoke). */
  factory: PiSessionFactory;
  /**
   * Per-user isolation inside the one Host (ADR-0010). Called once per Gitea
   * login name the Web Server forwards; the returned scope is cached. When
   * omitted, every connection shares `factory`.
   */
  scopeForUser?: (user: string) => UserScope | Promise<UserScope>;
  /**
   * Refuse connections that carry no user identity. Multi-user deployments
   * set this so a misconfigured Web Server cannot open the shared root scope.
   */
  requireUser?: boolean;
  /** Existing saved coordination scopes; recovery starts only after runtime HTTP listens. */
  savedMishuScopes?: () => AsyncIterable<string | undefined>;
  sharedSkillOwner?: string;
  eventBufferSize?: number;
  /** Stop idle Pi processes after this long; the conversation stays in Pi's session store. */
  idleTimeoutMs?: number;
  /** LocalSend v2 transfer endpoint on the User VM; browsers are told about it after `opened`. */
  transfer?: TransferServer;
  workspaces?: Workspaces;
  skills?: SkillManagerOptions;
  githubAccounts?: GitHubAccounts;
  runners?: RunnerManager;
  sshme?: RunnerManager;

  /** Poll interval for turns driven outside this Host (terminal take-over); default 3 s. */
  externalPollMs?: number;
  /** Deadline for auxiliary native reads; they never occupy the task command queue. */
  metadataTimeoutMs?: number;
  /** Durable display index; defaults to the user workspace metadata directory. */
  conversationIndexRoot?: string;
  syncProtocolV2?: boolean;
}

/** A user's registry plus the bookkeeping the server keeps beside it. */
interface UserSlot {
  mishu?:MishuCoordinator;
  user: string | undefined;
  workdir?: string;
  factory: PiSessionFactory;
  registry: HostSessionRegistry;
  index?: ConversationIndex;
  broadcastTimer?: ReturnType<typeof setTimeout>;
  workspaces?: Workspaces;
  skills?: SkillManager;
  githubAccounts?: GitHubAccounts;
  runners?: RunnerManager;
  sshme?: RunnerManager;
  lifecycleLocks: Set<string>;
  workspaceReads: Map<string, Promise<unknown>>;

}

export interface HostAddress {
  host: string;
  port: number;
}

/**
 * Private WebSocket listener for User VM sessions.  It owns no Pi details;
 * those live behind PiSessionFactory.
 */
export class HostServer {
  private readonly host: string;
  private readonly port: number;
  private readonly token?: string;
  private readonly factory: PiSessionFactory;
  private readonly scopeForUser?: (user: string) => UserScope | Promise<UserScope>;
  private readonly requireUser: boolean;
  private readonly sharedSkillOwner?:string;
  private readonly registryOptions: { eventBufferSize?: number; idleTimeoutMs?: number; externalPollMs?: number };
  /** Key: normalised user name, or "" for identity-less connections. */
  private readonly slots = new Map<string, Promise<UserSlot>>();
  private readonly taskPreparations = new Set<Promise<void>>();
  private readonly transferTargets = new Map<string, { slot: Promise<UserSlot>; sessionId: string }>();
  private readonly transfer?: TransferServer;
  private readonly http: HttpServer;
  private readonly mishuHttp: HttpServer;
  private readonly sockets = new Set<HostSocket>();
  private readonly wsServer: WebSocketServer;
  private started = false;
  private closing = false;
  private closePromise?: Promise<void>;
  private savedScopeRecovery?:Promise<void>;
  private readonly apiOperations = new Set<Promise<void>>();
  private readonly backgroundOperations = new Set<Promise<unknown>>();
  private readonly workspaces?: Workspaces;
  private execution?:ExecutionCapability;
  private readonly skillsOptions?: SkillManagerOptions;
  private readonly githubAccounts?: GitHubAccounts;
  private readonly runners?: RunnerManager;
  private readonly sshme?: RunnerManager;
  private readonly conversationIndexRoot?:string;
  private readonly syncV2Enabled:boolean;

  constructor(private readonly options: HostServerOptions) {
    this.conversationIndexRoot=options.conversationIndexRoot;
    this.syncV2Enabled=options.syncProtocolV2??process.env.PI_COFFEE_SYNC_V2!=="off";
    this.factory = options.factory;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 8788;
    this.token = options.token;
    this.transfer = options.transfer;

    this.factory = options.factory;
    this.scopeForUser = options.scopeForUser;
    this.requireUser = options.requireUser === true;
    this.sharedSkillOwner = options.sharedSkillOwner;
    this.workspaces = options.workspaces;
    this.skillsOptions = options.skills;
    this.githubAccounts=options.githubAccounts;
    this.runners = options.runners; this.sshme = options.sshme;
    this.registryOptions = {

      eventBufferSize: options.eventBufferSize,
      ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
      ...(options.externalPollMs === undefined ? {} : { externalPollMs: options.externalPollMs }),
    };
    const handleRequest = (request:IncomingMessage, response:import("node:http").ServerResponse) => {
      if(this.closing){json(response,503,{error:"Host is stopping"});return;}
      if(request.url?.startsWith("/api/")) {
        const operation=this.handleApi(request,response).catch(()=>{if(!response.headersSent)json(response,500,{error:"Host operation failed"});else response.destroy();});
        this.apiOperations.add(operation);
        void operation.then(()=>this.apiOperations.delete(operation),()=>this.apiOperations.delete(operation));
        return;
      }
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, role: "host", runtime:options.runtimeStatus?.(), protocolVersion: PROTOCOL_VERSION, capabilities:{giteaCheckouts:Boolean(this.workspaces),chatWorkspaces:Boolean(this.workspaces),ownerEnvironment:this.execution?.ownerEnvironment ?? false,passwordlessRoot:this.execution?.passwordlessRoot ?? false} }));
        return;
      }
      response.writeHead(404);
      response.end();
    };
    this.http = createServer(handleRequest);
    this.mishuHttp = createServer((request,response)=>{
      if(request.url!=='/api/mishu/runtime'){json(response,404,{error:'Not found'});return;}
      handleRequest(request,response);
    });
    this.wsServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
    this.http.on("upgrade", (request, socket, head) => this.handleUpgrade(request, socket, head));
    this.wsServer.on("connection", (socket, request) => {

      // The user name was validated during the upgrade; a connection without
      // one belongs to the identity-less (single-user) slot.
      const user = normalizeUsername(request.headers[USER_HEADER]);
      const slot = this.slotFor(user);
      const hostSocket = new HostSocket(socket, slot, this.transfer, (scope, sessionId) => {
        this.transferTargets.set(scope, { slot, sessionId });
      }, options.metadataTimeoutMs ?? 10000,this.syncV2Enabled,work=>this.trackBackground(work));
      this.sockets.add(hostSocket);
      hostSocket.onClose = () => this.sockets.delete(hostSocket);
    });
  }

  async mishuRuntime(user:string|undefined,id:string):Promise<{extensions:string[];env:Record<string,string>}> {
    const slot=await this.slotFor(user);if(!slot.mishu)return {extensions:[],env:{}};
    const task=await slot.workspaces?.lookup(id);if(!task||task.workspaceKind!=='chat'||(task.engine??'pi')!=='pi')return {extensions:[],env:{}};
    const extension=this.mishuExtension();if(!extension)return {extensions:[],env:{}};
    const address=this.mishuHttp.address();if(!address||typeof address==='string')throw Error('MISHU local interface is not listening');
    try{const env=await slot.mishu.environment(id,`http://127.0.0.1:${address.port}/api/mishu/runtime`);
      return {extensions:env.PI_COFFEE_MISHU_TOKEN?[extension]:[],env};
    }catch(error){if(error instanceof MishuStateError)return {extensions:[],env:{}};throw error;}
  }
  private mishuExtension():string|undefined {
    if(this.options.runtimeStatus?.().mode==='emergency')return undefined;
    try{return dirname(createRequire(import.meta.url).resolve('pi-coffee-mishu/package.json'));}catch{return undefined;}
  }
  private async handleApi(req: IncomingMessage, res: import("node:http").ServerResponse) {
    if(req.url==='/api/mishu/runtime'){
      if(req.method!=='POST'){json(res,405,{error:'Use POST'});return;}
      const token=req.headers.authorization?.replace(/^Bearer /,'')??'';
      const slots=await Promise.all([...this.slots.values()]);
      const slot=slots.find(s=>s.mishu?.accepts(token));
      if(!slot?.mishu){json(res,401,{error:'Invalid MISHU capability'});return;}
      try{json(res,200,await slot.mishu.runtime(token,await readJson(req,32768)));}catch(e){json(res,409,{error:e instanceof Error?e.message:'MISHU operation failed'});}return;
    }
    if(!this.token || req.headers.authorization !== `Bearer ${this.token}`) {json(res,401,{error:"Unauthorized"});return;}
    const rawUser=req.headers[USER_HEADER], user=normalizeUsername(rawUser);
    if ((rawUser!==undefined && !user) || (!user && this.requireUser)) {json(res,400,{error:"Valid user identity required"});return;}
    let slot:UserSlot;
    try {slot=await this.slotFor(user);} catch {json(res,503,{error:"User scope unavailable"});return;}
    if(req.url==='/api/mishu'){
      if(req.method!=='POST'){json(res,405,{error:'Use POST'});return;}
      if(!slot.mishu||!this.mishuExtension()){json(res,503,{error:'MISHU plugin is not installed on this Host'});return;}
      try{
        const input=await readJson(req,32768);
        if(typeof input.id!=='string'||!input.id||input.id.length>128)throw Error('Select a Pi Chat first');
        let result:unknown;
        if(input.action==='status')result=await slot.mishu.status(input.id);
        else if(input.action==='select'&&typeof input.selected==='boolean'){
          result=await slot.mishu.select(input.id,input.selected);
          for(const socket of this.sockets)if(socket.user===user&&socket.sessionId===input.id)socket.close();
        }else throw Error('Use /mishu-setup explicitly inside the selected Chat');
        json(res,200,result);
      }catch(e){json(res,409,{error:e instanceof Error?e.message:'MISHU operation failed'});}return;
    }
    const readUrl=new URL(req.url??'/', 'http://host');
    const syncRoute=/^\/api\/conversations\/([^/]+)\/(meta|page|changes|content|commands)$/.exec(readUrl.pathname);
    if(syncRoute){
      res.setHeader('cache-control','no-store');
      if(req.method!=='GET'){json(res,405,{error:'Use GET'});return;}
      if(!slot.index||!this.syncV2Enabled){json(res,503,{error:'sync_unavailable'});return;}
      try {
        const id=decodeURIComponent(syncRoute[1]);if(!id||id.length>256||/[\/\\\x00]/.test(id)){json(res,400,{error:'invalid_conversation'});return;}
        if(slot.workspaces && ((!await slot.workspaces.lookup(id)&&!slot.registry.get(id))||await slot.workspaces.isArchived(id))){json(res,404,{error:'conversation_unavailable'});return;}
        const args=Object.fromEntries(readUrl.searchParams);if(args.cursor?.length>4096){json(res,400,{error:'invalid_cursor'});return;}
        let value:unknown;
        if(syncRoute[2]==='meta')value=await slot.index.meta(id);
        else if(syncRoute[2]==='page')value=await slot.index.page(id,args);
        else if(syncRoute[2]==='changes')value=await slot.index.changes(id,args);
        else if(syncRoute[2]==='commands')value=await slot.index.commands(id,args);
        else value=await slot.index.content(id,args);
        json(res,200,value);
      }catch(error){const code=error instanceof ConversationIndexError?error.code:'index_unavailable';json(res,['reset_required','entity_changed','entity_deleted','conversation_deleted'].includes(code)?409:code.startsWith('invalid')||code==='limit_too_small'?400:503,{error:code,...(error instanceof ConversationIndexError?error.meta:{})});}
      return;
    }
    if(req.url === "/api/revoke-files" && req.method === "POST") {for(const [grant,target] of this.transferTargets)if(await target.slot===slot){await this.transfer?.revoke(grant);this.transferTargets.delete(grant);}json(res,200,{ok:true});return;}
    if(req.url === '/api/release' && req.method === 'GET') {json(res,200,{hostBackendCommit:await readReleaseCommit(this.options.releaseDir??process.cwd())});return;}
    if(req.url === '/api/runtime' && req.method === 'GET') {
      json(res,200,this.options.runtimeStatus?.() ?? {mode:'normal'});return;
    }
    if(req.url === "/api/engines" && req.method === "GET") {
      try { json(res,200,{runtime:this.options.runtimeStatus?.(),engines:await slot.factory.engines?.() ?? PI_ONLY_ENGINES,takeover:Boolean(slot.factory.prepareTakeover),clearChatContext:Boolean(slot.factory.prepareContextReset),forkModes:Object.fromEntries(["pi","codex","claude","cursor","grok"].map(engine=>[engine,slot.factory.forkModes?.(engine as "pi"|"codex"|"claude"|"cursor"|"grok")??[]]))}); }
      catch { json(res,503,{error:"Agent discovery unavailable"}); }
      return;
    }
    if(req.url === '/api/github-accounts') {
      if(!slot.githubAccounts){json(res,404,{error:'GitHub account management is unavailable'});return;}
      if(req.method!=='POST'){json(res,405,{error:'Use POST'});return;}
      try {json(res,200,await slot.githubAccounts.handle(await readJson(req)));}
      catch {json(res,409,{error:'GitHub authorization failed; check the account or reconnect it'});}return;
    }
    if(req.url === "/api/runners" || req.url === "/api/sshme") {
      const manager=req.url === "/api/sshme" ? slot.sshme : slot.runners;
      if(!manager){json(res,404,{error:"Runner management is unavailable on this Host"});return;}
      if(req.method!=="POST"){json(res,405,{error:"Use POST for scoped runner requests"});return;}
      try {const input=await readJson(req);const selected=req.url==='/api/sshme'?manager.forConversation(input.conversationId):manager;json(res,200,await selected.handle(input));}
      catch(error){json(res,409,{error:error instanceof Error ? error.message : "Runner operation failed"});}
      return;
    }
    if(req.url === "/api/skills") {
      if(!slot.skills){json(res,404,{error:"Skill management is not configured on this Host"});return;}
      if(req.method!=="POST"){json(res,405,{error:"Use POST for scoped Skill requests"});return;}
      try {
        const input=await readJson(req);
        if(input.scope==='user' && user && user!==this.sharedSkillOwner){json(res,403,{error:'Machine-wide Skills are managed by the VM owner; select project scope for task Skills'});return;}
        if(input.action==='reload') {
          const id=input.conversationId,task=typeof id==='string'?await slot.workspaces?.lookup(id):undefined;
          if(!task || task.archived || (task.engine??'pi')!==input.engine)throw new Error('Select an active Task using this Agent');
          await slot.skills.handle({...input,action:'list'});
          if(slot.lifecycleLocks.has(id))throw new Error('Task lifecycle operation in progress');
          slot.lifecycleLocks.add(id);
          try {
            const live=slot.registry.get(id);
            if(live){
              if(live.isBusy)throw new Error('Wait for the running task before reloading Skills');
              const state=await live.backgroundState();if(!state.known || state.active)throw new Error('Background work is active or unknown; the Agent was not stopped');
              await slot.registry.stopIdle(id);
              for(const socket of this.sockets)if(socket.user===slot.user && socket.sessionId===id)socket.close();
            }
            json(res,200,{ok:true,reloaded:Boolean(live),activation:'Skills will be discovered when the Agent next opens; conversation history is retained.'});
          }finally{slot.lifecycleLocks.delete(id);}
        } else if(input.scope==='project' && ['install','update','enable','disable','disable_native','restore_native'].includes(input.action)) {
          const id=input.conversationId;
          if(typeof id!=='string' || slot.lifecycleLocks.has(id))throw new Error('Project lifecycle operation in progress');
          slot.lifecycleLocks.add(id);
          try {
            const live=slot.registry.get(id);
            if(live){if(live.isBusy)throw new Error('Wait for the running task before changing project Skills');const state=await live.backgroundState();if(!state.known||state.active)throw new Error('Project has active or unknown background work');}
            json(res,200,await slot.skills.handle(input));
          }finally{slot.lifecycleLocks.delete(id);}
        } else json(res,200,await slot.skills.handle(input));
      }
      catch(e){json(res,409,{error:e instanceof Error?e.message:"Skill operation failed"});}
      return;
    }
    const ws=slot.workspaces;
    if(!ws || req.url!=="/api/workspace") {json(res,404,{error:"Project workspace mode is not configured"});return;}
    let locked: string | undefined;
    try {
      if(req.method === "GET") {json(res,200,await ws.list());return;}
      if(req.method!=="POST") {json(res,405,{error:"Method not allowed"});return;}
      const input=await readJson(req);
      if(input.action==='clear_chat_context'){
        const id=input.id;
        if(typeof id!=='string'||!id||id.length>200||typeof input.expectedNativeId!=='string'||!input.expectedNativeId||input.expectedNativeId.length>200||typeof input.operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId))throw new Error('Invalid context reset request');
        const task=await ws.lookup(id);
        if(!task||task.workspaceKind!=='chat'||(task.engine??'pi')!=='pi'||task.archived||task.creationState!=='ready'||task.workspaceRemoved||task.cleanupStarted||task.fork&&task.fork.status!=='completed')throw new Error('Only an active Pi Chat can clear context');
        if(slot.lifecycleLocks.has(id))throw new Error('Task lifecycle operation in progress');
        if(task.contextReset?.id===input.operationId){json(res,200,task);return;}
        if((task.nativeBinding?.id??id)!==input.expectedNativeId)throw new Error('Context changed; refresh before clearing');
        if(!slot.factory.prepareContextReset)throw new Error('Chat context reset unavailable on this Host');
        slot.lifecycleLocks.add(id);locked=id;
        const session=(await slot.registry.open(id)).session;
        if(session.isBusy||session.pendingUiRequests.length)throw new Error('Finish running and queued instructions before clearing context');
        const history=await session.getHistory();
        if(!history.entries.length){json(res,200,task);return;}
        const listing=(await slot.registry.list()).find(row=>row.id===id);
        await slot.mishu?.revokeConversation(id);
        await session.clearContext({id:input.operationId,expectedNativeId:input.expectedNativeId,title:listing?.name||listing?.preview||'Chat'});
        const changed=await ws.lookup(id),source=await slot.factory.readHistory?.(id);
        await slot.index?.reconcile(id,[],{binding:source?.binding??`pi:${changed!.nativeBinding!.id}:original`,sourceGeneration:source?.sourceGeneration,sourceFreshness:'current',checkedAt:new Date().toISOString()});
        for(const socket of this.sockets)if(socket.user===slot.user&&socket.sessionId===id)socket.close();
        json(res,200,changed);void this.broadcastSessions(slot);return;
      }
      if(input.action==='fork'){
        const id=input.id,targetId=input.targetId,mode=input.mode;
        if(typeof id!=='string'||typeof targetId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId)||!['native','handoff'].includes(mode))throw new Error('Invalid Fork request');
        const source=await ws.lookup(id);if(!source||source.archived||source.workspaceRemoved||source.cleanupStarted)throw new Error('Unknown or unavailable source task');
        const prior=await ws.lookup(targetId);
        if(prior){if(prior.fork?.sourceId!==id||prior.fork.mode!==mode)throw new Error('Fork request ID belongs to another operation');json(res,200,prior);return;}
        if(mode==='handoff'&&input.acceptDrift!==true)throw new Error('Confirm possible Handoff drift and model cost');
        if(!slot.factory.forkConversation||!slot.factory.forkModes?.(source.engine??'pi').includes(mode))throw new Error('This Agent does not support the selected Fork mode');
        if(slot.lifecycleLocks.has(id)||slot.lifecycleLocks.has(targetId))throw new Error('Task lifecycle operation in progress');
        slot.lifecycleLocks.add(id);slot.lifecycleLocks.add(targetId);
        try{
          const session=(await slot.registry.open(id)).session;
          const nativeState=await session.readNativeState();
          if(session.isBusy||nativeState.isStreaming||nativeState.isCompacting||session.pendingUiRequests.length)throw new Error('Finish running work, queued input, compaction and questions before Fork');
          const background=await session.backgroundState();if(!background.known||background.active)throw new Error('Background work is active or unknown');
          const history=await session.getHistory(),models=await session.getModels();
          const finalState=await session.readNativeState();if(session.isBusy||finalState.isStreaming||finalState.isCompacting||session.pendingUiRequests.length)throw new Error('Source resumed during Fork preparation');
          const listing=(await slot.registry.list()).find(row=>row.id===id);
          const title=((listing?.name||listing?.preview||history.entries.find(e=>e.kind==='user')?.text||'新对话').replace(/\s+/g,' ').trim().slice(0,140))+' · Fork';
          const target=await ws.beginFork(id,targetId,mode,title,{...(models.current?{model:{provider:models.current.provider,id:models.current.id}}:{}),thinkingLevel:models.thinkingLevel,...(models.context?{contextPreset:models.context.preset}:{})});
          const operation=(async()=>{
            try {await ws.copyForkWorkspace(targetId,history);await slot.factory.forkConversation!(id,targetId,mode,history);await ws.finishFork(targetId);}
            catch(error){await ws.finishFork(targetId,error instanceof Error?error.message:'Fork failed');}
            finally{slot.lifecycleLocks.delete(id);slot.lifecycleLocks.delete(targetId);void this.broadcastSessions(slot);}
          })();this.taskPreparations.add(operation);void operation.finally(()=>this.taskPreparations.delete(operation)).catch(()=>undefined);
          json(res,202,target);return;
        }catch(error){slot.lifecycleLocks.delete(id);slot.lifecycleLocks.delete(targetId);throw error;}
      }
      if(input.action==='github_bind'){
        const ids=(await ws.list()).conversations.filter(c=>c.projectId===input.projectId).map(c=>c.id);
        if(ids.some(id=>slot.lifecycleLocks.has(id)))throw new Error('Project lifecycle operation in progress');
        for(const id of ids)slot.lifecycleLocks.add(id);
        try {
          for(const id of ids){const live=slot.registry.get(id)??(await slot.registry.open(id)).session;if(live.isBusy)throw new Error('Finish running tasks before binding');const state=await live.backgroundState();if(!state.known||state.active)throw new Error('Background work is active or unknown');if(live.isBusy)throw new Error('Task resumed during authorization change');}
          for(const id of ids){await slot.registry.stopIdle(id);await slot.factory.resetTaskRuntime?.(id);for(const socket of this.sockets)if(socket.user===slot.user&&socket.sessionId===id)socket.close();}
          json(res,200,await ws.bindGitHubProject(input.projectId,input.accountId));
        }finally{for(const id of ids)slot.lifecycleLocks.delete(id);}return;
      }
      if(input.action==='takeover'){
        const id=input.id;
        if(typeof id!=='string'||input.acceptDrift!==true||!['pi','codex'].includes(input.engine)||!['pi','codex'].includes(input.expectedEngine))throw new Error('Confirm context drift and select Pi or Codex');
        const task=await ws.lookup(id);
        if(!task||task.workspaceKind!=='project'||task.archived||task.engine!==input.expectedEngine||task.engine===input.engine)throw new Error('Select an active Work task with an unchanged source Agent');
        if(!slot.factory.prepareTakeover)throw new Error('Agent takeover unavailable on this Host');
        if(slot.lifecycleLocks.has(id))throw new Error('Task lifecycle operation in progress');
        slot.lifecycleLocks.add(id);locked=id;
        const readiness=(await slot.factory.engines?.())?.find(e=>e.id===input.engine);if(!readiness?.available)throw new Error(readiness?.reason??'Target Agent unavailable');
        const session=(await slot.registry.open(id)).session;
        if(session.isBusy||session.pendingUiRequests.length)throw new Error('Finish running and queued instructions before switching Agent');
        const background=await session.backgroundState();if(!background.known||background.active)throw new Error('Source background work is active or unknown');
        const listing=(await slot.registry.list()).find(s=>s.id===id);
        const title=listing?.name||listing?.preview;
        const operation:TakeoverState={...(title?{title}:{}),id:takeoverId(),from:input.expectedEngine,to:input.engine,status:'preparing',at:new Date().toISOString()};
        await slot.mishu?.revokeConversation(id);
        await ws.beginTakeover(id,operation);
        // Host owns this operation after HTTP returns. A disconnected viewer never retries it.
        const takeover = session.takeover(operation).then(async()=>{
          for(const socket of this.sockets)if(socket.user===slot.user&&socket.sessionId===id)socket.close();
        }).catch(async(error)=>{
          await ws.updateTakeover(id,operation.id,{status:'failed',error:error instanceof Error?error.message:'Takeover failed'});
        }).finally(()=>{slot.lifecycleLocks.delete(id);void this.broadcastSessions(slot);}).catch(()=>console.warn('Takeover status could not be saved; inspect the task before retrying'));
        this.taskPreparations.add(takeover);
        void takeover.finally(()=>this.taskPreparations.delete(takeover));
        locked=undefined;json(res,202,operation);return;
      }
      // Reject mutating lifecycle operations while the parent is streaming. External commands remain trusted VM operations.
      const target=input.id;
      if(input.action==="conversation" || input.action==="continue") {
        const engine=parseAgentEngine(input.engine);
        const existing=target ? await ws.lookup(target) : undefined;
        if(existing && (existing.engine ?? "pi")!==engine)throw new Error("Task Agent is fixed at creation");
        if(!existing && input.action==='conversation' && input.workspaceKind==='chat' && engine!=='pi')throw new Error('Chat is available only with Pi; choose Work and a Gitea or GitHub Project for Codex or Claude Code');
        const available=(await slot.factory.engines?.() ?? PI_ONLY_ENGINES).find(item=>item.id===engine);
        if(!existing && !available?.available)throw new Error(available?.reason ?? "Agent unavailable");
      }
      if(input.action==="delete" && target) {
        const task=await ws.lookup(target);
        if(task?.takeoverSegments?.length)throw new Error("Takeover history is retained; archive this Task instead");
        if(task?.engine && task.engine!=="pi")throw new Error("Native cleanup is unavailable; Workspace and native history are retained. Archive this Task instead.");
      }
      if(target && !["files","changes","change_file","status","sidebar_move","sidebar_pin","sidebar_collapse","sidebar_display"].includes(input.action)) {
        if(slot.lifecycleLocks.has(target) || (input.action!=="archive" && slot.registry.get(target)?.isBusy))throw new Error("Stop the source conversation before changing its lifecycle");
        slot.lifecycleLocks.add(target);locked=target;
      }
      if(target && (["checkpoint","sync","pull_request","delete"].includes(input.action) || input.action==="conversation" && slot.registry.get(target))) {
        const c=await ws.lookup(target);
        if(slot.registry.get(target) || (!c?.creationState || c.creationState==='ready') && !c?.workspaceRemoved && !c?.cleanupStarted) {
          const opened=slot.registry.get(target) ?? (await slot.registry.open(target)).session;
          if(opened.isBusy)throw new Error("Source conversation is busy");
          const background=await opened.backgroundState();
          if(!background.known || background.active>0)throw new Error("Workspace has active/queued children or their status is unknown. Wait for completion, or have the VM owner inspect and reconcile interrupted native work; no task was stopped.");
          if(opened.isBusy)throw new Error("Source conversation resumed while checking background work");
          // Stop only a verified idle parent before mutating its workspace; never stop children to satisfy a lock.
          if(!c?.engine || c.engine==="pi") {
            await slot.registry.stopIdle(target);
            for(const socket of this.sockets)if(socket.user===slot.user && socket.sessionId===target)socket.close();
          }
        }
      }
      let result:unknown;
      switch(input.action) {
        case "sidebar_move": {
          if(typeof input.id!=="string" || input.id.length>200 || !input.id)throw new Error("Invalid conversation");
          if(!await ws.lookup(input.id) && !(await slot.registry.list()).some(s=>s.id===input.id))throw new Error("Unknown conversation");
          result=await ws.moveSidebar(input.id,input.projectId);break;
        }
        case "sidebar_pin": {
          if(typeof input.id!=="string"||!input.id||input.id.length>200||typeof input.pinned!=="boolean")throw new Error('Invalid pin preference');
          if(!await ws.lookup(input.id)&&!(await slot.registry.list()).some(s=>s.id===input.id))throw new Error('Unknown conversation');
          if(await ws.isArchived(input.id))throw new Error('Restore the conversation before pinning it');
          result=await ws.pinSidebar(input.id,input.pinned);break;
        }
        case "sidebar_group_create": result=await ws.createSidebarGroup(input.name);break;
        case "sidebar_group_delete": result=await ws.deleteSidebarGroup(input.groupId);break;
        case "sidebar_display": result=await ws.displaySidebar(input.showGroups);break;
        case "sidebar_collapse": result=await ws.collapseSidebar(input.projectId,input.collapsed);break;
        case "files": {
          if(!this.transfer || !await ws.lookup(input.id))throw new Error("Unknown workspace or file service unavailable");
          if(slot.lifecycleLocks.has(input.id))throw new Error("Workspace lifecycle operation in progress");
          await ws.dataRoot(input.id);
          const scope=transferScope(user,input.id);
          const token=this.transfer.issueToken(scope,slot.workdir,input.id,ws);
          this.transferTargets.set(scope,{slot:Promise.resolve(slot),sessionId:input.id});
          result={url:this.transfer.publicUrl(),sessionId:input.id,scope,token,inbox:await this.transfer.inbox(scope),maxFileBytes:this.transfer.limits.maxFileBytes,maxBatchBytes:this.transfer.limits.maxBatchBytes};break;
        }
        case "changes": result=await this.workspaceRead(slot,JSON.stringify(['changes',input.id,input.scope==='turn']),()=>input.scope==="turn" ? ws.turnChanges(input.id) : ws.changes(input.id));break;
        case "change_file": result=await ws.changeFile(input.id,input);break;
        case "status": result=await this.workspaceRead(slot,JSON.stringify(['status',input.id,input.refresh!==false]),()=>ws.syncStatus(input.id,input.refresh!==false));break;
        case "branches": result=await ws.branches(input.projectId);break;
        case "discover": result=await ws.discover();break;
        case "gitea_repos": result=await ws.giteaRepositories();break;
        case "gitea_project": result=await ws.registerGiteaProject(input.repository);break;
        case "github_repos": result=await ws.githubRepositories(input.accountId);break;
        case "github_project": result=await ws.registerGitHubProject(input.repository,input.accountId);break;
        case "project": result=await ws.createProject(input.name,input.url);break;
        case "bind_project": result=await ws.bindProjectRepository(input.projectId,input.repoUrl,input.repoId,input.webUrl);break;
        case "import": {
          if(!this.transfer || typeof input.scope!=="string" || typeof input.file!=="string")throw new Error("Upload a ZIP to a conversation inbox first");
          const target=this.transferTargets.get(input.scope);
          if(!target || await target.slot!==slot)throw new Error("Unknown upload scope");
          result=await ws.createProject(input.name,undefined,await this.transfer.importPath(input.scope,input.file));break;
        }
        case "conversation":
          if(input.workspaceKind && !['chat','project'].includes(input.workspaceKind))throw new Error('Invalid workspace kind');
          result=input.workspaceKind==='chat' ? await ws.createChatConversation(input.id,parseAgentEngine(input.engine)) : await ws.createConversation(input.projectId,input.branch,input.id,parseAgentEngine(input.engine));break;
        case "continue": result=await ws.continueFrom(input.projectId,input.sourceBranch,input.sourceSha,input.id,parseAgentEngine(input.engine));break;
        case "migration_plan": result=await ws.migrationPlan(input.id);break;
        case "migrate": result=await ws.migrateConversation(input.id);break;
        case "checkpoint": result=await ws.checkpoint(input.id,input.paths,input.message);break;
        case "sync": result=await ws.pushCheckpoint(input.id);break;
        case "pull_request": result=await ws.openPullRequest(input.id,input.title);break;
        case "archive":
        case "restore": {
          if(input.action==="archive")await slot.mishu?.revokeConversation(input.id);
          if(await ws.lookup(input.id)) result=await ws.archive(input.id,input.action==="archive",false);
          else {
            if(!(await slot.registry.list()).some(s=>s.id===input.id))throw new Error("Unknown conversation");
            result=await ws.archiveLegacy(input.id,input.action==="archive");
          }
          break;
        }
        case "delete": {
          await this.transfer?.quiesce(transferScope(user,input.id));
          // Cleanup fails closed if LSP cannot be loaded: do not delete a tree
          // that might still have a daemon using it. Basic conversations remain available.
          await (await import('pi-coffee-lsp')).stopLspDaemon(taskNamespace(user,input.id));
          if(await ws.lookup(input.id)) result=await ws.deleteWorkspace(input.id,input.confirmation,()=>slot.registry.delete(input.id),input.includeLocalFiles===true);
          else {
            if(input.id!==input.confirmation || !await ws.isArchived(input.id))throw new Error("Archive and confirm the exact conversation ID first");
            await slot.registry.delete(input.id);await ws.archiveLegacy(input.id,false);result={ok:true,retained:["legacy workspace","uploads"]};
          }
          await slot.index?.remove(input.id);
          break;
        }
        default: throw new Error("Unknown workspace action");
      }
      json(res,200,result);void this.broadcastSessions(slot);
    } catch(e) {json(res,409,{error:e instanceof Error ? e.message : "Workspace operation failed"});}
    finally {if(locked)slot.lifecycleLocks.delete(locked);}

  }

  /**
   * The registry for one user, created on first contact. Each user's sidebar
   * mirrors only that user's store: list pushes stay inside the slot.
   */
  private slotFor(user: string | undefined): Promise<UserSlot> {
    const key = user ?? "";
    const existing = this.slots.get(key);
    if (existing) return existing;
    const created = (async (): Promise<UserSlot> => {
      const scope: UserScope = user !== undefined && this.scopeForUser !== undefined
        ? await this.scopeForUser(user)
        : { factory: this.factory, githubAccounts:this.githubAccounts, workspaces: this.workspaces, skills: this.skillsOptions, runners: this.runners, sshme: this.sshme };
      const indexRoot=scope.workspaces?join(scope.workspaces.root,'.coffee','conversation-index'):this.conversationIndexRoot;
      const index=indexRoot?new ConversationIndex({root:indexRoot,userScope:key,factory:scope.factory,onChange:meta=>{for(const socket of this.sockets)if(socket.user===user&&socket.sessionId===meta.conversationId)socket.send({v:1,type:'sync_changed',sessionId:meta.conversationId,conversationId:meta.conversationId,bindingEpoch:meta.bindingEpoch,headRevision:meta.headRevision,sourceFreshness:meta.sourceFreshness});}}):undefined;
      const lifecycleLocks=new Set<string>();
      const mishu=scope.workspaces?new MishuCoordinator(join(scope.workspaces.root,'.coffee','mishu'),scope.workspaces,lifecycleLocks):undefined;
      const registry = new HostSessionRegistry({ factory: scope.factory, ...this.registryOptions, runnerGuidance:scope.runners&&scope.workspaces?async id=>(await scope.workspaces!.lookup(id))?.workspaceKind==='project'?scope.runners!.guidance():undefined:undefined, onEvent:(id,event)=>{
        index?.event(id,event);mishu?.event(id,event);
        const status=event&&typeof event==='object'&&!Array.isArray(event)?runLifecycle(event.type):undefined;
        if(status&&scope.workspaces)void this.trackBackground(scope.workspaces.recordRunStatus(id,status)).then(()=>this.broadcastSessions(slot),()=>console.warn('Run status could not be saved'));
      },onCommand:async(id,requestId,state,mode)=>{await mishu?.command(id,requestId,state,mode);await index?.command(id,requestId,state,mode);}, ...(scope.workspaces ? {runStatuses:()=>scope.workspaces!.runStatuses(),onHistory:async(id,history)=>{await scope.workspaces!.exportHistory(id,history);index?.scheduleAudit(id,true);},onRun:async(id,state,requestId)=>{await this.trackBackground(scope.workspaces!.markRun(id,state,requestId));}} : {}) });
      mishu?.attach(registry);
      const slot: UserSlot = { user, mishu, githubAccounts:scope.githubAccounts, index, factory: scope.factory, registry, workspaces:scope.workspaces, runners:scope.runners, sshme:scope.sshme, skills:scope.skills ? new SkillManager(scope.skills,scope.workspaces) : undefined, lifecycleLocks, workspaceReads:new Map(), ...(scope.workdir === undefined ? {} : { workdir: scope.workdir }) };
      registry.onChange((session) => {
        if(this.closing)return;
        this.broadcastSessions(slot);
        if(session?.wasInterrupted&&slot.workspaces) void this.trackBackground(slot.workspaces.markRun(session.id,"interrupted")).catch(()=>undefined);
        if(slot.workspaces)void this.trackBackground(slot.workspaces.settleRuns(id=>registry.get(id)?.wasInterrupted ? undefined : registry.get(id)?.isBusy)).catch(()=>undefined);
      });
      return slot;
    })();
    this.slots.set(key, created);
    created.catch(() => this.slots.delete(key));
    return created;
  }

  private workspaceRead(slot: UserSlot, key: string, read: () => Promise<unknown>): Promise<unknown> {
    const existing = slot.workspaceReads.get(key);
    if (existing) return existing;
    const pending = read().finally(() => { slot.workspaceReads.delete(key); });
    slot.workspaceReads.set(key, pending);
    return pending;
  }

  private trackBackground<T>(work:Promise<T>):Promise<T> {
    this.backgroundOperations.add(work);
    void work.then(()=>this.backgroundOperations.delete(work),()=>this.backgroundOperations.delete(work));
    return work;
  }

  private broadcastSessions(slot: UserSlot): void {
    if (this.closing || slot.broadcastTimer !== undefined) return;
    slot.broadcastTimer = setTimeout(() => {void this.trackBackground((async () => {
      slot.broadcastTimer = undefined;
      const targets = [...this.sockets].filter((socket) => socket.user === slot.user);
      if (targets.length === 0) return;
      try {
        const sessions = await slot.registry.list();
        for (const socket of targets) socket.send({ v: 1, type: "sessions", sessions });
      } catch {
        // Listing is best-effort; the browser can still ask explicitly.
      }
    })());}, 150);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.execution=await inspectExecutionCapability();
    // Fail closed: the Host transport carries prompts and Pi events. Without a
    // bearer token, anything that can reach the port owns the User VM's Pi.
    // Loopback-only binds are the documented local smoke exception.
    if (!isLoopback(this.host) && (this.token === undefined || this.token.length === 0)) {
      throw new Error(
        `Refusing to bind the Host to ${this.host} without PI_COFFEE_HOST_TOKEN; set a transport token or bind to 127.0.0.1`,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.http.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.http.off("error", onError);
        resolve();
      };
      this.http.once("error", onError);
      this.http.once("listening", onListening);
      this.http.listen(this.port, this.host);
    });
    try {
      await new Promise<void>((resolve,reject)=>{
        const failed=(error:Error)=>reject(error);
        this.mishuHttp.once('error',failed);
        this.mishuHttp.listen(0,'127.0.0.1',()=>{this.mishuHttp.off('error',failed);resolve();});
      });
    }catch(error){await new Promise<void>(resolve=>this.http.close(()=>resolve()));throw error;}
    this.started = true;
    if(this.options.savedMishuScopes)this.savedScopeRecovery=this.recoverSavedMishuScopes();
  }

  private async recoverSavedMishuScopes():Promise<void> {
    try {
      for await(const user of this.options.savedMishuScopes!()){
        if(this.closing)break;
        if(user!==undefined&&(!this.scopeForUser||normalizeUsername(user)!==user))continue;
        try {
          const slot=await this.slotFor(user);
          // Load one scoped store at a time; model notification work remains
          // serial per secretary through the existing coordinator scheduler.
          await slot.mishu?.recoveryReady();
        }catch{console.warn('[pi-coffee] MISHU saved-scope recovery unavailable; stored state retained, other scopes continue.');}
      }
    }catch{console.warn('[pi-coffee] MISHU saved-scope discovery unavailable; stored state retained.');}
  }

  address(): HostAddress {
    const address = this.http.address();
    if (address === null || typeof address === "string") {
      throw new Error("HostServer is not listening");
    }
    return { host: this.host, port: address.port };
  }

  /** Publish a Host-originated event (transfer progress, …) to a live Session's browsers. */
  announce(scope: string, event: JsonValue): void {
    const target = this.transferTargets.get(scope);
    if (target) void target.slot.then((slot) => slot.registry.get(target.sessionId)?.announce(event)).catch(() => undefined);
  }

  close(): Promise<void> {
    if (!this.started) return Promise.resolve();
    return this.closePromise ??= this.finishClose().finally(() => { this.closePromise = undefined; });
  }

  private async finishClose(): Promise<void> {
    this.closing = true;
    const httpClosed = Promise.all([this.http,this.mishuHttp].map(server=>new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());})));
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    // A disconnected HTTP client does not cancel its workspace mutation. Wait
    // for its finally block to release the durable lock before main exits.
    await Promise.allSettled([...this.apiOperations]);
    // Startup discovery may be awaiting a scope constructor. Fence its iterator
    // before taking the registry snapshot so shutdown also owns that last slot.
    await this.savedScopeRecovery;
    const slots = await Promise.allSettled([...this.slots.values()]);
    this.slots.clear();
    this.transferTargets.clear();
    for (const slot of slots) {
      if (slot.status !== "fulfilled") continue;
      if (slot.value.broadcastTimer !== undefined) clearTimeout(slot.value.broadcastTimer);
      // Cancel reconstruction before waiting for takeover recovery. The registry
      // remains owned until that recovery finishes, including a reopened source.
      await slot.value.factory.cancelTakeovers?.().catch(() => undefined);
    }
    await Promise.allSettled([...this.taskPreparations]);
    for (const slot of slots) {
      if (slot.status !== "fulfilled") continue;
      await slot.value.mishu?.close();
      await slot.value.registry.close();
    }
    // Detaching a browser does not cancel a started open, metadata read or
    // workspace bookkeeping callback. Stop native sessions first so their RPCs
    // can settle, then drain those owned operations before releasing the index.
    // Native model-turn promises are owned by the sessions, never this queue.
    while(this.backgroundOperations.size)await Promise.allSettled([...this.backgroundOperations]);
    for (const slot of slots) {
      if (slot.status !== "fulfilled") continue;
      await slot.value.index?.close();
      await slot.value.factory.close?.().catch(() => undefined);
    }
    this.wsServer.close();
    await httpClosed;
    this.started = false;
    this.closing = false;
  }

  private handleUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
    if (this.closing) { socket.destroy(); return; }
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    if (requestUrl.pathname !== "/host") {
      socket.destroy();
      return;
    }
    if (!isAuthorized(request, this.token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    // A forwarded identity must be a safe directory segment; fail closed
    // rather than mapping a strange name onto the wrong user's data.
    const rawUser = request.headers[USER_HEADER];
    if ((rawUser !== undefined && normalizeUsername(rawUser) === undefined) || (rawUser === undefined && this.requireUser)) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
      this.wsServer.emit("connection", websocket, request);
    });
  }
}

class HostSocket implements SessionSink {
  private readonly socket: WebSocket;
  private readonly slot: Promise<UserSlot>;
  private readonly transfer?: TransferServer;
  /** Resolved from `slot` before the first frame is handled. */
  private registry!: HostSessionRegistry;
  private factory!:PiSessionFactory;
  private mishu?:MishuCoordinator;
  private workdir?: string;
  private workspaces?: Workspaces;
  private lifecycleLocks = new Set<string>();
  user: string | undefined;
  private session?: HostSession;
  private opened = false;
  private closed = false;
  private listing=false;
  private readonly metadataReads=new Map<string,Promise<ServerFrame>>();
  private metadataEpoch=0;
  private syncProtocol?:2;
  private bindingEpoch?:string;
  private index?:ConversationIndex;
  private messageQueue: Promise<void>;
  private urgentControls=0;
  onClose: () => void = () => undefined;


  constructor(socket: WebSocket, slot: Promise<UserSlot>, transfer?: TransferServer, private readonly registerTransfer?: (scope: string, sessionId: string) => void, private readonly metadataTimeoutMs=10000,private readonly syncV2Enabled=true,private readonly trackOperation:(work:Promise<unknown>)=>void=()=>undefined) {

    this.socket = socket;
    this.slot = slot;
    this.transfer = transfer;
    // Frames queue behind the slot so a user's very first connection cannot
    // race its own registry creation.
    this.messageQueue = this.slot.then((resolved) => {
      this.user = resolved.user;
      this.registry = resolved.registry;this.index=resolved.index;
      this.factory=resolved.factory;this.mishu=resolved.mishu;
      this.workdir = resolved.workdir;
      this.workspaces = resolved.workspaces;
      this.lifecycleLocks = resolved.lifecycleLocks;
    }).catch((error) => {
      this.send({ v: 1, type: "error", code: "user_unavailable", message: error instanceof Error ? error.message : "User scope unavailable", fatal: true });
      this.close();
    });
    socket.on("message", (data) => {
      if(this.closed)return;
      let decoded:ClientFrame|undefined;
      const receivedGeneration=this.session?.commandGeneration;
      // Stop and pending answers must not queue behind durable prompt acceptance.
      // The normal handler still enforces identity, lifecycle and pending-request checks.
      if(this.opened&&!this.closed){
        try {
          const frame=decodeClientFrame(rawDataToBytes(data));decoded=frame;
          if(frame.type==='abort'||frame.type==='ui_response'){
            if(this.urgentControls>=16){this.send({v:1,type:'error',code:'control_busy',message:'Too many pending control requests',...rid(frame)});return;}
            this.urgentControls++;
            this.trackOperation(this.handleMessage(data,frame).finally(()=>{this.urgentControls--;}));return;
          }
        }catch{/* The ordered decoder reports malformed input consistently. */}
      }
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data,decoded,receivedGeneration)).catch(() => undefined);
      this.trackOperation(this.messageQueue);
    });
    socket.on("close", () => void this.detach());
    socket.on("error", () => void this.detach());
  }

  get sessionId():string|undefined {return this.session?.id;}

  send(frame: ServerFrame): void {
    if(frame.type==='sync_changed'&&this.syncProtocol!==2)return;
    if(frame.type==='sync_changed'&&this.bindingEpoch&&frame.bindingEpoch!==this.bindingEpoch){this.send({v:1,type:'error',code:'binding_changed',message:'Conversation binding changed. Reopen to continue.',fatal:true});this.close();return;}
    if(this.syncProtocol===2&&this.session&&this.bindingEpoch)frame={...frame,conversationId:this.session.id,bindingEpoch:this.bindingEpoch};
    if(this.syncProtocol===2&&frame.type==='event'&&frame.event&&typeof frame.event==='object'&&!Array.isArray(frame.event)&&['sync_entity','message_start','message_update','message_end','message_delta','message_completed','tool_update','tool_execution_start','tool_execution_update','tool_execution_end'].includes(String(frame.event.type)))return;
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(encodeFrame(frame));
    } catch {
      void this.detach();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.close();
    void this.detach();
  }

  /** Auxiliary reads share work, have a deadline, and cannot block prompts or answers. */
  private readMetadata(frame:ClientFrame,key:string,run:()=>Promise<ServerFrame>):void {
    const target=this.session,epoch=this.metadataEpoch;
    const scopedKey=epoch+':'+key;
    let read=this.metadataReads.get(scopedKey);
    if(!read){
      if(this.metadataReads.size>=16){this.send({v:1,type:'error',code:'metadata_unavailable',operation:frame.type,message:'Too many pending metadata reads',...rid(frame)});return;}
      let timer:ReturnType<typeof setTimeout>;
      const work=Promise.resolve().then(run);
      this.trackOperation(work);
      read=Promise.race([work,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('Auxiliary Agent read timed out')),this.metadataTimeoutMs);timer.unref();
      })]);
      this.metadataReads.set(scopedKey,read);
      // Keep the shared entry until the actual read settles, even after the deadline.
      // Repeated polls must not accumulate underlying reads if an adapter hangs.
      void work.then(()=>{clearTimeout(timer);this.metadataReads.delete(scopedKey);},()=>{clearTimeout(timer);this.metadataReads.delete(scopedKey);});
    }
    void read.then(value=>{
      if(this.session===target&&this.metadataEpoch===epoch)this.send({...value,...rid(frame)});
    },error=>{
      if(this.session===target&&this.metadataEpoch===epoch)this.send({v:1,type:'error',code:'metadata_unavailable',operation:frame.type,message:error instanceof Error?error.message:'Auxiliary Agent read failed',...rid(frame)});
    });
  }

  private async handleMessage(data: RawData,decoded?:ClientFrame,receivedGeneration?:number): Promise<void> {
    if (this.closed || this.registry === undefined) return;
    let frame: ClientFrame;
    try {
      frame = decoded??decodeClientFrame(rawDataToBytes(data));
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: error instanceof Error && "code" in error ? String(error.code) : "invalid_frame",
        message: error instanceof Error ? error.message : "Invalid frame",
        fatal: true,
      });
      this.socket.close(1008, "invalid frame");
      return;
    }

    try {
      if(frame.type==='prompt'&&receivedGeneration!==undefined)this.session?.assertCommandGeneration(receivedGeneration);
      if(this.syncProtocol===2&&this.session&&!['open','list_sessions','close'].includes(frame.type)){
        if(frame.conversationId!==this.session.id||frame.bindingEpoch!==this.bindingEpoch)throw new Error('Conversation identity changed; reopen before sending this command');
      }
      if(((this.session&&this.lifecycleLocks.has(this.session.id))||('sessionId' in frame&&typeof frame.sessionId==='string'&&this.lifecycleLocks.has(frame.sessionId)))&&!["list_sessions","get_state","get_queue"].includes(frame.type))throw new Error("Task lifecycle operation in progress");
      switch (frame.type) {
        case "open":
          await this.open(frame);
          break;
        case "list_sessions":
          // Allowed before open: the sidebar needs the list to choose from.
          if(!this.listing){
            this.listing=true;
            this.trackOperation(this.registry.list().then(sessions=>this.send({v:1,type:"sessions",sessions}),()=>this.send({v:1,type:"error",code:"list_unavailable",message:"Conversation list is temporarily unavailable; the current task remains connected",...rid(frame)})).finally(()=>{this.listing=false;}));
          }
          break;
        case "delete_session":
          if(this.workspaces) throw new Error("Use the archive screen and explicit workspace deletion confirmation");
          // Allowed before open: deleting from the sidebar must not require
          // attaching to the conversation first.
          if (!(await this.registry.delete(frame.sessionId))) {
            this.send({ v: 1, type: "error", code: "unknown_session", message: "No such conversation", ...rid(frame) });
            break;
          }
          if (this.session?.id === frame.sessionId) {
            this.session = undefined;
            this.opened = false;
          }
          await this.index?.remove(frame.sessionId);
          this.send({ v: 1, type: "ack", operation: "delete_session", ...rid(frame) });
          break;
        case "rename_session":
          if (frame.sessionId !== undefined && frame.sessionId !== this.session?.id) {
            await this.registry.rename(frame.sessionId, frame.name);
          } else {
            if (!this.session || !this.opened) throw new NotOpenError();
            await this.registry.rename(this.session.id, frame.name);
          }
          this.send({ v: 1, type: "ack", operation: "rename_session", ...rid(frame) });
          break;
        case "get_queue":
          if(!this.session||!this.opened)throw new NotOpenError();
          this.send(this.session.queueFrame);break;
        case "queue_action": {
          if(!this.session||!this.opened)throw new NotOpenError();
          if(this.lifecycleLocks.has(this.session.id)||await this.workspaces?.isArchived(this.session.id))throw new Error('Conversation is unavailable');
          try {await this.session.changeQueue(frame);this.send({v:1,type:'ack',operation:'queue_action',requestId:frame.requestId});}
          finally {this.send(this.session.queueFrame);}
          break;
        }
        case "prompt":
          await this.prompt(frame);
          break;
        case "abort":
          await this.abort(frame);
          break;
        case "get_command_catalog": {
          if(!this.factory.commandCatalog)throw new Error("Command discovery unavailable on this Host; update Host to preview Skills before starting a task");
          this.readMetadata(frame,frame.type+":"+frame.engine,async()=>({v:1,type:"command_catalog",engine:frame.engine,commands:await this.factory.commandCatalog!(frame.engine)}));
          break;
        }
        case "get_model_catalog": {
          if(!this.factory.modelCatalog)throw new Error("Model discovery unavailable on this Host");
          this.readMetadata(frame,frame.type+":"+frame.engine,async()=>({v:1,type:"model_catalog",engine:frame.engine,...await this.factory.modelCatalog!(frame.engine)}));
          break;
        }
        case "get_models": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const target=this.session;
          this.readMetadata(frame,frame.type,async()=>({v:1,type:"models",...await target.getModels()}));
          break;
        }
        case "set_model":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setModel(frame.provider, frame.id);this.metadataEpoch++;
          this.send({ v: 1, type: "ack", operation: "set_model", ...rid(frame) });
          break;
        case "set_context":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setContextPreset(frame.preset);
          this.send({v:1,type:"ack",operation:"set_context",...rid(frame)});
          this.metadataEpoch++;
          const target=this.session;
          this.readMetadata(frame,"get_models",async()=>({v:1,type:"models",...await target.getModels()}));
          break;
        case "set_thinking":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setThinkingLevel(frame.level);this.metadataEpoch++;
          this.send({ v: 1, type: "ack", operation: "set_thinking", ...rid(frame) });
          break;
        case "get_commands": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const target=this.session;
          this.readMetadata(frame,frame.type,async()=>({v:1,type:"commands",commands:await target.getCommands()}));
          break;
        }
        case "get_extensions": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const target=this.session;
          this.readMetadata(frame,frame.type,async()=>({v:1,type:"extensions",sessionId:target.id,extensions:await target.getExtensions()}));
          break;
        }
        case "get_stats": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const target=this.session;
          this.readMetadata(frame,frame.type,async()=>({v:1,type:"stats",sessionId:target.id,stats:await target.getStats()}));
          break;
        }
        case "compact": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const target=this.session;
          // Keep the socket responsive to abort/reconnect while the session owns the operation.
          void target.compact().then(()=>{
            if(this.session===target)this.send({v:1,type:"ack",operation:"compact",...rid(frame)});
          },error=>{
            if(this.session===target)this.send({v:1,type:"error",code:error instanceof SessionBusyError ? "busy" : "operation_failed",message:error instanceof Error ? error.message : "Compaction failed",...rid(frame)});
          });
          break;
        }
        case "ui_response": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const { v: _v, type: _t, requestId: _r, ...response } = frame;
          if (!this.session.hasPendingUi(response.id)) {
            this.send({ v: 1, type: "error", code: "unknown_ui_request", message: "That dialog is no longer waiting for an answer", ...rid(frame) });
            break;
          }
          // Success means the native adapter accepted the answer, not merely that it arrived.
          if(!await this.session.respondUi(response))throw new Error("Answer is already being processed or the question has ended");
          this.send({ v: 1, type: "ack", operation: "ui_response", ...rid(frame) });
          break;
        }
        case "ping":
          if (!this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "pong", nonce: frame.nonce });
          break;
        case "close":
          this.socket.close(1000, "client closed");
          break;
      }
    } catch (error) {
      this.send({
        v: 1,
        type: "error",
        code: error instanceof ConversationIndexError ? error.code : error instanceof SessionBusyError
          ? "busy"
          : error instanceof NotOpenError
            ? "not_open"
            : "operation_failed",
        message: error instanceof Error ? error.message : "Operation failed",
        ...rid(frame),
      });
    }
  }

  private async open(frame: Extract<ClientFrame, { type: "open" }>): Promise<void> {
    if (this.opened) {
      this.send({ v: 1, type: "error", code: "already_open", message: "Connection is already open" });
      return;
    }
    if(frame.sessionId && this.lifecycleLocks.has(frame.sessionId))throw new Error("Workspace lifecycle operation in progress; reconnect shortly");
    if(frame.sessionId && await this.workspaces?.isArchived(frame.sessionId))throw new Error("Restore the archived conversation first");
    const task=frame.sessionId ? await this.workspaces?.lookup(frame.sessionId) : undefined;
    if(task?.engine && task.engine!=="pi" && frame.nativeProtocol!==1)throw new Error("This Task requires a native-Agent capable client");
    const listed=frame.sessionId && !task ? (await this.registry.list()).find(s=>s.id===frame.sessionId) : undefined;
    if(frame.sessionId && this.workspaces && !task && !listed)throw new Error("Unknown Task: conversation unavailable");
    const engine=task?.engine ?? listed?.engine ?? "pi";
    // Resolve asynchronous metadata before taking the history/replay snapshot.
    // Nothing may yield between that snapshot, attaching and sending its replay.
    const sessionId = frame.sessionId ?? randomUUID();
    const capabilities = await this.factory.capabilities?.(sessionId) ?? capabilitiesFor(engine);
    if (this.closed) return;
    let syncPage:any;
    let useSync=frame.syncProtocol===2&&this.syncV2Enabled&&Boolean(this.index);
    if(useSync){
      syncPage=await this.index!.page(sessionId);
      // An old successful audit does not prove today's native history is indexed.
      // Unverified/stale sources must use native history on this explicit open.
      if(!syncPage.lastSourceCheckAt || syncPage.sourceFreshness!=='current'){useSync=false;syncPage=undefined;}
    }
    if(this.closed)return;
    const result = useSync ? await (async()=>{
      const session=await this.registry.connect(sessionId);
      syncPage=await this.index!.page(sessionId);
      // Native startup can yield long enough for another audit to invalidate
      // the admission snapshot. Recheck the page that will actually be sent.
      if(!syncPage.lastSourceCheckAt || syncPage.sourceFreshness!=='current'){
        useSync=false;syncPage=undefined;
        return this.registry.open(sessionId,frame.after);
      }
      return {session,history:{entries:syncPage.entries,leafId:syncPage.entries.at(-1)?.id??null},replay:[] as ServerFrame[],resync:undefined};
    })() : await this.registry.open(sessionId, frame.after);
    this.syncProtocol=useSync?2:undefined;
    // Switching away while native history loads must not leave a phantom subscriber.
    if(this.closed){result.session.detach(this);return;}
    this.metadataEpoch++;
    this.session = result.session;this.bindingEpoch=syncPage?.bindingEpoch;
    this.opened = true;
    const state = result.session.currentState;
    // Attach before replaying. No await occurs between these operations, so a
    // Pi event cannot be delivered to this socket ahead of the opened frame.
    result.session.attach(this);
    this.send({
      v: 1,
      type: "opened",
      ...(syncPage?{syncProtocol:2 as const,bindingEpoch:syncPage.bindingEpoch,baseRevision:syncPage.baseRevision}:{}),
      engine,
      capabilities,
      sessionId: result.session.id,
      cursor: result.session.currentCursor,
      state,
    });
    this.send(syncPage?{v:1,type:'history',sessionId:result.session.id,entries:syncPage.entries,leafId:result.history.leafId,truncated:Boolean(syncPage.olderCursor),syncProtocol:2,bindingEpoch:syncPage.bindingEpoch,baseRevision:syncPage.baseRevision,headRevision:syncPage.headRevision,lastSourceCheckAt:syncPage.lastSourceCheckAt,snapshotId:syncPage.snapshotId,olderCursor:syncPage.olderCursor,sourceFreshness:syncPage.sourceFreshness}:boundedHistoryFrame(result.session.id, result.history.entries, result.history.leafId));
    if(syncPage)this.index!.scheduleAudit(sessionId,true);

    if (result.resync) {
      this.send({
        v: 1,
        type: "resync_required",
        sessionId: result.session.id,
        oldestCursor: result.resync.oldestCursor,
        newestCursor: result.resync.newestCursor,
      });
    }
    for (const replay of result.replay) this.send(replay);
    if(result.session.queueFrame.items.length)this.send(result.session.queueFrame);
    // A dialog Pi is still blocked on must reach this browser even if the
    // request itself predates the replay window (e.g. after a reload).
    const replayed = new Set(result.replay.map((frame) => (frame.type === "event" ? frame.cursor : -1)));
    for (const pending of result.session.pendingUiRequests) {
      if (pending.type === "event" && !replayed.has(pending.cursor)) this.send(pending);
    }
    // Transfer inbox preparation may yield; finish replaying before live events resume.
    if (this.transfer && (!this.workspaces || task)) {
      const scope = transferScope(this.user,result.session.id);
      const token = this.transfer.issueToken(scope, this.workdir, result.session.id, this.workspaces);
      this.registerTransfer?.(scope, result.session.id);


      this.send({
        v: 1,
        type: "transfer",
        sessionId: result.session.id,
        url: this.transfer.publicUrl(),

        scope,
        token,
        inbox: await this.transfer.inbox(scope),

        maxFileBytes: this.transfer.limits.maxFileBytes,
        maxBatchBytes: this.transfer.limits.maxBatchBytes,
      });
    }
  }

  private async prompt(frame: Extract<ClientFrame, { type: "prompt" }>): Promise<void> {
    const originSession=this.session,originGeneration=originSession?.commandGeneration;
    if(this.workspaces && this.session && await this.workspaces.isArchived(this.session.id)) throw new Error("Restore the archived conversation first");
    if(this.session && this.lifecycleLocks.has(this.session.id))throw new Error("Conversation lifecycle operation in progress");
    if (!this.session || !this.opened) throw new NotOpenError();
    if(await this.workspaces?.lookup(this.session.id))await this.workspaces!.cwd(this.session.id);
    if(originSession&&originGeneration!==undefined)originSession.assertCommandGeneration(originGeneration);
    if (frame.mode === "steer" || frame.mode === "follow_up") {
      // Follow-ups remain editable in the Host until native delivery; steering is native.
      // If nothing is running, treat it as a plain prompt so the message is
      // never silently parked.
      if (this.session.isStreaming) {
        // Durable acceptance precedes ACK; native/queue events still follow it.
        await this.session.acceptCommand(frame.requestId,frame.mode);
        this.send({v:1,type:"ack",operation:frame.mode,requestId:frame.requestId});
        const engine=(await this.workspaces?.lookup(this.session.id))?.engine??'pi';
        const capabilities=await this.factory.capabilities?.(this.session.id)??capabilitiesFor(engine);
        if(frame.mode==='follow_up'&&!capabilities.followUp)throw new Error('Queueing unavailable for this Agent');
        if(originSession&&originGeneration!==undefined)originSession.assertCommandGeneration(originGeneration);
        await this.session.enqueue(frame.mode, frame.text, frame.images,frame.requestId,true);
        return;
      }
    }
    const session=this.session;
    await session.preparePrompt(frame.requestId);
    // Acknowledgement means the command crossed the seam and was accepted;
    // lifecycle events continue asynchronously after it.
    this.send({ v: 1, type: "ack", operation: "prompt", requestId: frame.requestId });
    // Yield one turn after the acknowledgement. This gives every transport a
    // deterministic command/event ordering even when a test adapter emits its
    // first Pi event synchronously.
    setImmediate(() => {
      const setup=frame.text.trim()==='/mishu-setup';
      if(frame.text.trim()==='/mishu-history')this.mishu?.beginHistory(session.id,frame.requestId);
      if(frame.text.trim()==='/mishu-notifications')this.mishu?.beginNotifications(session.id,frame.requestId);
      if(setup)this.mishu?.beginSetup(session.id,frame.requestId);
      if(/^\/mishu-report(?:\s|$)/.test(frame.text.trim()))this.mishu?.beginReport(session.id,frame.requestId);
      void session.prompt(frame.requestId, frame.text, frame.images).catch((error) => {
        this.send({
          v: 1,
          type: "error",
          code: error instanceof SessionBusyError ? "busy" : "operation_failed",
          message: error instanceof Error ? error.message : "Prompt failed",
          requestId: frame.requestId,
        });
      }).finally(()=>{this.mishu?.endHistory(session.id,frame.requestId);this.mishu?.endSetup(session.id,frame.requestId);this.mishu?.endNotifications(session.id,frame.requestId);this.mishu?.endReport(session.id,frame.requestId);});
    });
  }

  private async abort(frame: Extract<ClientFrame, { type: "abort" }>): Promise<void> {
    if (!this.session || !this.opened) throw new Error("Connection must be opened first");
    await this.session.abort();
    this.send({ v: 1, type: "ack", operation: "abort", ...(frame.requestId === undefined ? {} : { requestId: frame.requestId }) });
  }

  private async detach(): Promise<void> {
    if (this.closed) {
      this.session?.detach(this);
      this.onClose();
      return;
    }
    this.closed = true;
    this.session?.detach(this);
    this.onClose();
  }
}

function rid(frame: ClientFrame): { requestId?: string } {
  return "requestId" in frame && typeof frame.requestId === "string" ? { requestId: frame.requestId } : {};
}

class NotOpenError extends Error {
  constructor() {
    super("Connection must be opened first");
    this.name = "NotOpenError";
  }
}

/**
 * The history frame must respect MAX_FRAME_BYTES. Keep the newest entries and
 * flag truncation; older conversation stays in the User VM's session file.
 */
function boundedHistoryFrame(sessionId: string, entries: HistoryEntry[], leafId: string | null): ServerFrame {
  const budget = MAX_FRAME_BYTES - 4096;
  let kept = entries;
  let truncated = false;
  const measure = (list: HistoryEntry[]) => Buffer.byteLength(JSON.stringify(list), "utf8");
  while (kept.length > 0 && measure(kept) > budget) {
    kept = kept.slice(Math.max(1, Math.floor(kept.length / 4)));
    truncated = true;
  }
  return { v: 1, type: "history", sessionId, entries: kept, leafId, truncated };
}

function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

function isAuthorized(request: IncomingMessage, token?: string): boolean {
  if (token === undefined) return true;
  const authorization = request.headers.authorization;
  return authorization === `Bearer ${token}`;
}

function rawDataToBytes(data: RawData): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}

function transferScope(user:string|undefined,id:string):string { return user===undefined ? id : createHash("sha256").update(JSON.stringify([user,id])).digest("hex"); }
