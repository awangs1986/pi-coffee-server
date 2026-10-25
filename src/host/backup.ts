import {normalizeUsername} from '../shared/identity.js';
import {renameSync} from 'node:fs';
import {readReleaseIdentity} from '../shared/release.js';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,lstat,realpath,open,readdir,rename,readFile,rm,readlink,symlink} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import type {AgentEngine} from '../shared/protocol.js';

export const BACKUP_PROTOCOL_VERSION=1;
/** Reserved data-scope identity; cannot collide with a valid Gitea username. */
export const LEGACY_BACKUP_SCOPE='__legacy_default__';
export const BACKUP_ENGINES=['pi','codex'] as const;
export const DEFERRED_BACKUP_ENGINES=['claude','cursor','grok'] as const;
const validScope=(value:string)=>value===LEGACY_BACKUP_SCOPE||normalizeUsername(value)===value;
const safeId=(value:string)=>/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export class BackupError extends Error {constructor(readonly code:string,message:string){super(message);}}
export interface WriterProof {known:boolean;active?:boolean;reason?:string;}
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
  if(!proof)throw new BackupError('writers_unknown','Native writer proof unavailable');
  if(!proof.known)throw new BackupError(proof.active?'writers_active':'writers_unknown',proof.reason??'Native writer coverage is not verified');
  if(this.active||epoch!==this.epoch)throw new BackupError('capture_revoked','Writer admitted while checking custody');
  const controller=new AbortController();this.leases.add(controller);let released=false;
  return {epoch,signal:controller.signal,assertValid:()=>{if(released||controller.signal.aborted||epoch!==this.epoch||this.active)throw new BackupError('capture_revoked','Capture revoked by a writer');},release:()=>{released=true;this.leases.delete(controller);}};
 }
}
export interface RecoveryMember {scope:string;taskId:string;engine:AgentEngine;nativeBindings:string[];}
export type RecoverySource = {id:string;recoveryKey:string;role:'registry'|'workspace'|'task-data'|'native'} & ({path:string;data?:never}|{data:Uint8Array;path?:never});
export interface NativeRecoveryGroup {
 groupId:string;adapterVersion?:string;fence:WriterAdmissionFence;members:RecoveryMember[];sources:RecoverySource[];
 /** Re-read native IDs, source closure and lifecycle against the original binding cut. */
 validate():Promise<void>;
}
/** Native store details, historical dependencies and shared writer groups belong here. */
export interface NativeRecoveryAdapter {readonly version:string;resolve(scope:string,taskId:string):Promise<NativeRecoveryGroup>;}
export interface CheckpointObject {path:string;kind:'file'|'directory'|'symlink';size:number;mode?:number;linkTarget?:string;sha256?:string;role:RecoverySource['role'];}
export interface CheckpointManifest {
 schemaVersion:1;checkpointId:string;captureAt:string;adapterVersion:string;groupId:string;epoch:number;
 members:RecoveryMember[];runtime:{serverVersion:string|null;commit:string|null};sources:{id:string;recoveryKey:string;role:RecoverySource['role'];originalPath?:string}[];coverage:'complete';objects:CheckpointObject[];totalBytes:number;
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
 private readonly captures=new Map<string,AbortController>();private initialized?:Promise<void>;private readonly metadata=new Map<string,Promise<SealedCheckpoint|undefined>>();private inventory?:Promise<SealedCheckpoint[]>;
 constructor(private options:BackupCoordinatorOptions){this.root=resolve(options.root);this.now=options.now??Date.now;}
 private key(scope:string,taskId:string){if(!validScope(scope)||!safeId(taskId))throw new BackupError('invalid_identity','Invalid backup identity');return scope+'/'+taskId;}
 private async initialize(){
  if(!this.initialized)this.initialized=(async()=>{await mkdir(this.root,{recursive:true,mode:0o700});await checkedDirectory(this.root);await mkdir(join(this.root,'sealed'),{mode:0o700,recursive:true});await checkedDirectory(join(this.root,'sealed'));await mkdir(join(this.root,'staging'),{mode:0o700,recursive:true});await checkedDirectory(join(this.root,'staging'));})();
  return this.initialized;
 }
 async status(scope:string,taskId:string,engine:AgentEngine):Promise<BackupTaskStatus>{
  const key=this.key(scope,taskId),excluded=DEFERRED_BACKUP_ENGINES.includes(engine as typeof DEFERRED_BACKUP_ENGINES[number]);
  const base:BackupTaskStatus={taskId,engine,state:'unprotected',coverage:excluded?'excluded':'unavailable',checkpointId:null,captureAt:null,ageMs:null,stale:false,reason:excluded?'Deferred engine outside this release':'Native writer coverage is not verified'};
  if(excluded)return base;
  let cached=this.metadata.get(key);if(!cached){cached=this.findCheckpoint(scope,taskId,false);this.metadata.set(key,cached);void cached.catch(()=>this.metadata.delete(key));}const point=await cached;
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
   const group=await abortable(this.options.adapter.resolve(scope,taskId),controller.signal);
   validateGroup(group,scope,taskId);
   if(group.sources.some(s=>s.path!==undefined&&(resolve(s.path)===this.root||this.root.startsWith(resolve(s.path)+'/')||resolve(s.path).startsWith(this.root+'/'))))throw new BackupError('unsafe_source','Checkpoint store overlaps a live source');
   const acquiredLease=await abortable(group.fence.lease().then(value=>{if(controller.signal.aborted){value.release();controller.signal.throwIfAborted();}return value;}),controller.signal);lease=acquiredLease;
   const captureSignal=AbortSignal.any([controller.signal,acquiredLease.signal]);
   const assert=()=>{controller.signal.throwIfAborted();acquiredLease.assertValid();};assert();
   await abortable(group.validate(),captureSignal);assert();
   const checkpointId=randomUUID(),captureAt=new Date(this.now()).toISOString();
   staging=join(this.root,'staging',checkpointId);await mkdir(staging,{mode:0o700});
   await mkdir(join(staging,'objects'),{mode:0o700});
   const objects:CheckpointObject[]=[],budget={bytes:0,files:0};
   for(const source of group.sources){assert();if(source.path!==undefined)await copySource(source.path,join(staging,'objects',source.id),'objects/'+source.id,source.role,objects,budget,{maxBytes:this.options.maxBytes??1024*1024*1024,maxFiles:this.options.maxFiles??100000},assert);else {budget.bytes+=source.data.byteLength;budget.files++;if(budget.bytes>(this.options.maxBytes??1024*1024*1024)||budget.files>(this.options.maxFiles??100000))throw new BackupError('resource_limit','Capture resource limit exceeded');await durableBytes(join(staging,'objects',source.id),source.data);objects.push({path:'objects/'+source.id,kind:'file',mode:0o600,size:source.data.byteLength,sha256:digest(source.data),role:source.role});}}
   await abortable(group.validate(),captureSignal);assert();
   const runtime=await readReleaseIdentity(process.cwd());assert();
   const manifest:CheckpointManifest={schemaVersion:1,checkpointId,captureAt,adapterVersion:group.adapterVersion??this.options.adapter.version,groupId:group.groupId,epoch:acquiredLease.epoch,members:group.members,runtime:{serverVersion:runtime.version,commit:runtime.commit},sources:group.sources.map(({id,recoveryKey,role,path})=>({id,recoveryKey,role,...(path?{originalPath:resolve(path)}:{})})),coverage:'complete',objects,totalBytes:budget.bytes};
   if(Buffer.byteLength(JSON.stringify(manifest))>32*1024*1024)throw new BackupError('resource_limit','Manifest resource limit exceeded');
   await durableWrite(join(staging,'manifest.json'),JSON.stringify(manifest));
   await durableWrite(join(staging,'seal'),digest(JSON.stringify(manifest))+'\n');
   await syncDirectory(join(staging,'objects'));await syncDirectory(staging);assert();
   // A short synchronous publication linearizes sealing before any new JS writer admission.
   assert();const directory=join(this.root,'sealed',checkpointId);renameSync(staging,directory);staging=undefined;
   this.inventory=undefined;for(const member of group.members)this.metadata.set(this.key(member.scope,member.taskId),Promise.resolve({directory,manifest}));
   await syncDirectory(join(this.root,'sealed'));
   this.tasks.delete(key);
  }catch(error){
   const code=error instanceof BackupError?error.code:controller.signal.aborted?'capture_cancelled':'capture_failed';
   this.tasks.set(key,{state:code==='writers_active'||code==='capture_revoked'?'waiting':['writers_unknown','configuration_incomplete','external_context','closure_incomplete','native_version_unqualified','unsupported_native_schema','sqlite_home_unresolved','external_native_resource'].includes(code)?'unavailable':'failed',reason:publicReason(code)});
  }finally{
   clearTimeout(timeout);signal?.removeEventListener('abort',cancel);lease?.release();this.captures.delete(key);
   if(staging)await rm(staging,{recursive:true,force:true});
  }
  return this.status(scope,taskId,engine);
 }
 /** A controlled local job boundary. It returns source paths only to trusted Host code. */
 async sealedCheckpoint(scope:string,taskId:string):Promise<SealedCheckpoint|undefined>{const point=await this.findCheckpoint(scope,taskId,true);this.metadata.set(this.key(scope,taskId),Promise.resolve(point));return point;}
 private async findCheckpoint(scope:string,taskId:string,verify:boolean):Promise<SealedCheckpoint|undefined>{
  this.key(scope,taskId);await this.initialize();
  const points=verify?await this.readInventory(true):await(this.inventory??=this.readInventory(false));
  const candidates=points.filter(point=>point.manifest.members.some(m=>m.scope===scope&&m.taskId===taskId)).sort((a,b)=>b.manifest.captureAt.localeCompare(a.manifest.captureAt));
  for(const point of candidates){try{if(verify)await verifySealedCheckpoint(point.directory);return point;}catch{/* Keep a damaged newest point from hiding the preceding intact point. */}}
  return undefined;
 }
 private async readInventory(keepObjects:boolean):Promise<SealedCheckpoint[]>{
  const points:SealedCheckpoint[]=[];
  for(const name of await readdir(join(this.root,'sealed'))){
   if(!/^[0-9a-f-]{36}$/.test(name))continue;
   const directory=join(this.root,'sealed',name);
   try{
    await checkedDirectory(directory);const raw=await boundedText(join(directory,'manifest.json'),32*1024*1024),seal=(await boundedText(join(directory,'seal'),128)).trim();
    if(digest(raw)!==seal)continue;const manifest:CheckpointManifest=JSON.parse(raw);
    if(manifest.schemaVersion!==1||manifest.checkpointId!==name||manifest.coverage!=='complete'||!Number.isFinite(Date.parse(manifest.captureAt))||!Array.isArray(manifest.members)||manifest.members.some(m=>!validScope(m.scope)||!safeId(m.taskId)))continue;
    if(!Array.isArray(manifest.objects)||manifest.objects.length>(this.options.maxFiles??100000))continue;
    points.push({directory,manifest:keepObjects?manifest:{...manifest,objects:[],sources:[]}});
   }catch{/* Staging or damaged metadata cannot be a protected source checkpoint. */}
  }
  return points;
 }

}
function validateGroup(group:NativeRecoveryGroup,scope:string,taskId:string){
 if(!safeId(group.groupId)||!group.members.length||!group.members.some(m=>m.scope===scope&&m.taskId===taskId)||group.members.some(m=>!validScope(m.scope)||!safeId(m.taskId)||!BACKUP_ENGINES.includes(m.engine as typeof BACKUP_ENGINES[number])||!m.nativeBindings.length))throw new BackupError('closure_incomplete','Native source closure is incomplete');
 if(!group.sources.length||new Set(group.sources.map(s=>s.id)).size!==group.sources.length||group.sources.some(s=>!safeId(s.id)||typeof s.recoveryKey!=='string'||!s.recoveryKey||s.recoveryKey.length>256||s.recoveryKey.startsWith('/')||s.recoveryKey.split('/').includes('..')||(s.path!==undefined&&!isAbsolute(s.path)))||!group.sources.some(s=>s.role==='native')||!group.sources.some(s=>s.role==='workspace')||!group.sources.some(s=>s.role==='registry')||!group.sources.some(s=>s.role==='task-data'))throw new BackupError('closure_incomplete','Native source closure is incomplete');
}
function publicReason(code:string){return ({native_version_unqualified:'Codex native version is not qualified for complete recovery',unsupported_native_schema:'Codex native schema or enabled feature is not qualified for complete recovery',sqlite_home_unresolved:'Effective Codex SQLite home cannot be verified',external_native_resource:'Codex references an external resource without a recovery mapping',configuration_incomplete:'Mutable native Pi configuration is not mapped for recovery',external_context:'External MISHU context requires a recovery mapping',writers_active:'Consistency group has active writers',capture_revoked:'Capture revoked by a writer; previous sealed checkpoint retained',writers_unknown:'Native writer coverage is not verified',capture_cancelled:'Capture cancelled; previous sealed checkpoint retained',capture_timeout:'Capture resource deadline exceeded',closure_incomplete:'Native source closure is incomplete',resource_limit:'Capture resource limit exceeded',unsafe_source:'Source contains an unsafe path or unsupported file type'} as Record<string,string>)[code]??'Capture failed; previous sealed checkpoint retained';}
async function checkedDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path)||(info.mode&0o077)!==0||info.uid!==process.getuid?.())throw new BackupError('unsafe_source','Unsafe backup directory');}
async function durableBytes(path:string,data:Uint8Array){const handle=await open(path,'wx',0o400);try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}}
async function durableWrite(path:string,text:string){await durableBytes(path,Buffer.from(text));}
async function syncDirectory(path:string){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function copySource(source:string,target:string,name:string,role:RecoverySource['role'],objects:CheckpointObject[],budget:{bytes:number;files:number},limits:{maxBytes:number;maxFiles:number},assert:()=>void,sourceRoot=source):Promise<void>{
 assert();const info=await lstat(source);
 if(info.isSymbolicLink()){
  const original=await readlink(source),targetSource=resolve(dirname(source),original),inside=relative(sourceRoot,targetSource);
  if(inside.startsWith('..')||isAbsolute(inside)||isAbsolute(original))throw new BackupError('unsafe_source','Symlink leaves its owned source');
  if(++budget.files>limits.maxFiles)throw new BackupError('resource_limit','Too many files');
  await symlink(original,target);objects.push({path:name,kind:'symlink',linkTarget:original,size:0,role});return;
 }
 if(await realpath(source)!==resolve(source))throw new BackupError('unsafe_source','Symlink source');
 if(++budget.files>limits.maxFiles)throw new BackupError('resource_limit','Too many files');
 if(info.isDirectory()){
  await mkdir(target,{mode:0o700});objects.push({path:name,kind:'directory',mode:info.mode&0o777,size:0,role});
  for(const child of (await readdir(source)).sort())await copySource(join(source,child),join(target,child),name+'/'+child,role,objects,budget,limits,assert,sourceRoot);
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
  const info=await lstat(path);
  if(object.kind==='symlink'){if(!info.isSymbolicLink()||typeof object.linkTarget!=='string'||isAbsolute(object.linkTarget)||await readlink(path)!==object.linkTarget)throw Error('Unsafe sealed link');const target=relative(resolve(directory,'objects',object.path.split('/')[1]),resolve(dirname(path),object.linkTarget));if(target.startsWith('..')||isAbsolute(target))throw Error('Escaping sealed link');continue;}
  if(info.isSymbolicLink()||await realpath(path)!==path)throw Error('Unsafe sealed object');
  if(object.kind==='directory'){if(!info.isDirectory())throw Error('Missing directory');}
  else if(object.kind==='file'){if(!info.isFile()||info.size!==object.size||await fileDigest(path)!==object.sha256)throw Error('Damaged sealed file');}
  else throw Error('Unknown object type');
 }
}

async function boundedText(path:string,limit:number){const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>limit)throw Error('Invalid checkpoint metadata');return readFile(path,'utf8');}
async function fileDigest(path:string){const file=await open(path,'r'),hash=createHash('sha256');try{const buffer=Buffer.allocUnsafe(256*1024);for(;;){const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}return hash.digest('hex');}finally{await file.close();}}

