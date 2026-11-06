import {readFile} from 'node:fs/promises';
/** Process identity is diagnostic evidence, not execution or filesystem authority. */
export async function processObservation(pid=process.pid){
 if(!Number.isSafeInteger(pid)||pid<1)return null;
 if(process.platform!=='linux')return {pid};
 try{
  const stat=await readFile(`/proc/${pid}/stat`,'utf8'),tail=stat.slice(stat.lastIndexOf(')')+2).split(' ');
  if(tail[0]==='Z')return null;
  return {pid,birth:tail[19],boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};
 }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
export async function observedVerification(receipt){
 if(receipt.status!=='running')return receipt;
 const owner=receipt.owner;
 if(!owner)return {...receipt,status:'unknown',reason:'running_receipt_has_no_process_identity'};
 try{
  const current=await processObservation(owner.pid);
  if(!current||current.birth!==owner.birth||current.boot!==owner.boot)return {...receipt,status:'interrupted',reason:'verification_process_exited'};
  if(process.platform!=='linux'){try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return {...receipt,status:'interrupted',reason:'verification_process_exited'};throw error;}}
  return receipt;
 }catch{return {...receipt,status:'unknown',reason:'verification_process_unobservable'};}
}
