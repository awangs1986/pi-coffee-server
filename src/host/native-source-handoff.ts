import {createHash,randomUUID} from 'node:crypto';
import {lstat,realpath,readFile,readdir,open,rename} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {piNativeHistoryObservation} from './pi-adapter.js';
import {codexNativeHistoryObservation} from './codex-adapter.js';
import {NativeWriterCustody,isNativeWriterCustody} from './native-custody.js';
import {PhysicalWriterFence,physicalFenceCoversCustody,assertPhysicalCaptureLease} from './physical-writer-fence.js';
import type {CaptureLease} from './backup.js';

/** Only adapter-private WeakMaps can supply these observations. This type is not
 * a capability; arbitrary objects never enter the persistent witness path. */
export interface NativeHistoryObservation {launchDirectory:string;engine:'pi'|'codex';roots:string[];binding:string;sourceFile:string;normalCloseRequested?:true;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function privateJson(path:string){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid?.()||(s.mode&0o077)||s.size>65536)throw Error('Native handoff receipt unavailable');return readFile(path,'utf8');}
async function directoryIdentity(path:string){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||resolve(path)!==path||await realpath(path)!==path||s.uid!==process.getuid?.())throw Error('Native handoff store changed');return {path,dev:s.dev,ino:s.ino,uid:s.uid};}
async function atomicJson(dir:string,name:string,value:unknown){const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>65536)throw Error('Native observation exceeds bounded receipt');const temp=join(dir,randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);try{await file.writeFile(serialized);await file.sync();}finally{await file.close();}await rename(temp,join(dir,name));const parent=await open(dir,'r');try{await parent.sync();}finally{await parent.close();}}
async function sourceIdentity(observation:NativeHistoryObservation){
 const rel=relative(observation.roots[0],observation.sourceFile);if(!rel||rel.startsWith('..')||resolve(observation.sourceFile)!==observation.sourceFile||await realpath(observation.sourceFile)!==observation.sourceFile)throw Error('Native history is outside observed store');
 const file=await open(observation.sourceFile,'r');let line:string;try{
  if(!(await file.stat()).isFile())throw Error('Native history is not a file');
  const chunks:Buffer[]=[];let offset=0,complete=false;
  // Native instructions can make a Codex header much larger than one read.
  // Keep the existing native audit's 64MiB budget, and read only the header.
  while(offset<64*1024*1024){const bytes=Buffer.alloc(65536),{bytesRead}=await file.read(bytes,0,bytes.length,offset);if(!bytesRead){complete=true;break;}const chunk=bytes.subarray(0,bytesRead),newline=chunk.indexOf(10);chunks.push(newline<0?chunk:chunk.subarray(0,newline));offset+=bytesRead;if(newline>=0){complete=true;break;}}
  if(!complete)throw Error('Native header exceeds audit budget');line=Buffer.concat(chunks).toString('utf8');
 }finally{await file.close();}
 const row=JSON.parse(line);if(observation.engine==='pi'?row.type!=='session'||row.id!==observation.binding:row.type!=='session_meta'||row.payload?.id!==observation.binding)throw Error('Native history identity changed');
}
/** Called after real RPC history only. Exporting the call does not export an
 * issuer: the subject must already inhabit an adapter's private observation map. */
