import {mkdir,readFile,writeFile,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export type UsagePurpose='foreground'|'report'|'memory'|'context';
export interface UsageRecord {callId:string;model:string;at:string;purpose:UsagePurpose;source:'native-log'|'native-event';input?:number;output?:number;cacheRead?:number;cacheWrite?:number;status?:string;inputIncludesCache?:boolean}
interface Stored extends UsageRecord {secretaryId:string;binding:string}
interface Reservation {secretaryId:string;binding:string;operationId:string;purpose:Exclude<UsagePurpose,'foreground'>;at:string;state:'reserved'|'started'|'released'}
interface UsageState {diagnostic?:string;version:1;startedAt:string;records:Record<string,Stored>;reservations:Record<string,Reservation>}
export const USAGE_LIMITS={records:20000,reservations:20000,bytes:32*1024*1024,hourlyCalls:12};
const key=(...parts:string[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const number=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function validate(s:unknown):asserts s is UsageState {
 const object=(v:unknown):v is Record<string,any>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
 const string=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
 if(!object(s)||s.diagnostic!==undefined&&!string(s.diagnostic,200)||s.version!==1||!date(s.startedAt)||!object(s.records)||!object(s.reservations)||Object.keys(s).some(k=>!['version','startedAt','records','reservations','diagnostic'].includes(k))||Object.keys(s.records).length>USAGE_LIMITS.records||Object.keys(s.reservations).length>USAGE_LIMITS.reservations)throw Error('Usage storage schema invalid');
 for(const [id,r] of Object.entries(s.records)){
  if(!object(r)||!hash(id)||!string(r.secretaryId,128)||!hash(r.binding)||!string(r.callId,512)||id!==key(r.secretaryId,r.binding,r.callId)||!string(r.model,200)||!date(r.at)||!['foreground','report','memory','context'].includes(r.purpose)||!['native-log','native-event'].includes(r.source)||r.status!==undefined&&!string(r.status,100)||r.inputIncludesCache!==undefined&&typeof r.inputIncludesCache!=='boolean'||Object.keys(r).some(k=>!['secretaryId','binding','callId','model','at','purpose','source','input','output','cacheRead','cacheWrite','status','inputIncludesCache'].includes(k)))throw Error('Usage record schema invalid');
  for(const f of ['input','output','cacheRead','cacheWrite'])if(r[f]!==undefined&&!number(r[f]))throw Error('Usage counter schema invalid');
 }
 for(const [id,r] of Object.entries(s.reservations))if(!object(r)||!hash(id)||!string(r.secretaryId,128)||!hash(r.binding)||!string(r.operationId,256)||id!==key(r.secretaryId,r.binding,r.operationId)||!date(r.at)||!['report','memory','context'].includes(r.purpose)||!['reserved','started','released'].includes(r.state)||Object.keys(r).some(k=>!['secretaryId','binding','operationId','purpose','at','state'].includes(k)))throw Error('Usage reservation schema invalid');
}
/** Account-scoped durable metering. Full identities stay retained: never prune dedup keys into new quota. */
export class MishuUsage {
 private state?:UsageState;private tail:Promise<unknown>=Promise.resolve();private failure?:string;
 constructor(private root:string,private now:()=>number=Date.now){}
 private async load(){if(this.state)return;try{const file=join(this.root,'usage-v1.json'),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>USAGE_LIMITS.bytes)throw Error('capacity/file');const bytes=await readFile(file);const value:unknown=JSON.parse(bytes.toString());validate(value);this.state=value;this.failure=value.diagnostic;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')this.state={version:1,startedAt:new Date(this.now()).toISOString(),records:{},reservations:{}};else throw Error('Usage storage unavailable; existing data preserved');}}
 private async persist(state:UsageState){validate(state);const bytes=JSON.stringify(state);if(Buffer.byteLength(bytes)>USAGE_LIMITS.bytes)throw Error('Usage storage capacity reached');await mkdir(this.root,{recursive:true,mode:0o700});const file=join(this.root,'usage-v1.json'),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,bytes,{mode:0o600,flush:true,flag:'wx'});await rename(temp,file);}
 private transaction<T>(fn:(s:UsageState)=>T|Promise<T>,recover=false,accounting=false):Promise<T>{
  const work=this.tail.then(async()=>{let phase:'load'|'operation'|'save'='load';try{
   await this.load();const next=structuredClone(this.state!);phase='operation';const result=await fn(next);if(recover)delete next.diagnostic;phase='save';await this.persist(next);this.state=next;if(recover)this.failure=undefined;return result;
  }catch(e){
   // Expected admission/release rejections are not metering loss. Failed native
   // accounting and storage errors remain latched across queries and restart.
   if(phase!=='operation'||recover||accounting){this.failure='Usage metering unavailable; budgeted auxiliary runs are blocked';if(this.state){this.state.diagnostic=this.failure;try{await this.persist(this.state);}catch{/* Preserve the last saved journal if storage itself is unavailable. */}}}
   throw e;
  }});this.tail=work.catch(()=>undefined);return work;
 }
 private applyRecord(s:UsageState,secretaryId:string,binding:string,row:UsageRecord){
  if(!row.callId||row.callId.length>512||!row.model||row.model.length>200||!Number.isFinite(Date.parse(row.at))||!['foreground','report','memory','context'].includes(row.purpose)||!['native-log','native-event'].includes(row.source))throw Error('Invalid native usage identity');
  for(const field of ['input','output','cacheRead','cacheWrite'] as const)if(row[field]!==undefined&&!number(row[field]))throw Error('Invalid native usage counters');
  const id=key(secretaryId,binding,row.callId),prior=s.records[id];if(!prior&&Object.keys(s.records).length>=USAGE_LIMITS.records)throw Error('Usage identity capacity reached; no dedup identities were deleted');
  if(prior&&(prior.model!==row.model||prior.purpose!==row.purpose))throw Error('Native usage identity changed category/model');
  const merged={...prior,...row,secretaryId,binding};for(const field of ['input','output','cacheRead','cacheWrite'] as const)if(prior?.[field]!==undefined)merged[field]=Math.max(prior[field]!,row[field]??0);s.records[id]=merged;
 }
 record(secretaryId:string,binding:string,row:UsageRecord){return this.transaction(s=>this.applyRecord(s,secretaryId,binding,row),false,true);}
 recordMany(secretaryId:string,binding:string,rows:UsageRecord[]){return this.transaction(s=>{for(const row of rows)this.applyRecord(s,secretaryId,binding,row);},true);}
 recordReserved(secretaryId:string,operationId:string,purpose:Reservation['purpose'],row:Omit<UsageRecord,'callId'|'purpose'|'source'>){return this.transaction(s=>{
  const matches=Object.values(s.reservations).filter(r=>r.secretaryId===secretaryId&&r.operationId===operationId);
  if(matches.length!==1||matches[0].purpose!==purpose||matches[0].state==='released')throw Error('Exact accepted auxiliary reservation unavailable');
  const accepted=matches[0];this.applyRecord(s,secretaryId,accepted.binding,{...row,callId:'aux:'+operationId,purpose:accepted.purpose,source:'native-event'});
 },false,true);}
 reserve(secretaryId:string,binding:string,operationId:string,purpose:Reservation['purpose'],limit=USAGE_LIMITS.hourlyCalls){return this.transaction(s=>{
  if(s.diagnostic||this.failure)throw Error('Usage metering unavailable; no new auxiliary calls');
  if(!operationId||operationId.length>256||!['report','memory','context'].includes(purpose)||!Number.isSafeInteger(limit)||limit<1||limit>USAGE_LIMITS.hourlyCalls)throw Error('Invalid auxiliary reservation');
  const id=key(secretaryId,binding,operationId),prior=s.reservations[id];if(prior){if(prior.purpose!==purpose)throw Error('Reservation identity changed');return {admitted:false,state:prior.state,operationId};}
  if(Object.keys(s.reservations).length>=USAGE_LIMITS.reservations)throw Error('Auxiliary reservation identity capacity reached');
  const used=Object.values(s.reservations).filter(r=>r.secretaryId===secretaryId&&r.binding===binding&&r.state!=='released'&&Date.parse(r.at)>this.now()-3600000).length;if(used>=limit)throw Error('Auxiliary hourly call budget exhausted');
  s.reservations[id]={secretaryId,binding,operationId,purpose,at:new Date(this.now()).toISOString(),state:'reserved'};return {admitted:true,state:'reserved' as const,operationId};
 });}
 transition(secretaryId:string,binding:string,operationId:string,started:boolean){return this.transaction(s=>{const r=s.reservations[key(secretaryId,binding,operationId)];if(!r)throw Error('Auxiliary reservation missing');if(started){if(s.diagnostic||this.failure)throw Error('Usage metering unavailable; auxiliary start blocked');if(r.state==='released')throw Error('Auxiliary reservation already released');r.state='started';}else{if(r.state==='started')throw Error('Started or uncertain native call cannot return quota');r.state='released';}return {state:r.state};});}
 async query(secretaryId:string,binding:string,input:Record<string,unknown>){await this.tail;try{await this.transaction(()=>undefined);}catch{return {version:1,available:false,diagnostic:this.failure??'Usage storage unavailable',records:[],coverage:'unknown'};}
  if(input.version!==1)throw Error('usage requires version 1');for(const field of ['since','until'] as const)if(input[field]!==undefined&&(typeof input[field]!=='string'||!Number.isFinite(Date.parse(input[field] as string))))throw Error('Invalid usage time filter');
  const all=Object.values(this.state!.records).filter(r=>r.secretaryId===secretaryId&&r.binding===binding&&(!input.purpose||r.purpose===input.purpose)&&(!input.model||r.model===input.model)&&(!input.since||Date.parse(r.at)>=Date.parse(String(input.since)))&&(!input.until||Date.parse(r.at)<=Date.parse(String(input.until)))).sort((a,b)=>b.at.localeCompare(a.at));
  const offset=Number.isSafeInteger(input.offset)?Math.max(0,Number(input.offset)):0,limit=Number.isSafeInteger(input.limit)?Math.max(1,Math.min(50,Number(input.limit))):50;
  const sums:Record<string,number|null>={};for(const field of ['input','output','cacheRead','cacheWrite'] as const)sums[field]=all.length&&all.every(r=>r[field]!==undefined)?all.reduce((sum,r)=>sum+r[field]!,0):null;
  const reservations=Object.values(this.state!.reservations).filter(r=>r.secretaryId===secretaryId&&r.binding===binding&&r.state!=='released'&&Date.parse(r.at)>this.now()-3600000);
  return {version:1,available:!this.failure&&!this.state!.diagnostic,diagnostic:this.failure??this.state!.diagnostic,startedAt:this.state!.startedAt,coverage:'partial',gaps:['Only verified native identities are counted; unknown historical/auxiliary engine usage is not zero','Target conversation costs are excluded'],hostWatch:{modelCalls:0,known:true},totals:sums,records:all.slice(offset,offset+limit).map(({binding:_,secretaryId:__,...r})=>r),total:all.length,next:offset+limit<all.length?offset+limit:null,limits:USAGE_LIMITS,budget:{used:reservations.length,remaining:Math.max(0,USAGE_LIMITS.hourlyCalls-reservations.length),windowMs:3600000},currency:null};
 }
 async flush(){await this.tail;}
}
