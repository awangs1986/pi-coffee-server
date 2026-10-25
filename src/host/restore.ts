import {randomUUID} from 'node:crypto';
import {mkdir,readdir,rename,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import type {BackupRepository} from './backup-repository.js';
import {verifySealedCheckpoint,type CheckpointManifest,type CaptureLease} from './backup.js';
import type {Conversation,Project,Workspaces} from './workspaces.js';
import {durableJson,exists,privateDir,readJson,restoreFail,restoreLock,sha,syncDir,treeDigest} from './restore-files.js';
export interface RestoreAction {source:string;target:string;phase:'task'|'native';digest:string;dev:number;ino:number;parent:{dev:number;ino:number;uid:number};}
export interface NativeRestorePreparation {conversation:Conversation;project?:Project;actions:RestoreAction[];nativeBindings:string[];warnings:string[];}
export interface NativeRestoreAdapter {
 readonly version:string;
 prepareRestore(point:{directory:string;manifest:CheckpointManifest},scope:string,taskId:string,staging:string):Promise<NativeRestorePreparation>;
 restoreLease():Promise<CaptureLease>;
}
export interface RestoreScope {workspaces:Workspaces;adapter?:NativeRestoreAdapter;withPublication?:<T>(taskId:string,run:()=>Promise<T>)=>Promise<T>;}
export interface RestorePlan {
 schemaVersion:1;id:string;scope:string;taskId:string;jobId:string;requestedBy:string;revision:number;createdAt:string;updatedAt:string;
 state:'requested'|'staged'|'approved'|'publishing'|'cancelled'|'completed'|'completed-after-cancel'|'failed';phase:'requested'|'prepared'|'task'|'native'|'registry'|'complete';
 checkpointId?:string;manifestSha256?:string;adapterVersion?:string;nativeBindings?:string[];digest?:string;approvedBy?:string;approvedRevision?:number;approvalDigest?:string;cancelRequested?:boolean;errorCode?:string;
 plan?:{conversation:Conversation;project?:Project;actions:RestoreAction[];expectedRegistry:string|null;registryDigest:string;warnings:string[]};
}
export interface RestoreCoordinatorOptions {root:string;repository?:BackupRepository;scope:(scope:string)=>Promise<RestoreScope>;authorize:(actor:string,scope:string,manage:boolean)=>Promise<boolean>;now?:()=>number;onPublication?:(event:{operationId:string;scope:string;taskId:string;phase:'task'|'native'|'registry'})=>Promise<void>;}
/** Independent trusted job API. Actor and dataScope are separate; HTTP handlers
 * supply authenticated identity. Durable stages reconcile actual side effects,
 * including a crash after publication but before its journal update. */
export class RestoreCoordinator {
 readonly root:string;constructor(private options:RestoreCoordinatorOptions){this.root=resolve(options.root);}
 private async allowed(actor:string,scope:string,manage:boolean){if(!await this.options.authorize(actor,scope,manage))throw restoreFail('forbidden');}
 private date(){return new Date((this.options.now??Date.now)()).toISOString();}
 private path(id:string){if(!/^[0-9a-f-]{36}$/.test(id))throw restoreFail('invalid_operation');return join(this.root,id+'.json');}
 private async save(plan:RestorePlan){plan.updatedAt=this.date();await durableJson(this.path(plan.id),plan);}
 private async read(id:string):Promise<RestorePlan>{return readJson(this.path(id));}
 private public(plan:RestorePlan){const {plan:internal,...safe}=plan;return {...safe,...(internal?{warnings:internal.warnings,originalPaths:internal.actions.map(a=>a.target)}:{}),protectionScope:['pi','codex'],excludedEngines:['claude','cursor','grok'],authenticationRestored:false,automaticReplay:false};}
 async status(actor:string,scope:string){await this.allowed(actor,scope,actor!==scope);await privateDir(this.root,true);const result=[];for(const name of await readdir(this.root)){if(!/^[0-9a-f-]{36}\.json$/.test(name))continue;const p=await this.read(name.slice(0,-5));if(p.scope===scope)result.push(this.public(p));}return result;}
 async request(actor:string,scope:string,input:{taskId:string;jobId:string}){await this.allowed(actor,scope,actor!==scope);if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.taskId)||!/^[0-9a-f-]{36}$/.test(input.jobId))throw restoreFail('invalid_identity');return restoreLock(this.root,async()=>{const p:RestorePlan={schemaVersion:1,id:randomUUID(),scope,taskId:input.taskId,jobId:input.jobId,requestedBy:actor,revision:1,createdAt:this.date(),updatedAt:this.date(),state:'requested',phase:'requested'};await this.save(p);return this.public(p);});}
 async operate(actor:string,id:string,input:{action:'plan'|'revise'|'approve'|'publish'|'cancel';revision:number;digest?:string}){
  // Cancellation remains visible even if the publishing worker currently owns the lock.
  if(input.action==='cancel'){const p=await this.read(id);await this.allowed(actor,p.scope,actor!==p.requestedBy);if(input.revision!==p.revision)throw restoreFail('stale_revision');await durableJson(join(this.root,id+'.cancel'),{revision:p.revision,at:this.date(),actor});try{return await restoreLock(this.root,async()=>{const current=await this.read(id);await this.applyCancel(current);return this.public(current);});}catch(e){if((e as {code?:string}).code==='operation_active')return {...this.public(p),cancelRequested:true};throw e;}}
  return restoreLock(this.root,async()=>{const p=await this.read(id);await this.allowed(actor,p.scope,true);if(input.revision!==p.revision)throw restoreFail('stale_revision');await this.applyCancel(p);if(['completed','completed-after-cancel'].includes(p.state)){if(input.action==='publish')return this.public(p);throw restoreFail('operation_complete');}if(p.state==='cancelled')throw restoreFail('operation_cancelled');
   if(input.action==='revise'){if(p.phase!=='requested'&&p.phase!=='prepared')throw restoreFail('publication_started');p.revision++;p.state='requested';p.phase='requested';delete p.plan;delete p.digest;delete p.approvalDigest;delete p.approvedBy;delete p.approvedRevision;await this.save(p);return this.public(p);}
   if(input.action==='plan'){if(p.state!=='requested')throw restoreFail('plan_already_staged');await this.prepare(p);return this.public(p);}
   if(input.action==='approve'){if(p.state!=='staged'||input.digest!==p.digest)throw restoreFail('stale_approval');p.approvedBy=actor;p.approvedRevision=p.revision;p.approvalDigest=p.digest;p.state='approved';await this.save(p);return this.public(p);}
   if(input.action==='publish'){if(!p.plan||!p.approvedBy||p.approvedRevision!==p.revision||p.approvalDigest!==p.digest||input.digest!==p.digest)throw restoreFail('approval_required');await this.allowed(p.approvedBy,p.scope,true);await this.publish(p);return this.public(p);}
   throw restoreFail('invalid_action');
  });
 }
 private async cancelled(p:RestorePlan){if(!await exists(join(this.root,p.id+'.cancel')))return false;const c=await readJson(join(this.root,p.id+'.cancel'));return c.revision===p.revision;}
 private async applyCancel(p:RestorePlan){if(!await this.cancelled(p))return;p.cancelRequested=true;if(p.phase==='complete')p.state='completed-after-cancel';else if(p.phase==='requested'||p.phase==='prepared'&&['staged','approved'].includes(p.state))p.state='cancelled';await this.save(p);}
 private async prepare(p:RestorePlan){
  const repository=this.options.repository;if(!repository)throw restoreFail('repository_unavailable');const job=(await repository.jobs()).find(j=>j.id===p.jobId&&j.state==='succeeded'),point=job?.points.find(x=>x.scope===p.scope&&x.taskId===p.taskId);if(!point)throw restoreFail('checkpoint_scope_mismatch');
  const scope=await this.options.scope(p.scope);if(!scope.adapter)throw restoreFail('native_adapter_unavailable');
  const stage=join(this.root,p.id+'-r'+p.revision+'-'+randomUUID());await privateDir(stage,true);const extract=join(stage,'extract');
  if(!await exists(extract))await repository.extract(p.jobId,extract);
  const directory=join(extract,point.checkpointId),manifest=await verifySealedCheckpoint(directory,point.manifestSha256);
  if(!manifest.members.some(m=>m.scope===p.scope&&m.taskId===p.taskId&&['pi','codex'].includes(m.engine)))throw restoreFail('native_adapter_unavailable');
  const prepared=await scope.adapter.prepareRestore({directory,manifest},p.scope,p.taskId,stage);
  const current=await scope.workspaces.lookup(p.taskId);p.checkpointId=point.checkpointId;p.manifestSha256=point.manifestSha256;p.adapterVersion=scope.adapter.version;p.nativeBindings=prepared.nativeBindings;
  p.plan={conversation:prepared.conversation,project:prepared.project,actions:prepared.actions,expectedRegistry:current?sha(JSON.stringify(current)):null,registryDigest:sha(JSON.stringify({conversation:prepared.conversation,project:prepared.project})),warnings:prepared.warnings};
  p.digest=sha(JSON.stringify({scope:p.scope,id:p.id,requestedBy:p.requestedBy,jobId:p.jobId,checkpointId:p.checkpointId,manifestSha256:p.manifestSha256,adapterVersion:p.adapterVersion,revision:p.revision,nativeBindings:p.nativeBindings,plan:p.plan}));p.phase='prepared';p.state='staged';await this.save(p);
 }
 private async publish(p:RestorePlan){
  const scope=await this.options.scope(p.scope);if(!scope.adapter||scope.adapter.version!==p.adapterVersion)throw restoreFail('adapter_version_changed');
  const run=async()=>{const lease=await scope.adapter!.restoreLease();try{
   p.state='publishing';await this.save(p);const plan=p.plan!;
   const current=await scope.workspaces.lookup(p.taskId),receipt=current?.recoveryReceipt;
   if(receipt?.operationId===p.id&&receipt.digest===p.digest){await this.reconcileActions(p);p.phase='registry';await this.save(p);}else{
    if((current?sha(JSON.stringify(current)):null)!==plan.expectedRegistry)throw restoreFail('registry_changed');
    for(const phase of ['task','native'] as const){for(const action of plan.actions.filter(a=>a.phase===phase)){lease.assertValid();await this.publishAction(action);}await this.options.onPublication?.({operationId:p.id,scope:p.scope,taskId:p.taskId,phase});p.phase=phase;await this.save(p);}
    lease.assertValid();await scope.workspaces.importRecoveredTask({operationId:p.id,digest:p.digest!,conversation:plan.conversation,project:plan.project,expectedRegistry:plan.expectedRegistry});await this.options.onPublication?.({operationId:p.id,scope:p.scope,taskId:p.taskId,phase:'registry'});p.phase='registry';await this.save(p);
   }
   p.phase='complete';p.cancelRequested=await this.cancelled(p);p.state=p.cancelRequested?'completed-after-cancel':'completed';delete p.errorCode;await this.save(p);
  }catch(e){p.state='failed';p.errorCode=(e as {code?:string}).code??'restore_failed';await this.save(p);throw e;}finally{lease.release();}};
  if(scope.withPublication)await scope.withPublication(p.taskId,run);else await run();
 }
 private async reconcileActions(p:RestorePlan){for(const action of p.plan!.actions)await this.publishAction(action);}
 private async publishAction(action:RestoreAction){
  const parent=await privateDir(dirname(action.target));if(parent.dev!==action.parent.dev||parent.ino!==action.parent.ino||parent.uid!==action.parent.uid)throw restoreFail('target_parent_changed');
  if(await exists(action.target)){const actual=await lstat(action.target);if(actual.isSymbolicLink()||actual.dev!==action.dev||actual.ino!==action.ino||await treeDigest(action.target)!==action.digest)throw restoreFail('target_changed');return;}
  const source=await lstat(action.source);if(source.dev!==action.dev||source.ino!==action.ino||await treeDigest(action.source)!==action.digest)throw restoreFail('stage_changed');
  // Linux renameat2(RENAME_NOREPLACE), via the trusted local helper, avoids a
  // check/rename race with an unmanaged writer. No overwrite fallback.
  const {execFile}=await import('node:child_process');await new Promise<void>((done,reject)=>execFile('python3',['-c',"import ctypes,os,sys;lib=ctypes.CDLL(None,use_errno=True);r=lib.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1);e=ctypes.get_errno();sys.exit(0) if r==0 else (_ for _ in ()).throw(OSError(e,os.strerror(e)))",action.source,action.target],{timeout:10000,maxBuffer:4096},error=>error?reject(restoreFail('target_conflict')):done()));
  await syncDir(dirname(action.target));await syncDir(dirname(action.source));
 }
}
