import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {BackupBrokerError,type BackupBrokerRequest,type BackupBrokerContext,type BackupBrokerOperation,type BackupBrokerQualification} from './backup-key-protocol.js';
import type {RepositoryJob} from './backup-repository.js';
/** Host holds this scoped IPC facade, never a repository root or runtime secret. */
export class BackupRepositoryClient {
 constructor(private options:BackupBrokerContext&{socket:string;serviceUid:number;timeoutMs?:number}){}
 private async call(operation:BackupBrokerOperation,payload:Partial<BackupBrokerRequest>={}):Promise<any>{
  const request:BackupBrokerRequest={...payload,schema:1,id:randomUUID(),operation,context:{actor:this.options.actor,dataScope:this.options.dataScope,authorityRevision:this.options.authorityRevision}};
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
 backup(selection:{scope:string;taskId:string;expectedCheckpointId?:string}[]):Promise<RepositoryJob>{return this.call('backup',{selection});}
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
