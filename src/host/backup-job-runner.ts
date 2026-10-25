import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,lstat,realpath,readFile,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {BackupCoordinator,BackupError,LEGACY_BACKUP_SCOPE} from './backup.js';
import {BackupRepository,type RepositoryJob,type BackupSelection} from './backup-repository.js';
import {normalizeUsername} from '../shared/identity.js';
import type {AgentEngine} from '../shared/protocol.js';

export interface BackupInventoryTask {taskId:string;engine:AgentEngine;archived?:boolean;}
interface Policy {schema:1;revision:string;scopes:string[];timeZone:string;hour:number;minute:number;startDate:string;}
interface Coverage {state:'complete'|'partial'|'stale'|'unknown';unprotected:string[];stale:string[];excluded:BackupInventoryTask[];points:{taskId:string;captureAt:string;checkpointId:string}[];}
interface Attempt {number:number;id:string;startedAt:string;finishedAt?:string;state:'running'|'succeeded'|'partial'|'failed'|'uncertain';errorCode?:string;}
interface ScheduledRun {id:string;date:string;revision:string;startedAt:string;finishedAt?:string;state:Attempt['state'];attempts:Attempt[];scopeStates?:Record<string,Attempt['state']>;}
interface Alert {id:string;scope:string;kind:'job-failed'|'point-stale'|'unprotected'|'inventory-unavailable';openedAt:string;lastObservedAt:string;resolvedAt?:string;occurrences:number;message:string;}
interface Journal {schema:1;runs:ScheduledRun[];alerts:Alert[];}
const validScope=(v:string)=>v===LEGACY_BACKUP_SCOPE||normalizeUsername(v)===v;
const taskId=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const engines=new Set(['pi','codex','claude','cursor','grok']);

/** Independent scheduled-job seam. Inventories are Host-owned publications, not
 * discovered native directories or a list of whichever points happen to exist. */
