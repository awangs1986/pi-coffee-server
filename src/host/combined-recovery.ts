import {BackupError,WriterAdmissionFence,type CheckpointManifest,type NativeRecoveryAdapter} from './backup.js';
import type {NativeRestoreAdapter,NativeRestoreOptions,NativeMergeContext} from './restore.js';
import type {Workspaces,Conversation} from './workspaces.js';
/** One scope's recovery boundary; HTTP and the coordinator never inspect
 * native engine schemas. The trusted source authority supplies a common fence
 * covering both native homes, their shared resources and the task registry. */
export class CombinedNativeRecoveryAdapter implements NativeRecoveryAdapter,NativeRestoreAdapter {
 readonly version='pi-codex-recovery-v1';
 constructor(private options:{workspaces:Workspaces;pi:NativeRecoveryAdapter&NativeRestoreAdapter;codex:NativeRecoveryAdapter&NativeRestoreAdapter;fence:WriterAdmissionFence}){}
 private adapter(engine:string){if(engine==='pi')return this.options.pi;if(engine==='codex')return this.options.codex;throw new BackupError('closure_incomplete','Native engine recovery unavailable');}
 async resolve(scope:string,taskId:string){const task=await this.options.workspaces.lookup(taskId);if(!task)throw new BackupError('closure_incomplete','Task binding missing');return this.adapter(task.engine??'pi').resolve(scope,taskId);}
 async prepareRestore(point:{directory:string;manifest:CheckpointManifest},scope:string,taskId:string,stage:string,options?:NativeRestoreOptions){const member=point.manifest.members.find(m=>m.scope===scope&&m.taskId===taskId);if(!member)throw new BackupError('closure_incomplete','Task binding missing');if(point.manifest.members.some(m=>m.engine!==member.engine))throw new BackupError('closure_incomplete','Mixed native graph requires a qualified group plan');return this.adapter(member.engine).prepareRestore(point,scope,taskId,stage,options);}
 async validateReplacementSafety(plan:Record<string,unknown>,context:{directory:string;manifest:CheckpointManifest;currentRegistry:Conversation|undefined;scope:string;taskId:string}){if(plan.kind!=='codex-01591'||!this.options.codex.validateReplacementSafety)throw new BackupError('closure_incomplete','Native safety validation unavailable');return this.options.codex.validateReplacementSafety(plan,context);}
 async publishNativeMerge(plan:Record<string,unknown>,context:NativeMergeContext){if(plan.kind!=='codex-01591'||!this.options.codex.publishNativeMerge)throw new BackupError('closure_incomplete','Native merge unavailable');return this.options.codex.publishNativeMerge(plan,context);}
 async restoreLease(){return this.options.fence.publicationLease();}
}
