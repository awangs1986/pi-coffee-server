import {runLifecycle} from '../shared/run-lifecycle.js';
import {InputQueue} from "./input-queue.js";
import { randomUUID } from "node:crypto";
import type {
  CommandInfo,
  ExtensionInfo,
  ImageInput,
  JsonValue,
  ServerFrame,
  SessionState,
  SessionStats,
  SessionSummary,
  UiResponse,
} from "../shared/protocol.js";
import type { AgentSessionListing as PiSessionListing, AgentHistory as PiHistory, AgentModels as PiModels, AgentSessionFactory as PiSessionFactory, AgentSession as PiSession } from "./agent-adapter.js";

export interface SessionSink {
  send(frame: ServerFrame): void;
}

export interface HostSessionOptions {
  completionForHistory?:(id:string)=>Promise<string|null>;
  runnerGuidance?:(id:string)=>Promise<{revision:string;text?:string}|undefined>;
  id?: string;
  factory: PiSessionFactory;
  eventBufferSize?: number;
  /** Stop the Pi process after this long with no browser attached and nothing running. 0 disables. */
  idleTimeoutMs?: number;
  onIdle?: (session: HostSession) => void;
  onHistory?: (id:string,history:PiHistory)=>Promise<void>;
  /** Record each Host-started turn before native delivery, including queued turns. */
  onEvent?: (id:string,event:JsonValue)=>void;
  onCommand?:(id:string,requestId:string,state:"accepted"|"delivering"|"running"|"settled"|"uncertain"|"cancelled",mode?:string,text?:string)=>Promise<unknown>;
  onRun?: (id:string,state:"running"|"interrupted",requestId?:string)=>Promise<void>;
  /** Called when a run starts or settles (the conversation list's running flag / counts change). */
  onLifecycle?: (session: HostSession) => void;
  /**
   * How often to re-read the agent's state while a turn this Host did not
   * start is running (e.g. the VM admin's terminal drives the same Codex
   * thread). No events reach us for such a turn, so its end is polled.
   */
  externalPollMs?: number;
}

export interface SessionOpenResult {
  session: HostSession;
  history: PiHistory;
  completionId?: string|null;
  replay: ServerFrame[];
  resync?: { oldestCursor: number; newestCursor: number };
}

/**
 * In-process owner of one original Pi session. Durability lives in Pi's own
 * session file in the User VM: this object can be stopped when idle and
 * recreated later without losing the conversation.
 */
export class HostSession {
  readRunEvidence(runId?:string){return this.pi?.readRunEvidence?.(runId);}
  readonly id: string;
  private readonly inputs:InputQueue;
  private readonly runnerGuidance?:HostSessionOptions['runnerGuidance'];
  private runnerRevision?:string;
  private readonly factory: PiSessionFactory;
  private readonly eventBufferSize: number;
  private readonly idleTimeoutMs: number;
  private readonly onIdle?: (session: HostSession) => void;
  private readonly completionForHistory?:HostSessionOptions["completionForHistory"];
  private readonly onHistory?: (id:string,history:PiHistory)=>Promise<void>;
  private readonly onRun?: HostSessionOptions["onRun"];
  private readonly onEvent?: HostSessionOptions["onEvent"];
  private readonly onCommand?:HostSessionOptions["onCommand"];
  private readonly runCommands=new Set<string>();
  private deliveryGeneration=0;
  get commandGeneration():number {return this.deliveryGeneration;}
  assertCommandGeneration(generation:number):void {this.assertDelivery(generation);}
  private assertDelivery(generation:number):void {if(generation!==this.deliveryGeneration)throw new DeliveryCancelledError();}
  private historyExport:Promise<void>=Promise.resolve();
  private readonly onLifecycle?: (session: HostSession) => void;
  private readonly sinks = new Set<SessionSink>();
  private readonly events: ServerFrame[] = [];
  private pi?: PiSession;
  private unsubscribe?: () => void;
  private cursor = 0;
  /** Cursor of the latest completed message; everything up to here is in the durable history. */
  private lastMessageEndCursor = 0;
  private state: SessionState = { isStreaming: false, messageCount: 0 };
  private activeRequestId?: string;
  private compacting = false;
  /** Extension dialogs awaiting an answer, keyed by request id. */
  private readonly pendingUi = new Map<string, ServerFrame>();
  private readonly answeringUi = new Set<string>();
  private started = false;
  private interrupted = false;
  private recoveryPromise?: Promise<void>;
  private startPromise?: Promise<void>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  /** A run settled while no browser was attached; cleared when one attaches. */
  private unseenSettle = false;
  private readonly externalPollMs: number;
  private externalTimer?: ReturnType<typeof setTimeout>;

