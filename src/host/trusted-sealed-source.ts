import {createServer,type Socket,type Server} from 'node:net';
import {once} from 'node:events';
import {open,lstat,realpath,readFile,chmod,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {kernelPeerCredentials} from './linux-file-lease.js';
import {BackupBrokerError,type BackupBrokerPolicy,type BackupBrokerContext,type BackupHostClientIdentity} from './backup-key-protocol.js';
import {verifySealedCheckpoint,type SealedCheckpoint,LEGACY_BACKUP_SCOPE} from './backup.js';
import {emitSealedCheckpoint} from './backup-checkpoint-stream.js';
export interface SealedSourceAudit {event:'started'|'progress'|'completed'|'refused';requestId?:string;actor?:string;scope?:string;checkpointId?:string;bytes?:number;code?:string;}
export interface SourceProducerGrant {listener:BackupHostClientIdentity;workerCommand:string[];}
export interface SealedSourcePolicy extends BackupBrokerPolicy {sourceProducers:SourceProducerGrant[];}
export interface TrustedSealedSourceOptions {socket:string;policyFile:string;coordinator:{sealedCheckpoint(scope:string,taskId:string,expectedCheckpointId?:string):Promise<SealedCheckpoint|undefined>};maxBytes?:number;maxConcurrent?:number;timeoutMs?:number;audit?:(entry:SealedSourceAudit)=>Promise<void>;}
interface Request {schema:1;id:string;operation:'export-checkpoint';context:BackupBrokerContext;scope:string;taskId:string;expectedCheckpointId:string;challenge?:string;}
interface ProcessIdentity extends BackupHostClientIdentity {parent:number;}
const uuid=/^[a-f0-9]{8}-[a-f0-9-]{27}$/,scope=(value:unknown):value is string=>typeof value==='string'&&(value===LEGACY_BACKUP_SCOPE||/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(value));
const fail=(code:string)=>new BackupBrokerError(code);
async function bounded(path:string,maximum:number){const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const buffer=Buffer.alloc(maximum+1),{bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>maximum)throw fail('source_authority_unavailable');return buffer.subarray(0,bytesRead).toString('utf8');}finally{await file.close();}}
async function identity(pid:number):Promise<ProcessIdentity>{
 const status=await bounded('/proc/'+pid+'/status',65536),raw=await bounded('/proc/'+pid+'/stat',65536),fields=raw.slice(raw.lastIndexOf(')')+2).split(' '),uids=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);
 if(!uids||new Set(uids.slice(1)).size!==1||['Z','X'].includes(fields[0]))throw fail('source_producer_not_enrolled');
 return {pid,uid:Number(uids[1]),parent:Number(fields[1]),birth:fields[19],boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};
}
const same=(actual:BackupHostClientIdentity,expected:BackupHostClientIdentity)=>actual.pid===expected.pid&&actual.uid===expected.uid&&actual.boot===expected.boot&&actual.birth===expected.birth;
/** Private named sealed-point endpoint; it never captures live files or changes
 * native privileges. Producer delegation is only from an explicitly enrolled
 * fixed-worker listener to its direct child, not arbitrary Host ancestry. */
