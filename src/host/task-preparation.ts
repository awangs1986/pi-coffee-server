import {holdTaskLifecycle} from './task-lifecycle.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {ForkTurnFailure} from './fork.js';
import type {AgentHistory} from './agent-adapter.js';
import {bounded,preparationExecution,readPreparationArtifact} from './preparation-execution.js';
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {durableJson, privateDir, readJson, sha} from './restore-files.js';
import {parseAgentEngine, CHAT_ENGINES, type AgentEngine} from '../shared/protocol.js';
import {PI_ONLY_ENGINES, type AgentSessionFactory, type AgentSession} from './agent-adapter.js';
import type {Workspaces, Conversation} from './workspaces.js';

export interface PreparationBudgets {stageMs:number;operationMs:number;cleanupMs:number;}
export const PREPARATION_BUDGETS:PreparationBudgets={stageMs:120000,operationMs:600000,cleanupMs:10000};
export type PreparationKind='create-chat'|'create-work'|'native-fork'|'handoff-fork';
export type PreparationStatus='accepted'|'running'|'finalizing'|'completed'|'failed'|'cancelled'|'uncertain';
export interface PreparationInput {operationId:string;targetTaskId:string;kind:PreparationKind;engine?:AgentEngine;projectId?:string;branch?:string;sourceId?:string;acceptDrift?:boolean;}
export interface PreparationView {operationId:string;targetTaskId:string;kind:PreparationKind;revision:number;status:PreparationStatus;phase:string;error?:string;receipts?:{publication?:{digest:string};summary?:{digest:string};turns?:{[phase:string]:import('./fork.js').ForkTurnReceipt&{operationId:string}};source?:{binding:string;leafId:string|null;digest:string}};allowedActions:('cancel'|'resume')[];task?:Conversation;}
interface Record extends PreparationView {schema:1;input:PreparationInput;completedStages:string[];failedPhase?:string;}
const publicationDigest=(task:Conversation)=>sha(JSON.stringify({id:task.id,engine:task.engine??'pi',cwd:task.cwd,nativeBinding:task.nativeBinding?{state:task.nativeBinding.state,id:task.nativeBinding.id,requestedId:task.nativeBinding.requestedId}:undefined}));
const identity=(value:unknown)=>{if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value))throw Error('Invalid preparation identity');return value;};
/** One coordinator per authenticated Host scope. Browser-supplied owners are never accepted. */
export class TaskPreparation {
 private readonly records=new Map<string,Record>();
 private readonly targets=new Map<string,Record>();
 private readonly running=new Map<string,Promise<void>>();
 private readonly releases=new Map<string,()=>void>();
 private readonly inFlight=new Map<string,Set<Promise<unknown>>>();
 private initialized?:Promise<void>;
 private readonly controllers=new Map<string,AbortController>();
 private tail:Promise<unknown>=Promise.resolve();
 private writes:Promise<void>=Promise.resolve();
 private closing=false;
 private get budgets(){return this.options.budgets??PREPARATION_BUDGETS;}
 private readonly root:string;
 private lease?:FileLease;
 constructor(private readonly options:{workspaces:Workspaces;factory:AgentSessionFactory;locks:Set<string>;changed:()=>void;sourceBusy?:(id:string)=>boolean|Promise<boolean>;budgets?:PreparationBudgets}) {this.root=join(options.workspaces.root,'.coffee','preparations');}
 async ready(){await this.load();}
 private async load(){return this.initialized??=this.initialize();}
 private async initialize(){
  await privateDir(this.root,true);
  this.lease=acquireFileLease(join(this.root,'owner.lock'),'exclusive');if(!this.lease)throw Error('Another Host owns task preparation');
  for(const file of await readdir(this.root)){
   if(!file.endsWith('.json'))continue;
   const record:Record=await readJson(join(this.root,file));
   if(record.schema!==1||file!==identity(record.operationId)+'.json'||record.targetTaskId!==record.input.targetTaskId)throw Error('Preparation journal identity mismatch');
   if(['accepted','running','finalizing'].includes(record.status)){
    const task=await this.options.workspaces.lookup(record.targetTaskId);
    if(record.status==='finalizing'&&record.completedStages.includes('cleanup')&&task?.preparationId===record.operationId&&!task.archived&&!task.workspaceRemoved&&!task.cleanupStarted&&record.receipts?.publication?.digest===publicationDigest(task)){
      record.status='completed';record.phase='completed';record.allowedActions=[];delete record.error;
    }else if(record.status==='accepted'&&record.phase==='accepted'&&!record.completedStages.length){
      record.status='failed';record.error='Host restarted before preparation began; explicit resume is available';record.allowedActions=['resume'];
    }else{
      record.status='uncertain';record.error='Host restarted during preparation; no native/model work was replayed';record.allowedActions=[];
    }
    record.revision++;await this.save(record);
   }
   this.records.set(record.operationId,record);this.targets.set(record.targetTaskId,record);
   if(record.status==='uncertain')this.hold(record);
  }
  this.options.workspaces.preparationProjection=task=>this.project(task);
 }
 private hold(record:Record){this.releases.set(record.operationId,holdTaskLifecycle(this.options.locks,[record.targetTaskId,...record.input.sourceId?[record.input.sourceId]:[]]));}
 private release(record:Record){this.releases.get(record.operationId)?.();this.releases.delete(record.operationId);}
 private publicStatus(record:Record):PreparationStatus {
  return record.status==='completed'&&this.running.has(record.operationId)?'finalizing':record.status;
 }
 private project(task:Conversation):Conversation {
  const source=task.forking?this.targets.get(task.forking.targetId):undefined;
  if(source?.input.sourceId===task.id&&this.running.has(source.operationId)&&task.forking)task={...task,forking:{...task.forking,status:'preparing'}};

  if(!task.preparationId||task.recoveryReceipt)return task;const record=this.records.get(task.preparationId);
  if(!record)return {...task,creationState:'failed',creationError:'Preparation journal unavailable'};
  const status=this.publicStatus(record);
  return {...task,creationState:status==='completed'?'ready':['failed','cancelled','uncertain'].includes(status)?'failed':'creating',...(record.error?{creationError:record.error}:{}),...(task.fork?{fork:{...task.fork,status:status==='completed'?'completed':['failed','cancelled','uncertain'].includes(status)?'failed':'preparing',...(record.error?{error:record.error}:{})}}:{})};
 }
 private serialize<T>(run:()=>Promise<T>):Promise<T>{const next=this.tail.then(run);this.tail=next.catch(()=>undefined);return next;}
 private async save(record:Record){
  const {task:_task,...durable}=record;const snapshot=structuredClone(durable),write=async()=>{this.lease?.assertHeld();await durableJson(join(this.root,record.operationId+'.json'),snapshot);};
  const next=this.writes.then(()=>this.options.workspaces.backupWriterFence?this.options.workspaces.backupWriterFence.runWriter('platform',write):write());
  this.writes=next.catch(()=>undefined);await next;this.options.changed();
 }
 private view(record:Record):PreparationView {const {schema:_,input:__,completedStages:___,failedPhase:____,...view}=record;const status=this.publicStatus(record);return structuredClone({...view,status,...(status!==record.status?{phase:'publication'}:{}),...(record.task?{task:this.project(record.task)}:{})});}
 async get(id:unknown){await this.load();await this.writes;const record=this.records.get(identity(id));if(!record)throw Error('Unknown preparation');record.task=await this.options.workspaces.lookup(record.targetTaskId);return this.view(record);}
 async start(raw:PreparationInput):Promise<PreparationView>{
  await this.load();return this.serialize(async()=>{
   if(this.closing)throw Error('Host is stopping');
   const input:PreparationInput={operationId:identity(raw.operationId),targetTaskId:identity(raw.targetTaskId),kind:raw.kind,engine:parseAgentEngine(raw.engine),...(raw.projectId?{projectId:raw.projectId}:{}),...(raw.branch?{branch:raw.branch}:{}),...(raw.sourceId?{sourceId:identity(raw.sourceId)}:{}),...(raw.acceptDrift===true?{acceptDrift:true}:{})};
   if(!/^[a-zA-Z0-9-]{1,100}$/.test(input.targetTaskId))throw Error('Invalid target task identity');
   for(const value of [input.projectId,input.branch])if(value!==undefined&&(typeof value!=='string'||value.length>512||/[\r\n\0]/.test(value)))throw Error('Invalid project or branch');
   if(typeof input.kind!=='string')throw Error('Invalid preparation kind');
   if(input.kind.endsWith('fork')){if(!input.sourceId||raw.engine!==undefined||raw.projectId!==undefined||raw.branch!==undefined)throw Error('Invalid Fork preparation fields');}
   else if(raw.sourceId!==undefined||raw.acceptDrift!==undefined||input.kind==='create-chat'&&(raw.projectId!==undefined||raw.branch!==undefined))throw Error('Creation cannot include Fork or repository fields');
   const prior=this.records.get(input.operationId);
   if(prior){if(input.sourceId)input.engine=prior.input.engine;if(JSON.stringify(prior.input)!==JSON.stringify(input))throw Error('Preparation identity belongs to another request');prior.task=await this.options.workspaces.lookup(prior.targetTaskId);return this.view(prior);}
   if(!['create-chat','create-work','native-fork','handoff-fork'].includes(input.kind))throw Error('Unsupported preparation kind');
   if(input.kind==='create-chat'&&!CHAT_ENGINES.includes(input.engine!))throw Error('Chat is available with Pi or Codex');
   if(input.kind==='create-work'&&!(await this.options.workspaces.list()).projects.some(p=>p.id===input.projectId))throw Error('Unknown project');
   if(input.kind.endsWith('fork')){
    const source=input.sourceId?await this.options.workspaces.lookup(input.sourceId):undefined;
    if(!source||source.archived||source.cleanupStarted||source.workspaceRemoved||source.creationState==='failed'||source.fork&&source.fork.status!=='completed')throw Error('Unknown or unavailable Fork source');
    await this.options.workspaces.assertPreparationReady(source);if(source.creationState&&source.creationState!=='ready')throw Error('Source task is not ready');
    input.engine=source.engine??'pi';
    if(!this.options.factory.forkModes?.(input.engine).includes(input.kind==='native-fork'?'native':'handoff'))throw Error('Selected Fork mode unavailable');
    if(input.kind==='handoff-fork'&&!input.acceptDrift)throw Error('Confirm possible Handoff drift and model cost');
   }
   if(this.running.size>=2)throw Error('Two task preparations are already active; wait for one to finish');
   if(this.options.locks.has(input.targetTaskId)||await this.options.workspaces.lookup(input.targetTaskId))throw Error('Preparation destination already exists');
   if(input.sourceId&&this.options.locks.has(input.sourceId))throw Error('Source task lifecycle is busy');
   const record:Record={schema:1,input,...input,revision:1,status:'accepted',phase:'accepted',completedStages:[],allowedActions:['cancel']};
   this.hold(record);
   try{if(input.sourceId&&await this.options.sourceBusy?.(input.sourceId))throw Error('Source task lifecycle is busy');await this.save(record);}catch(error){this.release(record);throw error;}
   this.records.set(record.operationId,record);this.targets.set(record.targetTaskId,record);
   const view=this.view(record);
   this.controllers.set(input.operationId,new AbortController());
   const running=this.execute(record);this.running.set(input.operationId,running);void running.finally(()=>{this.running.delete(input.operationId);this.options.changed();}).catch(()=>undefined);
   return view;
  });
 }
 async cancel(id:unknown,expectedRevision:unknown){
  await this.load();return this.serialize(async()=>{
   const record=this.records.get(identity(id));if(!record||record.revision!==expectedRevision)throw Error('Preparation revision changed');
   if(!record.allowedActions.includes('cancel'))throw Error('Preparation cannot be cancelled');
   record.allowedActions=[];record.error='Preparation cancellation requested';record.revision++;await this.save(record);
   this.controllers.get(record.operationId)?.abort(Error('Preparation cancelled by user'));
   return this.view(record);
  });
 }
 async resume(id:unknown,expectedRevision:unknown):Promise<PreparationView>{
  await this.load();
  // A terminal journal write can precede the final lock/projection release by
  // one disk write. Join that owned tail; never race its controller or create a
  // second execution merely because the Browser saw the saved failure first.
  const current=this.records.get(identity(id));
  if(current?.status==='failed'&&current.revision===expectedRevision&&current.allowedActions.includes('resume'))await this.running.get(current.operationId);
  return this.serialize(async()=>{
   const record=this.records.get(identity(id));
   if(!record||record.revision!==expectedRevision)throw Error('Preparation revision changed');
   if(this.closing||this.running.size>=2||!record.allowedActions.includes('resume')||this.running.has(record.operationId))throw Error('Preparation outcome must be inspected before resume');
   const target=await this.options.workspaces.lookup(record.targetTaskId),source=record.input.sourceId?await this.options.workspaces.lookup(record.input.sourceId):undefined;
   if(target&&(target.archived||target.cleanupStarted||target.workspaceRemoved)||record.input.sourceId&&(!source||source.archived||source.cleanupStarted||source.workspaceRemoved))throw Error('Preparation task or source is unavailable');
   if(this.options.locks.has(record.targetTaskId)||record.input.sourceId&&this.options.locks.has(record.input.sourceId))throw Error('Task lifecycle is busy');
   this.hold(record);
   try{if(record.input.sourceId&&await this.options.sourceBusy?.(record.input.sourceId))throw Error('Source task lifecycle is busy');}catch(error){this.release(record);throw error;}
   record.status='accepted';record.phase='resume';record.allowedActions=['cancel'];delete record.error;record.revision++;try{await this.save(record);}catch(error){this.release(record);throw error;}
   this.controllers.set(record.operationId,new AbortController());const view=this.view(record);
   const running=this.execute(record);this.running.set(record.operationId,running);void running.finally(()=>{this.running.delete(record.operationId);this.options.changed();}).catch(()=>undefined);return view;
  });
 }
 private track<T>(record:Record,run:()=>Promise<T>):Promise<T>{
  const operations=this.inFlight.get(record.operationId)??new Set<Promise<unknown>>();this.inFlight.set(record.operationId,operations);
  const work=Promise.resolve().then(run);operations.add(work);
  const finished=()=>{operations.delete(work);if(!operations.size)this.inFlight.delete(record.operationId);};void work.then(finished,finished);return work;
 }
 private async stage<T>(record:Record,name:string,run:()=>Promise<T>):Promise<T>{
  const controller=this.controllers.get(record.operationId)!;controller.signal.throwIfAborted();
  record.status='running';record.phase=name;record.revision++;await this.save(record);
  const duration=['summary','seed'].includes(name)?Math.max(this.budgets.stageMs,180000):this.budgets.stageMs;
  const deadline=Date.now()+duration;
  const work=this.track(record,()=>preparationExecution.run({operationId:record.operationId,signal:controller.signal,deadline},()=>Promise.resolve().then(run)));
  const result=await bounded(()=>work,duration,controller.signal);
  controller.signal.throwIfAborted();record.completedStages.push(name);record.revision++;await this.save(record);return result;
 }
 private async inspectSource(id:string){
  const factory=this.options.factory;if(factory.inspectForkSource)return factory.inspectForkSource(id);
  const session=await factory.create({sessionId:id,requireExisting:true});
  try{
   const state=await session.getState(),background=await session.backgroundState?.();
   if(state.isStreaming||state.isCompacting||!background?.known||background.active)throw Error('Finish running work, queued input, compaction and questions before Fork');
   const history=await session.getHistory(),models=await session.getModels(),after=await session.getState();
   if(after.isStreaming||after.isCompacting)throw Error('Source resumed during preparation');
   return {history,binding:session.getHistoryBinding?.()??id,title:state.sessionName,settings:{...(models.current?{model:{provider:models.current.provider,id:models.current.id}}:{}),thinkingLevel:models.thinkingLevel,contextPreset:models.context?.preset}};
  }finally{await preparationExecution.exit(()=>bounded(()=>session.stop(),this.budgets.cleanupMs));}
 }
 private async execute(record:Record){
  const {workspaces:ws,factory}=this.options;let session:AgentSession|undefined;
  const timer=setTimeout(()=>this.controllers.get(record.operationId)?.abort(Error('Preparation operation deadline exceeded')),this.budgets.operationMs);
  try{
   await this.stage(record,'readiness',async()=>{const available=factory.engineAvailability?await factory.engineAvailability(record.input.engine!):(await factory.engines?.()??PI_ONLY_ENGINES).find(e=>e.id===record.input.engine);if(!available?.available)throw Error(available?.reason??'Agent unavailable');});
   if(record.input.sourceId){
    const sourceId=record.input.sourceId,mode=record.kind==='native-fork'?'native':'handoff';
    if(!record.receipts?.summary){
    const captured=await this.stage(record,'source-snapshot',async()=>{
      if(await this.options.sourceBusy?.(sourceId))throw Error('Source task resumed');
      const result=await this.inspectSource(sourceId);
      if(await this.options.sourceBusy?.(sourceId))throw Error('Source task resumed');
      if(Buffer.byteLength(JSON.stringify(result))>32*1024*1024)throw Error('Source history exceeds preparation evidence budget');
      record.receipts={...record.receipts,source:{binding:result.binding,leafId:result.history.leafId,digest:sha(JSON.stringify(result.history))}};
      return result;
    });
    await this.stage(record,'workspace',async()=>{
      const title=((captured.title||captured.history.entries.find(e=>e.kind==='user')?.text||'新对话').replace(/\s+/g,' ').trim().slice(0,140))+' · Fork';
      await ws.beginFork(sourceId,record.targetTaskId,mode,title,captured.settings);
      await ws.copyForkWorkspace(record.targetTaskId,captured.history);
    });
    }
    const history:AgentHistory=JSON.parse(await readPreparationArtifact(join(await ws.forkRecordsDirectory(record.targetTaskId),'source-history.json'),32*1024*1024));
    if(sha(JSON.stringify(history))!==record.receipts?.source?.digest)throw Error('Source snapshot changed; resume refused');
    const signal=this.controllers.get(record.operationId)!.signal;
    if(mode==='native')await this.stage(record,'native-binding',()=>factory.forkConversation!(sourceId,record.targetTaskId,mode,history));
    else await preparationExecution.run({operationId:record.operationId,signal,deadline:Date.now()+this.budgets.operationMs},()=>bounded(()=>this.track(record,()=>factory.forkConversation!(sourceId,record.targetTaskId,mode,history,{
      signal,summary:record.receipts?.summary,turnCompleted:async(phase,receipt)=>{record.receipts={...record.receipts,turns:{...record.receipts?.turns,[phase]:{...receipt,operationId:record.operationId}}};record.revision++;await this.save(record);},stage:(name,run)=>this.stage(record,name,run),summarySaved:async digest=>{record.receipts={...record.receipts,summary:{digest}};record.revision++;await this.save(record);}
    })),this.budgets.operationMs,signal));
    await this.stage(record,'cleanup',async()=>{});
    await ws.finishFork(record.targetTaskId);
   }else{
    await this.stage(record,'workspace',()=>record.kind==='create-chat'?ws.createChatConversation(record.targetTaskId,record.input.engine):ws.createConversation(record.input.projectId!,record.input.branch,record.targetTaskId,record.input.engine));
    await this.stage(record,'native-binding',async()=>{session=await factory.create({sessionId:record.targetTaskId});await session.getState();const task=await ws.lookup(record.targetTaskId);if(task&&(task.engine??'pi')==='pi'&&!task.nativeBinding)await ws.setNativeBinding(task.id,{state:'bound',id:task.id});});
    await this.stage(record,'cleanup',async()=>{await session?.stop();session=undefined;await factory.resetTaskRuntime?.(record.targetTaskId);});
   }
   const prepared=await ws.lookup(record.targetTaskId);
   if(!prepared||prepared.preparationId!==record.operationId||prepared.archived||prepared.workspaceRemoved||prepared.cleanupStarted)throw Error('Prepared task identity changed before publication');
   if((prepared.engine??'pi')==='pi'&&!prepared.nativeBinding)await ws.setNativeBinding(prepared.id,{state:'bound',id:prepared.id});
   record.receipts={...record.receipts,publication:{digest:publicationDigest(prepared)}};
   record.status='finalizing';record.allowedActions=[];record.phase='publication';record.revision++;await this.save(record);
   record.task=await ws.lookup(record.targetTaskId);record.allowedActions=[];record.status='completed';record.phase='completed';record.revision++;await this.save(record);
  }catch(error){
   const failedPhase=record.phase,wasCancelled=this.controllers.get(record.operationId)?.signal.aborted;
   const uncertain=Boolean((error as {cleanupUncertain?:boolean})?.cleanupUncertain)||(failedPhase==='workspace'&&(wasCancelled||/deadline|timed out/i.test(error instanceof Error?error.message:'')))||!(error instanceof ForkTurnFailure)&&['native-binding','summary-binding','seed-binding','summary','seed','settings','cleanup'].includes(record.phase);
   record.failedPhase=failedPhase;
   this.controllers.get(record.operationId)?.abort(error);
   record.error=(error instanceof Error?error.message:'Preparation failed').slice(0,1000);record.allowedActions=[];record.phase='cleanup';record.revision++;await this.save(record);
   try{
    await bounded(async()=>{await Promise.allSettled(this.inFlight.get(record.operationId)??[]);await session?.stop();await factory.resetTaskRuntime?.(record.targetTaskId);},this.budgets.cleanupMs);
    record.status=uncertain?'uncertain':wasCancelled?'cancelled':'failed';
   }catch{record.status='uncertain';}
   if(record.status==='failed'&&['readiness','workspace'].includes(failedPhase)&&record.kind.startsWith('create-'))record.allowedActions=['resume'];
   if(record.status==='failed'&&error instanceof ForkTurnFailure&&failedPhase==='seed'&&record.receipts?.summary&&record.input.engine==='codex')record.allowedActions=['resume'];
   record.task=await ws.lookup(record.targetTaskId);record.revision++;await this.save(record);
   if(record.input.sourceId&&(await ws.lookup(record.targetTaskId))?.fork)await ws.finishFork(record.targetTaskId,record.error);

  }finally{clearTimeout(timer);if(record.status!=='uncertain')this.release(record);this.controllers.delete(record.operationId);this.options.changed();}
 }
 async close(){this.closing=true;for(const controller of this.controllers.values())controller.abort(Error('Host stopped during preparation'));await Promise.allSettled(this.running.values());await this.writes;this.lease?.release();}
}
