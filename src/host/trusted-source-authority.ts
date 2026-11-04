import type {FreshCustodyAllocation} from './native-custody.js';
import {constants,openSync,closeSync,fstatSync,readFileSync,lstatSync,realpathSync,writeFileSync,fsyncSync,renameSync,mkdirSync} from 'node:fs';
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

export interface DestinationContext {actor:string;scope:string;operationId:string;revision:number;mode:'missing-only'|'replace';digest?:string;}
export interface RestoreDestination {lease(context:DestinationContext):Promise<CaptureLease>;assertLease(lease:CaptureLease):void;}
const destinationLeases=new WeakMap<CaptureLease,TrustedSourceAuthority>();
declare const freshDestinationBrand:unique symbol;
export type FreshDestinationToken={readonly [freshDestinationBrand]:true};
const freshDestinations=new WeakMap<object,{fence:PhysicalWriterFence;allocation:FreshCustodyAllocation;assert:()=>void}>();
export function assertFreshDestinationToken(token:FreshDestinationToken,fence:PhysicalWriterFence){const proof=freshDestinations.get(token);if(!proof||proof.fence!==fence)throw invalid();proof.assert();return proof.allocation;}



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
 freshCustody?:FreshCustodyAllocation;initialCheckpoint?:string;handoffDigest?:string;handoffKernelBoot?:string;priorBootReceiptDigest?:string;reconciliation?:{id:string;digest:string};
}
interface LocalOwner {origin:'qualified-host'|'configured-host-startup';enrollmentId:string|null;configurationDigest:string;graphDigest:string;identity:ProcessIdentity;checksum:string;}
interface Operation {id:string;producer:string;kind:'local'|'delegation';localOwner?:LocalOwner;}
interface LocalResolution {id:string;producer:string;owner:LocalOwner;death:{kind:'boot-changed'|'process-exited'|'process-replaced';kernelBoot:string;previousBoot?:string;currentBirth?:string};}
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
 maxBytes?:number;maxFiles?:number;captureTimeoutMs?:number;
}
const boundFences=new WeakMap<WriterAdmissionFence,PhysicalWriterFence>();
/** Exact construction provenance for native launch attestation, not a Boolean. */
export function trustedSourcePhysicalFence(fence:WriterAdmissionFence){return boundFences.get(fence);}
const invalid=()=>new BackupError('writers_unknown','Trusted source ownership or writer coverage is unqualified');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
function captureLimits(options:Pick<ExistingSourceEnrollment,'maxBytes'|'maxFiles'|'captureTimeoutMs'>){
 const limits={maxBytes:options.maxBytes??1024**3,maxFiles:options.maxFiles??100000,captureTimeoutMs:options.captureTimeoutMs??30000};
 if(Object.values(limits).some(value=>!Number.isSafeInteger(value)||value<1)||limits.captureTimeoutMs>2147483647)throw new BackupError('resource_limit','Invalid capture resource limits');return limits;
}
async function beforeDeadline<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
 return new Promise<T>((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();void work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
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

const digestPattern=/^[a-f0-9]{64}$/;
const bootPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function localChecksum(operation:Pick<Operation,'id'|'producer'|'kind'>,owner:Omit<LocalOwner,'checksum'>){return hash(JSON.stringify([operation.id,operation.producer,operation.kind,owner.origin,owner.enrollmentId,owner.configurationDigest,owner.graphDigest,owner.identity.pid,owner.identity.uid,owner.identity.boot,owner.identity.birth]));}
/** Kernel process identity is a death proof only for this exact previously
 * recorded local owner. UID ambiguity/read failures never mean completion. */
function deadLocalOwner(owner:ProcessIdentity):LocalResolution['death']{
 const kernelBoot=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();if(!bootPattern.test(kernelBoot)||!bootPattern.test(owner.boot)||owner.uid!==process.getuid?.())throw invalid();
 if(owner.boot!==kernelBoot)return {kind:'boot-changed',kernelBoot,previousBoot:owner.boot};
 let stat:string,status:string;try{stat=readFileSync('/proc/'+owner.pid+'/stat','utf8');status=readFileSync('/proc/'+owner.pid+'/status','utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {kind:'process-exited',kernelBoot};throw invalid();}
 const fields=stat.slice(stat.lastIndexOf(')')+2).split(' '),uids=status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m);if(!uids||new Set(uids.slice(1)).size!==1||Number(uids[1])!==owner.uid||!/^\d+$/.test(fields[19]))throw invalid();
 if(fields[19]!==owner.birth)return {kind:'process-replaced',kernelBoot,currentBirth:fields[19]};
 if(['Z','X'].includes(fields[0]))return {kind:'process-exited',kernelBoot};throw invalid();
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
 private readonly provisional=new AsyncLocalStorage<{enrollment:Enrollment;revision:number;lease:CaptureLease;pending:Operation[]}>();
 private closed=false;private disabled=false;private enrolling=false;private active=new Set<string>();private fences=new Map<string,WriterAdmissionFence>();
 private constructor(private options:TrustedSourceOptions,private owner:FileLease,private rootIdentity:DirectoryIdentity){}
 static async open(options:TrustedSourceOptions){
  if(!(options.fence instanceof PhysicalWriterFence)||[options.root,options.configuration,options.graph].some(path=>resolve(path)!==path))throw invalid();
  await mkdir(options.root,{recursive:true,mode:0o700});const root=directory(options.root),owner=acquireFileLease(join(options.root,'owner.lock'),'exclusive');if(!owner)throw invalid();
  const authority=new TrustedSourceAuthority(options,owner,root);
  try{
   let text:string;try{text=privateText(join(options.root,'state.json'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;authority.save();return authority;}
   const state:State=JSON.parse(text);if(state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.operations)||!Array.isArray(state.issues)||new Set(state.operations.map(operation=>operation?.id)).size!==state.operations.length||state.issues.some(issue=>!id(issue))||state.operations.some(operation=>!operation||!id(operation.id)||!id(operation.producer)||!['local','delegation'].includes(operation.kind)))throw invalid();
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
   const freshCustody=await this.options.fence.allocateFreshDestination();
   const roots=[];for(const root of config.roots){await mkdir(root.path,{mode:0o700});roots.push({...directory(root.path),id:root.id});}
   if(!await this.options.authorize(actor))throw invalid();this.assertOwner();if(this.disabled||this.state.revision!==revision||hash(privateText(this.options.configuration,65536))!==hash(configText)||hash(privateText(this.options.graph,65536))!==hash(graphText))throw invalid();
   for(const root of roots){const {id:_,...expected}=root;if(!same(directory(root.path),expected))throw invalid();}if(observed.some(producer=>!producerCurrent(producer)))throw invalid();
   const previousState=this.state;this.state={...previousState,enrollment:{schema:1,freshCustody,id:randomUUID(),groupId:config.groupId,configurationDigest:hash(configText),graphDigest:hash(graphText),roots,producers:observed,administrator:actor,assumptions:['trusted-source-root','all-source-producers-use-admission-v1']},revision:previousState.revision+1};
   try{this.save();}catch{this.state=previousState;this.poison('enrollment-journal-unavailable');throw invalid();}
  }finally{this.enrolling=false;}
 }
 async enrollExisting(actor:string,options:ExistingSourceEnrollment){return this.enrollCold(actor,options,false);}
 async requalify(actor:string,options:ExistingSourceEnrollment){return this.enrollCold(actor,options,true);}
 /** Trusted main may use this after passive handoff collection at startup. */
 async qualifyExisting(actor:string,options:ExistingSourceEnrollment){return this.enrollCold(actor,options,Boolean(this.state.enrollment));}
 private async enrollCold(actor:string,options:ExistingSourceEnrollment,restart:boolean):Promise<{checkpoint:SealedCheckpoint;evidence:TrustedSourceEvidence}>{
  const limits=captureLimits(options);if(this.enrolling)throw invalid();this.enrolling=true;let lease:CaptureLease|undefined;const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(new BackupError('capture_timeout','Source enrollment deadline exceeded')),limits.captureTimeoutMs);
  try{
   if(!await this.options.authorize(actor))throw invalid();this.assertOwner();
   if(this.state.issues.some(issue=>issue!=='authority-reopened')||Boolean(this.state.enrollment)!==restart||restart&&!this.state.issues.includes('authority-reopened')||this.disabled&&!this.state.issues.includes('authority-reopened'))throw invalid();
   const revision=this.state.revision,configText=privateText(this.options.configuration,65536),config=configuration(configText),graphText=privateText(this.options.graph,65536);graph(graphText,config);
   // Initial supported topology is one cooperating Host. A daemon or remote
   // authority needs its own real handoff adapter, never a guessed process list.
   if(actor!==config.owner.administrator||config.producers.length!==1||config.producers[0].kind!=='host'||config.producers[0].id!==options.producer)throw invalid();
   const resolutions=this.resolvePendingLocal(configText,graphText,options.producer),pending=structuredClone(this.state.operations);
   const roots=config.roots.map(root=>({...directory(root.path,true),id:root.id}));
   for(const root of roots)if(under(root.path,this.options.root)||under(this.options.root,root.path)||under(root.path,this.options.configuration)||under(root.path,this.options.graph)||under(root.path,options.checkpointRoot)||under(options.checkpointRoot,root.path)||roots.some(other=>other!==root&&(under(root.path,other.path)||under(other.path,root.path))))throw invalid();
   if(restart){const old=this.state.enrollment!;this.validateReconciliation(old);if(old.configurationDigest!==hash(configText)||old.graphDigest!==hash(graphText)||!same(old.roots,roots))throw invalid();}
   const enrollment:Enrollment={schema:1,id:randomUUID(),groupId:config.groupId,configurationDigest:hash(configText),graphDigest:hash(graphText),roots,producers:[{...config.producers[0],identity:identity(process.pid)}],administrator:actor,assumptions:['trusted-source-root','all-source-producers-use-admission-v1']};
   lease=await this.options.fence.lease();const held=lease,assert=held.assertValid.bind(held);held.assertValid=()=>{deadline.signal.throwIfAborted();assert();};
   return await beforeDeadline(this.provisional.run({enrollment,revision,lease:held,pending},async()=>{
    this.evidence();this.assertScopeInventory(options.scopes);
    const fence=this.writerFence(options.producer),observedPaths=new Set<string>(),native=await materializeTrustedNativeSource({groupId:config.groupId,scopes:options.scopes,fence,lease:held,maxBytes:limits.maxBytes,maxFiles:limits.maxFiles,assertRoots:paths=>{this.verifyRoots(paths);for(const path of paths)observedPaths.add(path);}});
    this.assertEnrolledRootsUsed([...observedPaths]);
    let handoff;try{handoff=await verifyNativeSourceHandoff(options.handoff,{fence:this.options.fence,lease:held,stores:native.stores});}catch{throw invalid();}
    this.evidence();const member=native.group.members[0];
    const coordinator=new BackupCoordinator({root:options.checkpointRoot,...limits,adapter:{version:'trusted-native-source-v1',resolve:async()=>native.group}});
    const status=await coordinator.capture(member.scope,member.taskId,member.engine);if(status.state!=='protected'||!status.checkpointId)throw invalid();
    const checkpoint=await coordinator.sealedCheckpoint(member.scope,member.taskId,status.checkpointId);if(!checkpoint)throw invalid();
    if(!await this.options.authorize(actor))throw invalid();this.evidence();held.assertValid();enrollment.initialCheckpoint=checkpoint.manifest.checkpointId;enrollment.handoffDigest=handoff.receiptDigest;enrollment.handoffKernelBoot=handoff.kernelBoot;enrollment.priorBootReceiptDigest=handoff.priorBootReceiptDigest;
    if(resolutions.length)enrollment.reconciliation=this.recordLocalReconciliation(enrollment,resolutions);
    this.evidence();held.assertValid();const previousState=this.state,resolvedIds=new Set(resolutions.map(operation=>operation.id));
    this.state={...previousState,operations:previousState.operations.filter(operation=>!resolvedIds.has(operation.id)),enrollment,issues:[],revision:previousState.revision+1};this.disabled=false;
    // A failed rename must not leave a cleared in-memory journal which a later
    // ordinary write could persist. The receipt remains retained for audit.
    try{this.save();}catch{this.state=previousState;this.poison('enrollment-journal-unavailable');throw invalid();}
    const evidence:TrustedSourceEvidence={schema:1,enrollmentId:enrollment.id,groupId:enrollment.groupId,revision:this.state.revision,assumptions:[...enrollment.assumptions],configurationDigest:enrollment.configurationDigest,graphDigest:enrollment.graphDigest};
    return {checkpoint,evidence};
   }),deadline.signal);
  }finally{clearTimeout(timer);lease?.release();this.enrolling=false;}
 }

 private localOwner(operation:Operation):LocalOwner|undefined{
  const configText=privateText(this.options.configuration,65536),config=configuration(configText),graphText=privateText(this.options.graph,65536);graph(graphText,config);
  if(config.producers.length!==1||config.producers[0].kind!=='host'||config.producers[0].id!==operation.producer)return undefined;
  const current=identity(process.pid),enrolled=this.state.enrollment?.producers.find(producer=>producer.id===operation.producer),qualified=!this.disabled&&!this.state.issues.length&&enrolled?.kind==='host'&&same(enrolled.identity,current);
  const owner:Omit<LocalOwner,'checksum'>={origin:qualified?'qualified-host':'configured-host-startup',enrollmentId:this.state.enrollment?.id??null,configurationDigest:hash(configText),graphDigest:hash(graphText),identity:current};
  return {...owner,checksum:localChecksum(operation,owner)};
 }
 private resolvePendingLocal(configText:string,graphText:string,producer:string):LocalResolution[]{
  const enrollment=this.state.enrollment,resolutions:LocalResolution[]=[];
  for(const operation of this.state.operations){
   const owner=operation.localOwner;
   if(operation.kind!=='local'||operation.producer!==producer||!owner||!record(owner)||!keys(owner,['origin','enrollmentId','configurationDigest','graphDigest','identity','checksum'])||!['qualified-host','configured-host-startup'].includes(owner.origin)||owner.enrollmentId!==(enrollment?.id??null)||owner.configurationDigest!==hash(configText)||owner.graphDigest!==hash(graphText)||!record(owner.identity)||!keys(owner.identity,['pid','uid','boot','birth'])||!Number.isSafeInteger(owner.identity.pid)||owner.identity.pid<1||!Number.isSafeInteger(owner.identity.uid)||owner.identity.uid<0||typeof owner.identity.boot!=='string'||!bootPattern.test(owner.identity.boot)||typeof owner.identity.birth!=='string'||!/^\d+$/.test(owner.identity.birth)||owner.checksum!==localChecksum(operation,owner))throw invalid();
   if(owner.origin==='qualified-host'&&!enrollment?.producers.some(value=>value.id===producer&&value.kind==='host'&&same(value.identity,owner.identity)))throw invalid();
   resolutions.push({id:operation.id,producer:operation.producer,owner,death:deadLocalOwner(owner.identity)});
  }
  return resolutions;
 }
 private validateReconciliation(enrollment:Enrollment){
  if(!enrollment.reconciliation)return;const reference=enrollment.reconciliation;if(!id(reference.id)||!digestPattern.test(reference.digest))throw invalid();
  directory(join(this.options.root,'reconciliations'));const raw=privateText(join(this.options.root,'reconciliations',reference.id+'.json')),receipt=JSON.parse(raw);
  if(hash(raw)!==reference.digest||receipt.enrollmentId!==enrollment.id||receipt.checkpointId!==enrollment.initialCheckpoint||receipt.handoffDigest!==enrollment.handoffDigest||receipt.handoffKernelBoot!==enrollment.handoffKernelBoot||receipt.priorBootReceiptDigest!==enrollment.priorBootReceiptDigest||receipt.configurationDigest!==enrollment.configurationDigest||receipt.graphDigest!==enrollment.graphDigest)throw invalid();
 }
 private recordLocalReconciliation(enrollment:Enrollment,operations:LocalResolution[]){
  this.evidence();const root=join(this.options.root,'reconciliations');mkdirSync(root,{recursive:true,mode:0o700});directory(root);
  const receipt={schema:1,id:randomUUID(),enrollmentId:enrollment.id,previousEnrollmentId:this.state.enrollment?.id??null,configurationDigest:enrollment.configurationDigest,graphDigest:enrollment.graphDigest,kernelBoot:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),handoffDigest:enrollment.handoffDigest,handoffKernelBoot:enrollment.handoffKernelBoot,priorBootReceiptDigest:enrollment.priorBootReceiptDigest,checkpointId:enrollment.initialCheckpoint,operations,at:new Date().toISOString()};
  const text=JSON.stringify(receipt);if(Buffer.byteLength(text)>1024*1024)throw invalid();const file=openSync(join(root,receipt.id+'.json'),'wx',0o600);try{writeFileSync(file,text);fsyncSync(file);}finally{closeSync(file);}const parent=openSync(root,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
  return {id:receipt.id,digest:hash(text)};
 }

 private assertScopeInventory(scopes:readonly TrustedNativeSourceScope[]){
  const config=configuration(privateText(this.options.configuration,65536)),value=JSON.parse(privateText(this.options.graph,65536));graph(JSON.stringify(value),config);
  if(!scopes.length||new Set(scopes.map(scope=>scope.scope)).size!==scopes.length||value.roots.some((root:{scope:string})=>!scopes.some(scope=>scope.scope===root.scope))||scopes.some(scope=>!value.roots.some((root:{scope:string})=>root.scope===scope.scope)))throw invalid();
 }
 private assertEnrolledRootsUsed(paths:readonly string[]){
  const enrollment=this.provisional.getStore()?.enrollment??this.state.enrollment;if(!enrollment||enrollment.roots.some(root=>!paths.some(path=>under(root.path,path))))throw invalid();
 }
 createNativeCoordinator(options:Omit<ExistingSourceEnrollment,'handoff'>):BackupCoordinator{
  const limits=captureLimits(options),fence=this.writerFence(options.producer),authority=this;
  return new BackupCoordinator({root:options.checkpointRoot,...limits,adapter:{version:'trusted-native-source-v1',resolve:async()=>{
   const evidence=authority.evidence();authority.assertScopeInventory(options.scopes);
   return {groupId:evidence.groupId,fence,members:[],sources:[],validate:async()=>{throw invalid();},materialize:async lease=>{const observedPaths=new Set<string>(),native=await materializeTrustedNativeSource({groupId:evidence.groupId,scopes:options.scopes,fence,lease,maxBytes:limits.maxBytes,maxFiles:limits.maxFiles,assertRoots:paths=>{authority.verifyRoots(paths);for(const path of paths)observedPaths.add(path);}});authority.assertEnrolledRootsUsed([...observedPaths]);return native.group;}};
  }}});
 }
 private evidence():TrustedSourceEvidence{
  this.assertOwner();const provisional=this.provisional.getStore(),enrollment=provisional?.enrollment??this.state.enrollment;
  if(provisional){provisional.lease.assertValid();if(this.state.revision!==provisional.revision||!same(this.state.operations,provisional.pending)||this.state.issues.some(issue=>issue!=='authority-reopened'))throw invalid();}
  else if(this.disabled||this.state.issues.length)throw invalid();
  if(!enrollment||enrollment.schema!==1)throw invalid();
  if(hash(privateText(this.options.configuration,65536))!==enrollment.configurationDigest||hash(privateText(this.options.graph,65536))!==enrollment.graphDigest)throw invalid();
  for(const root of enrollment.roots){const {id:_,...expected}=root;if(!same(directory(root.path,true),expected))throw invalid();}
  if(enrollment.freshCustody)this.options.fence.assertDestinationAllocation(enrollment.freshCustody);
  this.validateReconciliation(enrollment);
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
 destination(paths:()=>Promise<readonly string[]>):RestoreDestination {return Object.freeze({lease:async(context:DestinationContext)=>this.destinationLease(context,await paths()),assertLease:(lease:CaptureLease)=>{if(destinationLeases.get(lease)!==this)throw invalid();lease.assertValid();}});}
 /** Destination ownership is deliberately independent of source history closure.
  * Keep original operations/enrollment untouched until an actual source cut. */
 async destinationLease(context:DestinationContext,paths:readonly string[]):Promise<CaptureLease>{
  if(!context||!id(context.operationId)||!Number.isSafeInteger(context.revision)||context.revision<1||!['missing-only','replace'].includes(context.mode)||context.digest!==undefined&&!digestPattern.test(context.digest))throw invalid();
  if(!await this.options.authorize(context.actor))throw invalid();
  const baseline=this.stateDigest,current=identity(process.pid);let resolutions:LocalResolution[]=[];
  const assert=()=>{
   this.assertOwner();if(this.stateDigest!==baseline||!same(identity(process.pid),current)||this.state.issues.some(issue=>issue!=='authority-reopened')||this.disabled&&!this.state.issues.includes('authority-reopened'))throw invalid();
   const enrollment=this.state.enrollment;if(!enrollment)throw invalid();
   const configText=privateText(this.options.configuration,65536),config=configuration(configText),graphText=privateText(this.options.graph,65536);graph(graphText,config);
   if(context.actor!==config.owner.administrator||enrollment.configurationDigest!==hash(configText)||enrollment.graphDigest!==hash(graphText)||config.producers.length!==1||config.producers[0].kind!=='host'||enrollment.producers.length!==1||enrollment.producers[0].id!==config.producers[0].id||enrollment.producers[0].kind!=='host'||!JSON.parse(graphText).roots.some((root:{scope:string})=>root.scope===context.scope))throw invalid();
   const former=enrollment.producers[0].identity;if(!same(former,current))deadLocalOwner(former);
   if(enrollment.freshCustody)this.options.fence.assertDestinationAllocation(enrollment.freshCustody);
   this.validateReconciliation(enrollment);resolutions=this.resolvePendingLocal(configText,graphText,config.producers[0].id);
   for(const root of enrollment.roots){const {id:_,...expected}=root;if(!same(directory(root.path,true),expected))throw invalid();}
   if(!paths.length||paths.length>256)throw invalid();for(const path of paths){if(resolve(path)!==path)throw invalid();const root=enrollment.roots.find(root=>under(root.path,path));if(!root)throw invalid();let existing=path;for(;;){try{const info=lstatSync(existing);if(realpathSync(existing)!==existing||info.isSymbolicLink()||!info.isFile()&&!info.isDirectory()||info.dev!==root.dev)throw invalid();break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||existing===root.path)throw error;existing=dirname(existing);}}}
  };
  assert();let token:FreshDestinationToken|undefined;const allocation=this.state.enrollment?.freshCustody;if(allocation){token=Object.freeze({}) as FreshDestinationToken;freshDestinations.set(token,{fence:this.options.fence,allocation,assert});}
  const lease=await this.options.fence.destinationLease(token,Boolean(context.digest)),held=lease.assertValid.bind(lease);
  lease.assertValid=()=>{held();assert();};
  try{
   lease.assertValid();if(!await this.options.authorize(context.actor))throw invalid();lease.assertValid();
   if(context.digest){const root=join(this.options.root,'destinations');mkdirSync(root,{recursive:true,mode:0o700});directory(root);const receipt={schema:1,...context,enrollmentId:this.state.enrollment!.id,journalDigest:baseline,owner:current,pending:this.state.operations,resolutions,at:new Date().toISOString()},text=JSON.stringify(receipt);if(Buffer.byteLength(text)>1024*1024)throw invalid();const fd=openSync(join(root,randomUUID()+'.json'),'wx',0o600);try{writeFileSync(fd,text);fsyncSync(fd);}finally{closeSync(fd);}for(const parent of [root,this.options.root]){const fd=openSync(parent,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}}
   lease.assertValid();destinationLeases.set(lease,this);return lease;
  }catch(error){lease.release();throw error;}
 }
 async capture():Promise<{lease:CaptureLease;evidence:TrustedSourceEvidence}>{return this.cut(false);}
 private async cut(publication:boolean):Promise<{lease:CaptureLease;evidence:TrustedSourceEvidence}>{
  let evidence:TrustedSourceEvidence;try{evidence=this.evidence();}catch{throw invalid();}
  const provisional=this.provisional.getStore();
  if(!provisional&&this.state.operations.length)throw this.state.operations.every(operation=>this.active.has(operation.id))?new BackupError('writers_active','Tracked source writers are active'):invalid();
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
    const admitted:Operation={id:operation,producer,kind};if(kind==='local')admitted.localOwner=this.localOwner(admitted);
    this.state.operations.push(admitted);this.state.revision++;this.save();this.active.add(operation);recorded=true;
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