export async function persistNativeHistoryObservation(subject:object){
 const observations=piNativeHistoryObservation(subject)??codexNativeHistoryObservation(subject);if(!observations?.length)return;
 const dir=observations[0].launchDirectory,command=await privateJson(join(dir,'command.json')),receipt=JSON.parse(await privateJson(join(dir,'state.json')));
 if(receipt.state!=='active'||receipt.boot!==(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim())throw Error('Native history custody is not active');
 const rows=[];for(const observation of observations){if(observation.launchDirectory!==dir)throw Error('Mixed native custody');await sourceIdentity(observation);rows.push({...observation,rootIdentities:await Promise.all(observation.roots.map(directoryIdentity))});}
 await atomicJson(dir,'history-observation.json',{schema:1,id:receipt.id,boot:receipt.boot,commandDigest:hash(command),observations:rows});
}
/** Records the existing adapter close request; never initiates any lifecycle. */
export async function persistNativeNormalClose(subject:object){
 const observations=piNativeHistoryObservation(subject)??codexNativeHistoryObservation(subject);if(!observations?.length||!observations.every(row=>row.normalCloseRequested===true))return;
 const dir=observations[0].launchDirectory,receipt=JSON.parse(await privateJson(join(dir,'state.json')));if(receipt.state!=='active')return;
 const observation=await privateJson(join(dir,'history-observation.json'));await atomicJson(dir,'normal-close.json',{schema:1,id:receipt.id,boot:receipt.boot,observationDigest:hash(observation)});
}

declare const nativeHandoffBrand:unique symbol;
export type NativeSourceHandoff={readonly [nativeHandoffBrand]:true};
type Evidence={schema:1;custodyRoot:string;groupLock:string;receiptDigest:string;observations:{engine:'pi'|'codex';roots:string[];bindings:string[]}[]};
const handoffs=new WeakMap<object,{custody:NativeWriterCustody;fence:PhysicalWriterFence;evidence:Evidence}>();
async function evidence(custody:NativeWriterCustody):Promise<Evidence>{
 if((await custody.state()).state!=='quiescent'||!custody.groupLock)throw Error('Native handoff custody incomplete');
 const rows:string[]=[],observations:Evidence['observations']=[];
 for(const id of (await readdir(custody.root)).filter(id=>id!=='group-lock.json').sort()){
  const dir=join(custody.root,id),receiptText=await privateJson(join(dir,'state.json')),receipt=JSON.parse(receiptText),command=await privateJson(join(dir,'command.json'));rows.push(id,command,receiptText);
  if(!receipt.observationDigest)continue;
  const observationText=await privateJson(join(dir,'history-observation.json'));if(hash(observationText)!==receipt.observationDigest||receipt.commandDigest!==hash(command))throw Error('Native handoff receipt changed');
  const observation=JSON.parse(observationText);if(observation.schema!==1||observation.id!==id||observation.boot!==receipt.boot||observation.commandDigest!==hash(command))throw Error('Native handoff identity changed');
  if(receipt.nativeStatus!==0){const close=await privateJson(join(dir,'normal-close.json')),value=JSON.parse(close);if(![ -15,143 ].includes(receipt.nativeStatus)||receipt.closeDigest!==hash(close)||value.id!==id||value.boot!==receipt.boot||value.observationDigest!==receipt.observationDigest)throw Error('Native lifecycle did not close normally');}
  if(!Array.isArray(observation.observations)||!observation.observations.length)throw Error('Native history not observed');
  for(const row of observation.observations){if(!['pi','codex'].includes(row.engine)||row.launchDirectory!==dir||!Array.isArray(row.roots)||row.roots.length!==2||typeof row.binding!=='string'||!row.binding)throw Error('Native observation invalid');
   if(JSON.stringify(await Promise.all(row.roots.map(directoryIdentity)))!==JSON.stringify(row.rootIdentities))throw Error('Native store identity changed');await sourceIdentity(row);
   let group=observations.find(group=>group.engine===row.engine&&JSON.stringify(group.roots)===JSON.stringify(row.roots));if(!group){group={engine:row.engine,roots:row.roots,bindings:[]};observations.push(group);}if(!group.bindings.includes(row.binding))group.bindings.push(row.binding);
  }
 }
 if(!observations.length)throw Error('Native history lifecycle not observed');
 return {schema:1,custodyRoot:custody.root,groupLock:custody.groupLock,receiptDigest:hash(JSON.stringify(rows)),observations};
}
export async function readNativeSourceHandoff(options:{custody:NativeWriterCustody;fence:PhysicalWriterFence}):Promise<NativeSourceHandoff>{
 if(!isNativeWriterCustody(options.custody)||!physicalFenceCoversCustody(options.fence,options.custody))throw Error('Native handoff fence mismatch');
 const proof=await evidence(options.custody),token=Object.freeze({}) as NativeSourceHandoff;handoffs.set(token,{...options,evidence:proof});return token;
}
export async function verifyNativeSourceHandoff(token:NativeSourceHandoff,options:{fence:PhysicalWriterFence;lease:CaptureLease;stores:readonly {scope:string;engine:'pi'|'codex';roots:readonly string[];bindings:readonly string[]}[]}):Promise<Evidence>{
 const held=handoffs.get(token);if(!held||held.fence!==options.fence)throw Error('Native handoff capability mismatch');assertPhysicalCaptureLease(options.fence,options.lease);
 const current=await evidence(held.custody);if(current.receiptDigest!==held.evidence.receiptDigest)throw Error('Native handoff changed');
 const groups=new Map<string,{engine:'pi'|'codex';roots:readonly string[];bindings:Set<string>}>();for(const store of options.stores){if(store.roots.length!==2||store.roots.some(root=>resolve(root)!==root))throw Error('Native store roots invalid');const key=store.engine+JSON.stringify([...store.roots].sort());let group=groups.get(key);if(!group){group={engine:store.engine,roots:store.roots,bindings:new Set()};groups.set(key,group);}for(const binding of store.bindings)group.bindings.add(binding);}
 for(const group of groups.values()){if(!group.bindings.size)continue;const observed=current.observations.find(row=>row.engine===group.engine&&JSON.stringify([...row.roots].sort())===JSON.stringify([...group.roots].sort()));if(!observed?.bindings.some(binding=>group.bindings.has(binding)))throw Error('Native store has no completed history lifecycle');}
 assertPhysicalCaptureLease(options.fence,options.lease);return structuredClone(current);
}
