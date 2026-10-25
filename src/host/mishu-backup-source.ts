import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {BackupError,type RecoverySource} from './backup.js';
import {validateMishuState,MAX_MISHU_STATE_BYTES} from './mishu-state.js';

// This format is an inert archive, never a MISHU database or execution journal.
// Text citations are copied evidence; they do not authorize fetching other tasks.
type Row=Record<string,any>;
const fail=()=>{throw new BackupError('external_context','Unsupported MISHU note source');};
const object=(v:unknown):v is Row=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function shape(v:unknown,required:string[],optional:string[]=[]):asserts v is Row{if(!object(v)||required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
function list(v:unknown,max:number):any[]{if(!Array.isArray(v)||v.length>max)fail();return v as any[];}
function pick(v:Row,keys:string[]){return Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));}
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
function provenance(v:unknown){
 shape(v,['kind','at'],['conversationId','messageId','sourceBinding','revision','requestId','quote','start','end','fromBinding']);
 if(!['manual','user-message','restored','evidence'].includes(v.kind)||typeof v.at!=='string')fail();
 for(const key of ['conversationId','messageId','sourceBinding','quote','fromBinding'])if(v[key]!==undefined&&typeof v[key]!=='string')fail();
 for(const key of ['revision','start','end'])if(v[key]!==undefined&&!Number.isSafeInteger(v[key]))fail();
 return pick(v,['kind','at','conversationId','messageId','sourceBinding','revision','quote','start','end','fromBinding']);
}
function entry(v:unknown){
 shape(v,['id','revision','kind','text','source','updatedAt','deleted','candidate','history'],['project','proposesFor']);
 if(typeof v.id!=='string'||!Number.isSafeInteger(v.revision)||v.revision<1||!['preference','agreement','project-fact','summary'].includes(v.kind)||typeof v.text!=='string'||typeof v.updatedAt!=='string'||typeof v.deleted!=='boolean'||typeof v.candidate!=='boolean')fail();
 for(const key of ['project','proposesFor'])if(v[key]!==undefined&&typeof v[key]!=='string')fail();
 return {...pick(v,['id','revision','kind','text','updatedAt','deleted','candidate','project','proposesFor']),source:provenance(v.source),history:list(v.history,20).map(h=>{shape(h,['revision','text','source','at']);if(!Number.isSafeInteger(h.revision)||typeof h.text!=='string'||typeof h.at!=='string')fail();return {...pick(h,['revision','text','at']),source:provenance(h.source)};})};
}
function memory(v:unknown,taskId:string){
 shape(v,['version','books']);if(v.version!==1||!object(v.books))fail();
 return Object.entries(v.books).filter(([key])=>key.startsWith(taskId+':')).map(([key,b])=>{
  shape(b,['enabled','revision','entries','operations']);if(typeof b.enabled!=='boolean'||!Number.isSafeInteger(b.revision))fail();
  const revisions=list(b.operations,2000).flatMap(o=>{shape(o,['id','fingerprint','result']);shape(o.result,[],['enabled','entry','entries','noteOnly','revision']);const values=[...(o.result.entry?[o.result.entry]:[]),...(o.result.entries?list(o.result.entries,500):[])];return values.map(entry);});
  return {sourceBinding:key.slice(taskId.length+1),revision:b.revision,entries:list(b.entries,500).map(entry),retainedOperationNotes:revisions};
 });
}
function historicalState(v:unknown,taskId:string){
 validateMishuState(v);const c=v.chats[taskId];if(!c)return undefined;
 const textKeys=['purpose','scope','summary','nextStep','text','latestReply','question','stopCondition','result','error'];
 const citeKeys=['sourceBinding','fromTaskId','fromSourceBinding','targetId','binding','taskId','createdAt','updatedAt','recordedAt','restoredAt','messageId','noteId','revision','truncated','latestReplyTruncated'];
 const brief=(b:Row)=>({...pick(b,[...textKeys,...citeKeys]),...(b.fact?{fact:pick(b.fact,['text','latestReply','entries','truncated','latestReplyTruncated'])}:{}),...(b.reports?{reports:b.reports.map((r:Row)=>({brief:r.brief,events:r.events?.map((e:Row)=>pick(e,['text','latestReply','entries','truncated','latestReplyTruncated']))}))}:{})});
 return {sourceBinding:c.sourceBinding,
  notes:(c.notes??[]).map((n:Row)=>pick(n,[...textKeys,...citeKeys])),
  receipts:c.messages.map((r:Row)=>pick(r,[...textKeys,...citeKeys])),
  taskNotes:(c.taskJournal?.tasks??[]).map(brief),
  retainedTaskNotes:(c.taskJournal?.operations??[]).filter((o:Row)=>o.task).map((o:Row)=>brief(o.task)),
  assignmentNotes:(c.assignments??[]).map((a:Row)=>pick(a,[...textKeys,...citeKeys])),
  pendingInstructionNotes:(c.userInstructions??[]).map((i:Row)=>({text:i.text})),
  followupNotes:(c.followups?.plans??[]).map((p:Row)=>pick(p,['sourceBinding','text','stopCondition','createdAt','updatedAt'])),
  questionNotes:(c.clarifications?.questions??[]).map((q:Row)=>({...pick(q,['questionId','sourceBinding','taskId','revision','question','options','createdAt','expiresAt']),...(q.answer?{answer:pick(q.answer,['text','at'])}:{}),...(q.execution?{proposedActionText:q.execution.text}:{})}))};
}
function change(v:unknown){
 shape(v,['op','source'],['entryId','expectedRevision','kind','text','project','candidate']);
 if(!['add','edit','remove'].includes(v.op)||v.text!==undefined&&typeof v.text!=='string')fail();
 // The old mutation is descriptive text only, not an operation to apply at restore.
 return {historicalChange:v.op,...pick(v,['entryId','expectedRevision','kind','text','project','candidate']),source:provenance(v.source)};
}
function consolidation(v:unknown,taskId:string){
 shape(v,['version','jobs','books'],['settings']);if(v.version!==1||!object(v.books))fail();list(v.settings??[],2000);
 return list(v.jobs,100).filter(j=>j.sourceId===taskId).map(j=>{
  shape(j,['id','operationId','sourceId','binding','generation','revision','automatic','state','createdAt','targetId','sources','changes','model'],['oldValues','automaticApplied','indices','cursor','hasMore','error']);
  if(typeof j.binding!=='string'||typeof j.createdAt!=='string'||!['reserved','running','ready','adopting','adopted','cancelled','uncertain'].includes(j.state))fail();
  const evidence=list(j.sources,20).map(s=>{shape(s,['messageId','conversationId','sourceBinding','text','role','at','range','truncated']);shape(s.range,['start','end'],['redacted']);if(['messageId','conversationId','sourceBinding','text','role'].some(k=>typeof s[k]!=='string')||s.at!==null&&typeof s.at!=='string'||typeof s.truncated!=='boolean'||!Number.isSafeInteger(s.range.start)||!Number.isSafeInteger(s.range.end)||s.range.redacted!==undefined&&typeof s.range.redacted!=='boolean')fail();return {...pick(s,['messageId','conversationId','sourceBinding','text','at','truncated']),historicalRole:s.role,range:s.range};});
  if(j.oldValues!==undefined&&(!object(j.oldValues)||Object.values(j.oldValues).some(x=>typeof x!=='string')))fail();
  return {sourceBinding:j.binding,createdAt:j.createdAt,historicalOutcome:j.state,evidence,candidateNotes:list(j.changes,10).map(change),previousNoteValues:j.oldValues,previouslyAdoptedNotes:list(j.automaticApplied??[],10).map(change)};
 });
}
function receipt(v:unknown,assignment:boolean){
 if(assignment){shape(v,['id','taskId','sourceRunId','phase','targetId','binding','scope','fingerprint','messageId','requestId','text','authorizationRef','state','createdAt'],['retryOf','error']);}
 else shape(v,['messageId','targetId','fingerprint','requestId','state','kind','createdAt','archivedAt'],['result','truncated','error']);
 for(const key of ['text','result','error'])if(v[key]!==undefined&&typeof v[key]!=='string')fail();
 return pick(v,['taskId','messageId','targetId','binding','scope','text','result','error','truncated','createdAt','archivedAt']);
}

