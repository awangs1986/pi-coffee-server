import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync,writeFileSync,fsyncSync,renameSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import {BackupError,BackupCoordinator,WriterAdmissionFence,LEGACY_BACKUP_SCOPE,type CaptureLease,type RecoveryPublication,type SealedCheckpoint} from './backup.js';
import {normalizeUsername} from '../shared/identity.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {PhysicalWriterFence} from './physical-writer-fence.js';
import {materializeTrustedNativeSource,type TrustedNativeSourceScope} from './trusted-native-source-closure.js';
import {verifyNativeSourceHandoff,type NativeSourceHandoff} from './native-source-handoff.js';

interface DirectoryIdentity {path:string;dev:number;ino:number;uid:number;}
interface ProcessIdentity {pid:number;uid:number;boot:string;birth:string;}
interface Producer {id:string;kind:'host'|'delegation-broker';identity:ProcessIdentity;}
interface Configuration {
 schema:1;groupId:string;
 owner:{administrator:string;operatingAssumption:'all-source-producers-use-admission-v1'};
 roots:{id:string;path:string}[];producers:{id:string;kind:Producer['kind']}[];
}
interface Enrollment {
 schema:1;id:string;groupId:string;configurationDigest:string;graphDigest:string;
 roots:(DirectoryIdentity&{id:string})[];producers:Producer[];administrator:string;
 assumptions:readonly ['trusted-source-root','all-source-producers-use-admission-v1'];
 initialCheckpoint?:string;handoffDigest?:string;
}
interface Operation {id:string;producer:string;kind:'local'|'delegation';}
interface State {schema:1;revision:number;enrollment?:Enrollment;operations:Operation[];issues:string[];}
export interface TrustedSourceOptions {
 root:string;configuration:string;graph:string;fence:PhysicalWriterFence;
 /** Invoked by trusted Host integration, never inferred from sudo or caller scope. */
 authorize:(actor:string)=>Promise<boolean>;
}
export interface TrustedSourceEvidence {
 schema:1;enrollmentId:string;groupId:string;revision:number;
 assumptions:Enrollment['assumptions'];configurationDigest:string;graphDigest:string;
}
export interface ExistingSourceEnrollment {
 producer:string;handoff:NativeSourceHandoff;scopes:readonly TrustedNativeSourceScope[];checkpointRoot:string;
}
const boundFences=new WeakMap<WriterAdmissionFence,PhysicalWriterFence>();
/** Exact construction provenance for native launch attestation, not a Boolean. */
export function trustedSourcePhysicalFence(fence:WriterAdmissionFence){return boundFences.get(fence);}
const invalid=()=>new BackupError('writers_unknown','Trusted source ownership or writer coverage is unqualified');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,names:string[])=>Object.keys(value).length===names.length&&Object.keys(value).every(key=>names.includes(key));
function directory(path:string,source=false):DirectoryIdentity{
 const stat=lstatSync(path);if(resolve(path)!==path||realpathSync(path)!==path||!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&(source?0o022:0o077))!==0)throw invalid();
 return {path,dev:stat.dev,ino:stat.ino,uid:stat.uid};
}
function privateText(path:string,max=1024*1024):string{
 if(resolve(path)!==path||realpathSync(path)!==path)throw invalid();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||stat.size>max)throw invalid();
  const text=readFileSync(fd,'utf8');if(Buffer.byteLength(text)>max)throw invalid();return text;
 }finally{closeSync(fd);}
}
function identity(pid:number):ProcessIdentity{
 if(!Number.isSafeInteger(pid)||pid<1)throw invalid();
 const stat=readFileSync('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),status=readFileSync('/proc/'+pid+'/status','utf8');
 const uids=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);if(!uids||new Set(uids.slice(1)).size!==1||['Z','X'].includes(fields[0]))throw invalid();
 return {pid,uid:Number(uids[1]),boot:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),birth:fields[19]};
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function producerCurrent(producer:Producer|undefined){try{return Boolean(producer&&same(identity(producer.identity.pid),producer.identity));}catch{return false;}}
const under=(parent:string,path:string)=>path===parent||(!relative(parent,path).startsWith('..')&&!isAbsolute(relative(parent,path)));
function configuration(text:string):Configuration{
 const value:unknown=JSON.parse(text);
 if(!record(value)||!keys(value,['schema','groupId','owner','roots','producers'])||value.schema!==1||!id(value.groupId)||!record(value.owner)||!keys(value.owner,['administrator','operatingAssumption'])||!id(value.owner.administrator)||value.owner.operatingAssumption!=='all-source-producers-use-admission-v1'||!Array.isArray(value.roots)||!value.roots.length||value.roots.length>64||!Array.isArray(value.producers)||!value.producers.length||value.producers.length>64)throw invalid();
 for(const root of value.roots)if(!record(root)||!keys(root,['id','path'])||!id(root.id)||typeof root.path!=='string'||resolve(root.path)!==root.path)throw invalid();
 for(const producer of value.producers)if(!record(producer)||!keys(producer,['id','kind'])||!id(producer.id)||!['host','delegation-broker'].includes(String(producer.kind)))throw invalid();
 if(new Set(value.roots.map(root=>root.id)).size!==value.roots.length||new Set(value.producers.map(producer=>producer.id)).size!==value.producers.length)throw invalid();
 return value as unknown as Configuration;
}
function graph(text:string,config:Configuration){
 const value:unknown=JSON.parse(text);
 if(!record(value)||!keys(value,['schema','groupId','roots'])||value.schema!==1||value.groupId!==config.groupId||!Array.isArray(value.roots)||value.roots.length!==config.roots.length)throw invalid();
 for(const root of value.roots)if(!record(root)||!keys(root,['id','scope','engine'])||!id(root.id)||typeof root.scope!=='string'||root.scope!==LEGACY_BACKUP_SCOPE&&normalizeUsername(root.scope)!==root.scope||!['pi','codex','shared'].includes(String(root.engine))||!config.roots.some(entry=>entry.id===root.id))throw invalid();
 if(new Set(value.roots.map(root=>root.id)).size!==value.roots.length)throw invalid();
}

