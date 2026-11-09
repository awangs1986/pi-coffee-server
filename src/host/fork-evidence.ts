import {createHash,randomUUID} from 'node:crypto';
import {open,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {AgentHistory} from './agent-adapter.js';
import {checkedTaskRoot} from './task-storage.js';
import {checkPreparation} from './preparation-execution.js';
import {syncDir} from './restore-files.js';

/** Per-operation ceilings, not preallocated buffers or model-context budgets. */
export const FORK_EVIDENCE_MAX_BYTES=256*1024*1024;
export const FORK_NATIVE_PAGE_BYTES=32*1024*1024;
export const FORK_NATIVE_PAGE_TURNS=20;
export function assertForkEvidenceBudget(bytes:number){
 if(bytes>FORK_EVIDENCE_MAX_BYTES)throw Error('Fork source exceeds its 256 MiB evidence budget; original history is retained');
}

/** Canonical JSON in bounded entry-sized pieces; no second whole-history string. */
function* historyParts(history:AgentHistory):Generator<string>{
 if(!history||!Array.isArray(history.entries)||(history.leafId!==null&&typeof history.leafId!=='string')||Object.keys(history).length!==2||Object.keys(history).some(key=>key!=='entries'&&key!=='leafId'))throw Error('Invalid Fork evidence shape; snapshot cannot be verified');
 yield '{"entries":[';
 for(let i=0;i<history.entries.length;i++){
  checkPreparation();if(i)yield ',';yield JSON.stringify(history.entries[i]);
 }
 yield '],"leafId":'+JSON.stringify(history.leafId)+'}';
}
export function forkHistoryReceipt(history:AgentHistory){
 const hash=createHash('sha256');let bytes=0;
 for(const part of historyParts(history)){bytes+=Buffer.byteLength(part);assertForkEvidenceBudget(bytes);hash.update(part);}
 return {bytes,digest:hash.digest('hex')};
}
export async function writeForkHistory(root:string,history:AgentHistory){
 await checkedTaskRoot(root);
 const temporary=join(root,randomUUID()+'.tmp');const file=await open(temporary,'wx',0o600);
 let bytes=0;
 try{
  for(const part of historyParts(history)){bytes+=Buffer.byteLength(part);assertForkEvidenceBudget(bytes);await file.writeFile(part,'utf8');}
  await file.sync();await file.close();
  await rename(temporary,join(root,'source-history.json'));
  await syncDir(root);
 }finally{await file.close().catch(()=>{});await rm(temporary,{force:true});}
}
