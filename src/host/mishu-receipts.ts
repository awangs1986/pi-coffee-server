import {DatabaseSync} from 'node:sqlite';
import {appendFile,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

/**
 * Receipt rotation. state.json keeps at most `live` receipts per secretary;
 * older terminal receipts move to an append-only archive whose idempotency
 * index keeps messageId → fingerprint, so an archived messageId is never
 * delivered again. Archive first, then shrink state: a crash in between only
 * duplicates an archive line, which the index ignores.
 */
export const RECEIPT_LIMITS={live:500,keep:400,assignmentsLive:500,assignmentsKeep:400,indexEntries:20000,indexMs:30*24*3600*1000};
const TERMINAL=['settled','cancelled','uncertain'];
export interface ArchivedReceipt {messageId:string;targetId:string;fingerprint:string;requestId:string;state:string;kind:string;createdAt:string;archivedAt:string;result?:string;truncated?:boolean;error?:string}
interface RotatableReceipt {messageId:string;requestId:string;state:string;createdAt:string}
interface RotatableAssignment {id:string;taskId:string;requestId:string;state:string}

/** Terminal receipts to archive (oldest first) when live receipts reach the limit. */
export function receiptsToRotate<T extends RotatableReceipt>(messages:T[],protectedRequestIds:Set<string>,limits=RECEIPT_LIMITS):T[]{
 if(messages.length<limits.live)return [];
 const excess=messages.length-limits.keep;
 return messages.filter(m=>TERMINAL.includes(m.state)&&!protectedRequestIds.has(m.requestId)).slice(0,excess);
}
/** Terminal assignments that no task references and that are not the latest per task. */
export function assignmentsToRotate<T extends RotatableAssignment>(assignments:T[],referenced:Set<string>,limits=RECEIPT_LIMITS):T[]{
 if(assignments.length<limits.assignmentsLive)return [];
 const latest=new Map<string,string>();for(const a of assignments)latest.set(a.taskId,a.id);
 const excess=assignments.length-limits.assignmentsKeep;
 return assignments.filter(a=>TERMINAL.includes(a.state)&&!referenced.has(a.id)&&latest.get(a.taskId)!==a.id).slice(0,excess);
}

export class ReceiptArchive {
 private db?:DatabaseSync;
 private async database(){
  if(!this.db){await mkdir(this.root,{recursive:true,mode:0o700});this.db=new DatabaseSync(join(this.root,'identities.sqlite'));this.db.exec('CREATE TABLE IF NOT EXISTS identities (chat TEXT NOT NULL, message TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(chat,message))');}
  return this.db;
 }
 private async remember(chatId:string,receipts:ArchivedReceipt[]){
  const db=await this.database(),insert=db.prepare('INSERT OR IGNORE INTO identities VALUES (?,?,?)');
  db.exec('BEGIN');try{for(const {result:_,error:__,truncated:___,...identity} of receipts)insert.run(chatId,identity.messageId,JSON.stringify(identity));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
 }
 private indexes=new Map<string,Map<string,ArchivedReceipt>>();
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private root:string,private now:()=>number=Date.now,private limits=RECEIPT_LIMITS){}
 private file(chatId:string,kind:'receipts'|'assignments'){return join(this.root,`${kind}-${chatId}.jsonl`);}
 private async index(chatId:string){
  let index=this.indexes.get(chatId);if(index)return index;
  index=new Map();
  const text=await readFile(this.file(chatId,'receipts'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  const complete=text.endsWith('\n')?text:text.slice(0,text.lastIndexOf('\n')+1);
  for(const line of complete.split('\n')){if(!line)continue;const r=JSON.parse(line) as ArchivedReceipt;if(typeof r.messageId!=='string'||typeof r.fingerprint!=='string')throw Error('Invalid receipt archive; original evidence preserved');index.set(r.messageId,r);}
  if(complete!==text){
   const file=this.file(chatId,'receipts');await writeFile(file+'.torn-'+Date.now(),text,{mode:0o600,flag:'wx',flush:true});await writeFile(file+'.tmp',complete,{mode:0o600,flush:true});await rename(file+'.tmp',file);
  }
  await this.remember(chatId,[...index.values()]);
  this.indexes.set(chatId,index);return index;
 }
 private serial<T>(work:()=>Promise<T>){const next=this.tail.then(work);this.tail=next.catch(()=>undefined);return next;}
 archive(chatId:string,receipts:Omit<ArchivedReceipt,'archivedAt'>[]){return this.serial(async()=>{
  if(!receipts.length)return;
  await mkdir(this.root,{recursive:true,mode:0o700});
  const index=await this.index(chatId),archivedAt=new Date(this.now()).toISOString();
  const fresh=receipts.filter(r=>!index.has(r.messageId)).map(r=>({...r,archivedAt}));
  if(fresh.length)await appendFile(this.file(chatId,'receipts'),fresh.map(r=>JSON.stringify(r)).join('\n')+'\n',{mode:0o600,flush:true});
  await this.remember(chatId,fresh);
  for(const r of fresh)index.set(r.messageId,r);
  await this.compact(chatId,index);
 });}
 archiveAssignments(chatId:string,assignments:object[]){return this.serial(async()=>{
  if(!assignments.length)return;
  await mkdir(this.root,{recursive:true,mode:0o700});
  await appendFile(this.file(chatId,'assignments'),assignments.map(a=>JSON.stringify(a)).join('\n')+'\n',{mode:0o600,flush:true});
 });}
 private async compact(chatId:string,index:Map<string,ArchivedReceipt>){
  const cutoff=this.now()-this.limits.indexMs;
  const kept=[...index.values()].filter(r=>Date.parse(r.archivedAt)>=cutoff).slice(-this.limits.indexEntries);
  if(kept.length===index.size)return;
  const file=this.file(chatId,'receipts'),temp=file+'.tmp';
  await writeFile(temp,kept.map(r=>JSON.stringify(r)).join('\n')+(kept.length?'\n':''),{mode:0o600,flush:true});await rename(temp,file);
  index.clear();for(const r of kept)index.set(r.messageId,r);
 }
 lookup(chatId:string,messageId:string){return this.serial(async()=>{const live=(await this.index(chatId)).get(messageId);if(live)return live;const row=(await this.database()).prepare('SELECT receipt FROM identities WHERE chat=? AND message=?').get(chatId,messageId);return row?JSON.parse(String(row.receipt)) as ArchivedReceipt:undefined;});}
 async close(){await this.tail;this.db?.close();this.db=undefined;}
 async size(chatId:string){return this.serial(async()=>(await this.index(chatId)).size);}
 forget(chatId:string){this.indexes.delete(chatId);}
}
