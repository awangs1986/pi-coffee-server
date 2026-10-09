import {appendFile,mkdir,readdir,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {WatchKind} from './mishu-rules.js';

/** One durable state transition. Text fields are already clipped by the producer. */
export interface WatchEvent {seq:number;at:string;conv:string;kind:WatchKind;data:Record<string,string|number|boolean>}
export interface JournalLimits {segmentEvents:number;segmentBytes:number;maxEvents:number;retentionMs:number;ringSize:number;pageLimit:number}
export const JOURNAL_LIMITS:JournalLimits={segmentEvents:5000,segmentBytes:2*1024*1024,maxEvents:20000,retentionMs:7*24*3600*1000,ringSize:1000,pageLimit:100};
interface Segment {start:number;count:number;bytes:number;lastAt:number;file:string;sealed?:boolean}
const SEGMENT=/^events-(\d{12})\.jsonl$/;
function parse(line:string):WatchEvent|undefined{
 try{const v=JSON.parse(line) as WatchEvent;return Number.isSafeInteger(v?.seq)&&typeof v.conv==='string'&&typeof v.kind==='string'?v:undefined;}catch{return undefined;}
}

/**
 * Append-only, segment-rotated JSONL event log. Writes are serialized; a torn
 * final line after a crash is ignored on read. Sequence numbers never repeat.
 */
export class WatchJournal {
 private segments:Segment[]=[];
 private ring:WatchEvent[]=[];
 private nextSeq=1;
 private tail:Promise<unknown>=Promise.resolve();
 private ready?:Promise<void>;
 readonly limits:JournalLimits;
 constructor(private root:string,limits:Partial<JournalLimits>={},private now:()=>number=Date.now){this.limits={...JOURNAL_LIMITS,...limits};}
 get head(){return this.nextSeq-1;}
 get firstSeq(){return this.segments.find(segment=>segment.count>0)?.start??this.nextSeq;}
 load(){return this.ready??=(async()=>{
  await mkdir(this.root,{recursive:true,mode:0o700});
  const names=(await readdir(this.root)).filter(n=>SEGMENT.test(n)).sort();
  for(const name of names){
   const events=await this.readSegment(name);
   const info=await stat(join(this.root,name));
   const bytes=await readFile(join(this.root,name));
   const sealed=bytes.length>0&&bytes.at(-1)!==10;
   const start=Number(SEGMENT.exec(name)![1]);
   this.segments.push({start,count:events.length,bytes:info.size,lastAt:events.length?Date.parse(events.at(-1)!.at):info.mtimeMs,file:name,sealed});
   if(events.length)this.nextSeq=Math.max(this.nextSeq,events.at(-1)!.seq+1);else this.nextSeq=Math.max(this.nextSeq,start+(sealed?1:0));
   this.ring.push(...events);if(this.ring.length>this.limits.ringSize)this.ring.splice(0,this.ring.length-this.limits.ringSize);
  }
 })();}
 private async readSegment(name:string):Promise<WatchEvent[]>{
  const text=await readFile(join(this.root,name),'utf8').catch(()=>'');
  // Only newline-terminated lines are complete; a torn tail is dropped.
  const complete=text.endsWith('\n')?text:text.slice(0,text.lastIndexOf('\n')+1);
  return complete.split('\n').filter(Boolean).map(parse).filter((e):e is WatchEvent=>e!==undefined);
 }
 append(input:Omit<WatchEvent,'seq'|'at'>):Promise<WatchEvent>{
  const work=this.tail.then(async()=>{
   await this.load();
   const event:WatchEvent={seq:this.nextSeq,at:new Date(this.now()).toISOString(),conv:input.conv,kind:input.kind,data:input.data};
   const line=JSON.stringify(event)+'\n',size=Buffer.byteLength(line);
   let current=this.segments.at(-1);
   if(!current||current.sealed||current.count>=this.limits.segmentEvents||current.bytes+size>this.limits.segmentBytes){
    current={start:event.seq,count:0,bytes:0,lastAt:this.now(),file:`events-${String(event.seq).padStart(12,'0')}.jsonl`};
    this.segments.push(current);
   }
   await appendFile(join(this.root,current.file),line,{mode:0o600});
   this.nextSeq++;current.count++;current.bytes+=size;current.lastAt=this.now();
   this.ring.push(event);if(this.ring.length>this.limits.ringSize)this.ring.shift();
   await this.prune();
   return event;
  });
  this.tail=work.catch(()=>undefined);
  return work;
 }
 private async prune(){
  const total=()=>this.segments.reduce((n,s)=>n+s.count,0);
  while(this.segments.length>1&&(total()>this.limits.maxEvents||this.now()-this.segments[0].lastAt>this.limits.retentionMs)){
   const oldest=this.segments.shift()!;await rm(join(this.root,oldest.file),{force:true});
  }
 }
 /** Events with seq > after. gap=true when retained history no longer covers the cursor. */
 async read(after=0,limit=this.limits.pageLimit):Promise<{events:WatchEvent[];next:number;gap:boolean;head:number}>{
  await this.load();await this.tail;
  const bounded=Math.max(1,Math.min(this.limits.pageLimit,Math.floor(limit)||this.limits.pageLimit));
  const cursor=Math.max(0,Math.floor(after)||0);
  let gap=cursor<this.firstSeq-1;
  let events:WatchEvent[];
  const ringStart=this.ring[0]?.seq??this.nextSeq;
  if(cursor>=ringStart-1)events=this.ring.filter(e=>e.seq>cursor).slice(0,bounded);
  else{
   events=[];
   for(const segment of this.segments){
    const end=segment.start+segment.count-1;if(end<=cursor)continue;
    for(const event of await this.readSegment(segment.file)){if(event.seq>cursor)events.push(event);if(events.length>=bounded)break;}
    if(events.length>=bounded)break;
   }
  }
  let covered=cursor;for(const event of events){if(event.seq>covered+1)gap=true;covered=event.seq;}
  return {events,next:events.at(-1)?.seq??Math.max(cursor,this.head),gap,head:this.head};
 }
 async flush(){await this.tail;}
}