export class BackupJobRunner {
 readonly root:string;private now:()=>number;
 constructor(private options:{root:string;repository:Pick<BackupRepository,'backup'|'jobs'|'status'|'recoverInterruptedOperation'>;coordinator:Pick<BackupCoordinator,'status'|'refreshStatusInventory'>;now?:()=>number}){this.root=resolve(options.root);this.now=options.now??Date.now;}
 private async initialize(){await mkdir(this.root,{recursive:true,mode:0o700});await checkedDirectory(this.root);await mkdir(join(this.root,'inventory'),{recursive:true,mode:0o700});await checkedDirectory(join(this.root,'inventory'));}
 async configure(input:{revision:string;scopes:string[];timeZone?:string;hour?:number;minute?:number}):Promise<void>{
  await this.initialize();const timeZone=input.timeZone??'America/Toronto',hour=input.hour??4,minute=input.minute??0;
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(input.revision)||!Array.isArray(input.scopes)||!input.scopes.length||input.scopes.length>256||new Set(input.scopes).size!==input.scopes.length||input.scopes.some(s=>typeof s!=='string'||!validScope(s))||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw new BackupError('invalid_schedule','Invalid backup schedule');
  const startDate=localTime(this.now(),timeZone).date;
  await this.locked(async()=>{
   const old=await this.policy();
   const policy:Policy={schema:1,revision:input.revision,scopes:[...input.scopes].sort(),timeZone,hour,minute,startDate};
   if(old?.revision===policy.revision){if(JSON.stringify({...old,startDate:''})!==JSON.stringify({...policy,startDate:''}))throw new BackupError('schedule_revision_conflict','Use a new revision for schedule changes');return;}
   await atomic(this.root,'policy.json',policy);
  });
 }
 /** Trusted Host/CLI publication. Ordinary Browser callers cannot supply this. */
 async updateInventory(scope:string,tasks:BackupInventoryTask[]):Promise<void>{
  await this.initialize();const policy=await this.policy();
  if(!policy?.scopes.includes(scope)||!Array.isArray(tasks)||tasks.length>100000||new Set(tasks.map(t=>t.taskId)).size!==tasks.length||tasks.some(t=>!taskId.test(t.taskId)||!engines.has(t.engine)))throw new BackupError('invalid_inventory','Backup inventory is outside the configured scope');
  await atomic(join(this.root,'inventory'),inventoryName(scope),{schema:1,scope,observedAt:this.time(),tasks:tasks.map(({taskId,engine,archived})=>({taskId,engine,...(archived===undefined?{}:{archived})}))});
 }
 async status(scope:string){
  await this.initialize();const policy=await this.policy();if(!validScope(scope)||policy&&!policy.scopes.includes(scope))throw new BackupError('invalid_scope','Backup schedule scope unavailable');
  const journal=await this.journal();const coverage=await this.coverage(scope);
  return {schemaVersion:1,configured:Boolean(policy),schedule:policy?{revision:policy.revision,timeZone:policy.timeZone,hour:policy.hour,minute:policy.minute}:null,coverage,
   runs:journal.runs.slice().reverse().slice(0,30).map(({id,date,revision,startedAt,finishedAt,state,attempts,scopeStates})=>({id,date,revision,startedAt,finishedAt,state:scopeStates?.[scope]??state,attempts:attempts.map(a=>({...a}))})),alerts:journal.alerts.filter(a=>a.scope===scope).map(a=>({...a})),excludedEngines:['claude','cursor','grok']};
 }
 async tick():Promise<{dispatched:boolean;run?:ScheduledRun}>{
  await this.initialize();return this.locked(async()=>{
   const policy=await this.policy();if(!policy)return {dispatched:false};
   const journal=await this.journal(),now=this.now();
   const coverage=new Map<string,Coverage>();for(const scope of policy.scopes)coverage.set(scope,await this.coverage(scope));
   this.updateCoverageAlerts(journal,coverage);
   // A persisted in-flight attempt always reconciles before considering a new date.
   const pending=journal.runs.find(r=>r.state==='running'||r.state==='uncertain');
   if(pending){await this.execute(journal,pending,coverage,true);return {dispatched:false,run:pending};}
   const local=localTime(now,policy.timeZone),date=local.minutes>=policy.hour*60+policy.minute?local.date:previousDate(local.date);
   if(date<policy.startDate){await this.save(journal);return {dispatched:false};}
   const id=policy.revision+':'+date;let run=journal.runs.find(r=>r.id===id);
   if(run){
    if(run.state==='succeeded'||run.attempts.length>=3){await this.save(journal);return {dispatched:false};}
    const offset=run.attempts.length===1?15*60000:60*60000;
    if(now<Date.parse(run.startedAt)+offset){await this.save(journal);return {dispatched:false};}
   }else{
    run={id,date,revision:policy.revision,startedAt:this.time(),state:'running',attempts:[]};journal.runs.push(run);
   }
   const number=run.attempts.length+1,attempt:Attempt={number,id:operationId(run.id+':'+number),startedAt:this.time(),state:'running'};
   run.attempts.push(attempt);run.state='running';delete run.finishedAt;await this.save(journal);
   await this.execute(journal,run,coverage,false);return {dispatched:true,run};
  });
 }
 private async execute(journal:Journal,run:ScheduledRun,coverage:Map<string,Coverage>,reconciling:boolean){
  const attempt=run.attempts.at(-1)!;let job:RepositoryJob|undefined;
  try{
   if(reconciling){
    job=(await this.options.repository.jobs()).find(j=>j.id===attempt.id);
    if(job?.state==='running'){await this.options.repository.recoverInterruptedOperation();job=(await this.options.repository.jobs()).find(j=>j.id===attempt.id);}
    if(job?.state==='running')throw new BackupError('operation_uncertain','Backup operation is still being reconciled');
    if(job?.state==='failed')throw new BackupError(job.errorCode??'repository_failed','Previous attempt failed');
   }
   if(!job){
    const selection:BackupSelection[]=[];for(const scope of coverage.keys())for(const p of (await this.coverage(scope,false)).points)selection.push({scope,taskId:p.taskId});
    if(!selection.length)throw new BackupError('coverage_incomplete','No protected task checkpoint is available');
    job=await this.options.repository.backup(selection,undefined,attempt.id);
   }
   for(const scope of coverage.keys())coverage.set(scope,await this.coverage(scope));
   this.updateCoverageAlerts(journal,coverage);
   const complete=[...coverage.values()].every(c=>c.state==='complete');
   attempt.state=complete?'succeeded':'partial';run.state=attempt.state;
   run.scopeStates=Object.fromEntries([...coverage].map(([scope,c])=>[scope,c.state==='complete'?'succeeded':'partial']));
   for(const [scope,c] of coverage)if(c.state==='complete')this.resolveAlert(journal,scope,'job-failed');
  }catch(error){
   const code=error instanceof BackupError?error.code:'repository_failed';
   const uncertain=['repository_busy','operation_uncertain'].includes(code)&&reconciling;
   attempt.state=uncertain?'uncertain':'failed';run.state=attempt.state;attempt.errorCode=code;
   run.scopeStates=Object.fromEntries([...coverage.keys()].map(scope=>[scope,attempt.state]));
   for(const scope of coverage.keys())this.observeAlert(journal,scope,'job-failed',uncertain?'Backup write state is being reconciled':'Scheduled backup failed; earlier recovery points retained');
  }
  if(run.state!=='uncertain'){attempt.finishedAt=this.time();run.finishedAt=this.time();}
  await this.save(journal);
 }
 private async coverage(scope:string,stored=true):Promise<Coverage>{
  const result:Coverage={state:'complete',unprotected:[],stale:[],excluded:[],points:[]};
  let inventory:{schema:number;scope:string;observedAt:string;tasks:BackupInventoryTask[]};
  try{inventory=await json(join(this.root,'inventory',inventoryName(scope)));if(inventory.schema!==1||inventory.scope!==scope||!Array.isArray(inventory.tasks)||!Number.isFinite(Date.parse(inventory.observedAt)))throw Error();}catch{return {...result,state:'unknown'};}
  this.options.coordinator.refreshStatusInventory();
  const saved=stored?(await this.options.repository.status(scope)).points:[];
  for(const task of inventory.tasks){
   if(!['pi','codex'].includes(task.engine)){result.excluded.push(task);continue;}
   const status=stored?saved.find(p=>p.taskId===task.taskId&&p.engine===task.engine):await this.options.coordinator.status(scope,task.taskId,task.engine);
   if(!status?.checkpointId||!status.captureAt||('coverage' in status&&status.coverage!=='complete')){result.unprotected.push(task.taskId);continue;}
   result.points.push({taskId:task.taskId,captureAt:status.captureAt,checkpointId:status.checkpointId});if(status.stale)result.stale.push(task.taskId);
  }
  result.state=result.unprotected.length?'partial':result.stale.length?'stale':'complete';return result;
 }
 private updateCoverageAlerts(journal:Journal,coverage:Map<string,Coverage>){for(const [scope,c] of coverage){for(const [kind,active,message] of [['inventory-unavailable',c.state==='unknown','Task inventory is unavailable; coverage cannot be established'],['unprotected',c.unprotected.length>0,'Some Pi/Codex tasks have no complete checkpoint'],['point-stale',c.stale.length>0,'Required checkpoint age exceeds 24 hours']] as const){if(active)this.observeAlert(journal,scope,kind,message);else this.resolveAlert(journal,scope,kind);}}}
 private observeAlert(journal:Journal,scope:string,kind:Alert['kind'],message:string){const old=journal.alerts.find(a=>a.scope===scope&&a.kind===kind&&!a.resolvedAt);if(old){old.lastObservedAt=this.time();old.occurrences++;return;}journal.alerts.push({id:randomUUID(),scope,kind,message,openedAt:this.time(),lastObservedAt:this.time(),occurrences:1});}
 private resolveAlert(journal:Journal,scope:string,kind:Alert['kind']){const old=journal.alerts.find(a=>a.scope===scope&&a.kind===kind&&!a.resolvedAt);if(old)old.resolvedAt=this.time();}
 private async policy():Promise<Policy|undefined>{try{return await json(join(this.root,'policy.json'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
 private async journal():Promise<Journal>{try{const value=await json(join(this.root,'state.json'));if(value.schema!==1||!Array.isArray(value.runs)||!Array.isArray(value.alerts))throw Error('Invalid schedule journal');return value;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {schema:1,runs:[],alerts:[]};throw error;}}
 private async save(journal:Journal){if(journal.runs.length>4096||journal.alerts.length>16384)throw new BackupError('schedule_capacity','Schedule journal requires administrative archival');await atomic(this.root,'state.json',journal);}
 private time(){return new Date(this.now()).toISOString();}
 private async locked<T>(run:()=>Promise<T>):Promise<T>{
  const path=join(this.root,'runner-lock');let reclaim=false;
  try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;reclaim=true;}
  if(reclaim){
   const before=await checkedDirectory(path),owner=await json(join(path,'owner.json'));
   if(!Number.isSafeInteger(owner.pid)||typeof owner.identity!=='string'||typeof owner.nonce!=='string'||await identity(owner.pid)!==undefined)throw new BackupError('schedule_busy','Another schedule worker is active or unknown');
   const after=await checkedDirectory(path),current=await json(join(path,'owner.json'));if(after.ino!==before.ino||after.dev!==before.dev||current.nonce!==owner.nonce)throw new BackupError('schedule_busy','Schedule lease changed');
   const retired=join(this.root,'retired-'+owner.nonce);await rename(path,retired);await mkdir(path,{mode:0o700});await rm(retired,{recursive:true});
  }
  const nonce=randomUUID();await atomic(path,'owner.json',{pid:process.pid,identity:await identity(process.pid),nonce});
  try{return await run();}finally{const owner=await json(join(path,'owner.json'));if(owner.nonce!==nonce)throw new BackupError('schedule_busy','Schedule lease changed');await rm(path,{recursive:true});await sync(this.root);}
 }
}
function localTime(now:number,timeZone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),get=(name:string)=>parts.find(p=>p.type===name)!.value;return {date:get('year')+'-'+get('month')+'-'+get('day'),minutes:Number(get('hour'))*60+Number(get('minute'))};}
function previousDate(date:string){return new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);}
function inventoryName(scope:string){return createHash('sha256').update(scope).digest('hex')+'.json';}
function operationId(value:string){const h=createHash('sha256').update(value).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);}
async function checkedDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path)||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw new BackupError('schedule_unavailable','Schedule storage unavailable');return info;}
async function json(path:string):Promise<any>{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)!==0||info.uid!==process.getuid?.()||info.size>32*1024*1024)throw new BackupError('schedule_unavailable','Schedule record unavailable');return JSON.parse(await readFile(path,'utf8'));}
async function atomic(dir:string,name:string,value:unknown){const temp=join(dir,randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}await rename(temp,join(dir,name));await sync(dir);}
async function sync(path:string){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function identity(pid:number):Promise<string|undefined>{try{const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),stat=await readFile('/proc/'+pid+'/stat','utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');if(fields[0]==='Z'||fields[0]==='X')return undefined;return boot+':'+fields[19];}catch{try{process.kill(pid,0);return 'unknown';}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return undefined;return 'unknown';}}}
