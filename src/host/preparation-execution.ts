import {open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
/** Execution-only context. Never changes native permissions or account selection. */
export interface PreparationExecution {operationId:string;signal:AbortSignal;deadline:number;}
export const preparationExecution=new AsyncLocalStorage<PreparationExecution>();
export function preparationBudget(maximum:number):number {
 const context=preparationExecution.getStore();context?.signal.throwIfAborted();
 const remaining=context?Math.min(maximum,context.deadline-Date.now()):maximum;
 if(remaining<=0)throw Error('Preparation stage deadline exceeded');return Math.max(1,remaining);
}
export function checkPreparation(){const context=preparationExecution.getStore();context?.signal.throwIfAborted();if(context&&Date.now()>=context.deadline)throw Error('Preparation stage deadline exceeded');}
export async function bounded<T>(run:()=>Promise<T>,milliseconds:number,signal?:AbortSignal):Promise<T>{
 signal?.throwIfAborted();let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>{};
 const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(signal?.reason??Error('Preparation cancelled'));signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>reject(Error('Preparation stage deadline exceeded')),milliseconds);});
 try{return await Promise.race([Promise.resolve().then(run),interrupted]);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

/** Fixed-size read: even a concurrently growing artifact cannot exceed the budget. */
export async function readPreparationArtifact(path:string,maximum:number):Promise<string>{
 if(await realpath(path)!==resolve(path))throw Error('Unsafe preparation artifact');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const info=await file.stat();
  if(!info.isFile()||info.uid!==process.getuid?.()||info.nlink!==1)throw Error('Unsafe preparation artifact');
  if(info.size>maximum)throw Error('Preparation artifact exceeds byte budget');
  const buffer=Buffer.alloc(maximum+1);let length=0;
  while(length<buffer.length){const {bytesRead}=await file.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  if(length>maximum)throw Error('Preparation artifact exceeds byte budget');
  return buffer.toString('utf8',0,length);
 }finally{await file.close();}
}
