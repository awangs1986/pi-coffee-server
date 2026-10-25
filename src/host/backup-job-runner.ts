import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,lstat,realpath,readFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {BackupCoordinator,BackupError,LEGACY_BACKUP_SCOPE} from './backup.js';
import {BackupRepository,type RepositoryJob,type BackupSelection} from './backup-repository.js';
import {normalizeUsername} from '../shared/identity.js';
import type {AgentEngine} from '../shared/protocol.js';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';

export interface BackupInventoryTask {taskId:string;engine:AgentEngine;archived?:boolean;}
export interface BackupInventoryConnection {url:string;tokenFile:string;actor:string;}
interface Policy {schema:1;revision:string;scopes:string[];timeZone:string;hour:number;minute:number;startDate:string;host?:BackupInventoryConnection;}
interface Coverage {state:'complete'|'partial'|'stale'|'unknown';inventoryAvailable:boolean;repositoryAvailable:boolean;unprotected:string[];stale:string[];excluded:BackupInventoryTask[];points:{taskId:string;captureAt:string;checkpointId:string}[];}
interface Attempt {number:number;id:string;startedAt:string;finishedAt?:string;state:'running'|'succeeded'|'partial'|'failed'|'uncertain';errorCode?:string;scopeStates?:Record<string,Attempt['state']>;}
interface ScheduledRun {id:string;date:string;revision:string;scopes?:string[];startedAt:string;finishedAt?:string;state:Attempt['state'];attempts:Attempt[];scopeStates?:Record<string,Attempt['state']>;}
interface Alert {id:string;scope:string;kind:'job-failed'|'point-stale'|'unprotected'|'inventory-unavailable'|'repository-unavailable';openedAt:string;lastObservedAt:string;resolvedAt?:string;occurrences:number;message:string;}
interface Journal {schema:1;lastCheckedAt?:string;runs:ScheduledRun[];alerts:Alert[];}
const validScope=(v:string)=>v===LEGACY_BACKUP_SCOPE||normalizeUsername(v)===v;
const taskId=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const engines=new Set(['pi','codex','claude','cursor','grok']);

/** Independent scheduled-job seam. Inventories are Host-owned publications, not
 * discovered native directories or a list of whichever points happen to exist. */
