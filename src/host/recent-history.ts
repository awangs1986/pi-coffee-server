import {randomUUID} from 'node:crypto';
import type {AgentHistory,HistoryDisplayPage,AgentSession} from './agent-adapter.js';
import {compactEntry} from './conversation-projection.js';
type Mode='compact'|'detailed';
type Batch={owner:string;binding:string;mode:Mode;records:string[];next:string|null;bytes:number;expires:number};
const batches=new Map<string,Batch>();let retained=0,reading=0;
const MAX_BYTES=64*1024*1024,TTL=600_000;
function remove(id:string){const b=batches.get(id);if(b){retained-=b.bytes;batches.delete(id);}}
function sweep(){for(const [id,b] of batches)if(b.expires<=Date.now())remove(id);}
const collector=setInterval(sweep,60_000);collector.unref();
/** Bounded display cache, never a native-store replacement or execution owner. */
export class RecentHistoryPager {
 private owner=randomUUID();private pending=new Map<string,Promise<HistoryDisplayPage>>();private closed=false;
 constructor(private session:AgentSession){}
 private binding(){const value=this.session.getHistoryBinding?.();if(typeof value!=="string"||!value||value.length>1024)throw Error("history_page_unavailable");return value;}
 close(){this.closed=true;for(const [id,b] of batches)if(b.owner===this.owner)remove(id);}
 private token(token:string,mode?:Mode){
  sweep();const match=/^([a-f0-9-]{36})\.(\d+)$/.exec(token);const b=match?batches.get(match[1]):undefined;
  const offset=match?Number(match[2]):-1;
  if(this.closed||!b||b.owner!==this.owner||b.binding!==this.binding()||mode&&b.mode!==mode||!Number.isSafeInteger(offset)||offset<0||offset>b.records.length)throw Error('history_page_expired');
  batches.delete(match![1]);batches.set(match![1],b);return {id:match![1],b,offset};
 }
 content(token:string){const {b,offset}=this.token(token);if(offset>=b.records.length)throw Error('history_page_expired');return {entry:JSON.parse(b.records[offset])};}
 page(mode:Mode,cursor?:string):Promise<HistoryDisplayPage>{
  if(cursor){const {id,b,offset}=this.token(cursor,mode);if(offset>0)return Promise.resolve(this.window(id,b,offset));if(!b.next)throw Error('history_page_expired');return this.read(mode,b.next);}
  return this.read(mode);
 }
 private read(mode:Mode,cursor?:string){
  const binding=this.binding(),key=JSON.stringify([binding,mode,cursor]);const pending=this.pending.get(key);if(pending)return pending;
  if(reading>=2)throw Error('history_read_busy');reading++;
  const work=(async()=>{
   const page=await this.session.getHistoryPage!(cursor);
   if(this.closed||this.binding()!==binding)throw Error('history_page_expired');
   const records:string[]=[];let bytes=0;
   for(const entry of page.entries){if(mode==='compact'&&!compactEntry(entry))continue;const record=JSON.stringify(entry);bytes+=Buffer.byteLength(record)*3+256;if(bytes>MAX_BYTES)throw Error('history_page_too_large');records.push(record);}
   const next=page.olderCursor??null;bytes+=(next?.length??0)*3;
   if(bytes>MAX_BYTES)throw Error('history_page_too_large');sweep();
   while(batches.size>=256||retained+bytes>MAX_BYTES){const oldest=batches.keys().next().value;if(!oldest)break;remove(oldest);}
   const id=randomUUID(),batch={owner:this.owner,binding,mode,records,next,bytes,expires:Date.now()+TTL};batches.set(id,batch);retained+=bytes;
   return this.window(id,batch,records.length);
  })().finally(()=>{reading--;this.pending.delete(key);});this.pending.set(key,work);return work;
 }
 private window(id:string,b:Batch,end:number):HistoryDisplayPage{
  const entries:AgentHistory['entries']=[];let bytes=0,index=end;
  while(index>0&&entries.length<40){
   const original=JSON.parse(b.records[index-1]),field=original.kind==='tool'?'result':'text';
   const text=String(original[field]??'');let short=text.slice(0,8192);
   const entry:any={id:original.id,kind:original.kind,[field]:short,...(original.at?{at:original.at}:{}),...(original.imageCount?{imageCount:original.imageCount}:{}),...(original.kind==='tool'?{name:String(original.name??'').slice(0,256),isError:Boolean(original.isError)}:{})};
   if(typeof entry.id!=='string'||!entry.id||entry.id.length>1024||!['user','assistant','tool','note'].includes(entry.kind))throw Error('invalid_history_entry');
   if(original.kind==='tool'&&original.args!==undefined){const encoded=JSON.stringify(original.args);entry.args=Buffer.byteLength(encoded)<=1024?original.args:{preview:encoded.slice(0,256)};}
   while(Buffer.byteLength(JSON.stringify(entry))>8192&&short.length){short=short.slice(0,Math.floor(short.length*.75));entry[field]=short;}
   if(short.length&&/[\uD800-\uDBFF]/.test(short.at(-1)!)){short=short.slice(0,-1);entry[field]=short;}
   if(short.length<text.length||original.args!==undefined||original.diff!==undefined)entry.contentToken=id+'.'+(index-1);
   const size=Buffer.byteLength(JSON.stringify(entry));if(entries.length&&bytes+size>56*1024)break;
   entries.unshift(entry);bytes+=size;index--;
  }
  return {entries,leafId:entries.at(-1)?.id??null,olderCursor:index>0||b.next?id+'.'+index:null,coverage:'recent'};
 }
}