  constructor(options: HostSessionOptions) {
    this.runnerGuidance=options.runnerGuidance;
    this.id = options.id ?? randomUUID();
    this.inputs=new InputQueue({busy:()=>this.executionBusy,
      validate:async text=>{await this.ready().validateFollowUp?.(text);},
      deliver:async(text,images,promote,queuedRequestId)=>{
        const generation=this.deliveryGeneration;
        if(this.interrupted||this.compacting||this.contextChanging||this.reportOrigin)throw new SessionBusyError();
        if(promote&&queuedRequestId?.startsWith("mishu-dispatch-"))throw Error("Tracked assignments must remain serial; inspect their task record instead of promoting them");
        if(promote&&this.state.isStreaming){
          try {
            if(queuedRequestId)await this.onCommand?.(this.id,queuedRequestId,"delivering","steer",text);
            this.assertDelivery(generation);
            if(queuedRequestId)this.runCommands.add(queuedRequestId);
            await this.deliverWithRunnerGuidance(text,value=>this.ready().steer(value,images),generation);
          }catch(error){if(queuedRequestId)void this.onCommand?.(this.id,queuedRequestId,error instanceof DeliveryCancelledError?"cancelled":"uncertain").catch(()=>undefined);throw error;}
          return;
        }
        const requestId=queuedRequestId??randomUUID();await this.preparePrompt(requestId,true);this.assertDelivery(generation);await this.prompt(requestId,text,images);
      },changed:()=>{this.onEvent?.(this.id,{type:"sync_metadata",metadata:{queue:this.inputs.items.map(item=>({id:item.id,revision:item.revision,status:item.status,imageCount:item.imageCount}))}});for(const sink of this.sinks)sink.send(this.queueFrame);this.onLifecycle?.(this);}
    });
    this.factory = options.factory;
    this.eventBufferSize = Math.max(1, options.eventBufferSize ?? 256);
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 0);
    this.onIdle = options.onIdle;
    this.completionForHistory=options.completionForHistory;
    this.onHistory=options.onHistory;
    this.onRun=options.onRun;this.onEvent=options.onEvent;this.onCommand=options.onCommand;
    this.onLifecycle = options.onLifecycle;
    this.externalPollMs = Math.max(0, options.externalPollMs ?? 3000);
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      this.pi = await this.factory.create({ sessionId: this.id });
      this.unsubscribe = this.pi.onEvent((event) => this.handlePiEvent(event));
      try {
        this.state = await this.pi.getState();
        this.started = true;this.inputs.resume();
        this.watchExternalTurn();
      } catch (error) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        await this.pi.stop();
        this.pi = undefined;
        throw error;
      }
    })();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  async prepare(after?: number): Promise<SessionOpenResult> {
    if (this.interrupted) {
      this.recoveryPromise ??= this.stop().then(()=>{this.interrupted=false;});
      try {await this.recoveryPromise;} finally {this.recoveryPromise=undefined;}
    }
    await this.start();
    if (!this.pi) throw new Error("Session is not ready");
    if(after!==undefined && after>this.cursor)throw new Error("Future session cursor");
    // Capture a proven completion boundary BEFORE asynchronous export. A completion
    // racing the history RPC requires another read, never an invented watermark.
    let history:PiHistory;let historyCursor:number;let completionId:string|null;let attempts=0;
    do {
      historyCursor=this.lastMessageEndCursor;
      completionId=await this.completionForHistory?.(this.id)??null;
      history=await this.pi.getHistory();
      if(historyCursor===this.lastMessageEndCursor)break;
      if(++attempts>=3)throw new Error("History changed while loading; retry the read");
    } while(true);
    await this.exportHistory(history);
    // The durable history already contains every completed message, so the
    // browser only needs the events of the message that is still in flight.
    // A returning browser's `after` cursor can only move that boundary later.
    const replayFrom = Math.max(after ?? 0, historyCursor);
    const oldestCursor = this.events[0]?.type === "event" ? this.events[0].cursor : this.cursor + 1;
    const resync = replayFrom < oldestCursor - 1
      ? { oldestCursor, newestCursor: this.cursor }
      : undefined;
    const replay = resync
      ? []
      : this.events.filter((frame) => frame.type === "event" && frame.cursor > replayFrom);
    return { session: this, history, completionId, replay, ...(resync === undefined ? {} : { resync }) };
  }

  attach(sink: SessionSink): void {
    this.sinks.add(sink);
    if (this.unseenSettle) {
      this.unseenSettle = false;
      this.onLifecycle?.(this); // the list's "finished" flag just cleared
    }
    this.clearIdleTimer();
  }

  detach(sink: SessionSink): void {
    this.sinks.delete(sink);
    this.scheduleIdleCheck();
  }

  get currentState(): SessionState {
    return { ...this.state, isCompacting: this.compacting };
  }

  get currentCursor(): number {
    return this.cursor;
  }

  get isStreaming(): boolean {
    return this.state.isStreaming;
  }

  get hasSinks(): boolean {
    return this.sinks.size > 0;
  }


  /** What the conversation list should say about this session's need for the user. */
  get attention(): "waiting" | "finished" | undefined {
    if (this.pendingUi.size > 0) return "waiting";
    if (this.unseenSettle) return "finished";
    return undefined;
  }
  /** Internal callback stays outside public queue rows and cannot be edited/steered. */
  enqueueNotification(title:string,deliver:()=>Promise<void>,cancel:()=>Promise<void>){return this.inputs.addInternal('MISHU 汇报：'+title,deliver,cancel);}
  cancelNotification(id:string,requestId?:string){if(this.inputs.cancelInternal(id)&&requestId)void this.onCommand?.(this.id,requestId,'cancelled').catch(()=>undefined);}
  private reportOrigin=false;
  /** Host-controlled run classification; never populated from model fields. */
  setReportOrigin(){if(!this.activeRequestId)throw Error('Report requires reserved command');this.reportOrigin=true;}
  get isReportRun(){return this.reportOrigin;}
  /** Host request currently owning the native run (undefined when idle). */
  get currentRequestId(){return this.activeRequestId;}
  private contextChanging=false;
  private get executionBusy(): boolean { return this.contextChanging || this.compacting || this.state.isStreaming || this.activeRequestId !== undefined; }
  get isTransitioning():boolean {return this.contextChanging||this.compacting;}
  get isBusy():boolean {return this.executionBusy||this.inputs.items.length>0;}
  get wasInterrupted(): boolean { return this.interrupted; }
  async preparePrompt(requestId: string,fromQueue=false): Promise<void> {
    const generation=this.deliveryGeneration;
    this.reservePrompt(requestId,fromQueue);
    try {
      if(!fromQueue)await this.onCommand?.(this.id,requestId,"accepted","prompt");
      this.assertDelivery(generation);
      await this.onRun?.(this.id,"running",requestId);
      this.assertDelivery(generation);
    }catch(error){
      if(this.activeRequestId===requestId)this.activeRequestId=undefined;
      if(error instanceof DeliveryCancelledError){void this.onCommand?.(this.id,requestId,"cancelled").catch(()=>undefined);if(!this.activeRequestId)void this.onRun?.(this.id,"interrupted").catch(()=>undefined);}
      throw error;
    }
  }


  reservePrompt(requestId: string,fromQueue=false): void {
    if (this.interrupted) throw new Error("Agent was interrupted. Reopen the conversation before retrying; the previous request was not replayed.");
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    if (fromQueue?this.executionBusy:this.isBusy) {
      throw new SessionBusyError();
    }
    this.activeRequestId = requestId;
  }

  async prompt(requestId: string, text: string, images?: ImageInput[]): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    if (this.activeRequestId !== requestId) throw new Error("Prompt was not reserved");
    const generation=this.deliveryGeneration;
    try {
      await this.onCommand?.(this.id,requestId,"delivering","prompt",text);this.assertDelivery(generation);this.runCommands.add(requestId);
      await this.deliverWithRunnerGuidance(text,value=>this.ready().prompt(value,images,requestId.startsWith("mishu-dispatch-")?{runId:requestId}:undefined),generation);
    } catch (error) {
      if(this.activeRequestId===requestId)this.activeRequestId = undefined;this.runCommands.delete(requestId);
      const cancelled=error instanceof DeliveryCancelledError;
      const receipt=this.onCommand?.(this.id,requestId,cancelled?"cancelled":"uncertain").catch(()=>undefined);
      if(!cancelled)await receipt;
      else void receipt;
      if(!this.activeRequestId)void this.onRun?.(this.id,"interrupted").catch(()=>undefined);
      throw error;
    }
  }

  private async deliverWithRunnerGuidance(text:string,deliver:(value:string)=>Promise<void>,generation:number){
    const guidance=!text.trimStart().startsWith('/')?await this.runnerGuidance?.(this.id):undefined;
    this.assertDelivery(generation);
    const changed=guidance&&guidance.revision!==this.runnerRevision;
    await deliver(changed&&guidance.text?text+'\n\n'+guidance.text:text);
    if(guidance)this.runnerRevision=guidance.revision;
  }

  async acceptCommand(requestId:string,mode:string){const generation=this.deliveryGeneration;await this.onCommand?.(this.id,requestId,"accepted",mode);if(generation!==this.deliveryGeneration)void this.onCommand?.(this.id,requestId,"cancelled").catch(()=>undefined);this.assertDelivery(generation);}

  /** Join a busy run: steer interrupts after current tool calls, follow_up waits for the end. */
  async enqueue(mode: "steer" | "follow_up", text: string, images?: ImageInput[],requestId?:string,accepted=false): Promise<void> {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    if (this.compacting || this.contextChanging || this.reportOrigin && mode === "steer") throw new SessionBusyError();
    const generation=this.deliveryGeneration;
    if(requestId&&!accepted)await this.onCommand?.(this.id,requestId,"accepted",mode);
    try {
      this.assertDelivery(generation);
      if (mode === "steer") {
        if(requestId)await this.onCommand?.(this.id,requestId,"delivering","steer",text);
        this.assertDelivery(generation);
        if(requestId)this.runCommands.add(requestId);
        await this.deliverWithRunnerGuidance(text,value=>this.ready().steer(value,images),generation);
      }else await this.inputs.add(text, images,requestId);
    }catch(error){if(requestId)void this.onCommand?.(this.id,requestId,error instanceof DeliveryCancelledError?"cancelled":"uncertain").catch(()=>undefined);throw error;}
  }

  get queueFrame():Extract<ServerFrame,{type:'queue_state'}>{return {v:1,type:'queue_state',sessionId:this.id,items:this.inputs.items};}
  async changeQueue(action:import('../shared/protocol.js').QueueAction){
    if(this.interrupted||this.compacting||this.contextChanging||this.reportOrigin)throw new SessionBusyError();
    const queued=this.inputs.items.find(item=>item.id===action.id);
    if(queued?.requestId?.startsWith('mishu-dispatch-')&&action.action!=='cancel')throw Error('Tracked assignments cannot be edited, promoted or moved; stop the task and inspect its original dispatch');
    const command=action.action==='cancel'?queued?.requestId:undefined;
    await this.inputs.change(action);if(command)await this.onCommand?.(this.id,command,"cancelled");
  }
  async abort(expectedRequestId?:string): Promise<void> {
    if(expectedRequestId!==undefined&&this.activeRequestId!==expectedRequestId)throw Error('Target run changed; nothing stopped');
    if(expectedRequestId!==undefined){if(!this.pi||!this.started)throw Error('Session is not ready');await this.pi.abort();return;}
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    // Fence every suspended pre-native send before calling the adapter. Neither
    // a queued ledger write nor a slow native delivery response may delay Stop.
    this.deliveryGeneration++;
    const cancelled=this.inputs.items.map(item=>item.requestId).filter((id):id is string=>Boolean(id)&&!this.runCommands.has(id!));
    if(this.activeRequestId&&!this.runCommands.has(this.activeRequestId)){cancelled.push(this.activeRequestId);this.activeRequestId=undefined;}
    this.inputs.clear();
    const nativeAbort=this.pi.abort();
    void this.inputs.waitForDelivery();
    for(const id of new Set(cancelled))void this.onCommand?.(this.id,id,"cancelled").catch(()=>undefined);
    await nativeAbort;
  }

  async rename(name: string): Promise<void> {
    if (this.compacting||this.contextChanging)throw new SessionBusyError();
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    await this.pi.rename(name);
    this.state = { ...this.state, sessionName: name };
    this.scheduleIdleCheck();
  }

  hasPendingUi(id: string): boolean {
    return this.pendingUi.has(id);
  }

  /**
   * Publish a Host-originated event (e.g. transfer progress) on the same
   * ordered stream as Pi's events, so browsers see one consistent timeline.
   */
  announce(event: JsonValue): void {
    if (!this.started) return;
    this.handlePiEvent(event);
  }

  /** Answer a pending extension dialog; unknown ids are ignored (already answered or timed out). */
  async respondUi(response: UiResponse): Promise<boolean> {
    if (!this.pendingUi.has(response.id) || this.answeringUi.has(response.id)) return false;
    this.answeringUi.add(response.id);
    try {await this.ready().respondUi(response);this.pendingUi.delete(response.id);this.onEvent?.(this.id,{type:"sync_pending",requests:this.pendingUiRequests.map(frame=>({id:frame.type==="event"&&isRecord(frame.event)?String(frame.event.id):""}))});this.onLifecycle?.(this);return true;}
    finally {this.answeringUi.delete(response.id);}

  }

  /** Dialogs Pi is still blocked on; re-sent to every browser that opens the Session. */
  get pendingUiRequests(): ServerFrame[] {
    return [...this.pendingUi.values()];
  }

  backgroundState():Promise<{known:boolean;active:number}> {return this.ready().backgroundState?.() ?? Promise.resolve({known:false,active:0});}

  async takeover(operation:import('./takeover.js').TakeoverState):Promise<void>{
    if(!this.factory.prepareTakeover)throw new Error('Agent takeover unavailable on this Host');
    return this.replaceContext(async original=>this.factory.prepareTakeover!(this.id,operation,await original.getHistory()));
  }
  async clearContext(operation:{id:string;expectedNativeId:string;title:string}):Promise<void>{
    if(!this.factory.prepareContextReset)throw new Error('Chat context reset unavailable on this Host');
    return this.replaceContext(async original=>this.factory.prepareContextReset!(this.id,operation,await original.getModels()));
  }
  private async replaceContext(prepare:(original:PiSession)=>Promise<{session:PiSession;commit():Promise<void>;rollback():Promise<void>}>):Promise<void>{
    if(this.isBusy||this.pendingUi.size)throw new SessionBusyError();
    this.contextChanging=true;this.clearIdleTimer();this.onLifecycle?.(this);
    const original=this.ready();let sourceStopped=false,committed=false;let prepared:Awaited<ReturnType<typeof prepare>>|undefined;
    try{
      const state=await original.getState(),background=await this.backgroundState();
      if(state.isStreaming||state.isCompacting||state.pendingMessageCount||!background.known||background.active)throw new Error('Source has active or unknown work');
      prepared=await prepare(original);
      const nextState=await prepared.session.getState();
      const finalState=await original.getState(),finalBackground=await original.backgroundState?.();
      if(finalState.isStreaming||finalState.isCompacting||finalState.pendingMessageCount||!finalBackground?.known||finalBackground.active)throw new Error('Source resumed during takeover; it was not stopped');
      sourceStopped=true;await original.stop();
      await prepared.commit();committed=true;
      this.unsubscribe?.();this.pi=prepared.session;this.unsubscribe=this.pi.onEvent(e=>this.handlePiEvent(e));
      this.events.length=0;this.lastMessageEndCursor=this.cursor;this.state=nextState;this.unseenSettle=false;this.deliveryGeneration++;
      await this.exportHistory();
    }catch(error){
      if(!committed)await prepared?.rollback().catch(()=>undefined);
      if(sourceStopped&&!committed&&this.started){this.unsubscribe?.();this.pi=await this.factory.create({sessionId:this.id});this.unsubscribe=this.pi.onEvent(e=>this.handlePiEvent(e));this.state=await this.pi.getState();}
      // The committed binding is changed only after preparation succeeds.
      throw error;
    }finally{this.contextChanging=false;this.onLifecycle?.(this);this.scheduleIdleCheck();}
  }
  readNativeState():Promise<SessionState>{return this.ready().getState();}
  getHistory():Promise<import("./agent-adapter.js").AgentHistory>{return this.ready().getHistory();}
  getModels(): Promise<PiModels> { return this.ready().getModels(); }
  setModel(provider: string, id: string): Promise<void> { if(this.compacting||this.contextChanging)throw new SessionBusyError(); return this.ready().setModel(provider, id); }
  async setContextPreset(preset:import('../shared/protocol.js').ContextPreset):Promise<void>{
    if(this.isBusy)throw new SessionBusyError();
    const adapter=this.ready();if(!adapter.setContextPreset)throw new Error('Context settings require an updated Host and Agent');
    this.contextChanging=true;
    try{await adapter.setContextPreset(preset);}finally{this.contextChanging=false;}
  }
  setThinkingLevel(level: string): Promise<void> { if(this.compacting||this.contextChanging)throw new SessionBusyError(); return this.ready().setThinkingLevel(level); }
  getCommands(): Promise<CommandInfo[]> { return this.ready().getCommands(); }
  getExtensions(): Promise<ExtensionInfo[]> { return this.ready().getExtensions(); }
  getStats(): Promise<SessionStats> { return this.ready().getStats(); }
  async compact(): Promise<void> {
    const pi=this.ready();
    if(this.isBusy)throw new SessionBusyError();
    this.compacting=true;this.clearIdleTimer();
    this.announce({type:"context_operation",active:true});this.onLifecycle?.(this);
    let success=false, message:string|undefined;
    try {await pi.compact();await this.exportHistory(await pi.getHistory());success=true;}
    catch(error) {message=error instanceof Error ? error.message : "Compaction failed";throw error;}
    finally {
      this.compacting=false;
      this.announce({type:"context_operation",active:false,success,...(message ? {message} : {})});this.onLifecycle?.(this);
      this.scheduleIdleCheck();
    }
  }

  private ready(): PiSession {
    if (!this.pi || !this.started) throw new Error("Session is not ready");
    return this.pi;
  }

  async stop(): Promise<void> {
    this.deliveryGeneration++;
    this.inputs.stop();
    this.clearIdleTimer();
    if (this.externalTimer !== undefined) clearTimeout(this.externalTimer);
    this.externalTimer = undefined;
    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // A failed startup has already cleaned up its adapter.
      }
    }
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.historyExport;
    if (this.pi) await this.pi.stop();
    this.pi = undefined;
    this.started = false;
    this.sinks.clear();
  }

  /**
   * A turn is running that nobody prompted through this Host (take-over of a
   * terminal thread). Poll the adapter until it reports idle, then publish the
   * settle the browsers are waiting for.
   */
  private watchExternalTurn(): void {
    if (this.externalTimer !== undefined || this.externalPollMs === 0) return;
    if (!this.state.isStreaming || this.activeRequestId !== undefined) return;
    this.externalTimer = setTimeout(async () => {
      this.externalTimer = undefined;
      if (!this.pi || !this.started) return;
      // Our own events may have settled it meanwhile.
      if (!this.state.isStreaming || this.activeRequestId !== undefined) return;
      try {
        const fresh = await this.pi.getState();
        if (!fresh.isStreaming) {
          this.state = { ...this.state, ...fresh, isStreaming: true };
          this.handlePiEvent({ type: "agent_settled" });
          return;
        }
      } catch {
        // Transient; try again next tick.
      }
      this.watchExternalTurn();
    }, this.externalPollMs);
    this.externalTimer.unref?.();
  }

  private scheduleIdleCheck(): void {
    this.clearIdleTimer();
    if (!this.started || this.idleTimeoutMs === 0 || this.onIdle === undefined) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.checkIdle();
    }, this.idleTimeoutMs);
  }

  private async checkIdle(): Promise<void> {
    if (!this.started || this.hasSinks || this.isBusy) return;
    let background: { known: boolean; active: number };
    try {
      background = await this.backgroundState();
    } catch {
      background = { known: false, active: 0 };
    }
    // A browser may reconnect or a child may resume the parent during the probe.
    if (!this.started || this.hasSinks || this.isBusy) return;
    if (background.known && background.active === 0) this.onIdle?.(this);
    else this.scheduleIdleCheck();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private handlePiEvent(event: unknown): void {
    const safeEvent = toJsonValue(event);
    try{this.onEvent?.(this.id,safeEvent);}catch{/* Display ingestion must never interrupt native execution. */}
    const runPhase=isRecord(safeEvent)?runLifecycle(safeEvent.type):undefined;
    if(runPhase){
      const status=runPhase==='interrupted'?'uncertain':runPhase;
      for(const requestId of this.runCommands)void this.onCommand?.(this.id,requestId,status).catch(()=>undefined);
      if(status!=='running')this.runCommands.clear();
    }
    let settled = false;
    let lifecycle = false;
    if (isRecord(safeEvent) && typeof safeEvent.type === "string") {
      if ((safeEvent.type === "agent_interrupted" || safeEvent.type === "run_interrupted")) {
        this.interrupted = true;this.unseenSettle=false;this.inputs.pause();
        this.state = {...this.state,isStreaming:false};
        this.activeRequestId = undefined;this.reportOrigin=false;
        this.pendingUi.clear();
        // A reopened browser must not replay the dead run's agent_start/deltas
        // as though it were still streaming; durable history remains authoritative.
        this.lastMessageEndCursor = this.cursor;
        this.clearIdleTimer();
        this.onLifecycle?.(this);
        for (const sink of this.sinks) sink.send({v:1,type:"error",code:safeEvent.type==="agent_interrupted"?"pi_interrupted":"agent_interrupted",fatal:true,message:"Agent exited unexpectedly. This run was interrupted and was not replayed. Reopen the conversation, inspect the saved results, and retry explicitly."});
        return;
      }
      if ((safeEvent.type === "agent_start" || safeEvent.type === "run_started")) {
        this.unseenSettle=false;
        this.state = { ...this.state, isStreaming: true };
        lifecycle = true;
      }
      if ((safeEvent.type === "agent_settled" || safeEvent.type === "run_completed")) {
        this.state = { ...this.state, isStreaming: false };
        this.activeRequestId = undefined;this.reportOrigin=false;
        settled = true;
        lifecycle = true;
        // Whatever dialogs were open have been answered or timed out by now.
        this.pendingUi.clear();
        if (this.sinks.size === 0) this.unseenSettle = true;
      }
    }
    this.cursor += 1;
    // Pi appends a message to its session file when the message ends, so from
    // this cursor on the durable history is complete up to and including it.
    if (isRecord(safeEvent) && (safeEvent.type === "message_end" || (safeEvent.type === "agent_settled" || safeEvent.type === "run_completed"))) {
      this.lastMessageEndCursor = this.cursor;
    }
    const frame: ServerFrame = {
      v: 1,
      type: "event",
      sessionId: this.id,
      cursor: this.cursor,
      event: safeEvent,
      ...(this.activeRequestId === undefined ? {} : { requestId: this.activeRequestId }),
    };
    this.events.push(frame);
    while (this.events.length > this.eventBufferSize) this.events.shift();
    if (isRecord(safeEvent) && (safeEvent.type === "extension_ui_request" || safeEvent.type === "native_request") && typeof safeEvent.id === "string" && isDialogMethod(safeEvent.method)) {
      this.pendingUi.set(safeEvent.id, frame);
      lifecycle = true; // the list's "waiting" flag changed
    }
    for (const sink of this.sinks) sink.send(frame);
    if (settled) {void this.refreshState();void this.exportHistory();this.scheduleIdleCheck();this.inputs.wake();}
    if (lifecycle) this.onLifecycle?.(this);
  }

  private exportHistory(history?:PiHistory):Promise<void>{
    if(!this.onHistory)return Promise.resolve();
    const pi=this.pi;
    this.historyExport=this.historyExport.then(async()=>{
      if(history)await this.onHistory!(this.id,history);
      else if(pi)await this.onHistory!(this.id,await pi.getHistory());
    }).catch(()=>{console.warn('Task history export unavailable for '+this.id+'; native history remains authoritative');});
    return this.historyExport;
  }
  private async refreshState(): Promise<void> {
    if (!this.pi) return;
    try {
      const cursor=this.cursor;const state=await this.pi.getState();
      if(this.cursor===cursor)this.state=state;
    } catch {
      // The authoritative lifecycle event has already been forwarded. A
      // transient state refresh failure must not tear down a live session.
    }
  }
}

