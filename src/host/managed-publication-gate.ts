import {AsyncLocalStorage} from 'node:async_hooks';
import {constants,closeSync,existsSync,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BackupError} from './backup.js';
import {restorePlanDigest,type RestorePlan} from './restore.js';

interface Intent {operationId:string;revision:number;digest:string;}
interface GateRecord {schema:1;groupId:string;pending:Intent[];}
const refused=()=>new BackupError('writers_active','Managed source group has an unreconciled publication');
const same=(a:Intent,b:Intent)=>a.operationId===b.operationId&&a.revision===b.revision&&a.digest===b.digest;
const uuid=/^[0-9a-f-]{36}$/;
function directory(path:string,create=false){if(create)mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==process.getuid?.()||(stat.mode&0o077)||realpathSync(path)!==resolve(path))throw refused();return stat;}
function json(path:string):unknown{const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)||stat.size>32*1024*1024||realpathSync(path)!==resolve(path))throw refused();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const opened=fstatSync(fd);if(opened.dev!==stat.dev||opened.ino!==stat.ino)throw refused();return JSON.parse(readFileSync(fd,'utf8'));}finally{closeSync(fd);}}
function approved(plan:RestorePlan):Intent{if(plan.schemaVersion!==1||!uuid.test(plan.id)||!Number.isSafeInteger(plan.revision)||plan.revision<1||!plan.plan||!plan.approvedBy||plan.approvedRevision!==plan.revision||plan.digest!==restorePlanDigest(plan)||plan.approvalDigest!==plan.digest)throw refused();return {operationId:plan.id,revision:plan.revision,digest:plan.digest!};}
function pending(plan:RestorePlan){return plan.phase!=='complete'&&((plan as RestorePlan&{publicationAttempted?:boolean}).publicationAttempted===true||plan.state==='publishing'||['task','native','registry'].includes(plan.phase)||plan.state==='failed'&&!!plan.approvedBy);}

/** An irreversible native import outlives kernel flock and Host processes. The
 * durable approved job remains a group-wide admission fence until its actual
 * durable completion. It never treats a receipt/hash alone as native adoption. */
export class ManagedPublicationGate {
 private readonly context=new AsyncLocalStorage<{intent:Intent;active:boolean}>();private busy=false;private initialized=false;private readonly parentIdentity:{dev:number;ino:number};
 constructor(private options:{path:string;groupId:string;restoreRoot:string}){if(resolve(options.path)!==options.path||resolve(options.restoreRoot)!==options.restoreRoot||!options.groupId)throw refused();const parent=directory(dirname(options.path),true);this.parentIdentity={dev:parent.dev,ino:parent.ino};directory(options.restoreRoot,true);this.reconcile();this.initialized=true;}
 private checkParent(){const current=directory(dirname(this.options.path));if(current.dev!==this.parentIdentity.dev||current.ino!==this.parentIdentity.ino)throw refused();directory(this.options.restoreRoot);}
 private readPlan(id:string){if(!uuid.test(id))throw refused();const plan=json(join(this.options.restoreRoot,id+'.json')) as RestorePlan;if(plan.id!==id)throw refused();return plan;}
 private record():GateRecord{this.checkParent();if(!existsSync(this.options.path)){if(this.initialized)throw refused();return {schema:1,groupId:this.options.groupId,pending:[]};}const value=json(this.options.path) as GateRecord;if(value.schema!==1||value.groupId!==this.options.groupId||!Array.isArray(value.pending)||value.pending.length>4096||new Set(value.pending.map(item=>item.operationId)).size!==value.pending.length||value.pending.some(item=>!uuid.test(item.operationId)||!Number.isSafeInteger(item.revision)||item.revision<1||!/^[0-9a-f]{64}$/.test(item.digest)))throw refused();return value;}
 private save(record:GateRecord){this.checkParent();const temporary=join(dirname(this.options.path),'.publication-'+randomUUID()),fd=openSync(temporary,'wx',0o600);try{writeFileSync(fd,JSON.stringify(record));fsyncSync(fd);}finally{closeSync(fd);}try{renameSync(temporary,this.options.path);const parent=openSync(dirname(this.options.path),constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(parent);}finally{closeSync(parent);}}finally{try{unlinkSync(temporary);}catch{}}}
 private reconcile(){const record=this.record(),previous=JSON.stringify(record),intents=new Map(record.pending.map(intent=>[intent.operationId,intent]));const names=readdirSync(this.options.restoreRoot).filter(name=>uuid.test(name.slice(0,-5))&&name.endsWith('.json'));if(names.length>4096)throw refused();
  // Scan the trusted job intents on every restart, even if a gate file was lost.
  for(const name of names){const plan=this.readPlan(name.slice(0,-5));if(pending(plan)){const intent=approved(plan),existing=intents.get(plan.id);if(existing&&!same(existing,intent))throw refused();intents.set(plan.id,intent);}}
  for(const [id,intent]of intents){const plan=this.readPlan(id);if(!same(intent,approved(plan)))throw refused();if(plan.phase==='complete'&&['completed','completed-after-cancel'].includes(plan.state))intents.delete(id);}
  record.pending=[...intents.values()].sort((a,b)=>a.operationId.localeCompare(b.operationId));if(JSON.stringify(record)!==previous||!existsSync(this.options.path))this.save(record);return record;
 }
 /** All platform writes and native start/read/resume adoption use this gate. */
 assertAdmission(){if(this.record().pending.length)throw refused();}
 hasPending(){return this.record().pending.length>0;}
 assertApprovedOperation(operationId:string,digest:string){const context=this.context.getStore();if(!context?.active||context.intent.operationId!==operationId||context.intent.digest!==digest)throw refused();this.assertPublication();}
 assertPublication(){const record=this.record();if(!record.pending.length)return;const context=this.context.getStore();if(!context?.active||record.pending.length!==1||!same(record.pending[0],context.intent))throw refused();}
 async withApprovedPublication<T>(operationId:string,run:()=>Promise<T>):Promise<T>{if(this.busy)throw refused();this.busy=true;try{const record=this.reconcile(),plan=this.readPlan(operationId),intent=approved(plan);if(!['approved','publishing','failed','completed','completed-after-cancel'].includes(plan.state)||record.pending.some(item=>!same(item,intent)))throw refused();if(!record.pending.length){record.pending=[intent];this.save(record);}const context={intent,active:true};try{return await this.context.run(context,run);}finally{context.active=false;this.reconcile();}}finally{this.busy=false;}}
}
