import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

/** Only the fresh audit connection calls this. Wait for its supervisor before
 * forwarding normal close, so cancellation during startup cannot kill the
 * launcher before custody ownership exists. No user runtime is stopped. */
export function ownedNativeAuditClose(directory:string,close:()=>Promise<void>){
 let closing:Promise<void>|undefined;
 return ()=>closing??=(async()=>{
  const until=Date.now()+2000;
  while(Date.now()<until){try{const receipt=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));if(receipt.state==='active'||receipt.state==='quiescent')break;}catch{}await delay(10);}
  await close();
 })();
}
