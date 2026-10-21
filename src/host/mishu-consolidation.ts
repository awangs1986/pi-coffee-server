import {memoryExtractionInstructions,memoryExtractionPrompt} from 'pi-coffee-mishu/host-policy';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,lstat,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import type {MishuMemory,MemoryChange,MemoryEntry} from './mishu-memory.js';
import type {MemoryExtractionOutput} from './pi-memory-runner.js';

export const CONSOLIDATION_LIMITS={messages:20,inputChars:12000,changes:10,jobs:100,bytes:8*1024*1024,hourlyCalls:12};
export interface ConsolidationAuthority {binding:string;generation:number;enabled:boolean;idle:boolean;model?:{provider:string;id:string};project?:string}
interface Evidence {messageId:string;conversationId:string;sourceBinding:string;text:string;role:string;at:string|null;range:{start:number;end:number;redacted?:boolean};truncated:boolean}
export interface ConsolidationEvidence {available:boolean;entries:Evidence[];nextId?:string|null;hasMore?:boolean;missingAnchor?:boolean;reason?:string}
export interface Job {id:string;operationId:string;sourceId:string;binding:string;generation:number;revision:number;automatic:boolean;state:'reserved'|'running'|'ready'|'adopting'|'adopted'|'cancelled'|'uncertain';createdAt:string;targetId:string;sources:Evidence[];changes:MemoryChange[];oldValues?:Record<string,string>;indices?:number[];cursor?:string|null;hasMore?:boolean;error?:string;model:{provider:string;id:string}}
interface Book {enabled:boolean;generation:number;cursor?:string|null;configuredAt:string;pending?:string}
interface State {version:1;jobs:Job[];books:Record<string,Book>}
export interface ConsolidationPort {
 memory:MishuMemory;
 authority(id:string):Promise<ConsolidationAuthority>;
 evidence(id:string,input:Record<string,unknown>):Promise<ConsolidationEvidence>;
 reserve(id:string,operationId:string):Promise<{admitted:boolean}>;
 started(id:string,operationId:string):Promise<unknown>;
 record(id:string,operationId:string,output:MemoryExtractionOutput):Promise<void>;
 extract(id:string,input:{sessionFile:string;prompt:string;provider:string;model:string;signal:AbortSignal}):Promise<MemoryExtractionOutput>;
}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const validId=(s:unknown):s is string=>typeof s==='string'&&/^[\w-]{1,128}$/.test(s);
/** Owns recoverable candidate jobs, never execution grants or native task lifecycle. */
export class MishuConsolidation {
 private state:State={version:1,jobs:[],books:{}};private loaded?:Promise<void>;private tail:Promise<unknown>=Promise.resolve();
 private active=new Map<string,{jobId:string;controller:AbortController}>();private closed=false;private pending=new Set<Promise<unknown>>();
 constructor(private root:string,private port:ConsolidationPort){}
 private async load(){await(this.loaded??=(async()=>{try{const file=join(this.root,'consolidation-v1.json'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>CONSOLIDATION_LIMITS.bytes)throw Error('capacity');const data=JSON.parse(await readFile(file,'utf8'));if(data.version!==1||!Array.isArray(data.jobs)||data.jobs.length>CONSOLIDATION_LIMITS.jobs||!data.books||typeof data.books!=='object'||Array.isArray(data.books))throw Error('schema');for(const j of data.jobs){if(!validId(j.id)||!validId(j.operationId)||typeof j.sourceId!=='string'||typeof j.binding!=='string'||!Number.isSafeInteger(j.generation)||!Number.isSafeInteger(j.revision)||!['reserved','running','ready','adopting','adopted','cancelled','uncertain'].includes(j.state)||!Array.isArray(j.sources)||j.sources.length>20||!Array.isArray(j.changes)||j.changes.length>10||!j.model?.provider||!j.model?.id)throw Error('schema');if(['reserved','running'].includes(j.state)){j.state='uncertain';j.error='Host 在整理过程中重启；保留原请求，不自动再次生成。';}}for(const b of Object.values(data.books) as Book[])if(typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.generation)||typeof b.configuredAt!=='string')throw Error('schema');this.state=data;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Memory consolidation storage unavailable; original data preserved');}})());}
 private transaction<T>(fn:()=>T|Promise<T>):Promise<T>{const next=this.tail.then(async()=>{await this.load();const backup=structuredClone(this.state);try{const result=await fn();const bytes=JSON.stringify(this.state);if(Buffer.byteLength(bytes)>CONSOLIDATION_LIMITS.bytes)throw Error('Memory consolidation capacity reached');await mkdir(this.root,{recursive:true,mode:0o700});const file=join(this.root,'consolidation-v1.json'),temp=file+'.'+randomUUID();try{await writeFile(temp,bytes,{flag:'wx',mode:0o600,flush:true});await rename(temp,file);}catch(e){throw Error('Memory consolidation save failed; original data preserved');}return result;}catch(e){this.state=backup;throw e;}});this.tail=next.catch(()=>undefined);return next;}
 private key(id:string,binding:string){return id+':'+binding;}
 private async check(id:string,expected?:{binding:string;generation:number},readMemory=true){const a=await this.port.authority(id);if(!a.enabled||expected&&(a.binding!==expected.binding||a.generation!==expected.generation)||readMemory&&!(await this.port.memory.snapshot(id,a.binding)).enabled)throw Error('Memory consolidation authorization changed or memory disabled');return a;}
 private async owned(id:string,jobId:unknown){await this.tail;await this.load();const a=await this.check(id),job=this.state.jobs.find(j=>j.id===jobId&&j.sourceId===id&&j.binding===a.binding&&j.generation===a.generation);if(!job)throw Error('Memory consolidation job unavailable for current source');return job;}
 private present(job:Job){return structuredClone(job);}
 async status(id:string){await this.tail;await this.load();const a=await this.check(id),book=this.state.books[this.key(id,a.binding)];return {version:1,available:Boolean(a.model),reason:a.model?undefined:'请先打开当前秘书以确定原生模型；不会选择替代引擎',limits:CONSOLIDATION_LIMITS,automatic:{enabled:Boolean(book?.enabled&&book.generation===a.generation),cursor:book?.cursor??null,pending:book?.pending},jobs:this.state.jobs.filter(j=>j.sourceId===id&&j.binding===a.binding&&j.generation===a.generation).slice(-20).map(j=>this.present(j))};}
 async get(id:string,jobId:unknown){return {job:this.present(await this.owned(id,jobId))};}
 private candidates(raw:string,sources:Evidence[],entries:MemoryEntry[]):MemoryChange[]{
  if(raw.length>32000)throw Error('Candidate output exceeds capacity');let value;try{value=JSON.parse(raw);}catch{throw Error('Native extraction did not return valid candidate JSON');}
  if(!value||!Array.isArray(value.changes)||value.changes.length>CONSOLIDATION_LIMITS.changes)throw Error('Invalid candidate change batch');
  return value.changes.map((c:Record<string,unknown>)=>{
   const s=sources.find(s=>s.messageId===c.sourceId);if(!s||s.truncated||s.range.redacted||typeof c.quote!=='string'||!c.quote||!Number.isSafeInteger(c.start)||!Number.isSafeInteger(c.end)||Number(c.start)<0||Number(c.end)<=Number(c.start)||s.text.slice(Number(c.start),Number(c.end))!==c.quote)throw Error('Candidate lacks exact per-entry evidence');
   if(!['add','edit','remove'].includes(String(c.op)))throw Error('Invalid candidate operation');const old=entries.find(e=>e.id===c.entryId);
   if(c.op!=='add'&&(!old||old.deleted||old.revision!==c.expectedRevision))throw Error('Candidate targets a stale memory or tombstone');
   if(c.op==='add'&&c.entryId!==undefined)throw Error('New candidates cannot replace old identities');
   if(c.op!=='remove'&&(typeof c.text!=='string'||!c.text.trim()||c.text.length>2000||!['preference','agreement','project-fact','summary'].includes(String(c.kind))||c.kind==='project-fact'&&(typeof c.project!=='string'||!c.project||c.project.length>128)))throw Error('Invalid candidate fact');
   if(/(?:sk-|xai-)[A-Za-z0-9_-]{8,}|\b(?:Bearer|password|api[_-]?key|token)\s*[:= ]\s*\S+/i.test(String(c.text??'')+' '+c.quote))throw Error('Sensitive material cannot become memory');
   return {op:c.op as MemoryChange['op'],...(old?{entryId:old.id,expectedRevision:old.revision}:{}),...(c.op!=='remove'?{kind:c.kind as MemoryEntry['kind'],text:String(c.text).trim(),...(c.kind==='project-fact'?{project:String(c.project)}:{})}:{}),source:{kind:'evidence',at:s.at??new Date().toISOString(),conversationId:s.conversationId,messageId:s.messageId,sourceBinding:s.sourceBinding,quote:c.quote,start:Number(c.start),end:Number(c.end)},candidate:true};
  });
 }
 prepare(id:string,input:Record<string,unknown>,automatic=false){const work=this.prepareOnce(id,input,automatic);this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>undefined);return work;}
 private async prepareOnce(id:string,input:Record<string,unknown>,automatic=false){
  if(!validId(input.operationId))throw Error('A stable consolidation operationId is required');
  await this.tail;await this.load();const authority=await this.check(id),prior=this.state.jobs.find(j=>j.sourceId===id&&j.binding===authority.binding&&j.operationId===input.operationId);
  if(prior){if(prior.generation!==authority.generation||prior.targetId!==(input.targetId??id))throw Error('Consolidation operation identity changed');return {job:this.present(prior)};}
  if(!authority.idle||!authority.model||this.active.has(id)||this.closed)throw Error('Current native source is busy or isolated extraction unavailable');
  const book=this.state.books[this.key(id,authority.binding)],evidence=await this.port.evidence(id,{version:1,mode:automatic?'scan':'recent',...(automatic&&book?.cursor?{afterId:book.cursor}:{}),...(input.targetId?{targetId:input.targetId}:{}),limit:20});
  await this.check(id,authority);if(!evidence.available||evidence.missingAnchor)throw Error(evidence.reason??'Native evidence unavailable');
  const sources=evidence.entries.filter(e=>!e.truncated&&!e.range.redacted);if(!sources.length)throw Error(evidence.reason??'No complete evidence in current batch');
  const snapshot=await this.port.memory.snapshot(id,authority.binding),job:Job={id:randomUUID(),operationId:input.operationId,sourceId:id,binding:authority.binding,generation:authority.generation,revision:snapshot.revision,automatic,state:'reserved',createdAt:new Date().toISOString(),targetId:typeof input.targetId==='string'?input.targetId:id,sources,changes:[],model:authority.model,oldValues:Object.fromEntries(snapshot.entries.filter(e=>!e.deleted).map(e=>[e.id,e.text])),...(automatic?{cursor:evidence.nextId,hasMore:evidence.hasMore}:{})};
  await this.transaction(async()=>{await this.check(id,authority);if(this.state.jobs.length>=CONSOLIDATION_LIMITS.jobs||this.state.jobs.some(j=>j.sourceId===id&&['reserved','running','adopting'].includes(j.state)))throw Error('Memory consolidation job capacity reached');if(this.state.jobs.some(j=>j.sourceId===id&&j.operationId===job.operationId))throw Error('Consolidation operation already reserved');this.state.jobs.push(job);});
  const controller=new AbortController();this.active.set(id,{jobId:job.id,controller});
  try{
   const reservation=await this.port.reserve(id,job.id);if(!reservation.admitted)throw Error('Consolidation call already reserved; no regeneration');
   await this.check(id,authority);if(controller.signal.aborted)throw Error('Consolidation cancelled');
   await this.port.started(id,job.id);await this.transaction(()=>{job.state='running';});
   let memoryChars=0;const memory=[];for(const {id,revision,kind,text,project,deleted} of snapshot.entries){if(deleted)continue;const row={id,revision,kind,text,project},size=JSON.stringify(row).length;if(memoryChars+size>6000)break;memoryChars+=size;memory.push(row);}
   const prompt=memoryExtractionInstructions+'\n'+memoryExtractionPrompt({entries:sources,memory});
   const result=await this.port.extract(id,{sessionFile:join(this.root,'extractions',job.id+'.jsonl'),prompt,provider:job.model.provider,model:job.model.id,signal:controller.signal});
   if(result.provider!==job.model.provider||result.model!==job.model.id)throw Error('Native model identity changed');await this.port.record(id,job.id,result);await this.check(id,authority);if(controller.signal.aborted)throw Error('Consolidation cancelled');
   const changes=this.candidates(result.text,sources,snapshot.entries);
   await this.transaction(async()=>{await this.check(id,authority);if(job.state==='cancelled')throw Error('Consolidation cancelled');job.changes=changes;job.state='ready';});
   return {job:this.present(job)};
  }catch(error){await this.transaction(()=>{const current=this.state.jobs.find(j=>j.id===job.id);if(current&&current.state!=='cancelled'){current.state='uncertain';current.error='原生整理未能安全完成；原请求和证据保留，不自动再次生成。';}}).catch(()=>undefined);throw Error('Memory consolidation unavailable or uncertain; inspect saved job, no automatic retry');}
  finally{if(this.active.get(id)?.jobId===job.id)this.active.delete(id);}
 }
 async cancel(id:string,input:Record<string,unknown>){const job=await this.owned(id,input.jobId);if(job.state==='adopted')throw Error('Already adopted; edit memory explicitly');if(this.active.get(id)?.jobId===job.id)this.active.get(id)?.controller.abort();await this.transaction(()=>{job.state='cancelled';});return {job:this.present(job)};}
 async adopt(id:string,input:Record<string,unknown>){
  const job=await this.owned(id,input.jobId),indices=input.indices;
  if(!Array.isArray(indices)||indices.length>10||!indices.every(i=>Number.isSafeInteger(i)&&i>=0&&i<job.changes.length)||new Set(indices).size!==indices.length)throw Error('Select exact candidate rows');
  if(job.state==='adopted'){if(JSON.stringify(job.indices)!==JSON.stringify(indices))throw Error('This job was adopted with a different selection');return {job:this.present(job)};}
  if(!['ready','adopting'].includes(job.state))throw Error('No ready memory candidate to adopt');
  if(job.indices&&JSON.stringify(job.indices)!==JSON.stringify(indices))throw Error('Adoption already belongs to a different selection');
  await this.transaction(()=>{if(job.indices&&JSON.stringify(job.indices)!==JSON.stringify(indices))throw Error('Adoption selection changed');if(!['ready','adopting','adopted'].includes(job.state))throw Error('Candidate was cancelled');job.state='adopting';job.indices=indices;});
  // applyCandidates already owns the memory transaction; its guard must not read
  // the same transaction's snapshot and wait for itself.
  const validate=async()=>{await this.check(id,job,false);if(job.state==='cancelled')throw Error('Candidate was cancelled');for(const index of indices){const change=job.changes[index],source=job.sources.find(s=>s.messageId===change.source.messageId)!;const read=await this.port.evidence(id,{version:1,mode:'anchor',anchorId:source.messageId,...(source.conversationId!==id?{targetId:source.conversationId}:{}),limit:20});const now=read.entries.find(e=>e.messageId===source.messageId);if(!read.available||!now||now.sourceBinding!==source.sourceBinding||hash(now.text)!==hash(source.text))throw Error('Candidate evidence no longer accessible or changed');}};
  await this.port.memory.applyCandidates(id,job.binding,{operationId:'adopt-'+job.id,expectedRevision:job.revision,changes:indices.map(i=>({...job.changes[i],candidate:false}))},validate);
  await this.transaction(()=>{job.state='adopted';});return {job:this.present(job)};
 }
 abort(id:string){this.active.get(id)?.controller.abort();}
 async close(){this.closed=true;for(const {controller} of this.active.values())controller.abort();await Promise.allSettled([...this.pending]);await this.tail;}
}
