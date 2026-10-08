import {createHash,randomUUID} from 'node:crypto';
import type {AgentRunEvidence} from '../agent-adapter.js';

/** Bounded connection-local evidence, not a passive native transcript reader.
 * Host persists accepted facts with their explicit native/Host receipt identity.
 * A lost connection cannot reconstruct a missing event or claim gap recovery. */
export class LiveRunEvidence {
 private readonly generation=randomUUID();
 private readonly runs=new Map<string,AgentRunEvidence>();
 private readonly pendingFinals=new Map<string,NonNullable<AgentRunEvidence['entries']>>();
 private latest?:string;
 constructor(private engine:'codex'|'claude'|'cursor'|'grok',private nativeId:()=>string|undefined){}
 private capabilities(){return {online:'supported' as const,restartRecovery:'unknown' as const,passiveHistory:this.engine==='codex'||this.engine==='claude'?'supported' as const:'unknown' as const,detachedWriters:'unknown' as const};}
 start(runId:string){
  if(this.runs.has(runId))return;
  this.latest=runId;
  this.runs.set(runId,{supported:true,freshness:'current',runId,binding:`${this.engine}:${this.nativeId()}:${this.generation}`,watermark:'0',state:'running',entries:[],capabilities:this.capabilities(),identity:this.engine==='codex'?'native-run':'host-invocation',referenceKind:this.engine==='cursor'||this.engine==='grok'?'host-live-receipt':'native-message',reason:'Only this live connection is observed; Host downtime and detached writers remain unknown'});
  if(this.runs.size>32){const oldest=this.runs.keys().next().value!;this.runs.delete(oldest);this.pendingFinals.delete(oldest);}
 }
 message(runId:string|undefined,id:string|undefined,text:string,final=false){
  const run=runId?this.runs.get(runId):undefined;if(!run||run.state!=='running'||!id||!text)return;
  const entry={id,revision:createHash('sha256').update(text).digest('hex'),text:text.slice(0,4000),truncated:text.length>4000};
  const pending=this.pendingFinals.get(runId!)??[];
  // A native terminal answer can precede its turn outcome. Keep it bounded here,
  // without publishing the same final facts once as progress and again as settled.
  const entries=final?pending:run.entries!,other=final?run.entries!:pending;
  const moved=other.findIndex(e=>e.id===id);if(moved>=0)other.splice(moved,1);
  const old=entries.findIndex(e=>e.id===id);
  if(old>=0)entries[old]=entry;else if(entries.length+other.length<100)entries.push(entry);
  else {run.reason='Live evidence capacity exceeded; last confirmed facts retained';this.finish(runId,'unknown');return;}
  if(final){this.pendingFinals.set(runId!,pending);return;}
  run.watermark=createHash('sha256').update(JSON.stringify([run.state,entries])).digest('hex');
 }
 finish(runId:string|undefined,status:string){
  const run=runId?this.runs.get(runId):undefined;if(!run||run.state!=='running')return;
  run.entries!.push(...this.pendingFinals.get(runId!)??[]);this.pendingFinals.delete(runId!);
  run.state=status==='completed'&&run.entries?.length?'reply-available':status==='failed'||status==='interrupted'||status==='completed'?'incomplete':'uncertain';
  run.watermark=createHash('sha256').update(JSON.stringify([run.state,run.entries])).digest('hex');
 }
 lost(){for(const run of this.runs.values())if(run.state==='running')this.finish(run.runId,'unknown');}
 read(runId=this.latest):AgentRunEvidence{return structuredClone(runId&&this.runs.get(runId)||{supported:true,freshness:'unknown',state:'uncertain',runId,capabilities:this.capabilities(),reason:'No evidence for this run on the current live connection; no native work was replayed'});}
}