class DeliveryCancelledError extends Error {
  constructor(){super('Instruction cancelled by Stop before native delivery');this.name='DeliveryCancelledError';}
}

export class SessionBusyError extends Error {
  constructor() {
    super("A prompt is already running for this session");
    this.name = "SessionBusyError";
  }
}

export class HostSessionRegistry {
  private readonly factory: PiSessionFactory;
  private readonly eventBufferSize: number;
  private readonly idleTimeoutMs: number;
  private readonly sessions = new Map<string, HostSession>();
  private listing?:Promise<PiSessionListing[]>;
  private readonly changeListeners = new Set<(session?:HostSession) => void>();

  private readonly externalPollMs?: number;

  async supportsDispatchCorrelation(id:string){return await this.factory.supportsDispatchCorrelation?.(id)??false;}
  async readRunEvidence(id:string,runId?:string){return await this.sessions.get(id)?.readRunEvidence(runId)??await this.factory.readRunEvidence?.(id,runId)??{supported:false,freshness:'unknown' as const,state:'uncertain' as const,reason:'Engine has no verified passive run evidence capability'};}
  constructor(private options: { runStatuses?:()=>Promise<Map<string,Pick<SessionSummary,"runStatus"|"completionId"|"completedAt">>>; runnerGuidance?:HostSessionOptions['runnerGuidance']; onCommand?:HostSessionOptions["onCommand"]; onEvent?:HostSessionOptions["onEvent"]; onRun?:HostSessionOptions["onRun"]; onHistory?:(id:string,history:PiHistory)=>Promise<void>; factory: PiSessionFactory; eventBufferSize?: number; idleTimeoutMs?: number; externalPollMs?: number }) {
    this.factory = options.factory;
    this.eventBufferSize = options.eventBufferSize ?? 256;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60 * 1000;
    this.externalPollMs = options.externalPollMs;
  }

