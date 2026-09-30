
import { createHash } from "node:crypto";
import { SkillManager, type SkillManagerOptions } from "./skills.js";
import { capabilitiesFor } from "../shared/protocol.js";
import { stopLspDaemon } from "pi-coffee-lsp";
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
}

export interface HostServerOptions {
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
  sharedSkillOwner?: string;
  eventBufferSize?: number;
  /** Stop idle Pi processes after this long; the conversation stays in Pi's session store. */
  idleTimeoutMs?: number;
  /** LocalSend v2 transfer endpoint on the User VM; browsers are told about it after `opened`. */
  transfer?: TransferServer;
  workspaces?: Workspaces;
  skills?: SkillManagerOptions;

  /** Poll interval for turns driven outside this Host (terminal take-over); default 3 s. */
  externalPollMs?: number;
}

/** A user's registry plus the bookkeeping the server keeps beside it. */
interface UserSlot {
  user: string | undefined;
  workdir?: string;
  factory: PiSessionFactory;
  registry: HostSessionRegistry;
  broadcastTimer?: ReturnType<typeof setTimeout>;
  workspaces?: Workspaces;
  skills?: SkillManager;
  lifecycleLocks: Set<string>;

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
  private readonly transferTargets = new Map<string, { slot: Promise<UserSlot>; sessionId: string }>();
  private readonly transfer?: TransferServer;
  private readonly http: HttpServer;
  private readonly sockets = new Set<HostSocket>();
  private readonly wsServer: WebSocketServer;
  private started = false;
  private readonly workspaces?: Workspaces;
  private execution?:ExecutionCapability;
  private readonly skillsOptions?: SkillManagerOptions;

