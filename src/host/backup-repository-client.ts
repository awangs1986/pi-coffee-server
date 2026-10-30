import type {RecoveryPointQuery,RecoveryPointPage} from './recovery-point-catalog.js';
import {backupPeerFrames} from './backup-peer-client.js';
import type {RecoveryPin,RecoveryPinLease,RepositoryRetentionPlan} from './backup-retention.js';
import {BackupCheckpointReceiver} from './backup-checkpoint-transfer.js';import {verifySealedCheckpoint} from './backup.js';
import {open,realpath,mkdir,lstat,readdir,rename,rm} from 'node:fs/promises';import {constants} from 'node:fs';import {isAbsolute,resolve,dirname,join} from 'node:path';import {randomUUID} from 'node:crypto';
import {BackupBrokerError,type BackupBrokerRequest,type BackupBrokerContext,type BackupBrokerOperation,type BackupBrokerQualification,type BackupExtractionDescriptor} from './backup-key-protocol.js';
import type {RepositoryJob} from './backup-repository.js';
export interface BackupRepositoryClientOptions extends BackupBrokerContext {socket:string;serviceUid:number;timeoutMs?:number;}
export interface BackupRepositoryClientConfig extends BackupRepositoryClientOptions {schema:1;}
/** Host holds this scoped IPC facade, never a repository root or runtime secret. */
export class BackupRepositoryClient {
 constructor(private options:BackupRepositoryClientOptions){}
 static async fromConfig(path:string,context?:Pick<BackupBrokerContext,'actor'|'dataScope'>){const config=await readBackupRepositoryClientConfig(path);return new BackupRepositoryClient({...config,...context});}
 private async call(operation:BackupBrokerOperation,payload:Partial<BackupBrokerRequest>={},requestId?:string):Promise<any>{
  const request:BackupBrokerRequest={...payload,schema:1,id:requestId??randomUUID(),operation,context:{actor:this.options.actor,dataScope:this.options.dataScope,authorityRevision:this.options.authorityRevision}};
  if(Buffer.byteLength(JSON.stringify(request))>1024*1024)throw new BackupBrokerError('request_limit');
  const result=await requestUnixPeer(this.options.socket,this.options.serviceUid,request,['status','qualification','jobs','recovery-points','recovery-job'].includes(operation)?Math.min(this.options.timeoutMs??5000,5000):this.options.timeoutMs);
  if(!result||result.schema!==1||result.id!==request.id&&result.ok!==false)throw new BackupBrokerError('invalid_response');
  if(!result.ok)throw new BackupBrokerError(typeof result.error?.code==='string'&&/^[a-z_]{1,64}$/.test(result.error.code)?result.error.code:'broker_failed');
  return result.result;
 }
 status(scope=this.options.dataScope){return this.call('status',{scope});}
 jobs(scope=this.options.dataScope):Promise<RepositoryJob[]>{return this.call('jobs',{scope});}
 recoveryPoints(scope=this.options.dataScope,query:RecoveryPointQuery={}):Promise<RecoveryPointPage>{return this.call('recovery-points',{scope,query});}
 async recoveryJob(jobId:string,scope=this.options.dataScope):Promise<RepositoryJob|undefined>{return (await this.call('recovery-job',{scope,jobId}))??undefined;}
 qualification():Promise<BackupBrokerQualification>{return this.call('qualification');}
 configure():Promise<void>{return this.call('configure');}
 backup(selection:{scope:string;taskId:string;expectedCheckpointId?:string}[],signal?:AbortSignal,requestId?:string):Promise<RepositoryJob>{if(signal?.aborted)return Promise.reject(new BackupBrokerError('job_cancelled'));return this.call('backup',{selection},requestId);}
 exportRecoveryPackage():Promise<string>{return this.call('export-recovery');}
 verifyRecoveryPackage(recoveryPackage:string):Promise<void>{return this.call('verify-recovery',{recoveryPackage});}
 rotateRecoveryKey():Promise<void>{return this.call('rotate');}
 recoverInterruptedOperation():Promise<void>{return this.call('recover');}
 pinRecoveryJob(jobId:string,input:{operationId:string;revision:number;ttlMs?:number}):Promise<RecoveryPin>{return this.call('pin-recovery-job',{jobId,...input});}
 releaseRecoveryPin(pinId:string,operationId:string,revision:number):Promise<void>{return this.call('release-recovery-pin',{pinId,operationId,revision});}
 recoveryPins(scope=this.options.dataScope):Promise<RecoveryPin[]>{return this.call('recovery-pins',{scope});}
 previewRetention(input:{scopes:string[];timeZone?:string}):Promise<RepositoryRetentionPlan>{return this.call('retention-preview',input);}
 retentionPlans(scope=this.options.dataScope):Promise<RepositoryRetentionPlan[]>{return this.call('retention-plans',{scope});}
 executeRetention(retentionId:string,revision:number,digest:string):Promise<RepositoryRetentionPlan>{return this.call('retention-execute',{retentionId,revision,digest});}
 async withRecoveryPins<T>(pinIds:string[],run:(lease:RecoveryPinLease)=>Promise<T>):Promise<T>{
  if(!Array.isArray(pinIds)||!pinIds.length||pinIds.length>1000||new Set(pinIds).size!==pinIds.length||pinIds.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id)))throw new BackupBrokerError('invalid_recovery_pin');
  const request:BackupBrokerRequest={schema:1,id:randomUUID(),operation:'hold-recovery-pins',pinIds,context:{actor:this.options.actor,dataScope:this.options.dataScope,authorityRevision:this.options.authorityRevision}};
  const controller=new AbortController();let failure:BackupBrokerError|undefined,lastHeartbeat=0,granted=false,closing=false;
  let acknowledge!:(value:void)=>void,deny!:(error:Error)=>void;const ready=new Promise<void>((resolve,reject)=>{acknowledge=resolve;deny=reject;});
  const fail=(code:string)=>{failure??=new BackupBrokerError(code);deny(failure);controller.abort();};
  const timeout=Math.min(this.options.timeoutMs??30*60000,30*60000),deadline=Date.now()+timeout,grantTimer=setTimeout(()=>fail('broker_timeout'),Math.min(this.options.timeoutMs??5000,5000));
  const reading=(async()=>{try{
   for await(const frame of backupPeerFrames({socket:this.options.socket,serviceUid:this.options.serviceUid,request,timeoutMs:timeout,signal:controller.signal})){
    if(frame.schema!==1||frame.id!==request.id)throw new BackupBrokerError('invalid_response');
    if(frame.ok===false)throw new BackupBrokerError(typeof frame.error?.code==='string'&&/^[a-z_]{1,64}$/.test(frame.error.code)?frame.error.code:'broker_failed');
    if(!granted){if(frame.ok!==true||frame.result?.lease!==true||JSON.stringify(frame.result.pinIds)!==JSON.stringify(pinIds))throw new BackupBrokerError('invalid_response');granted=true;lastHeartbeat=Date.now();clearTimeout(grantTimer);acknowledge();}
    else if(frame.kind==='pin-heartbeat')lastHeartbeat=Date.now();else throw new BackupBrokerError('invalid_response');
   }
   if(!closing)fail('recovery_pin_lease_lost');
  }catch(error){if(!closing)fail(error instanceof BackupBrokerError?error.code:'recovery_pin_lease_lost');}})();
  const lease:RecoveryPinLease={assertHeld:()=>{if(failure)throw failure;if(!granted||Date.now()>=deadline||Date.now()-lastHeartbeat>5000)throw new BackupBrokerError('recovery_pin_lease_lost');}};
  try{await ready;lease.assertHeld();const result=await run(lease);lease.assertHeld();return result;}
  finally{closing=true;clearTimeout(grantTimer);controller.abort();await reading;}

 }
 /** Restore material arrives only through authenticated named streams. The local
  * destination is never included in an IPC message or exposed to the key owner. */
 async extract(jobId:string,destination:string,recoveryPackage?:string,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)throw new BackupBrokerError('job_cancelled');if(!isAbsolute(destination))throw new BackupBrokerError('invalid_restore_target');
  const parent=await lstat(dirname(destination));if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid?.()||(parent.mode&0o077)||await realpath(dirname(destination))!==resolve(dirname(destination)))throw new BackupBrokerError('invalid_restore_target');
  await mkdir(destination,{mode:0o700});let complete=false,descriptor:BackupExtractionDescriptor|undefined;
  try{
   descriptor=await this.call('stage-extraction',{jobId,...recoveryPackage?{recoveryPackage}:{}}) as BackupExtractionDescriptor;
   if(!descriptor||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(descriptor.extractionId)||descriptor.jobId!==jobId||!Number.isFinite(Date.parse(descriptor.expiresAt))||Date.parse(descriptor.expiresAt)<=Date.now()||!Array.isArray(descriptor.scopes)||descriptor.scopes.some(scope=>typeof scope!=='string')||!Array.isArray(descriptor.checkpoints)||descriptor.checkpoints.length<1||descriptor.checkpoints.length>1000||descriptor.checkpoints.some(point=>!point||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(point.checkpointId)||!/^[0-9a-f]{64}$/.test(point.manifestSha256)||!descriptor!.scopes.includes(point.scope)||typeof point.taskId!=='string'))throw new BackupBrokerError('invalid_response');
   for(const point of descriptor.checkpoints){
    const request:BackupBrokerRequest={schema:1,id:randomUUID(),operation:'restore-checkpoint',context:{actor:this.options.actor,dataScope:this.options.dataScope,authorityRevision:this.options.authorityRevision},extractionId:descriptor.extractionId,checkpointId:point.checkpointId};
    const receiver=new BackupCheckpointReceiver({root:destination,socket:this.options.socket,sourceUid:this.options.serviceUid,allowedScopes:descriptor.scopes,request,signal,directPeer:true});const material=await receiver.receive(point.scope,point.taskId,point.checkpointId);await verifySealedCheckpoint(material.directory,point.manifestSha256);
   }
   for(const name of await readdir(join(destination,'sealed')))await rename(join(destination,'sealed',name),join(destination,name));await rm(join(destination,'sealed'),{recursive:true});complete=true;
  }finally{
   if(descriptor?.extractionId)try{await this.call('close-extraction',{extractionId:descriptor.extractionId});}catch{/* Expiring service lease remains private if control disconnects or authority is revoked. */}
   if(!complete)await rm(destination,{recursive:true,force:true});
  }
 }

}
/** Fixed helper supplies SO_PEERCRED in both directions. */
export async function requestUnixPeer(socket:string,serviceUid:number,request:unknown,timeoutMs=30*60*1000):Promise<any>{
 for await(const frame of backupPeerFrames({socket,serviceUid,request,timeoutMs}))return frame;
 throw new BackupBrokerError('invalid_response');
}