  /** Fires whenever the conversation list may have changed (new, settled, renamed, deleted, retired). */
  onChange(listener: (session?:HostSession) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(session?:HostSession): void {
    for (const listener of this.changeListeners) {
      try { listener(session); } catch { /* a bad listener must not break the registry */ }
    }
  }

  private sessionFor(id?:string):HostSession {
    const existing=id===undefined?undefined:this.sessions.get(id);
    if(existing)return existing;
    const session=new HostSession({
      ...(id === undefined ? {} : { id }),
      factory: this.factory,
      runnerGuidance:this.options.runnerGuidance,
      eventBufferSize: this.eventBufferSize,
      idleTimeoutMs: this.idleTimeoutMs,
      ...(this.externalPollMs === undefined ? {} : { externalPollMs: this.externalPollMs }),
      onIdle: (idle) => void this.retire(idle),
      onLifecycle: (session) => this.notifyChange(session),
      completionForHistory:this.options.runStatuses?async id=>{const metadata=(await this.options.runStatuses!()).get(id);return metadata?.runStatus==='settled'?metadata.completionId??null:null;}:undefined,
      onHistory:this.options.onHistory,
      onRun:this.options.onRun,
      onEvent:this.options.onEvent,onCommand:this.options.onCommand,
    });
    this.sessions.set(session.id, session);
    return session;
  }

  /** v2 control attachment does not load, project or export full native history. */
  async connect(id:string):Promise<HostSession> {const session=this.sessionFor(id);await session.start();return session;}

  async open(id?: string, after?: number): Promise<SessionOpenResult> {
    const existing=id===undefined?undefined:this.sessions.get(id);
    const session=this.sessionFor(id);
    try {
      const result = await session.prepare(after);
      if (!existing) this.notifyChange();
      return result;
    } catch (error) {
      if (!existing) {
        this.sessions.delete(session.id);
        await session.stop().catch(() => undefined);
      }
      throw error;
    }
  }

  /** Rename any conversation; a stored-but-idle one is resumed for the call. */
  async rename(id: string, name: string): Promise<void> {
    const existing=this.sessions.get(id);
    const session=this.sessionFor(id);
    try {
      // Naming needs the native binding, not the full transcript projection/export.
      await session.start();await session.rename(name);this.notifyChange();
    }catch(error){
      if(!existing){this.sessions.delete(session.id);await session.stop().catch(()=>undefined);}
      throw error;
    }
  }

  /** Delete a conversation from the store, stopping its Pi process first. */
  async delete(id: string): Promise<boolean> {
    if (this.sessions.get(id)?.isBusy) throw new SessionBusyError();
    const live = this.sessions.get(id);
    if (live) {
      this.sessions.delete(id);
      await live.stop().catch(() => undefined);
    }
    const removed = await this.factory.delete(id);
    this.notifyChange();
    return removed || live !== undefined;
  }

  /** Durable conversations from the store, decorated with what is live right now. */
  async list(): Promise<SessionSummary[]> {
    // Share only an in-flight read within this user's registry. Never cache a
    // completed result or its live running/queue/attention decoration.
    const stored = await (this.listing ??= this.factory.list().finally(() => {
      this.listing = undefined;
    }));
    const known = new Set(stored.map((item) => item.id));
    // Pi writes the session file at startup; a conversation nobody has spoken
    // in yet is noise in a shared list (the opening browser shows it locally).
    const summaries: SessionSummary[] = stored

      .filter((item) => item.messageCount > 0 || item.engine && item.engine!=="pi")
      .map((item) => {
        const live = this.sessions.get(item.id);
        const attention = live?.attention;
        return { ...item, running: Boolean(live?.isStreaming||live?.isTransitioning), ...(live?.queueFrame.items.length?{queued:live.queueFrame.items.length}:{}), ...(attention === undefined ? {} : { attention }) };
      });

    // A conversation that was just opened has no file yet (Pi writes it with
    // the first message). Like Codex, it only appears in everyone's list once
    // it has content; the browser that opened it shows it locally meanwhile.
    for (const session of this.sessions.values()) {
      if (known.has(session.id) || (session.currentState.messageCount === 0 && !session.queueFrame.items.length)) continue;
      const now = new Date().toISOString();
      summaries.unshift({
        id: session.id,
        createdAt: now,
        updatedAt: now,
        messageCount: session.currentState.messageCount,
        preview: "",
        running: session.isStreaming||session.isTransitioning,
        ...(session.queueFrame.items.length?{queued:session.queueFrame.items.length}:{}),
        ...(session.attention === undefined ? {} : { attention: session.attention }),
      });
    }
    const statuses=await this.options.runStatuses?.();
    return summaries.map(item=>{
      const status=statuses?.get(item.id);
      return {...item,...(status??{})};
    });
  }

  async stopIdle(id:string):Promise<void> {
    const session=this.sessions.get(id);if(!session)return;
    if(session.isBusy)throw new SessionBusyError();
    await session.stop();this.sessions.delete(id);this.notifyChange();
  }

  get(id: string): HostSession | undefined {
    return this.sessions.get(id);
  }

  private async retire(session: HostSession): Promise<void> {
    if (this.sessions.get(session.id) !== session) return;
    this.sessions.delete(session.id);
    const empty = session.currentState.messageCount === 0;
    await session.stop().catch(() => undefined);
    // An abandoned empty conversation leaves no trace in the store.
    if (empty) await this.factory.delete(session.id).catch(() => undefined);
    this.notifyChange();
  }

  async close(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.stop()));
    this.sessions.clear();
  }
}

function isDialogMethod(method: unknown): boolean {
  return method === "select" || method === "confirm" || method === "input" || method === "editor";
}

function toJsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 12) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const output: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) output[key] = toJsonValue(item, depth + 1);
    return output;
  }
  return String(value);
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
