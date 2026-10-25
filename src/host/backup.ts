import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,realpath,open,readdir,rename,readFile,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import type {AgentEngine} from '../shared/protocol.js';

export const BACKUP_PROTOCOL_VERSION=1;
export const BACKUP_ENGINES=['pi','codex'] as const;
export const DEFERRED_BACKUP_ENGINES=['claude','cursor','grok'] as const;
const safeId=(value:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export class BackupError extends Error {constructor(readonly code:string,message:string){super(message);}}
export interface WriterProof {known:boolean;reason?:string;}
export interface CaptureLease {readonly epoch:number;readonly signal:AbortSignal;assertValid():void;release():void;}

/** The admission point must surround the *whole* writer lifetime, including descendants.
 * A proof callback audits custody outside this process. No proof means unknown,
 * never an inference from an idle Agent or unchanged file hashes. */
export class WriterAdmissionFence {
 private epoch=0;private active=0;private readonly leases=new Set<AbortController>();
 private readonly classes:Set<string>;
 constructor(private options:{writerClasses:string[];uncoveredWriters?:string[];probe?:()=>Promise<WriterProof>}){this.classes=new Set(options.writerClasses);}
 invalidate(reason='New writer admitted'):void{this.epoch++;for(const lease of this.leases)lease.abort(new BackupError('capture_revoked',reason));this.leases.clear();}
 beginWriter(writerClass:string):()=>void{
  this.invalidate();this.active++;
  if(!this.classes.has(writerClass))this.options.uncoveredWriters=[...new Set([...(this.options.uncoveredWriters??[]),writerClass])];
  let released=false;return ()=>{if(!released){released=true;this.active--;this.epoch++;}};
 }
 async runWriter<T>(writerClass:string,run:()=>Promise<T>):Promise<T>{
  const release=this.beginWriter(writerClass);try{return await run();}finally{release();}
 }
 async lease():Promise<CaptureLease>{
  const epoch=this.epoch;
  if(this.active)throw new BackupError('writers_active','Consistency group has active writers');
  if(this.options.uncoveredWriters===undefined||this.options.uncoveredWriters.length)throw new BackupError('writers_unknown','Native writer coverage is not verified');
  const proof=await this.options.probe?.();
  if(proof&&!proof.known)throw new BackupError('writers_unknown',proof.reason??'Native writer coverage is not verified');
  if(this.active||epoch!==this.epoch)throw new BackupError('capture_revoked','Writer admitted while checking custody');
  const controller=new AbortController();this.leases.add(controller);let released=false;
  return {epoch,signal:controller.signal,assertValid:()=>{if(released||controller.signal.aborted||epoch!==this.epoch||this.active)throw new BackupError('capture_revoked','Capture revoked by a writer');},release:()=>{released=true;this.leases.delete(controller);}};
 }
}
export interface RecoveryMember {scope:string;taskId:string;engine:AgentEngine;nativeBindings:string[];}
export type RecoverySource = {id:string;role:'registry'|'workspace'|'task-data'|'native'} & ({path:string;data?:never}|{data:Uint8Array;path?:never});
export interface NativeRecoveryGroup {
 groupId:string;fence:WriterAdmissionFence;members:RecoveryMember[];sources:RecoverySource[];
 /** Re-read native IDs, source closure and lifecycle against the original binding cut. */
 validate():Promise<void>;
}
/** Native store details, historical dependencies and shared writer groups belong here. */
export interface NativeRecoveryAdapter {readonly version:string;resolve(scope:string,taskId:string):Promise<NativeRecoveryGroup>;}
export interface CheckpointObject {path:string;kind:'file'|'directory';size:number;mode?:number;sha256?:string;role:RecoverySource['role'];}
export interface CheckpointManifest {
 schemaVersion:1;checkpointId:string;captureAt:string;adapterVersion:string;groupId:string;epoch:number;
 members:RecoveryMember[];coverage:'complete';objects:CheckpointObject[];totalBytes:number;
}
export interface BackupTaskStatus {
 taskId:string;engine:AgentEngine;state:'unprotected'|'protected'|'waiting'|'unavailable'|'capturing'|'failed';
 coverage:'complete'|'unavailable'|'excluded';checkpointId:string|null;captureAt:string|null;ageMs:number|null;stale:boolean;reason?:string;
}
export interface SealedCheckpoint {directory:string;manifest:CheckpointManifest;}
export interface BackupCoordinatorOptions {
 root:string;adapter?:NativeRecoveryAdapter;now?:()=>number;maxBytes?:number;maxFiles?:number;captureTimeoutMs?:number;
}

/** Host-owned coordinator. Plain sealed materials remain private local source data;
 * the repository adapter receives only verified sealed directories, never live paths. */
export class BackupCoordinator {
 private readonly root:string;private readonly now:()=>number;
 private readonly tasks=new Map<string,{state:BackupTaskStatus['state'];reason?:string}>();
 private readonly captures=new Map<string,AbortController>();private initialized?:Promise<void>;
 constructor(private options:BackupCoordinatorOptions){this.root=resolve(options.root);this.now=options.now??Date.now;}
 private key(scope:string,taskId:string){if(!safeId(scope)||!safeId(taskId))throw new BackupError('invalid_identity','Invalid backup identity');return scope+'/'+taskId;}
 private async initialize(){
  if(!this.initialized)this.initialized=(async()=>{await mkdir(this.root,{recursive:true,mode:0o700});await checkedDirectory(this.root);await mkdir(join(this.root,'sealed'),{mode:0o700,recursive:true});await checkedDirectory(join(this.root,'sealed'));await mkdir(join(this.root,'staging'),{mode:0o700,recursive:true});await checkedDirectory(join(this.root,'staging'));})();
  return this.initialized;
 }
 async status(scope:string,taskId:string,engine:AgentEngine):Promise<BackupTaskStatus>{
  const key=this.key(scope,taskId),excluded=DEFERRED_BACKUP_ENGINES.includes(engine as typeof DEFERRED_BACKUP_ENGINES[number]);
  const base:BackupTaskStatus={taskId,engine,state:'unprotected',coverage:excluded?'excluded':'unavailable',checkpointId:null,captureAt:null,ageMs:null,stale:false,reason:excluded?'Deferred engine outside this release':'Native writer coverage is not verified'};
  if(excluded)return base;
  const point=await this.sealedCheckpoint(scope,taskId);
  const current=this.tasks.get(key);
  if(point){const ageMs=Math.max(0,this.now()-Date.parse(point.manifest.captureAt));return {...base,state:current?.state??'protected',coverage:'complete',checkpointId:point.manifest.checkpointId,captureAt:point.manifest.captureAt,ageMs,stale:ageMs>24*60*60*1000,reason:current?.reason};}
  return {...base,...current};
 }
 cancel(scope:string,taskId:string):boolean{const controller=this.captures.get(this.key(scope,taskId));controller?.abort(new BackupError('capture_cancelled','Capture cancelled'));return Boolean(controller);}
 async capture(scope:string,taskId:string,engine:AgentEngine,signal?:AbortSignal):Promise<BackupTaskStatus>{
  const key=this.key(scope,taskId);
  if(!BACKUP_ENGINES.includes(engine as typeof BACKUP_ENGINES[number]))return this.status(scope,taskId,engine);
  if(!this.options.adapter){this.tasks.set(key,{state:'unavailable',reason:'Native writer coverage is not verified'});return this.status(scope,taskId,engine);}
  if(this.captures.has(key))throw new BackupError('capture_busy','Capture already running for this task');
  if(this.captures.size>=1)throw new BackupError('capture_busy','Another low-priority capture is running');
  const controller=new AbortController();this.captures.set(key,controller);
  const cancel=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  const timeout=setTimeout(()=>controller.abort(new BackupError('capture_timeout','Capture resource deadline exceeded')),this.options.captureTimeoutMs??30000);
  let lease:CaptureLease|undefined,staging:string|undefined;
  try{
   await this.initialize();this.tasks.set(key,{state:'capturing'});
   const group=await this.options.adapter.resolve(scope,taskId);
   validateGroup(group,scope,taskId);
   lease=await group.fence.lease();
   const assert=()=>{controller.signal.throwIfAborted();lease!.assertValid();};assert();
   await group.validate();assert();
   const checkpointId=randomUUID(),captureAt=new Date(this.now()).toISOString();
   staging=join(this.root,'staging',checkpointId);await mkdir(staging,{mode:0o700});
   await mkdir(join(staging,'objects'),{mode:0o700});
   const objects:CheckpointObject[]=[],budget={bytes:0,files:0};
   for(const source of group.sources){assert();if(source.path!==undefined)await copySource(source.path,join(staging,'objects',source.id),'objects/'+source.id,source.role,objects,budget,{maxBytes:this.options.maxBytes??1024*1024*1024,maxFiles:this.options.maxFiles??100000},assert);else {budget.bytes+=source.data.byteLength;budget.files++;if(budget.bytes>(this.options.maxBytes??1024*1024*1024)||budget.files>(this.options.maxFiles??100000))throw new BackupError('resource_limit','Capture resource limit exceeded');await durableBytes(join(staging,'objects',source.id),source.data);objects.push({path:'objects/'+source.id,kind:'file',mode:0o600,size:source.data.byteLength,sha256:digest(source.data),role:source.role});}}
   await group.validate();assert();
   const manifest:CheckpointManifest={schemaVersion:1,checkpointId,captureAt,adapterVersion:this.options.adapter.version,groupId:group.groupId,epoch:lease.epoch,members:group.members,coverage:'complete',objects,totalBytes:budget.bytes};
   await durableWrite(join(staging,'manifest.json'),JSON.stringify(manifest));
   await durableWrite(join(staging,'seal'),digest(JSON.stringify(manifest))+'\n');
   await syncDirectory(staging);assert();
   // Publication has no await between final lease check and rename admission.
   const publication=rename(staging,join(this.root,'sealed',checkpointId));await publication;staging=undefined;
   await syncDirectory(join(this.root,'sealed'));
   this.tasks.delete(key);
  }catch(error){
   const code=error instanceof BackupError?error.code:controller.signal.aborted?'capture_cancelled':'capture_failed';
   this.tasks.set(key,{state:code==='writers_active'||code==='capture_revoked'?'waiting':code==='writers_unknown'?'unavailable':'failed',reason:publicReason(code)});
  }finally{
   clearTimeout(timeout);signal?.removeEventListener('abort',cancel);lease?.release();this.captures.delete(key);
   if(staging)await rm(staging,{recursive:true,force:true});
  }
  return this.status(scope,taskId,engine);
 }
 /** A controlled local job boundary. It returns source paths only to trusted Host code. */
 async sealedCheckpoint(scope:string,taskId:string):Promise<SealedCheckpoint|undefined>{
  this.key(scope,taskId);await this.initialize();let latest:SealedCheckpoint|undefined;
  for(const name of await readdir(join(this.root,'sealed'))){
   if(!/^[0-9a-f-]{36}$/.test(name))continue;
   const directory=join(this.root,'sealed',name);
   try{
    await checkedDirectory(directory);const raw=await readFile(join(directory,'manifest.json'),'utf8'),seal=(await readFile(join(directory,'seal'),'utf8')).trim();
    if(digest(raw)!==seal)continue;const manifest:CheckpointManifest=JSON.parse(raw);
    if(manifest.schemaVersion!==1||manifest.checkpointId!==name||manifest.coverage!=='complete'||!Number.isFinite(Date.parse(manifest.captureAt))||!Array.isArray(manifest.members)||!manifest.members.some(m=>m.scope===scope&&m.taskId===taskId))continue;
    if(!Array.isArray(manifest.objects)||manifest.objects.length>(this.options.maxFiles??100000))continue;
    await verifyObjects(directory,manifest.objects);
    if(!latest||manifest.captureAt>latest.manifest.captureAt)latest={directory,manifest};
   }catch{ /* An incomplete or damaged point is never published as protected. */ }
  }
  return latest;
 }
}
function validateGroup(group:NativeRecoveryGroup,scope:string,taskId:string){
 if(!safeId(group.groupId)||!group.members.length||!group.members.some(m=>m.scope===scope&&m.taskId===taskId)||group.members.some(m=>!safeId(m.scope)||!safeId(m.taskId)||!BACKUP_ENGINES.includes(m.engine as typeof BACKUP_ENGINES[number])||!m.nativeBindings.length))throw new BackupError('closure_incomplete','Native source closure is incomplete');
 if(!group.sources.length||new Set(group.sources.map(s=>s.id)).size!==group.sources.length||group.sources.some(s=>!safeId(s.id)||(s.path!==undefined&&!isAbsolute(s.path)))||!group.sources.some(s=>s.role==='native')||!group.sources.some(s=>s.role==='workspace'))throw new BackupError('closure_incomplete','Native source closure is incomplete');
}
function publicReason(code:string){return ({writers_active:'Consistency group has active writers',capture_revoked:'Capture revoked by a writer; previous sealed checkpoint retained',writers_unknown:'Native writer coverage is not verified',capture_cancelled:'Capture cancelled; previous sealed checkpoint retained',capture_timeout:'Capture resource deadline exceeded',closure_incomplete:'Native source closure is incomplete',resource_limit:'Capture resource limit exceeded',unsafe_source:'Source contains an unsafe path or unsupported file type'} as Record<string,string>)[code]??'Capture failed; previous sealed checkpoint retained';}
async function checkedDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path))throw new BackupError('unsafe_source','Unsafe backup directory');}
async function durableBytes(path:string,data:Uint8Array){const handle=await open(path,'wx',0o400);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}}
async function durableWrite(path:string,text:string){await durableBytes(path,Buffer.from(text));}
async function syncDirectory(path:string){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function copySource(source:string,target:string,name:string,role:RecoverySource['role'],objects:CheckpointObject[],budget:{bytes:number;files:number},limits:{maxBytes:number;maxFiles:number},assert:()=>void):Promise<void>{
 assert();const info=await lstat(source);
 if(info.isSymbolicLink()||await realpath(source)!==resolve(source))throw new BackupError('unsafe_source','Symlink source');
 if(++budget.files>limits.maxFiles)throw new BackupError('resource_limit','Too many files');
 if(info.isDirectory()){
  await mkdir(target,{mode:0o700});objects.push({path:name,kind:'directory',mode:info.mode&0o777,size:0,role});
  for(const child of (await readdir(source)).sort())await copySource(join(source,child),join(target,child),name+'/'+child,role,objects,budget,limits,assert);
  await syncDirectory(target);return;
 }
 if(!info.isFile()||info.nlink!==1)throw new BackupError('unsafe_source','Unsupported source file');
 if(info.size+budget.bytes>limits.maxBytes)throw new BackupError('resource_limit','Too many bytes');
 const input=await open(source,'r'),output=await open(target,'wx',0o400);const hash=createHash('sha256');let bytes=0;
 try{
  const opened=await input.stat();if(opened.ino!==info.ino||opened.dev!==info.dev||!opened.isFile())throw new BackupError('unsafe_source','Source changed');
  const buffer=Buffer.allocUnsafe(256*1024);
  for(;;){assert();const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break;bytes+=bytesRead;budget.bytes+=bytesRead;if(budget.bytes>limits.maxBytes)throw new BackupError('resource_limit','Too many bytes');const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);await output.writeFile(chunk);}
  await output.sync();const after=await input.stat();if(after.size!==bytes||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw new BackupError('capture_revoked','Source changed outside writer fence');
 }finally{await Promise.all([input.close(),output.close()]);}
 objects.push({path:name,kind:'file',mode:info.mode&0o777,size:bytes,sha256:hash.digest('hex'),role});
}
async function verifyObjects(directory:string,objects:CheckpointObject[]){
 const seen=new Set<string>();
 for(const object of objects){
  if(typeof object.path!=='string'||seen.has(object.path)||!object.path.startsWith('objects/')||object.path.split('/').some(p=>!p||p==='.'||p==='..')||isAbsolute(object.path)||object.path.includes('\\'))throw Error('Invalid object');seen.add(object.path);
  const path=resolve(directory,object.path),rel=relative(directory,path);if(rel.startsWith('..')||isAbsolute(rel))throw Error('Invalid object');
  const info=await lstat(path);if(info.isSymbolicLink()||await realpath(path)!==path)throw Error('Unsafe sealed object');
  if(object.kind==='directory'){if(!info.isDirectory())throw Error('Missing directory');}
  else if(object.kind==='file'){if(!info.isFile()||info.size!==object.size||digest(await readFile(path))!==object.sha256)throw Error('Damaged sealed file');}
  else throw Error('Unknown object type');
 }
}