/** Host-owned metadata only. This file must contain no repository/key-root paths. */
export async function readBackupRepositoryClientConfig(path:string):Promise<BackupRepositoryClientConfig>{
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const info=await file.stat();if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)||info.nlink!==1||info.size>8192||await realpath(path)!==resolve(path))throw new BackupBrokerError('client_configuration_invalid');
  const buffer=Buffer.alloc(8193),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead!==info.size||bytesRead>8192)throw new BackupBrokerError('client_configuration_invalid');let value;try{value=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));}catch{throw new BackupBrokerError('client_configuration_invalid');}
  if(!value||value.schema!==1||Object.keys(value).some(key=>!['schema','socket','serviceUid','actor','dataScope','authorityRevision','timeoutMs'].includes(key))||typeof value.socket!=='string'||!isAbsolute(value.socket)||!Number.isSafeInteger(value.serviceUid)||value.serviceUid<0||typeof value.actor!=='string'||typeof value.dataScope!=='string'||!Number.isSafeInteger(value.authorityRevision)||value.authorityRevision<1||value.timeoutMs!==undefined&&(!Number.isSafeInteger(value.timeoutMs)||value.timeoutMs<100||value.timeoutMs>1800000))throw new BackupBrokerError('client_configuration_invalid');
  return value;
 }finally{await file.close();}
}