/** Trusted-owner operating contract plus observed identities and durable admission.
 * This is not a scan-based exclusion proof or a sandbox. Integration must register
 * every source-producing authority; external/untracked producers remain unknown.
 * The graph file is a trusted adapter root inventory, not a replacement for the
 * native adapter's version-specific closure validation at every cut. */
export class TrustedSourceAuthority {
 private state:State={schema:1,revision:0,operations:[],issues:[]};private stateDigest='';
 private readonly provisional=new AsyncLocalStorage<{enrollment:Enrollment;revision:number;lease:CaptureLease}>();
 private closed=false;private disabled=false;private enrolling=false;private active=new Set<string>();private fences=new Map<string,WriterAdmissionFence>();
 private constructor(private options:TrustedSourceOptions,private owner:FileLease,private rootIdentity:DirectoryIdentity){}
 static async open(options:TrustedSourceOptions){
  if(!(options.fence instanceof PhysicalWriterFence)||[options.root,options.configuration,options.graph].some(path=>resolve(path)!==path))throw invalid();
  await mkdir(options.root,{recursive:true,mode:0o700});const root=directory(options.root),owner=acquireFileLease(join(options.root,'owner.lock'),'exclusive');if(!owner)throw invalid();
  const authority=new TrustedSourceAuthority(options,owner,root);
  try{
   let text:string;try{text=privateText(join(options.root,'state.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;authority.save();return authority;}
   const state:State=JSON.parse(text);if(state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.operations)||!Array.isArray(state.issues)||state.issues.some(issue=>!id(issue))||state.operations.some(operation=>!operation||!id(operation.id)||!id(operation.producer)||!['local','delegation'].includes(operation.kind)))throw invalid();
   authority.state=state;authority.stateDigest=hash(text);
   // A restart never revives coverage automatically. Only a real native handoff
   // and a complete new sealed cut may requalify an otherwise intact journal.
   authority.poison('authority-reopened');return authority;
  }catch{owner.release();throw invalid();}
 }
 private assertOwner(){if(this.closed)throw invalid();this.owner.assertHeld();if(!same(directory(this.options.root),this.rootIdentity)||hash(privateText(join(this.options.root,'state.json')))!==this.stateDigest)throw invalid();}
 private save(){
  const text=JSON.stringify(this.state);if(Buffer.byteLength(text)>1024*1024)throw invalid();
  const temporary=join(this.options.root,randomUUID()+'.tmp'),file=openSync(temporary,'wx',0o600);
  try{writeFileSync(file,text);fsyncSync(file);}finally{closeSync(file);}
  renameSync(temporary,join(this.options.root,'state.json'));const parent=openSync(this.options.root,'r');try{fsyncSync(parent);}finally{closeSync(parent);}this.stateDigest=hash(text);
 }
 private poison(reason:string){
  this.disabled=true;this.options.fence.invalidate(reason);
  // Best effort only: metadata failure must not block unrelated ordinary work.
  // Reopened enrollment stays unqualified until the actual handoff protocol.
  try{this.assertOwner();if(!this.state.issues.includes(reason))this.state.issues.push(reason);this.state.revision++;this.save();}catch{}
 }
 async enrollFresh(actor:string,producers:{id:string;pid:number}[]){
  if(this.enrolling)throw invalid();this.enrolling=true;try{
   if(!await this.options.authorize(actor))throw invalid();this.assertOwner();if(this.disabled||this.state.enrollment||this.state.operations.length||this.state.issues.length)throw invalid();const revision=this.state.revision;
   const configText=privateText(this.options.configuration,65536),config=configuration(configText),graphText=privateText(this.options.graph,65536);graph(graphText,config);
   if(actor!==config.owner.administrator||producers.length!==config.producers.length||new Set(producers.map(producer=>producer.id)).size!==producers.length)throw invalid();
   const observed=config.producers.map(producer=>{const supplied=producers.find(value=>value.id===producer.id);if(!supplied)throw invalid();return {...producer,identity:identity(supplied.pid)};});
   for(const root of config.roots){directory(dirname(root.path));if(under(root.path,this.options.root)||under(this.options.root,root.path)||under(root.path,this.options.configuration)||under(root.path,this.options.graph)||config.roots.some(other=>other!==root&&(under(root.path,other.path)||under(other.path,root.path))))throw invalid();try{lstatSync(root.path);throw invalid();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
   const roots=[];for(const root of config.roots){await mkdir(root.path,{mode:0o700});roots.push({...directory(root.path),id:root.id});}
   this.assertOwner();if(this.disabled||this.state.revision!==revision)throw invalid();this.state.enrollment={schema:1,id:randomUUID(),groupId:config.groupId,configurationDigest:hash(configText),graphDigest:hash(graphText),roots,producers:observed,administrator:actor,assumptions:['trusted-source-root','all-source-producers-use-admission-v1']};this.state.revision++;this.save();
  }finally{this.enrolling=false;}
 }
 async enrollExisting(actor:string,options:ExistingSourceEnrollment){return this.enrollCold(actor,options,false);}
 async requalify(actor:string,options:ExistingSourceEnrollment){return this.enrollCold(actor,options,true);}
 /** Trusted main may use this after passive handoff collection at startup. */
 async qualifyExisting(actor:string,options:ExistingSourceEnrollment){return this.enrollCold(actor,options,Boolean(this.state.enrollment));}
 private async enrollCold(actor:string,options:ExistingSourceEnrollment,restart:boolean):Promise<{checkpoint:SealedCheckpoint;evidence:TrustedSourceEvidence}>{
  if(this.enrolling)throw invalid();this.enrolling=true;let lease:CaptureLease|undefined;
  try{
   if(!await this.options.authorize(actor))throw invalid();this.assertOwner();
   if(this.state.operations.length||this.state.issues.some(issue=>issue!=='authority-reopened')||Boolean(this.state.enrollment)!==restart||restart&&!this.state.issues.includes('authority-reopened')||this.disabled&&!this.state.issues.includes('authority-reopened'))throw invalid();
   const revision=this.state.revision,configText=privateText(this.options.configuration,65536),config=configuration(configText),graphText=privateText(this.options.graph,65536);graph(graphText,config);
   // Initial supported topology is one cooperating Host. A daemon or remote
   // authority needs its own real handoff adapter, never a guessed process list.
   if(actor!==config.owner.administrator||config.producers.length!==1||config.producers[0].kind!=='host'||config.producers[0].id!==options.producer)throw invalid();
   const roots=config.roots.map(root=>({...directory(root.path,true),id:root.id}));
   for(const root of roots)if(under(root.path,this.options.root)||under(this.options.root,root.path)||under(root.path,this.options.configuration)||under(root.path,this.options.graph)||under(root.path,options.checkpointRoot)||under(options.checkpointRoot,root.path)||roots.some(other=>other!==root&&(under(root.path,other.path)||under(other.path,root.path))))throw invalid();
   if(restart){const old=this.state.enrollment!;if(old.configurationDigest!==hash(configText)||old.graphDigest!==hash(graphText)||!same(old.roots,roots))throw invalid();}
   const enrollment:Enrollment={schema:1,id:randomUUID(),groupId:config.groupId,configurationDigest:hash(configText),graphDigest:hash(graphText),roots,producers:[{...config.producers[0],identity:identity(process.pid)}],administrator:actor,assumptions:['trusted-source-root','all-source-producers-use-admission-v1']};
   lease=await this.options.fence.lease();const held=lease;
   return await this.provisional.run({enrollment,revision,lease:held},async()=>{
    this.evidence();this.assertScopeInventory(options.scopes);
    const fence=this.writerFence(options.producer),observedPaths=new Set<string>(),native=await materializeTrustedNativeSource({groupId:config.groupId,scopes:options.scopes,fence,lease:held,assertRoots:paths=>{this.verifyRoots(paths);for(const path of paths)observedPaths.add(path);}});
    this.assertEnrolledRootsUsed([...observedPaths]);
    let handoff;try{handoff=await verifyNativeSourceHandoff(options.handoff,{fence:this.options.fence,lease:held,stores:native.stores});}catch{throw invalid();}
    this.evidence();const member=native.group.members[0];
    const coordinator=new BackupCoordinator({root:options.checkpointRoot,adapter:{version:'trusted-native-source-v1',resolve:async()=>native.group}});
    const status=await coordinator.capture(member.scope,member.taskId,member.engine);if(status.state!=='protected'||!status.checkpointId)throw invalid();
    const checkpoint=await coordinator.sealedCheckpoint(member.scope,member.taskId,status.checkpointId);if(!checkpoint)throw invalid();
    this.evidence();held.assertValid();enrollment.initialCheckpoint=checkpoint.manifest.checkpointId;enrollment.handoffDigest=handoff.receiptDigest;
    this.state.enrollment=enrollment;this.state.issues=[];this.state.revision++;this.disabled=false;
    try{this.save();}catch{this.poison('enrollment-journal-unavailable');throw invalid();}
    const evidence:TrustedSourceEvidence={schema:1,enrollmentId:enrollment.id,groupId:enrollment.groupId,revision:this.state.revision,assumptions:[...enrollment.assumptions],configurationDigest:enrollment.configurationDigest,graphDigest:enrollment.graphDigest};
    return {checkpoint,evidence};
   });
  }finally{lease?.release();this.enrolling=false;}
 }
 private assertScopeInventory(scopes:readonly TrustedNativeSourceScope[]){
  const config=configuration(privateText(this.options.configuration,65536)),value=JSON.parse(privateText(this.options.graph,65536));graph(JSON.stringify(value),config);
  if(!scopes.length||new Set(scopes.map(scope=>scope.scope)).size!==scopes.length||value.roots.some((root:{scope:string})=>!scopes.some(scope=>scope.scope===root.scope))||scopes.some(scope=>!value.roots.some((root:{scope:string})=>root.scope===scope.scope)))throw invalid();
 }
 private assertEnrolledRootsUsed(paths:readonly string[]){
  const enrollment=this.provisional.getStore()?.enrollment??this.state.enrollment;if(!enrollment||enrollment.roots.some(root=>!paths.some(path=>under(root.path,path))))throw invalid();
 }
 createNativeCoordinator(options:Omit<ExistingSourceEnrollment,'handoff'>):BackupCoordinator{
  const fence=this.writerFence(options.producer),authority=this;
  return new BackupCoordinator({root:options.checkpointRoot,adapter:{version:'trusted-native-source-v1',resolve:async()=>{
   const evidence=authority.evidence();authority.assertScopeInventory(options.scopes);
   return {groupId:evidence.groupId,fence,members:[],sources:[],validate:async()=>{throw invalid();},materialize:async lease=>{const observedPaths=new Set<string>(),native=await materializeTrustedNativeSource({groupId:evidence.groupId,scopes:options.scopes,fence,lease,assertRoots:paths=>{authority.verifyRoots(paths);for(const path of paths)observedPaths.add(path);}});authority.assertEnrolledRootsUsed([...observedPaths]);return native.group;}};
  }}});
 }
 private evidence():TrustedSourceEvidence{
  this.assertOwner();const provisional=this.provisional.getStore(),enrollment=provisional?.enrollment??this.state.enrollment;
  if(provisional){provisional.lease.assertValid();if(this.state.revision!==provisional.revision||this.state.operations.length||this.state.issues.some(issue=>issue!=='authority-reopened'))throw invalid();}
  else if(this.disabled||this.state.issues.length)throw invalid();
  if(!enrollment||enrollment.schema!==1)throw invalid();
  if(hash(privateText(this.options.configuration,65536))!==enrollment.configurationDigest||hash(privateText(this.options.graph,65536))!==enrollment.graphDigest)throw invalid();
  for(const root of enrollment.roots){const {id:_,...expected}=root;if(!same(directory(root.path,true),expected))throw invalid();}
  for(const producer of enrollment.producers)if(!producerCurrent(producer))throw invalid();
  return {schema:1,enrollmentId:enrollment.id,groupId:enrollment.groupId,revision:this.state.revision,assumptions:[...enrollment.assumptions],configurationDigest:enrollment.configurationDigest,graphDigest:enrollment.graphDigest};
 }
 async qualification():Promise<{state:'qualified'|'active'|'unknown';reason?:string;evidence?:TrustedSourceEvidence}>{
  try{const evidence=this.evidence();if(this.state.operations.length){const active=this.state.operations.every(operation=>this.active.has(operation.id));return {state:active?'active':'unknown',reason:active?'source-writers-active':'source-operation-unresolved'};}return {state:'qualified',evidence};}catch{return {state:'unknown',reason:'source-qualification-unavailable'};}
 }
 /** Main must check its actual configured source paths; a valid enrollment of
  * unrelated directories grants no source proof. This is not account access
  * authorization or a replacement for native adapter closure validation. */
 verifyRoots(paths:readonly string[]):TrustedSourceEvidence{
  try{
   const evidence=this.evidence();if(!Array.isArray(paths)||!paths.length||paths.length>256)throw invalid();
   for(const path of paths){
    if(typeof path!=='string'||resolve(path)!==path||realpathSync(path)!==path)throw invalid();
    const stat=lstatSync(path),root=(this.provisional.getStore()?.enrollment??this.state.enrollment)!.roots.find(root=>under(root.path,path));
    if(!root||stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory()||stat.dev!==root.dev)throw invalid();
   }
   return evidence;
  }catch{throw invalid();}
 }
 async capture():Promise<{lease:CaptureLease;evidence:TrustedSourceEvidence}>{return this.cut(false);}
 private async cut(publication:boolean):Promise<{lease:CaptureLease;evidence:TrustedSourceEvidence}>{
  let evidence:TrustedSourceEvidence;try{evidence=this.evidence();}catch{throw invalid();}
  if(this.state.operations.length)throw this.state.operations.every(operation=>this.active.has(operation.id))?new BackupError('writers_active','Tracked source writers are active'):invalid();
  const provisional=this.provisional.getStore();
  if(provisional){if(publication)throw invalid();const held=provisional.lease;held.assertValid();return {evidence,lease:{epoch:held.epoch,signal:held.signal,assertValid:()=>{held.assertValid();if(!same(evidence,this.evidence()))throw invalid();},release:()=>{}}};}
  const lease=await (publication?this.options.fence.publicationLease():this.options.fence.lease());
  const assert=lease.assertValid.bind(lease);lease.assertValid=()=>{assert();try{if(this.state.operations.length||!same(evidence,this.evidence()))throw invalid();}catch{throw invalid();}};
  try{lease.assertValid();}catch(error){lease.release();throw error;}
  // Preserve the exact physical publication object and its WeakSet capability.
  return {evidence,lease};
 }
 runWriter<T>(producer:string,operation:string,run:()=>Promise<T>):Promise<T>{return this.run(producer,operation,'local',run);}
 /** Negative observations revoke immediately and persist. No inverse API turns
  * a later empty process scan or an operator assertion into source proof. */
 invalidateCoverage(reason:'unregistered-producer'|'untracked-delegation'|'inspection-unavailable'):Promise<void>{
  if(!['unregistered-producer','untracked-delegation','inspection-unavailable'].includes(reason))throw invalid();this.poison(reason);return Promise.resolve();
 }
 /** Only a registered producer adapter may call this. Its promise must cover
  * the actual downstream job, not merely SSH/launcher acceptance. Failure or
  * authority loss leaves a durable unknown operation; no timeout clears it. */
 runDelegated<T>(producer:string,operation:string,run:()=>Promise<T>):Promise<T>{return this.run(producer,operation,'delegation',run);}
 private begin(producer:string,operation:string,kind:Operation['kind'],writerClass='platform'){
  if(!id(producer)||!id(operation))throw invalid();
  // Do not bypass physical recovery exclusion or an unreadable recovery gate.
  // Only backup-journal failures AFTER successful physical admission fall back.
  const release=this.options.fence.beginWriter(writerClass);let recorded=false,ended=false;
  try{
   if(this.state.operations.some(item=>item.id===operation))throw new BackupError('source_operation_active','Source operation identity is already pending');
   try{
    this.assertOwner();const enrolled=this.state.enrollment?.producers.find(item=>item.id===producer);
    const prequalifiedHost=kind==='local'&&(!this.state.enrollment||this.state.issues.includes('authority-reopened'))&&configuration(privateText(this.options.configuration,65536)).producers.some(item=>item.id===producer&&item.kind==='host');
    if(!producerCurrent(enrolled)&&!prequalifiedHost||kind==='delegation'&&enrolled?.kind!=='delegation-broker'||!['platform','native'].includes(writerClass)){if(!this.state.issues.includes('unregistered-producer'))this.state.issues.push('unregistered-producer');}
    this.state.operations.push({id:operation,producer,kind});this.state.revision++;this.save();this.active.add(operation);recorded=true;
   }catch{this.poison('admission-journal-unavailable');}
  }catch(error){release();throw error;}
  return (settled:boolean)=>{if(ended)return;ended=true;try{
   if(recorded&&settled){try{this.assertOwner();this.state.operations=this.state.operations.filter(item=>item.id!==operation);this.state.revision++;this.save();}catch{this.poison('completion-journal-unavailable');}}
  }finally{this.active.delete(operation);release();}};
 }
 private async run<T>(producer:string,operation:string,kind:Operation['kind'],run:()=>Promise<T>,writerClass='platform'):Promise<T>{
  const end=this.begin(producer,operation,kind,writerClass);let settled=false;try{const value=await run();settled=true;return value;}finally{
   // A local promise rejection is a settled logical Host operation, not evidence
   // that its native/helper descendants exited. Physical custody independently
   // retains their writer lease. Delegation rejection may lose remote acceptance
   // and therefore remains unresolved until a real producer completion receipt.
   end(settled||kind==='local');
  }
 }
 /** This is the fence the coordinator, registry, adapters and Host admissions
  * must actually share; a separate preflight proof plus a raw fence is unsafe. */
 writerFence(producer:string):WriterAdmissionFence{
  if(!id(producer))throw invalid();const existing=this.fences.get(producer);if(existing)return existing;const authority=this,physical=this.options.fence;
  const fence=new class extends WriterAdmissionFence {
   override invalidate(reason?:string){physical.invalidate(reason);}
   override beginWriter(writerClass:string){const end=authority.begin(producer,randomUUID(),'local',writerClass);return ()=>end(true);}
   override async runWriter<T>(writerClass:string,run:()=>Promise<T>){return authority.run(producer,randomUUID(),'local',run,writerClass);}
   override async lease(){return (await authority.capture()).lease;}
   override async publicationLease(){return (await authority.cut(true)).lease;}
   override async runRecoveryPublication<T>(publication:RecoveryPublication,run:()=>Promise<T>){return physical.runRecoveryPublication(publication,run);}
  }({writerClasses:[]});boundFences.set(fence,physical);this.fences.set(producer,fence);return fence;
 }
 async close(){if(this.closed)return;this.closed=true;this.options.fence.invalidate('Source authority closed');this.owner.release();}
}