  constructor(options: HostServerOptions) {
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
    this.registryOptions = {

      eventBufferSize: options.eventBufferSize,
      ...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
      ...(options.externalPollMs === undefined ? {} : { externalPollMs: options.externalPollMs }),
    };
    this.http = createServer((request, response) => {
      if(request.url?.startsWith("/api/")) { void this.handleApi(request,response).catch(()=>{if(!response.headersSent)json(response,500,{error:"Host operation failed"});else response.destroy();}); return; }
      if (request.url === "/healthz") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ ok: true, role: "host", protocolVersion: PROTOCOL_VERSION, capabilities:{giteaCheckouts:Boolean(this.workspaces),chatWorkspaces:Boolean(this.workspaces),ownerEnvironment:this.execution?.ownerEnvironment ?? false,passwordlessRoot:this.execution?.passwordlessRoot ?? false} }));
        return;
      }
      response.writeHead(404);
      response.end();
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
      });
      this.sockets.add(hostSocket);
      hostSocket.onClose = () => this.sockets.delete(hostSocket);
    });
  }

  private async handleApi(req: IncomingMessage, res: import("node:http").ServerResponse) {
    if(!this.token || req.headers.authorization !== `Bearer ${this.token}`) {json(res,401,{error:"Unauthorized"});return;}
    const rawUser=req.headers[USER_HEADER], user=normalizeUsername(rawUser);
    if ((rawUser!==undefined && !user) || (!user && this.requireUser)) {json(res,400,{error:"Valid user identity required"});return;}
    let slot:UserSlot;
    try {slot=await this.slotFor(user);} catch {json(res,503,{error:"User scope unavailable"});return;}
    if(req.url === "/api/revoke-files" && req.method === "POST") {for(const [grant,target] of this.transferTargets)if(await target.slot===slot){await this.transfer?.revoke(grant);this.transferTargets.delete(grant);}json(res,200,{ok:true});return;}
    if(req.url === "/api/engines" && req.method === "GET") {
      try { json(res,200,{engines:await slot.factory.engines?.() ?? PI_ONLY_ENGINES}); }
      catch { json(res,503,{error:"Agent discovery unavailable"}); }
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
        } else if(input.scope==='project' && ['install','update','enable','disable'].includes(input.action)) {
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
        if(task?.engine && task.engine!=="pi")throw new Error("Native cleanup is unavailable; Workspace and native history are retained. Archive this Task instead.");
      }
      if(target && !["files","changes","change_file","status","sidebar_move","sidebar_collapse","sidebar_display"].includes(input.action)) {
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
        case "changes": result=input.scope==="turn" ? await ws.turnChanges(input.id) : await ws.changes(input.id);break;
        case "change_file": result=await ws.changeFile(input.id,input);break;
        case "status": result=await ws.syncStatus(input.id,input.refresh!==false);break;
        case "branches": result=await ws.branches(input.projectId);break;
        case "discover": result=await ws.discover();break;
        case "gitea_repos": result=await ws.giteaRepositories();break;
        case "gitea_project": result=await ws.registerGiteaProject(input.repository);break;
        case "github_repos": result=await ws.githubRepositories();break;
        case "github_project": result=await ws.registerGitHubProject(input.repository);break;
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
          if(await ws.lookup(input.id)) result=await ws.archive(input.id,input.action==="archive",false);
          else {
            if(!(await slot.registry.list()).some(s=>s.id===input.id))throw new Error("Unknown conversation");
            result=await ws.archiveLegacy(input.id,input.action==="archive");
          }
          break;
        }
        case "delete": {
          await this.transfer?.quiesce(transferScope(user,input.id));
          await stopLspDaemon(taskNamespace(user,input.id));
          if(await ws.lookup(input.id)) result=await ws.deleteWorkspace(input.id,input.confirmation,()=>slot.registry.delete(input.id),input.includeLocalFiles===true);
          else {
            if(input.id!==input.confirmation || !await ws.isArchived(input.id))throw new Error("Archive and confirm the exact conversation ID first");
            await slot.registry.delete(input.id);await ws.archiveLegacy(input.id,false);result={ok:true,retained:["legacy workspace","uploads"]};
          }
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
        : { factory: this.factory, workspaces: this.workspaces, skills: this.skillsOptions };
      const registry = new HostSessionRegistry({ factory: scope.factory, ...this.registryOptions, ...(scope.workspaces ? {onHistory:(id,history)=>scope.workspaces!.exportHistory(id,history)} : {}) });
      const slot: UserSlot = { user, factory: scope.factory, registry, workspaces:scope.workspaces, skills:scope.skills ? new SkillManager(scope.skills,scope.workspaces) : undefined, lifecycleLocks:new Set<string>(), ...(scope.workdir === undefined ? {} : { workdir: scope.workdir }) };
      registry.onChange((session) => {
        this.broadcastSessions(slot);
        if(session?.wasInterrupted) void slot.workspaces?.markRun(session.id,"interrupted").catch(()=>undefined);
        void slot.workspaces?.settleRuns(id=>registry.get(id)?.wasInterrupted ? undefined : registry.get(id)?.isBusy).catch(()=>undefined);
      });
      return slot;
    })();
    this.slots.set(key, created);
    created.catch(() => this.slots.delete(key));
    return created;
  }

  private broadcastSessions(slot: UserSlot): void {
    if (slot.broadcastTimer !== undefined) return;
    slot.broadcastTimer = setTimeout(async () => {
      slot.broadcastTimer = undefined;
      const targets = [...this.sockets].filter((socket) => socket.user === slot.user);
      if (targets.length === 0) return;
      try {
        const sessions = await slot.registry.list();
        for (const socket of targets) socket.send({ v: 1, type: "sessions", sessions });
      } catch {
        // Listing is best-effort; the browser can still ask explicitly.
      }
    }, 150);
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
    this.started = true;
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

  async close(): Promise<void> {
    if (!this.started) return;
    for (const socket of this.sockets) socket.close();
    this.sockets.clear();
    const slots = await Promise.allSettled([...this.slots.values()]);
    this.slots.clear();
    this.transferTargets.clear();
    for (const slot of slots) {
      if (slot.status !== "fulfilled") continue;
      if (slot.value.broadcastTimer !== undefined) clearTimeout(slot.value.broadcastTimer);
      await slot.value.registry.close();
      await slot.value.factory.close?.().catch(() => undefined);
    }
    this.wsServer.close();
    await new Promise<void>((resolve, reject) => {
      this.http.close((error) => (error ? reject(error) : resolve()));
    });
    this.started = false;
  }

  private handleUpgrade(request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer): void {
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
  private workdir?: string;
  private workspaces?: Workspaces;
  private lifecycleLocks = new Set<string>();
  user: string | undefined;
  private session?: HostSession;
  private opened = false;
  private closed = false;
  private messageQueue: Promise<void>;
  onClose: () => void = () => undefined;


  constructor(socket: WebSocket, slot: Promise<UserSlot>, transfer?: TransferServer, private readonly registerTransfer?: (scope: string, sessionId: string) => void) {

    this.socket = socket;
    this.slot = slot;
    this.transfer = transfer;
    // Frames queue behind the slot so a user's very first connection cannot
    // race its own registry creation.
    this.messageQueue = this.slot.then((resolved) => {
      this.user = resolved.user;
      this.registry = resolved.registry;
      this.factory=resolved.factory;
      this.workdir = resolved.workdir;
      this.workspaces = resolved.workspaces;
      this.lifecycleLocks = resolved.lifecycleLocks;
    }).catch((error) => {
      this.send({ v: 1, type: "error", code: "user_unavailable", message: error instanceof Error ? error.message : "User scope unavailable", fatal: true });
      this.close();
    });
    socket.on("message", (data) => {
      this.messageQueue = this.messageQueue.then(() => this.handleMessage(data)).catch(() => undefined);
    });
    socket.on("close", () => void this.detach());
    socket.on("error", () => void this.detach());
  }

  get sessionId():string|undefined {return this.session?.id;}

  send(frame: ServerFrame): void {
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

  private async handleMessage(data: RawData): Promise<void> {
    if (this.closed || this.registry === undefined) return;
    let frame: ClientFrame;
    try {
      frame = decodeClientFrame(rawDataToBytes(data));
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
      switch (frame.type) {
        case "open":
          await this.open(frame);
          break;
        case "list_sessions":
          // Allowed before open: the sidebar needs the list to choose from.
          this.send({ v: 1, type: "sessions", sessions: await this.registry.list() });
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
        case "prompt":
          await this.prompt(frame);
          break;
        case "abort":
          await this.abort(frame);
          break;
        case "get_model_catalog": {
          if(!this.factory.modelCatalog)throw new Error("Model discovery unavailable on this Host");
          const catalog=await this.factory.modelCatalog(frame.engine);
          this.send({v:1,type:"model_catalog",engine:frame.engine,...rid(frame),...catalog});
          break;
        }
        case "get_models": {
          if (!this.session || !this.opened) throw new NotOpenError();
          const models = await this.session.getModels();
          this.send({ v: 1, type: "models", ...models });
          break;
        }
        case "set_model":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setModel(frame.provider, frame.id);
          this.send({ v: 1, type: "ack", operation: "set_model", ...rid(frame) });
          break;
        case "set_thinking":
          if (!this.session || !this.opened) throw new NotOpenError();
          await this.session.setThinkingLevel(frame.level);
          this.send({ v: 1, type: "ack", operation: "set_thinking", ...rid(frame) });
          break;
        case "get_commands":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "commands", commands: await this.session.getCommands() });
          break;
        case "get_extensions":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "extensions", sessionId: this.session.id, extensions: await this.session.getExtensions() });
          break;
        case "get_stats":
          if (!this.session || !this.opened) throw new NotOpenError();
          this.send({ v: 1, type: "stats", sessionId: this.session.id, stats: await this.session.getStats() });
          break;
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
          // Ack first: the answer crossed the seam. Pi's follow-on events
          // (the run resuming) arrive after it.
          this.send({ v: 1, type: "ack", operation: "ui_response", ...rid(frame) });
          await this.session.respondUi(response);
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
        code: error instanceof SessionBusyError
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
    const engine=task?.engine ?? listed?.engine ?? "pi";
    const result = await this.registry.open(frame.sessionId, frame.after);
    this.session = result.session;
    this.opened = true;
    const state = result.session.currentState;
    // Attach before replaying. No await occurs between these operations, so a
    // Pi event cannot be delivered to this socket ahead of the opened frame.
    result.session.attach(this);
    this.send({
      v: 1,
      type: "opened",
      engine,
      capabilities:await this.factory.capabilities?.(result.session.id) ?? capabilitiesFor(engine),
      sessionId: result.session.id,
      cursor: result.session.currentCursor,
      state,
    });
    this.send(boundedHistoryFrame(result.session.id, result.history.entries, result.history.leafId));

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
    // A dialog Pi is still blocked on must reach this browser even if the
    // request itself predates the replay window (e.g. after a reload).
    const replayed = new Set(result.replay.map((frame) => (frame.type === "event" ? frame.cursor : -1)));
    for (const pending of result.session.pendingUiRequests) {
      if (pending.type === "event" && !replayed.has(pending.cursor)) this.send(pending);
    }
  }

  private async prompt(frame: Extract<ClientFrame, { type: "prompt" }>): Promise<void> {
    if(this.workspaces && this.session && await this.workspaces.isArchived(this.session.id)) throw new Error("Restore the archived conversation first");
    if(this.session && this.lifecycleLocks.has(this.session.id))throw new Error("Conversation lifecycle operation in progress");
    if (!this.session || !this.opened) throw new NotOpenError();
    if(await this.workspaces?.lookup(this.session.id))await this.workspaces!.cwd(this.session.id);
    if (frame.mode === "steer" || frame.mode === "follow_up") {
      // Joining a busy run: Pi owns the queue and reports it via queue_update.
      // If nothing is running, treat it as a plain prompt so the message is
      // never silently parked.
      if (this.session.isStreaming) {
        // Same contract as prompt: the ack means "accepted at the seam"; Pi's
        // queue_update event follows and is the authoritative queue state.
        this.send({ v: 1, type: "ack", operation: frame.mode, requestId: frame.requestId });
        await this.session.enqueue(frame.mode, frame.text, frame.images);
        return;
      }
    }
    const session=this.session;
    session.reservePrompt(frame.requestId);
    try {await this.workspaces?.markRun(session.id,"running",frame.requestId);}
    catch(e){session.releasePrompt(frame.requestId);throw e;}
    // Acknowledgement means the command crossed the seam and was accepted;
    // lifecycle events continue asynchronously after it.
    this.send({ v: 1, type: "ack", operation: "prompt", requestId: frame.requestId });
    // Yield one turn after the acknowledgement. This gives every transport a
    // deterministic command/event ordering even when a test adapter emits its
    // first Pi event synchronously.
    setImmediate(() => {
      void session.prompt(frame.requestId, frame.text, frame.images).catch((error) => {
        void this.workspaces?.markRun(session.id,"interrupted").catch(()=>undefined);
        this.send({
          v: 1,
          type: "error",
          code: error instanceof SessionBusyError ? "busy" : "operation_failed",
          message: error instanceof Error ? error.message : "Prompt failed",
          requestId: frame.requestId,
        });
      });
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
