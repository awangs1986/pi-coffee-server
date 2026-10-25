import {constants} from 'node:fs';import {open,lstat,realpath,readFile,rm} from 'node:fs/promises';import {isAbsolute,resolve,join} from 'node:path';import {randomUUID} from 'node:crypto';
import {BackupError,LEGACY_BACKUP_SCOPE} from './backup.js';import {BackupRepository} from './backup-repository.js';
import {BackupBrokerError,type BackupBrokerPolicy,type BackupBrokerRequest,type BackupKeyServiceConfig,type BackupBrokerQualification} from './backup-key-protocol.js';import {BackupCheckpointReceiver} from './backup-checkpoint-transfer.js';
import {requestUnixPeer} from './backup-repository-client.js';
const scopeValid=(value:unknown):value is string=>typeof value==='string'&&(value===LEGACY_BACKUP_SCOPE||/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value));
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27}$/;
interface PeerRequest extends BackupBrokerRequest {_peer:{pid:number;uid:number;gid:number};}

/** Secret-owning side only. Host clients never import this or read its root. */
export class BackupKeyService {
 private readonly repository:BackupRepository;private points=new Map<string,import('./backup.js').SealedCheckpoint>();
 private constructor(private config:BackupKeyServiceConfig){this.repository=new BackupRepository({root:join(config.privateRoot,'repository-runtime'),coordinator:{sealedCheckpoint:async(scope,taskId)=>this.points.get(scope+'/'+taskId)}});}
 static async load(path:string){const config=await ownedJson(path) as BackupKeyServiceConfig;
  if(config.schema!==1||config.serviceUid!==process.getuid?.()||![config.serviceUid,config.hostUid,config.sourceUid].every(uid=>Number.isSafeInteger(uid)&&uid>=0)||!['socket','privateRoot','authorityFile','sourceSocket','binary','destination','node','handler'].every(key=>typeof config[key as keyof BackupKeyServiceConfig]==='string'&&isAbsolute(config[key as keyof BackupKeyServiceConfig] as string)))throw new BackupBrokerError('service_configuration_invalid');
  const info=await lstat(config.privateRoot);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==config.serviceUid||(info.mode&0o077)||await realpath(config.privateRoot)!==resolve(config.privateRoot))throw new BackupBrokerError('service_configuration_invalid');
  return new BackupKeyService(config);
 }
 private async authorize(request:PeerRequest){
  if(!request||request.schema!==1||typeof request.id!=='string'||!uuid.test(request.id)||!request._peer||request._peer.uid!==this.config.hostUid||!Number.isSafeInteger(request._peer.pid)||request._peer.pid<1)throw new BackupBrokerError('peer_identity_mismatch');
  if(Object.keys(request).some(key=>!['schema','id','context','operation','scope','selection','recoveryPackage','_peer'].includes(key)))throw new BackupBrokerError('invalid_request');
  const policy=await ownedJson(this.config.authorityFile) as BackupBrokerPolicy,context=request.context;
  if(policy.schema!==1||!Number.isSafeInteger(policy.revision)||!scopeValid(policy.administrator)||!Array.isArray(policy.scopes)||policy.scopes.some(scope=>!scopeValid(scope))||!policy.actors||typeof policy.actors!=='object')throw new BackupBrokerError('authority_unavailable');
  if(!context||Object.keys(context).some(key=>!['actor','dataScope','authorityRevision'].includes(key))||!scopeValid(context.actor)||!scopeValid(context.dataScope)||!Number.isSafeInteger(context.authorityRevision))throw new BackupBrokerError('invalid_request');
  if(context.authorityRevision!==policy.revision)throw new BackupBrokerError('authority_stale');
  const actor=Object.hasOwn(policy.actors,context.actor)?policy.actors[context.actor]:undefined;
  if(!actor||!Array.isArray(actor.scopes)||!actor.scopes.includes(context.dataScope)||!policy.scopes.includes(context.dataScope))throw new BackupBrokerError('scope_denied');
  const scope=request.scope??context.dataScope;if(!scopeValid(scope)||!policy.scopes.includes(scope)||!actor.scopes.includes(scope))throw new BackupBrokerError('scope_denied');
  const administrator=context.actor===policy.administrator&&actor.role==='administrator';
  if(!['status','jobs','qualification','configure','backup','export-recovery','verify-recovery','rotate','recover'].includes(request.operation))throw new BackupBrokerError('invalid_operation');
  if(!['status','qualification'].includes(request.operation)&&!administrator)throw new BackupBrokerError('administrator_required');
  if(!administrator&&scope!==context.dataScope)throw new BackupBrokerError('scope_denied');
  return {policy,actor,scope,administrator};
 }
 async qualification():Promise<BackupBrokerQualification>{
  const base={serviceUid:this.config.serviceUid,sourceUid:this.config.sourceUid,hostUid:this.config.hostUid};
  if(this.config.serviceUid===this.config.hostUid||this.config.serviceUid===this.config.sourceUid)return {...base,state:'unavailable',reason:'service_identity_not_separate'};
  // A fresh authenticated source-owner RPC supplies mechanical admission state,
  // not a configured Boolean or persisted signature-only qualification.
  try{
   const challenge=randomUUID(),response=await requestUnixPeer(this.config.sourceSocket,this.config.sourceUid,{schema:1,operation:'qualify-backup',challenge});
   const value=response?.result??response;
   if(value.schema!==1||value.challenge!==challenge||value.enforcement!=='managed-bwrap-flock-v1'||value.admission!=='protected-only'||value.legacy!=='drained'||!Number.isSafeInteger(value.policyRevision)||!/^[0-9a-f]{64}$/.test(value.profileDigest)||value.authority?.uid!==this.config.sourceUid||!Number.isSafeInteger(value.authority.pid)||value.authority.pid<1)throw new BackupBrokerError('source_boundary_unqualified');
   const info=await lstat('/proc/'+value.authority.pid),raw=await readFile('/proc/'+value.authority.pid+'/stat','utf8'),boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth=raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];
   if(info.uid!==this.config.sourceUid||value.authority.birth!==birth||value.authority.boot!==boot)throw new BackupBrokerError('source_boundary_unqualified');
   return {...base,state:'qualified',sourceRevision:value.policyRevision};
  }catch{return {...base,state:'unavailable',reason:'source_boundary_unqualified'};}
 }
 async dispatch(raw:unknown){
  const request=raw as PeerRequest,{scope,administrator}=await this.authorize(request);
  const qualification=await this.qualification();
  if(request.operation==='qualification')return qualification;
  if(request.operation==='status'){const state=await this.repository.status(scope);return {...state,qualification};}
  if(request.operation==='jobs')return (await this.repository.jobs()).filter(job=>job.selection?.some(item=>item.scope===scope)||job.points.some(item=>item.scope===scope)).map(job=>({...job,selection:job.selection.filter(item=>item.scope===scope),points:job.points.filter(item=>item.scope===scope)}));
  if(!administrator)throw new BackupBrokerError('administrator_required');
  if(qualification.state!=='qualified')throw new BackupBrokerError('activation_unqualified');
  await this.authorize(request); // Re-read current policy after external qualification.
  switch(request.operation){
   case 'configure':await this.repository.configure({destination:this.config.destination,binary:this.config.binary});return {configured:true};
   case 'export-recovery':return this.repository.exportRecoveryPackage();
   case 'verify-recovery':if(typeof request.recoveryPackage!=='string'||request.recoveryPackage.length>8192)throw new BackupBrokerError('invalid_recovery_copy');await this.repository.verifyRecoveryPackage(request.recoveryPackage);return {verified:true};
   case 'rotate':await this.repository.rotateRecoveryKey();return {rotated:true};
   case 'recover':await this.repository.recoverInterruptedOperation();return {reconciled:true};
   case 'backup':{
    if(!Array.isArray(request.selection)||request.selection.length<1||request.selection.length>1000||request.selection.some(item=>!item||Object.keys(item).some(key=>!['scope','taskId','expectedCheckpointId'].includes(key))||!scopeValid(item.scope)||!['string'].includes(typeof item.taskId)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(item.taskId)||item.expectedCheckpointId!==undefined&&!uuid.test(item.expectedCheckpointId)))throw new BackupBrokerError('invalid_selection');
    const policy=(await this.authorize(request)).policy;const grants=policy.actors[request.context.actor].scopes;
    for(const item of request.selection)if(!policy.scopes.includes(item.scope)||!grants.includes(item.scope))throw new BackupBrokerError('scope_denied');
    const ingestRoot=join(this.config.privateRoot,'ingest',request.id);let remaining=1024**3;
    try{
     for(const item of request.selection){const receiver=new BackupCheckpointReceiver({root:ingestRoot,socket:this.config.sourceSocket,sourceUid:this.config.sourceUid,maxBytes:remaining});const point=await receiver.receive(item.scope,item.taskId,item.expectedCheckpointId);remaining-=point.manifest.totalBytes;if(remaining<0)throw new BackupBrokerError('source_transfer_limit');this.points.set(item.scope+'/'+item.taskId,point);}
     await this.authorize(request);const current=await this.qualification();if(current.state!=='qualified'||current.sourceRevision!==qualification.sourceRevision)throw new BackupBrokerError('activation_unqualified');
     return await this.repository.backup(request.selection);
    }finally{await rm(ingestRoot,{recursive:true,force:true});this.points.clear();}
   }
   default:throw new BackupBrokerError('invalid_operation');
  }
 }
}
export async function ownedJson(path:string){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)||info.nlink!==1||info.size>65536||await realpath(path)!==resolve(path))throw new BackupBrokerError('service_configuration_invalid');const buffer=Buffer.alloc(65537),result=await file.read(buffer,0,buffer.length,0);if(result.bytesRead!==info.size||result.bytesRead>65536)throw new BackupBrokerError('service_configuration_invalid');return JSON.parse(buffer.subarray(0,result.bytesRead).toString('utf8'));}finally{await file.close();}}
export function publicBrokerCode(error:unknown){return error instanceof BackupBrokerError||error instanceof BackupError?error.code:'broker_failed';}
