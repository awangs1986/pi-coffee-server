import {lstat,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ColdEnrollmentCoordinator,withReadonlyLegacyExport,withCapturedReadonlyLegacyExport} from './cold-enrollment.js';
import type {FrozenLegacyScope} from './cold-enrollment-capture.js';
import type {EnrollmentMemberMapping} from './cold-enrollment-mapping.js';
import {acquireLegacyColdCut} from './legacy-cold-cut.js';
import {listenManagedControl,type ManagedSourceAuthority} from './managed-source-authority.js';
import {BackupRepositoryClient,type BackupRepositoryClientConfig} from './backup-repository-client.js';
import type {AccountRecoveryCoordinator} from './account-recovery.js';
import {verifySealedCheckpoint,type CheckpointManifest} from './backup.js';
import type {RepositoryJob} from './backup-repository.js';
import {privateDir,readJson,restoreFail} from './restore-files.js';

interface EnrollmentControlProfile {schema:1;actor:string;root:string;exportDirectory?:string;capture?:{scopes:FrozenLegacyScope[]};legacy:{socket:string;uid:number};mappings:EnrollmentMemberMapping[];}
async function profile(path:string,sourceParent:string){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)||stat.nlink!==1||stat.size>128*1024||await realpath(path)!==resolve(path))throw restoreFail('enrollment_profile_unsafe');const value:EnrollmentControlProfile=await readJson(path);if(value.schema!==1||Object.keys(value).some(key=>!['schema','actor','root','exportDirectory','capture','legacy','mappings'].includes(key))||typeof value.actor!=='string'||!Array.isArray(value.mappings)||!value.mappings.length||value.mappings.length>1000||resolve(value.root)!==value.root||!value.root.startsWith(join(sourceParent,'authority')+'/')||(Boolean(value.exportDirectory)===Boolean(value.capture))||value.exportDirectory!==undefined&&resolve(value.exportDirectory)!==value.exportDirectory||value.capture!==undefined&&(!Array.isArray(value.capture.scopes)||!value.capture.scopes.length)||!value.legacy||resolve(value.legacy.socket)!==value.legacy.socket||!Number.isSafeInteger(value.legacy.uid)||value.legacy.uid<1||value.legacy.uid===process.getuid?.())throw restoreFail('enrollment_profile_unsafe');return value;}

/** Explicitly installed source-UID maintenance socket, outside every native
 * namespace grant. There is no public HTTP route and requests contain no paths,
 * role claims, repository/key roots, callbacks or writable-source flags. */
export async function startColdEnrollmentControl(options:{socket:string;profile:string;accounts:AccountRecoveryCoordinator;authority:ManagedSourceAuthority;broker:BackupRepositoryClientConfig}){
 const controlRoot=join(options.authority.config.sourceParent,'authority');if(resolve(options.socket)!==options.socket||!options.socket.startsWith(controlRoot+'/'))throw restoreFail('enrollment_control_unsafe');await privateDir(controlRoot);await privateDir(dirname(options.socket));
 const configured=await profile(options.profile,options.authority.config.sourceParent),scopes=[...new Set(configured.mappings.map(mapping=>mapping.scope))];if(configured.actor!==options.broker.actor||configured.legacy.uid!==options.authority.config.legacyHostUid)throw restoreFail('enrollment_profile_scope_mismatch');const broker=new BackupRepositoryClient({...options.broker,actor:configured.actor,dataScope:scopes[0]});
 const coordinator=new ColdEnrollmentCoordinator({root:configured.root,accounts:options.accounts,authorize:async(actor,requested)=>actor===configured.actor&&requested.every(scope=>scopes.includes(scope)),archive:async(actor,point,operationId)=>options.authority.withEnrollmentPoint(point,async()=>{
  const job=await broker.backup(point.manifest.members.map(member=>({scope:member.scope,taskId:member.taskId,expectedCheckpointId:point.manifest.checkpointId})),undefined,operationId);return validateColdEnrollmentArchive(actor,configured.actor,point.manifest,job);
 })});
 return listenManagedControl(options.socket,[options.authority.config.executorUid],async(input,socket)=>{let result:unknown;try{if(input.schema!==1||Object.keys(input).some(key=>!['schema','action','id','revision','digest'].includes(key))||!['plan','status','approve','publish'].includes(String(input.action)))throw restoreFail('invalid_enrollment_request');
  // Re-read exact trusted configuration before every action, including publish.
  if(JSON.stringify(await profile(options.profile,options.authority.config.sourceParent))!==JSON.stringify(configured))throw restoreFail('enrollment_profile_changed');for(const scope of scopes)if(!(await options.authority.sourceProof(scope)).known)throw restoreFail('writers_unknown');
  if(input.action==='plan'){if(Object.keys(input).some(key=>!['schema','action'].includes(key)))throw restoreFail('invalid_enrollment_request');const lease=await acquireLegacyColdCut(configured.legacy.socket,configured.legacy.uid);try{if(configured.capture){result=await withCapturedReadonlyLegacyExport({root:join(configured.root,'frozen-capture-'+randomUUID()),scopes:configured.capture.scopes,lease,run:source=>coordinator.plan(configured.actor,source,configured.mappings)});}else{const directory=configured.exportDirectory!,manifest=await verifySealedCheckpoint(directory);result=await withReadonlyLegacyExport({point:{directory,manifest},lease,assertRetired:async()=>lease.assertValid(),run:source=>coordinator.plan(configured.actor,source,configured.mappings)});}}finally{lease.release();}}
  else if(input.action==='status'){if(typeof input.id!=='string')throw restoreFail('invalid_enrollment_request');result=await coordinator.status(configured.actor,input.id);}
  else{if(typeof input.id!=='string'||typeof input.digest!=='string'||!Number.isSafeInteger(input.revision))throw restoreFail('invalid_enrollment_request');result=await coordinator.operate(configured.actor,input.id,{action:input.action as 'approve'|'publish',revision:Number(input.revision),digest:input.digest});}
  socket.write(JSON.stringify({schema:1,ok:true,result})+'\n');
 }catch(error){socket.write(JSON.stringify({schema:1,ok:false,error:{code:error&&typeof error==='object'&&'code'in error?String(error.code):'enrollment_failed'}})+'\n');}});
}

/** Validate the repository result before cold enrollment creates account plans.
 * This receipt is not an OS export qualification or source-custody proof. */
export function validateColdEnrollmentArchive(actor:string,configuredActor:string,manifest:CheckpointManifest,job:RepositoryJob){
 const digest=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
 if(actor!==configuredActor||job.state!=='succeeded'||job.verification!=='repository-read'||!job.snapshotId||manifest.members.some(member=>!job.points.some(saved=>saved.scope===member.scope&&saved.taskId===member.taskId&&saved.checkpointId===manifest.checkpointId&&saved.manifestSha256===digest)))throw restoreFail('enrollment_archive_unverified');
 return {jobId:job.id,manifestSha256:digest,verification:'repository-read' as const};
}
