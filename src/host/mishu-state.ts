import {createHash} from 'node:crypto';
import {lstat,open,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/** Receipt snapshots amplify resource-specific limits; this is a separate load safety ceiling. */
export const MAX_MISHU_STATE_BYTES=512*1024*1024;
export class MishuStateError extends Error {
 constructor(readonly code:'invalid-state'|'unsupported-version'|'storage-capacity'|'storage-unavailable'){
  super(`MISHU storage ${code}; read-only diagnosis, original state preserved. Use a compatible Host; never restore a migration backup as live authorization.`);
 }
}
type Row=Record<string,any>;
const row=(v:unknown):v is Row=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function check(ok:unknown):asserts ok{if(!ok)throw new MishuStateError('invalid-state');}
const text=(v:unknown,max=4096)=>typeof v==='string'&&v.length<=max;
const num=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const one=(v:unknown,choices:string[])=>typeof v==='string'&&choices.includes(v);
function object(v:unknown,required:string[],optional:string[]=[]):asserts v is Row{check(row(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)));}
function array(v:unknown,max:number,validate:(v:any)=>void){check(Array.isArray(v)&&v.length<=max);for(const item of v)validate(item);}
function strings(v:Row,keys:string[],max=4096){for(const k of keys)check(text(v[k],max));}
function optional(v:Row,key:string,test:(x:any)=>unknown){if(v[key]!==undefined)check(test(v[key]));}
function refs(v:unknown){array(v,64,r=>{object(r,['id','revision']);strings(r,['id','revision'],4096);});}
const states=['not-started','watching','reply-available','incomplete','uncertain','waiting','stopped'];
function event(v:unknown){object(v,['revision','state','text','entries'],['latestReply']);check(num(v.revision)&&one(v.state,states)&&text(v.text,4000));optional(v,'latestReply',x=>text(x,4000));refs(v.entries);}
function assignment(v:unknown){object(v,['id','taskId','sourceRunId','phase','targetId','binding','scope','fingerprint','messageId','requestId','text','authorizationRef','state','createdAt'],['retryOf','error']);strings(v,['id','taskId','sourceRunId','targetId','binding','fingerprint','messageId','requestId','state','createdAt']);check(num(v.phase)&&text(v.scope,2000)&&text(v.text,4000)&&text(v.authorizationRef,500));optional(v,'retryOf',text);optional(v,'error',text);}
function report(v:unknown){object(v,['id','sourceLabel','notificationId','notificationRevision','taskId','sourceBinding','generation','processingId','state','createdAt'],['brief','events','eventVersions','recoveries','admissionFailures','retryAt','retryBlocked','deliveryAttempted','automatic','notificationGeneration','nativeBinding','outputs','error']);strings(v,['id','sourceLabel','notificationId','taskId','sourceBinding','processingId','createdAt']);check(num(v.notificationRevision)&&num(v.generation)&&one(v.state,['pending','admitted','processing','committed','uncertain','cancelled']));for(const k of ['recoveries','admissionFailures','retryAt','notificationGeneration'])optional(v,k,num);for(const k of ['retryBlocked','deliveryAttempted','automatic'])optional(v,k,x=>typeof x==='boolean');for(const k of ['nativeBinding','error'])optional(v,k,text);if(v.brief!==undefined){object(v.brief,['purpose','scope','nextStep']);check(text(v.brief.purpose,500)&&text(v.brief.scope,2000)&&text(v.brief.nextStep,1000));}if(v.events!==undefined)array(v.events,16,event);if(v.eventVersions!==undefined)array(v.eventVersions,16,x=>check(num(x)));if(v.outputs!==undefined)refs(v.outputs);}
function task(v:unknown){
 object(v,['taskId','sourceBinding','targetId','binding','revision','purpose','scope','summary','nextStep','workState','observation','acceptance','createdAt','updatedAt'],['assignment','obligation','fact','notificationError','notification','reports','observationError']);
 strings(v,['taskId','sourceBinding','targetId','binding','createdAt','updatedAt']);check(num(v.revision)&&v.revision>0&&text(v.purpose,500)&&text(v.scope,2000)&&text(v.summary,4000)&&text(v.nextStep,1000)&&one(v.workState,['recorded','stopped'])&&one(v.observation,states)&&v.acceptance==='pending');
 if(v.assignment!==undefined)assignment(v.assignment);
 if(v.obligation!==undefined){object(v.obligation,['runId','nativeBinding','watermark','state','generation']);strings(v.obligation,['runId','nativeBinding','watermark']);check(num(v.obligation.generation)&&one(v.obligation.state,['pending','reply-available','incomplete','uncertain','cancelled']));}
 if(v.fact!==undefined){object(v.fact,['text','entries'],['latestReply']);check(text(v.fact.text,4000));optional(v.fact,'latestReply',x=>text(x,4000));refs(v.fact.entries);}
 for(const k of ['notificationError','observationError'])optional(v,k,text);
 if(v.notification!==undefined){object(v.notification,['id','revision','state'],['events','readyAt','automatic','reportId']);check(text(v.notification.id)&&num(v.notification.revision)&&one(v.notification.state,['pending','committed']));optional(v.notification,'readyAt',num);optional(v.notification,'automatic',x=>typeof x==='boolean');optional(v.notification,'reportId',text);if(v.notification.events!==undefined)array(v.notification.events,16,event);}
 if(v.reports!==undefined)array(v.reports,100,r=>{report(r);check(r.taskId===v.taskId&&r.sourceBinding===v.sourceBinding);});
}
function note(v:unknown){object(v,['noteId','sourceBinding','fromTaskId','fromSourceBinding','purpose','scope','summary','nextStep','recordedAt','restoredAt','operationId']);strings(v,['noteId','sourceBinding','fromTaskId','fromSourceBinding','recordedAt','restoredAt','operationId']);check(text(v.purpose,500)&&text(v.scope,2000)&&text(v.summary,4000)&&text(v.nextStep,1000));}
export function validateMishuState(v:unknown):asserts v is {version:1|2;chats:Record<string,Row>}{
 if(row(v)&&v.version!==1&&v.version!==2)throw new MishuStateError('unsupported-version');
 object(v,['version','chats']);check(row(v.chats));
 for(const [id,c] of Object.entries(v.chats)){
  check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id));object(c,['selected','enabled','allowInstructions','sourceBinding','targets','messages'],['notificationError','notificationBudget','notifications','notificationGeneration','taskJournal','assignments','notes']);
  for(const k of ['selected','enabled','allowInstructions'])check(typeof c[k]==='boolean');check(text(c.sourceBinding));optional(c,'notifications',x=>typeof x==='boolean');optional(c,'notificationGeneration',num);optional(c,'notificationError',text);
  if(c.notificationBudget!==undefined){object(c.notificationBudget,['startedAt','used']);check(num(c.notificationBudget.startedAt)&&num(c.notificationBudget.used));}
  array(c.targets,20,t=>{object(t,['id','binding','title','engine']);strings(t,['id','binding','title','engine']);});
  array(c.messages,1000,m=>{object(m,['messageId','targetId','binding','kind','state','requestId','fingerprint','text','createdAt'],['authorizationRef','result','truncated','error']);strings(m,['messageId','targetId','binding','kind','state','requestId','fingerprint','createdAt']);check(text(m.text,4000));for(const k of ['authorizationRef','result','error'])optional(m,k,text);optional(m,'truncated',x=>typeof x==='boolean');});
  if(c.taskJournal!==undefined){object(c.taskJournal,['tasks','operations']);array(c.taskJournal.tasks,200,task);check(new Set(c.taskJournal.tasks.map((t:Row)=>t.taskId)).size===c.taskJournal.tasks.length);array(c.taskJournal.operations,2200,o=>{object(o,['id','fingerprint'],['task','stoppedTaskId']);strings(o,['id','fingerprint']);check((o.task!==undefined)!==(o.stoppedTaskId!==undefined));if(o.task!==undefined)task(o.task);else check(text(o.stoppedTaskId)&&c.taskJournal.tasks.some((t:Row)=>t.taskId===o.stoppedTaskId&&t.workState==='stopped'));});check(new Set(c.taskJournal.operations.map((o:Row)=>o.id)).size===c.taskJournal.operations.length);}
  if(c.assignments!==undefined)array(c.assignments,1000,assignment);if(c.notes!==undefined)array(c.notes,200,note);
 }
}
/** No source bytes, IDs, credentials or parser snippets enter diagnostics. */
export async function diagnoseMishuState(root:string,error:unknown){const safe=error instanceof MishuStateError?error:new MishuStateError('storage-unavailable');await writeFile(join(root,'diagnostic.json'),JSON.stringify({mode:'read-only',code:safe.code,at:new Date().toISOString(),recovery:'Keep state.json and migration backups private. Use a compatible version or repair an offline copy; never replace live authority with an older backup.'}),{mode:0o600,flush:true}).catch(()=>undefined);return safe;}
export async function readMishuState(root:string){
 const file=join(root,'state.json');const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new MishuStateError('invalid-state');if(info.size>MAX_MISHU_STATE_BYTES)throw new MishuStateError('storage-capacity');
 const handle=await open(file,'r');let bytes:Buffer;try{const fresh=await handle.stat();if(fresh.size>MAX_MISHU_STATE_BYTES)throw new MishuStateError('storage-capacity');bytes=await handle.readFile();}finally{await handle.close();}
 let state:unknown;try{state=JSON.parse(bytes.toString('utf8'));}catch{throw new MishuStateError('invalid-state');}validateMishuState(state);
 return {state,bytes,backupName:state.version===1?'state.v1.'+createHash('sha256').update(bytes).digest('hex')+'.json':undefined};
}
