import { Worker } from 'node:worker_threads';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentSessionFactory } from './agent-adapter.js';
import type { JsonValue, ServerFrame } from '../shared/protocol.js';

export interface ConversationMeta {
  syncProtocol: 2; conversationId: string; bindingEpoch: string; headRevision: string;
  oldestAvailableRevision: string; snapshotId: string; sourceFreshness: 'unknown'|'reconciling'|'current';
  lastSourceCheckAt: string|null; runState: 'unknown'|'running'|'settled'|'interrupted';
}
export class ConversationIndexError extends Error {
  constructor(readonly code: string, readonly meta?: ConversationMeta) { super(code==='request_already_accepted'?'This request was already accepted and was not sent again. Inspect its command receipt before retrying.':code==='command_ledger_full'?'Command receipt storage is full. Create a new conversation; existing request IDs remain protected.':code); }
}
/** A shared, bounded pool. Timeouts do not release a slot still executing work. */
class IndexPool {
  private workers: Array<{worker:Worker;busy:boolean;id:number;failed?:boolean}> = [];
  private queue: Array<any> = [];
  private pending = new Map<number,any>();
  private serial = 0;
  request(path: string, action: string, args: any): Promise<any> {
    if (this.pending.size + this.queue.length >= 128) return Promise.reject(new ConversationIndexError('index_overloaded'));
    return new Promise((resolve,reject)=>{this.queue.push({requestId:++this.serial,path,action,args,resolve,reject,workerId:createHash('sha256').update(path).digest()[0]%2});this.drain();});
  }
  private drain() {
    while(this.workers.length<2) {
      const url=new URL(import.meta.url.endsWith('.ts')?'./conversation-index-worker.ts':'./conversation-index-worker.js',import.meta.url);
      const worker=new Worker(url,{execArgv:process.execArgv.filter(arg=>!arg.startsWith("--input-type"))});const slot:{worker:Worker;busy:boolean;id:number;failed?:boolean}={worker,busy:false,id:[0,1].find(id=>!this.workers.some(slot=>slot.id===id))!};this.workers.push(slot);
      worker.on('message',message=>{if(slot.failed)return;const work=this.pending.get(message.requestId);this.pending.delete(message.requestId);slot.busy=false;slot.worker.unref();
        if(work){if(message.error)work.reject(new ConversationIndexError(message.error.code,message.error.meta));else work.resolve(message.value);}this.drain();});
      const rejectPending=()=>{for(const [id,work] of this.pending)if(work.slot===slot){work.reject(new ConversationIndexError('index_worker_failed'));this.pending.delete(id);}};
      worker.on('error',()=>{slot.failed=true;rejectPending();void worker.terminate();});
      // Replacement capacity is released only after the worker actually exits.
      worker.on('exit',()=>{slot.failed=true;rejectPending();this.workers=this.workers.filter(w=>w!==slot);if(this.queue.length)this.drain();});
      worker.unref();
    }
    for(const slot of this.workers) {if(slot.busy||slot.failed)continue;const queued=this.queue.findIndex(work=>work.workerId===slot.id);if(queued<0)continue;const work=this.queue.splice(queued,1)[0];slot.busy=true;slot.worker.ref();work.slot=slot;this.pending.set(work.requestId,work);slot.worker.postMessage({requestId:work.requestId,path:work.path,action:work.action,args:work.args});}
  }
}
const pool=new IndexPool();
/** Conservative UTF-16 estimate with a hard traversal budget; never stringify whole native tool bodies on the Host loop. */
function boundedWeight(value:unknown):number {
  let bytes=512,visited=0;const pending:unknown[]=[value];
  while(pending.length&&bytes<=256*1024){const item=pending.pop();if(++visited>2048)return 256*1024+1;if(typeof item==='string')bytes+=item.length*3+16;else if(item&&typeof item==='object'){const keys=Object.keys(item);if(keys.length>2048)return 256*1024+1;bytes+=keys.length*16;for(const key of keys)pending.push((item as any)[key]);}else bytes+=16;}
  return bytes;
}
interface Actor {tail:Promise<any>;bytes:number;audit?:Promise<void>;lastAccess:number;lastAudit:number;deleted:boolean;}
export interface ConversationIndexOptions { root:string; factory:AgentSessionFactory; userScope:string; onChange?:(meta:ConversationMeta)=>void; auditIntervalMs?:number; retainBytes?:number; }
/** Per-conversation single writer; no native Session ownership and no prompt delivery. */
export class ConversationIndex {
  private actors=new Map<string,Actor>();
  private timer?:ReturnType<typeof setInterval>;
  private closing=false;
  private closed=false;
  private closePromise?:Promise<void>;
  private pending=new Set<Promise<unknown>>();
  private ownerGeneration=randomUUID();
  private auditing=0;
  constructor(private options:ConversationIndexOptions) {
    const interval=options.auditIntervalMs??3000;
    if(interval>0){this.timer=setInterval(()=>{
      for(const [id,actor] of [...this.actors].sort((a,b)=>a[1].lastAudit-b[1].lastAudit)){if(Date.now()-actor.lastAccess>10*60_000&&!actor.bytes&&!actor.audit){this.actors.delete(id);continue;}if(!actor.deleted&&!actor.audit)this.scheduleAudit(id);}
    },interval);this.timer.unref();}
  }
  private path(id:string){return join(this.options.root,createHash('sha256').update(this.options.userScope+'\0'+id).digest('hex')+'.sqlite');}
  private actor(id:string):Actor {
    if(this.closing||this.closed)throw new ConversationIndexError('index_closed');
    let actor=this.actors.get(id);
    if(!actor){if(this.actors.size>=256)throw new ConversationIndexError('index_overloaded');actor={tail:Promise.resolve(),bytes:0,lastAccess:Date.now(),lastAudit:0,deleted:false};this.actors.set(id,actor);}
    actor.lastAccess=Date.now();if(actor.deleted)throw new ConversationIndexError('conversation_deleted');return actor;
  }
  private track<T>(work:Promise<T>):Promise<T> {
    this.pending.add(work);
    void work.then(()=>this.pending.delete(work),()=>this.pending.delete(work));
    return work;
  }
  private request(id:string,action:string,args:any={}) {if(this.closed)return Promise.reject(new ConversationIndexError('index_closed'));return this.track(pool.request(this.path(id),action,{...args,id,ownerGeneration:this.ownerGeneration,retainBytes:this.options.retainBytes??4*1024*1024}));}
  private async write(id:string,action:string,args:any,weight=0):Promise<ConversationMeta> {
    const actor=this.actor(id);if(actor.bytes+weight>256*1024)return Promise.reject(new ConversationIndexError('index_overloaded'));
    actor.bytes+=weight;
    const work=actor.tail.then(()=>{if(actor.deleted)throw new ConversationIndexError('conversation_deleted');return this.request(id,action,args);});
    actor.tail=work.catch(()=>undefined).finally(()=>{actor.bytes-=weight;});
    return this.track(work.then(meta=>{this.options.onChange?.(meta);return meta;}));
  }
  async meta(id:string):Promise<ConversationMeta> {this.actor(id);const value=await this.request(id,'meta');this.scheduleAudit(id);return value;}
  async page(id:string,args:any={}) {this.actor(id);const value=await this.request(id,'page',args);this.scheduleAudit(id);return value;}
  changes(id:string,args:any) {this.actor(id);return this.request(id,'changes',args);}
  command(id:string,requestId:string,state:string,mode?:string){return this.write(id,'command',{requestId,state,mode});}
  commands(id:string,args:any={}){this.actor(id);return this.request(id,'commands',args);}
  content(id:string,args:any) {this.actor(id);return this.request(id,'content',args);}
  /** Synchronous native callbacks enqueue independently of task controls. */
  event(id:string,event:JsonValue) {
    if(this.closing||this.closed)return;
    const type=event&&typeof event==='object'&&!Array.isArray(event)?String(event.type):'';
    // Terminal lifecycle barriers retain an ordered lane even when text ingestion is full.
    const weight=['agent_settled','run_completed','agent_interrupted','run_interrupted'].includes(type)?0:boundedWeight(event);
    void this.write(id,'event',{event},weight).catch(async()=>{if(!this.closing&&!this.closed)await this.request(id,'ingest_loss').catch(()=>undefined);}).finally(()=>{
      if(event&&typeof event==='object'&&!Array.isArray(event)&&['agent_settled','run_completed','message_end','message_completed'].includes(String(event.type)))this.scheduleAudit(id,true);
    });
  }
  scheduleAudit(id:string,force=false) {
    if(this.closing||this.closed||!this.options.factory.readHistory)return;
    let actor:Actor;try{actor=this.actors.get(id)??this.actor(id);}catch{return;}
    if(actor.audit||this.auditing>=2||(!force&&Date.now()-actor.lastAudit<1000))return;
    actor.lastAudit=Date.now();this.auditing++;
    actor.audit=(async()=>{
      // Capture before reading. Stream writes or rebinding invalidate a late audit.
      const before:ConversationMeta=await this.request(id,'meta');
      // Completed-only native projections cannot overwrite an in-flight tail.
      if(this.closing||this.closed||actor.deleted||before.runState==='running')return;
      await this.request(id,'freshness',{freshness:'reconciling'});
      if(this.closing||this.closed||actor.deleted)return;
      const source=await this.options.factory.readHistory!(id);
      if(this.closing||this.closed||actor.deleted)return;
      if(source.sourceFreshness!=='current'){await this.request(id,'freshness',{freshness:'unknown'});return;}
      await this.write(id,'reconcile',{entries:source.history.entries,binding:source.binding,sourceGeneration:source.sourceGeneration,sourceFreshness:source.sourceFreshness,checkedAt:source.checkedAt,expectedEpoch:before.bindingEpoch,expectedRevision:before.headRevision});
    })().catch(async()=>{if(!this.closing&&!this.closed&&!actor.deleted)await this.request(id,'freshness',{freshness:'unknown'}).catch(()=>undefined);}).finally(()=>{actor.audit=undefined;this.auditing--;});
  }
  async reconcile(id:string,entries:any[],options:any={}) {return this.write(id,'reconcile',{entries,...options});}
  async remove(id:string) {const actor=this.actor(id);actor.deleted=true;return this.track(actor.tail.then(()=>this.request(id,'delete')));}
  async flush(id?:string) {await Promise.all([...this.actors].filter(([key])=>!id||id===key).map(([,actor])=>actor.tail));}
  close():Promise<void> {
    if(this.closePromise)return this.closePromise;
    // Fence admission before yielding, but let already accepted writes drain.
    // Audits own source reads as well as SQLite requests: returning before either
    // finishes lets a late lookup/worker recreate files during caller cleanup.
    this.closing=true;if(this.timer)clearInterval(this.timer);
    return this.closePromise=(async()=>{
      await Promise.allSettled([...this.actors.values()].map(actor=>actor.audit));
      await this.flush();
      while(this.pending.size)await Promise.allSettled([...this.pending]);
      this.closed=true;
    })();
  }
}
