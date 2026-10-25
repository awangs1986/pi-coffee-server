import {spawn} from 'node:child_process';import {open,realpath} from 'node:fs/promises';import {constants} from 'node:fs';import {isAbsolute,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {BackupBrokerError,type BackupBrokerRequest,type BackupBrokerContext,type BackupBrokerOperation,type BackupBrokerQualification} from './backup-key-protocol.js';
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
  const result=await requestUnixPeer(this.options.socket,this.options.serviceUid,request,this.options.timeoutMs);
  if(!result||result.schema!==1||result.id!==request.id&&result.ok!==false)throw new BackupBrokerError('invalid_response');
  if(!result.ok)throw new BackupBrokerError(typeof result.error?.code==='string'&&/^[a-z_]{1,64}$/.test(result.error.code)?result.error.code:'broker_failed');
  return result.result;
 }
 status(scope=this.options.dataScope){return this.call('status',{scope});}
 jobs(scope=this.options.dataScope):Promise<RepositoryJob[]>{return this.call('jobs',{scope});}
 qualification():Promise<BackupBrokerQualification>{return this.call('qualification');}
 configure():Promise<void>{return this.call('configure');}
 backup(selection:{scope:string;taskId:string;expectedCheckpointId?:string}[],signal?:AbortSignal,requestId?:string):Promise<RepositoryJob>{if(signal?.aborted)return Promise.reject(new BackupBrokerError('job_cancelled'));return this.call('backup',{selection},requestId);}
 exportRecoveryPackage():Promise<string>{return this.call('export-recovery');}
 verifyRecoveryPackage(recoveryPackage:string):Promise<void>{return this.call('verify-recovery',{recoveryPackage});}
 rotateRecoveryKey():Promise<void>{return this.call('rotate');}
 recoverInterruptedOperation():Promise<void>{return this.call('recover');}
}
/** Fixed helper supplies SO_PEERCRED in both directions. */
export async function requestUnixPeer(socket:string,serviceUid:number,request:unknown,timeoutMs=30*60*1000):Promise<any>{
 const helper=new URL(import.meta.url.endsWith('.ts')?'../../src/host/backup-unix-peer.py':'./backup-unix-peer.py',import.meta.url).pathname;
 const output=await new Promise<string>((resolve,reject)=>{const child=spawn('/usr/bin/python3',[helper,'client',socket,String(serviceUid)],{stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});let data='',bytes=0;const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new BackupBrokerError('broker_timeout'));},timeoutMs);child.stdin.on('error',()=>undefined);child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024){child.kill('SIGKILL');reject(new BackupBrokerError('response_limit'));}else data+=chunk;});child.on('error',()=>{clearTimeout(timer);reject(new BackupBrokerError('transport_unavailable'));});child.on('close',()=>{clearTimeout(timer);resolve(data);});child.stdin.end(JSON.stringify(request)+'\n');});
 try{return JSON.parse(output);}catch{throw new BackupBrokerError('invalid_response');}
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