/** Read bounded no-follow sources without starting MISHU, repairing journals,
 * opening SQLite, traversing other tasks, or loading an operational authority. */
export async function collectMishuBackupSource(options:{root:string;taskId:string}):Promise<{sources:RecoverySource[];validate():Promise<void>}>{
 const root=resolve(options.root),taskId=options.taskId;
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(taskId))fail();
 async function directory(path:string){const info=await lstat(path).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;return undefined;});if(!info){const parent=dirname(path);if(parent!==path)await directory(parent);return false;}if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==path)throw new BackupError('unsafe_source','Unsafe MISHU source directory');return true;}
 const selectedName=(name:string)=>['state.json','memory.json','consolidation-v1.json'].includes(name)||/^memory\.backup-[a-f0-9]{64}\.json$/.test(name)||/^state\.v1\.[a-f0-9]{64}\.json$/.test(name);
 // Named operational resources are deliberately excluded, never imported as authority.
 // A novel durable source cannot silently acquire the same exclusion.
 const operationalName=(name:string)=>['.pi-coffee-backup-source','diagnostic.json','rules.json','grant.key','usage-v1.json','watch','receipts','state.json.tmp'].includes(name)||/^writer\.sqlite(?:-(?:shm|wal|journal))?$/.test(name)||/^memory\.[a-f0-9-]{36}\.tmp$/.test(name)||/^usage-v1\.json\.[a-f0-9-]{36}\.tmp$/.test(name)||/^consolidation-v1\.json\.[a-f0-9-]{36}$/.test(name);
 async function names(){
  if(!await directory(root))return [] as string[];
  const entries=await readdir(root);if(entries.some(name=>!selectedName(name)&&!operationalName(name)))fail();
  const found=entries.filter(selectedName),receipts=join(root,'receipts');
  if(await directory(receipts)){
   const entries=await readdir(receipts);
   if(entries.some(name=>!/^identities\.sqlite(?:-(?:shm|wal|journal))?$/.test(name)&&!/^(?:receipts|assignments)-[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.jsonl(?:\.tmp|\.torn-[0-9]+)?$/.test(name)))fail();
   for(const kind of ['receipts','assignments']){const name=kind+'-'+taskId+'.jsonl';if(entries.includes(name))found.push('receipts/'+name);}
  }
  return found.sort();
 }
 async function read(name:string){
  const path=join(root,name),before=await lstat(path);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>MAX_MISHU_STATE_BYTES||await realpath(path)!==path)throw new BackupError('unsafe_source','Unsafe MISHU source file');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(info.dev!==before.dev||info.ino!==before.ino||info.size!==before.size)throw new BackupError('capture_revoked','MISHU source changed');const bytes=Buffer.alloc(info.size+1);let length=0;while(length<bytes.length){const {bytesRead}=await file.read(bytes,length,bytes.length-length,length);if(!bytesRead)break;length+=bytesRead;}const after=await file.stat();if(length!==info.size||after.mtimeMs!==info.mtimeMs||after.size!==info.size)throw new BackupError('capture_revoked','MISHU source changed');const data=bytes.subarray(0,length);return {data,fingerprint:[String(info.dev),String(info.ino),String(info.size),hash(data)].join(':')};}finally{await file.close();}
 }
 const selected=await names(),fingerprints=new Map<string,string>(),archive={schemaVersion:1,kind:'mishu-notes-only',taskId,restorePolicy:{restoreAs:'historical-notes-archive',automaticContext:false,operationalAuthority:false,requireExplicitNoteAdoption:true},memory:[] as unknown[],history:[] as unknown[],consolidation:[] as unknown[],archivedReceipts:[] as unknown[],archivedAssignmentNotes:[] as unknown[]};let total=0;
 for(const name of selected){const {data,fingerprint}=await read(name);total+=data.length;if(total>MAX_MISHU_STATE_BYTES)throw new BackupError('resource_limit','MISHU note capture capacity exceeded');fingerprints.set(name,fingerprint);try{
  if(name.startsWith('receipts/')){const text=data.toString('utf8');if(text&&!text.endsWith('\n'))fail();const rows=text.split('\n').filter(Boolean).map(line=>receipt(JSON.parse(line),name.startsWith('receipts/assignments-')));if(name.startsWith('receipts/assignments-'))archive.archivedAssignmentNotes.push(...rows);else archive.archivedReceipts.push(...rows);}
  else{const value:unknown=JSON.parse(data.toString('utf8'));if(name.startsWith('memory'))archive.memory.push({snapshot:name,books:memory(value,taskId)});else if(name==='consolidation-v1.json')archive.consolidation.push(...consolidation(value,taskId));else{const history=historicalState(value,taskId);if(history)archive.history.push({snapshot:name,...history});}}
 }catch(error){if(error instanceof BackupError)throw error;fail();}}
 const content=Buffer.from(JSON.stringify(archive));if(content.length>MAX_MISHU_STATE_BYTES)throw new BackupError('resource_limit','MISHU note projection capacity exceeded');
 return {sources:selected.length?[{id:'mishu-notes',recoveryKey:'platform/mishu/notes-only-v1',role:'task-data',data:content}]:[],validate:async()=>{if(JSON.stringify(await names())!==JSON.stringify(selected))throw new BackupError('capture_revoked','MISHU source selection changed');for(const name of selected)if((await read(name)).fingerprint!==fingerprints.get(name))throw new BackupError('capture_revoked','MISHU notes changed');}};
}