export class BackupJobRunner {
 readonly root:string;private now:()=>number;private lease?:FileLease;
 constructor(private options:{root:string;repository:Pick<BackupRepository,'backup'|'jobs'|'status'|'recoverInterruptedOperation'>;coordinator:Pick<BackupCoordinator,'status'|'refreshStatusInventory'>;now?:()=>number}){this.root=resolve(options.root);this.now=options.now??Date.now;}
 private async initialize(){await mkdir(this.root,{recursive:true,mode:0o700});await checkedDirectory(this.root);await mkdir(join(this.root,'inventory'),{recursive:true,mode:0o700});await checkedDirectory(join(this.root,'inventory'));}
 async configure(input:{revision:string;scopes:string[];timeZone?:string;hour?:number;minute?:number;host?:BackupInventoryConnection}):Promise<void>{
  await this.initialize();const timeZone=input.timeZone??'America/Toronto',hour=input.hour??4,minute=input.minute??0;
  if(typeof input.revision!=='string'||!/^[a-zA-Z0-9_-]{1,64}$/.test(input.revision)||!Array.isArray(input.scopes)||!input.scopes.length||input.scopes.length>256||new Set(input.scopes).size!==input.scopes.length||input.scopes.some(s=>typeof s!=='string'||!validScope(s))||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw new BackupError('invalid_schedule','Invalid backup schedule');
  const startDate=localTime(this.now(),timeZone).date;
  if(input.host){const url=new URL(input.host.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!input.host.tokenFile.startsWith('/')||normalizeUsername(input.host.actor)!==input.host.actor)throw new BackupError('invalid_schedule','Invalid trusted inventory connection');}
  await this.locked(async()=>{
   const old=await this.policy();
   const policy:Policy={schema:1,revision:input.revision,scopes:[...input.scopes].sort(),timeZone,hour,minute,startDate,...(input.host?{host:input.host}:{})};
   if(old?.revision===policy.revision){if(JSON.stringify({...old,startDate:''})!==JSON.stringify({...policy,startDate:''}))throw new BackupError('schedule_revision_conflict','Use a new revision for schedule changes');return;}
   await atomic(this.root,'policy.json',policy);
  });
 }
 /** Trusted Host/CLI publication. Ordinary Browser callers cannot supply this. */
 async updateInventory(scope:string,tasks:BackupInventoryTask[]):Promise<void>{
  await this.initialize();const policy=await this.policy();
  if(!policy?.scopes.includes(scope)||!Array.isArray(tasks)||tasks.length>100000||new Set(tasks.map(t=>t.taskId)).size!==tasks.length||tasks.some(t=>!taskId.test(t.taskId)||!engines.has(t.engine)))throw new BackupError('invalid_inventory','Backup inventory is outside the configured scope');
  await atomic(join(this.root,'inventory'),inventoryName(scope),{schema:1,scope,observedAt:this.time(),source:'publication',available:true,tasks:tasks.map(({taskId,engine,archived})=>({taskId,engine,...(archived===undefined?{}:{archived})}))});
 }
 async status(scope:string){
  await this.initialize();const policy=await this.policy();if(!validScope(scope))throw new BackupError('invalid_scope','Backup schedule scope unavailable');
  if(policy&&!policy.scopes.includes(scope))return {schemaVersion:1,configured:false,lastCheckedAt:null,workerState:'not-observed',schedule:null,coverage:{state:'unknown',inventoryAvailable:false,repositoryAvailable:false,unprotected:[],stale:[],excluded:[],points:[]},runs:[],alerts:[],excludedEngines:['claude','cursor','grok']};
  const journal=await this.journal();const coverage=await this.coverage(scope);
  return {schemaVersion:1,configured:Boolean(policy),lastCheckedAt:journal.lastCheckedAt??null,workerState:!journal.lastCheckedAt?'not-observed':this.now()-Date.parse(journal.lastCheckedAt)>120000?'overdue':'recent',schedule:policy?{revision:policy.revision,timeZone:policy.timeZone,hour:policy.hour,minute:policy.minute}:null,coverage,
   runs:journal.runs.filter(run=>!run.scopes||run.scopes.includes(scope)).slice().reverse().slice(0,30).map(({id,date,revision,startedAt,finishedAt,state,attempts,scopeStates})=>({id,date,revision,startedAt,finishedAt,state:scopeStates?.[scope]??state,attempts:attempts.map(({scopeStates:states,...a})=>({...a,state:states?.[scope]??a.state}))})),alerts:journal.alerts.filter(a=>a.scope===scope).map(a=>({...a})),excludedEngines:['claude','cursor','grok']};
 }
 async tick():Promise<{dispatched:boolean;run?:ScheduledRun}>{
  await this.initialize();return this.locked(async()=>{
   const policy=await this.policy();if(!policy)return {dispatched:false};
   const journal=await this.journal(),now=this.now();journal.lastCheckedAt=this.time();
   if(policy.host)for(const scope of policy.scopes)await this.refreshHostInventory(policy.host,scope);
   const coverage=new Map<string,Coverage>();for(const scope of policy.scopes)coverage.set(scope,await this.coverage(scope,true,true));
   this.updateCoverageAlerts(journal,coverage);
   // A persisted in-flight attempt always reconciles before considering a new date.
   const pending=journal.runs.find(r=>r.state==='running'||r.state==='uncertain');
   if(pending){const pendingCoverage=new Map<string,Coverage>();for(const scope of pending.scopes??policy.scopes)pendingCoverage.set(scope,await this.coverage(scope,true,true));await this.execute(journal,pending,pendingCoverage,true);return {dispatched:false,run:pending};}
   const local=localTime(now,policy.timeZone),date=local.minutes>=policy.hour*60+policy.minute?local.date:previousDate(local.date);
   if(date<policy.startDate){await this.save(journal);return {dispatched:false};}
   const id=policy.revision+':'+date;let run=journal.runs.find(r=>r.id===id);
   if(run){
    if(run.state==='succeeded'||run.attempts.length>=3){await this.save(journal);return {dispatched:false};}
    const offset=run.attempts.length===1?15*60000:60*60000;
    if(now<Date.parse(run.startedAt)+offset){await this.save(journal);return {dispatched:false};}
   }else{
    run={id,date,revision:policy.revision,scopes:[...policy.scopes],startedAt:this.time(),state:'running',attempts:[]};journal.runs.push(run);
   }
   const number=run.attempts.length+1,attempt:Attempt={number,id:operationId(run.id+':'+number),startedAt:this.time(),state:'running'};
   run.attempts.push(attempt);run.state='running';delete run.finishedAt;await this.save(journal);
   await this.execute(journal,run,coverage,false);return {dispatched:true,run};
  });
 }
 private async execute(journal:Journal,run:ScheduledRun,coverage:Map<string,Coverage>,reconciling:boolean){
  const attempt=run.attempts.at(-1)!;let job:RepositoryJob|undefined,submitted=false;
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
    submitted=true;job=await this.options.repository.backup(selection,undefined,attempt.id);
   }
   for(const scope of coverage.keys())coverage.set(scope,await this.coverage(scope,true,true));
   this.updateCoverageAlerts(journal,coverage);
   const complete=[...coverage.values()].every(c=>c.state==='complete');
   attempt.state=complete?'succeeded':'partial';run.state=attempt.state;
   run.scopeStates=Object.fromEntries([...coverage].map(([scope,c])=>[scope,c.state==='complete'?'succeeded':'partial']));
   for(const [scope,c] of coverage)if(c.state==='complete')this.resolveAlert(journal,scope,'job-failed');
  }catch(error){
   const code=error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&/^[a-z_]{1,64}$/.test(error.code)?error.code:'repository_failed';
   const uncertain=['repository_busy','operation_uncertain','broker_timeout','transport_unavailable','invalid_response'].includes(code)||(!(error instanceof BackupError)&&(submitted||reconciling));
   attempt.state=uncertain?'uncertain':'failed';run.state=attempt.state;attempt.errorCode=code;
   run.scopeStates=Object.fromEntries([...coverage.keys()].map(scope=>[scope,attempt.state]));
   for(const scope of coverage.keys())this.observeAlert(journal,scope,'job-failed',uncertain?'Backup write state is being reconciled':'Scheduled backup failed; earlier recovery points retained');
  }
  attempt.scopeStates={...run.scopeStates};
  if(run.state!=='uncertain'){attempt.finishedAt=this.time();run.finishedAt=this.time();}
  await this.save(journal);
 }
 private async coverage(scope:string,stored=true,persist=false):Promise<Coverage>{
  const result:Coverage={state:'complete',inventoryAvailable:false,repositoryAvailable:false,unprotected:[],stale:[],excluded:[],points:[]};
  let inventory:{schema:number;scope:string;observedAt:string;tasks:BackupInventoryTask[];source?:string;available?:boolean};
  try{inventory=await json(join(this.root,'inventory',inventoryName(scope)));if(inventory.schema!==1||inventory.scope!==scope||!Array.isArray(inventory.tasks)||!Number.isFinite(Date.parse(inventory.observedAt)))throw Error();}catch{return {...result,state:'unknown'};}
  this.options.coordinator.refreshStatusInventory();
  const saved=stored?await this.repositoryPoints(scope,persist):{available:true,points:[]};result.repositoryAvailable=saved.available;
  for(const task of inventory.tasks){
   if(!['pi','codex'].includes(task.engine)){result.excluded.push(task);continue;}
   const status=stored?saved.points.find(p=>p.taskId===task.taskId&&p.engine===task.engine):await this.options.coordinator.status(scope,task.taskId,task.engine);
   if(!status?.checkpointId||!status.captureAt||('coverage' in status&&status.coverage!=='complete')){result.unprotected.push(task.taskId);continue;}
   result.points.push({taskId:task.taskId,captureAt:status.captureAt,checkpointId:status.checkpointId});if(this.now()-Date.parse(status.captureAt)>86400000)result.stale.push(task.taskId);
  }
  result.inventoryAvailable=inventory.available===true&&inventory.source==='authenticated-host';
  result.state=result.unprotected.length?'partial':!result.repositoryAvailable||!result.inventoryAvailable?'unknown':result.stale.length?'stale':'complete';return result;
 }
 private async repositoryPoints(scope:string,persist:boolean){
  const name='saved-'+inventoryName(scope);type Point=Awaited<ReturnType<BackupRepository['status']>>['points'][number];
  let cached:Point[]=[];try{const value=await json(join(this.root,'inventory',name));if(value.schema===1&&value.scope===scope&&Array.isArray(value.points))cached=value.points;}catch{/* Only confirmed bounded metadata may survive outages. */}
  try{
   const status=await this.options.repository.status(scope);
   if(!status.configured||!status.enabled)return {available:false,points:cached};
   const points=new Map<string,Point>();
   for(const point of status.points){if(point.scope!==scope||!taskId.test(point.taskId)||!['pi','codex'].includes(point.engine)||!Number.isFinite(Date.parse(point.captureAt)))throw Error('Invalid saved recovery point');const previous=points.get(point.taskId);if(!previous||point.captureAt>previous.captureAt)points.set(point.taskId,point);}
   const merged=[...points.values()];if(persist)await atomic(join(this.root,'inventory'),name,{schema:1,scope,points:merged});
   return {available:true,points:merged};
  }catch{return {available:false,points:cached};}
 }
 private async refreshHostInventory(connection:BackupInventoryConnection,scope:string){
  const file=join(this.root,'inventory',inventoryName(scope));
  try{
   const info=await lstat(connection.tokenFile);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)!==0||info.size>8192)throw Error('Unavailable inventory credential');
   const token=(await readFile(connection.tokenFile,'utf8')).trim();if(!token||/[\r\n]/.test(token))throw Error('Unavailable inventory credential');
   const response=await fetch(new URL('/api/backup',connection.url),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-pi-coffee-actor':connection.actor,...(scope===LEGACY_BACKUP_SCOPE?{}:{'x-pi-coffee-user':scope})},body:JSON.stringify({action:'status',scope}),signal:AbortSignal.timeout(5000),redirect:'error'});
   if(!response.ok||Number(response.headers.get('content-length'))>32*1024*1024)throw Error('Inventory unavailable');
   const reader=response.body!.getReader();let bytes=0;const chunks:Uint8Array[]=[];for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>32*1024*1024){await reader.cancel();throw Error('Inventory exceeds limit');}chunks.push(part.value);}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.schemaVersion!==1||data.scope!==scope||!Array.isArray(data.tasks))throw Error('Inventory identity mismatch');
   await this.updateInventory(scope,data.tasks.map((t:BackupInventoryTask)=>({taskId:t.taskId,engine:t.engine})));
   const inventory=await json(file);await atomic(join(this.root,'inventory'),inventoryName(scope),{...inventory,source:'authenticated-host',available:true});
  }catch{
   let old;try{old=await json(file);}catch{old={schema:1,scope,observedAt:this.time(),tasks:[]};}
   await atomic(join(this.root,'inventory'),inventoryName(scope),{...old,available:false});
  }
 }
 private updateCoverageAlerts(journal:Journal,coverage:Map<string,Coverage>){for(const [scope,c] of coverage){for(const [kind,active,message] of [['repository-unavailable',!c.repositoryAvailable,'Repository service is unavailable; saved recovery point metadata is from the last confirmed check'],['inventory-unavailable',!c.inventoryAvailable,'Task inventory is unavailable; coverage cannot be established'],['unprotected',c.unprotected.length>0,'Some Pi/Codex tasks have no complete checkpoint'],['point-stale',c.stale.length>0,'Required checkpoint age exceeds 24 hours']] as const){if(active)this.observeAlert(journal,scope,kind,message);else this.resolveAlert(journal,scope,kind);}}}
 private observeAlert(journal:Journal,scope:string,kind:Alert['kind'],message:string){const old=journal.alerts.find(a=>a.scope===scope&&a.kind===kind&&!a.resolvedAt);if(old){old.lastObservedAt=this.time();old.occurrences++;return;}journal.alerts.push({id:randomUUID(),scope,kind,message,openedAt:this.time(),lastObservedAt:this.time(),occurrences:1});}
 private resolveAlert(journal:Journal,scope:string,kind:Alert['kind']){const old=journal.alerts.find(a=>a.scope===scope&&a.kind===kind&&!a.resolvedAt);if(old)old.resolvedAt=this.time();}
 private async policy():Promise<Policy|undefined>{try{return await json(join(this.root,'policy.json'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
 private async journal():Promise<Journal>{try{const value=await json(join(this.root,'state.json'));if(value.schema!==1||!Array.isArray(value.runs)||!Array.isArray(value.alerts))throw Error('Invalid schedule journal');return value;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {schema:1,runs:[],alerts:[]};throw error;}}
 private async save(journal:Journal){this.lease?.assertHeld();if(journal.runs.length>4096||journal.alerts.length>16384)throw new BackupError('schedule_capacity','Schedule journal requires administrative archival');await atomic(this.root,'state.json',journal,()=>this.lease!.assertHeld());}
 private time(){return new Date(this.now()).toISOString();}
 private async locked<T>(run:()=>Promise<T>):Promise<T>{
  const lease=acquireFileLease(join(this.root,'runner.lock'),'exclusive');if(!lease)throw new BackupError('schedule_busy','Another schedule worker owns the kernel lease');this.lease=lease;
  try{await atomic(this.root,'owner.json',{pid:process.pid,identity:await identity(process.pid),nonce:randomUUID()},()=>lease.assertHeld());return await run();}finally{this.lease=undefined;lease.release();}
 }
}
function localTime(now:number,timeZone:string){const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),get=(name:string)=>parts.find(p=>p.type===name)!.value;return {date:get('year')+'-'+get('month')+'-'+get('day'),minutes:Number(get('hour'))*60+Number(get('minute'))};}
function previousDate(date:string){return new Date(Date.parse(date+'T12:00:00Z')-86400000).toISOString().slice(0,10);}
function inventoryName(scope:string){return createHash('sha256').update(scope).digest('hex')+'.json';}
function operationId(value:string){const h=createHash('sha256').update(value).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32);}
async function checkedDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(path)!==resolve(path)||info.uid!==process.getuid?.()||(info.mode&0o077)!==0)throw new BackupError('schedule_unavailable','Schedule storage unavailable');return info;}
async function json(path:string):Promise<any>{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||(info.mode&0o077)!==0||info.uid!==process.getuid?.()||info.size>32*1024*1024)throw new BackupError('schedule_unavailable','Schedule record unavailable');return JSON.parse(await readFile(path,'utf8'));}
async function atomic(dir:string,name:string,value:unknown,assert=()=>{}){const temp=join(dir,randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}assert();await rename(temp,join(dir,name));await sync(dir);}
async function sync(path:string){const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}}
async function identity(pid:number):Promise<string|undefined>{try{const boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),stat=await readFile('/proc/'+pid+'/stat','utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');if(fields[0]==='Z'||fields[0]==='X')return undefined;return boot+':'+fields[19];}catch{try{process.kill(pid,0);return 'unknown';}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return undefined;return 'unknown';}}}