async function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{if(signal.aborted)throw signal.reason;return new Promise<T>((resolve,reject)=>{const cancel=()=>reject(signal.reason);signal.addEventListener('abort',cancel,{once:true});void work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));});}

/** Repository/restore boundary: authenticate the sealed manifest and the entire
 * object tree, including rejecting extra files that Restic would otherwise read. */
export async function verifySealedCheckpoint(directory:string,expectedManifestSha256?:string):Promise<CheckpointManifest>{
 await checkedDirectory(directory);
 const raw=await boundedText(join(directory,'manifest.json'),32*1024*1024),seal=(await boundedText(join(directory,'seal'),128)).trim();
 if(digest(raw)!==seal||expectedManifestSha256&&digest(raw)!==expectedManifestSha256)throw new BackupError('checkpoint_damaged','Checkpoint manifest integrity failed');
 const manifest:CheckpointManifest=JSON.parse(raw);
 if(manifest.schemaVersion!==1||manifest.coverage!=='complete'||!Array.isArray(manifest.objects)||!Array.isArray(manifest.members)||!Number.isFinite(Date.parse(manifest.captureAt)))throw new BackupError('checkpoint_damaged','Checkpoint schema is not supported');
 await verifyObjects(directory,manifest.objects);
 const expected=new Set(manifest.objects.map(object=>object.path));
 async function walk(path:string,name:string):Promise<void>{for(const child of await readdir(path)){const entry=name+'/'+child,full=join(path,child);if(!expected.delete(entry))throw new BackupError('checkpoint_damaged','Checkpoint contains unsealed material');if((await lstat(full)).isDirectory())await walk(full,entry);}}
 const entries=await readdir(directory);if(entries.length!==3||!entries.every(entry=>['manifest.json','seal','objects'].includes(entry)))throw new BackupError('checkpoint_damaged','Checkpoint contains unsealed material');
 await walk(join(directory,'objects'),'objects');if(expected.size)throw new BackupError('checkpoint_damaged','Checkpoint material missing');
 return manifest;
}