export class TrustedSealedCheckpointSource {
 private server?:Server;private sockets=new Set<Socket>();private active=0;private socketIdentity?:{dev:number;ino:number};
 constructor(private options:TrustedSealedSourceOptions){if(!isAbsolute(options.socket)||Buffer.byteLength(options.socket)>100||!isAbsolute(options.policyFile)||options.maxBytes!==undefined&&(!Number.isSafeInteger(options.maxBytes)||options.maxBytes<1||options.maxBytes>1024**3)||options.maxConcurrent!==undefined&&(!Number.isSafeInteger(options.maxConcurrent)||options.maxConcurrent<1||options.maxConcurrent>4)||options.timeoutMs!==undefined&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<100||options.timeoutMs>30*60000))throw fail('source_configuration_invalid');}
 async listen(){
  if(this.server)throw fail('source_already_started');const directory=await lstat(dirname(this.options.socket));if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid?.()||(directory.mode&0o007)||await realpath(dirname(this.options.socket))!==resolve(dirname(this.options.socket)))throw fail('source_configuration_invalid');
  if(await lstat(this.options.socket).then(()=>true,()=>false))throw fail('source_endpoint_exists');await this.policy();
  this.server=createServer(socket=>{socket.on('error',()=>undefined);if(this.active>=(this.options.maxConcurrent??2)){socket.end(JSON.stringify({schema:1,error:{code:'source_busy'}})+'\n',()=>socket.destroy());return;}this.active++;this.sockets.add(socket);const timer=setTimeout(()=>socket.destroy(),this.options.timeoutMs??5*60000);
   void this.handle(socket).catch(async error=>{const code=error instanceof BackupBrokerError?error.code:'source_export_refused';await this.options.audit?.({event:'refused',code}).catch(()=>undefined);if(!socket.destroyed)socket.write(JSON.stringify({schema:1,error:{code}})+'\n');}).finally(()=>{clearTimeout(timer);this.active--;this.sockets.delete(socket);socket.end(()=>socket.destroy());});
  });this.server.listen(this.options.socket);await once(this.server,'listening');await chmod(this.options.socket,0o660);const info=await lstat(this.options.socket);this.socketIdentity={dev:info.dev,ino:info.ino};
 }
 private async policy():Promise<SealedSourcePolicy>{
  const info=await lstat(this.options.policyFile);if(!info.isFile()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)||info.nlink!==1||info.size>131072||await realpath(this.options.policyFile)!==resolve(this.options.policyFile))throw fail('source_authority_unavailable');
  const policy=JSON.parse(await bounded(this.options.policyFile,131072)) as SealedSourcePolicy;
  if(policy.schema!==1||!Number.isSafeInteger(policy.revision)||policy.revision<1||!scope(policy.administrator)||!Array.isArray(policy.scopes)||policy.scopes.some(value=>!scope(value))||!policy.actors||typeof policy.actors!=='object'||!Array.isArray(policy.sourceProducers)||!policy.sourceProducers.length||policy.sourceProducers.length>32)throw fail('source_authority_unavailable');
  for(const grant of policy.sourceProducers){const parent=grant?.listener;if(!parent||Object.keys(parent).some(key=>!['pid','uid','boot','birth'].includes(key))||!Number.isSafeInteger(parent.pid)||parent.pid<1||!Number.isSafeInteger(parent.uid)||parent.uid<0||typeof parent.boot!=='string'||!/^[a-f0-9-]{36}$/.test(parent.boot)||typeof parent.birth!=='string'||!/^\d+$/.test(parent.birth)||!Array.isArray(grant.workerCommand)||grant.workerCommand.length!==3||grant.workerCommand.some(arg=>typeof arg!=='string'||!isAbsolute(arg)||arg.includes('\0')))throw fail('source_authority_unavailable');}
  return policy;
 }
 private async authorize(request:Request,peer:ProcessIdentity,members:string[]=[]){
  const policy=await this.policy(),current=await identity(peer.pid);if(!same(current,peer)||current.parent!==peer.parent)throw fail('source_producer_not_enrolled');
  const grant=policy.sourceProducers.find(grant=>grant.listener.pid===current.parent&&grant.listener.uid===current.uid);if(!grant||!same(await identity(current.parent),grant.listener))throw fail('source_producer_not_enrolled');
  const command=(await bounded('/proc/'+peer.pid+'/cmdline',65536).catch(()=>{throw fail('source_producer_command_unreadable');})).split('\0');if(command.at(-1)==='')command.pop();if(JSON.stringify(command)!==JSON.stringify(grant.workerCommand))throw fail('source_producer_not_enrolled');
  const context=request.context;if(!context||Object.keys(context).some(key=>!['actor','dataScope','authorityRevision'].includes(key))||!scope(context.actor)||!scope(context.dataScope)||context.authorityRevision!==policy.revision)throw fail('source_authority_stale');
  const actor=Object.hasOwn(policy.actors,context.actor)?policy.actors[context.actor]:undefined;if(!actor||context.actor!==policy.administrator||actor.role!=='administrator')throw fail('source_administrator_required');
  if(!Array.isArray(actor.scopes)||[context.dataScope,request.scope,...members].some(value=>!scope(value)||!policy.scopes.includes(value)||!actor.scopes.includes(value)))throw fail('source_scope_denied');
 }
 private async handle(socket:Socket){
  const fd=(socket as Socket&{_handle?:{fd?:number}})._handle?.fd;if(fd===undefined)throw fail('source_peer_unavailable');const credentials=kernelPeerCredentials(fd),peer=await identity(credentials.pid);if(peer.uid!==credentials.uid)throw fail('source_peer_unavailable');
  let data='';socket.setEncoding('utf8');for await(const chunk of socket.iterator({destroyOnReturn:false})){data+=chunk;if(Buffer.byteLength(data)>16384)throw fail('source_request_limit');const end=data.indexOf('\n');if(end>=0){if(data.slice(end+1))throw fail('source_invalid_request');data=data.slice(0,end);break;}}
  const request=JSON.parse(data) as Request;if(!request||request.schema!==1||!uuid.test(request.id)||request.operation!=='export-checkpoint'||!scope(request.scope)||typeof request.taskId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(request.taskId)||!uuid.test(request.expectedCheckpointId)||Object.keys(request).some(key=>!['schema','id','operation','context','scope','taskId','expectedCheckpointId','challenge'].includes(key))||request.challenge!==undefined&&(typeof request.challenge!=='string'||request.challenge.length>128))throw fail('source_invalid_request');
  await this.authorize(request,peer);const point=await this.options.coordinator.sealedCheckpoint(request.scope,request.taskId,request.expectedCheckpointId);if(!point||point.manifest.checkpointId!==request.expectedCheckpointId||!point.manifest.members.some(member=>member.scope===request.scope&&member.taskId===request.taskId))throw fail('source_checkpoint_unavailable');
  const seal=(await bounded(join(point.directory,'seal'),128)).trim(),manifest=await verifySealedCheckpoint(point.directory,seal),members=manifest.members.map(member=>member.scope);if(manifest.totalBytes>(this.options.maxBytes??1024**3)||manifest.members.some(member=>!['pi','codex'].includes(member.engine)))throw fail('source_transfer_limit');
  await this.authorize(request,peer,members);const audit={requestId:request.id,actor:request.context.actor,scope:request.scope,checkpointId:request.expectedCheckpointId};await this.options.audit?.({event:'started',...audit});let bytes=0,encoded=0;
  await emitSealedCheckpoint(point.directory,async value=>{
   const frame=value as {type?:string;data?:string};if(socket.destroyed)throw fail('source_connection_lost');if(frame.type==='end')await verifySealedCheckpoint(point.directory,seal);await this.authorize(request,peer,members);
   const output=JSON.stringify(value)+'\n';encoded+=Buffer.byteLength(output);if(Buffer.byteLength(output)>1024*1024||encoded>(this.options.maxBytes??1024**3)*1.4+64*1024**2)throw fail('source_transfer_limit');await new Promise<void>((resolve,reject)=>{const closed=()=>reject(fail('source_connection_lost'));socket.once('close',closed);socket.write(output,error=>{socket.off('close',closed);error?reject(error):resolve();});});
   if(frame.type==='chunk'){bytes+=Buffer.from(frame.data!,'base64').length;await this.options.audit?.({event:'progress',...audit,bytes});}
  },seal);await this.options.audit?.({event:'completed',...audit,bytes});
 }
 async close(){const server=this.server;if(!server)return;this.server=undefined;for(const socket of this.sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));const current=await lstat(this.options.socket).catch(()=>undefined);if(current&&current.dev===this.socketIdentity?.dev&&current.ino===this.socketIdentity?.ino)await rm(this.options.socket);}
}
