import {mkdir,readFile,open,rename,rmdir} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {randomUUID} from 'node:crypto';

export interface RestartOptions {stateDir:string;operators:string[]}
interface Operation {id:string;owner:string;phase:'scheduled'|'running'|'succeeded'|'failed';createdAt:number;updatedAt:number;step?:string;reason?:string}
export class RestartError extends Error {constructor(readonly status:number,readonly code:string){super(code);}}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const busy=(op:Operation|null)=>Boolean(op&&['scheduled','running'].includes(op.phase));
/** Durable admission only. An independent operator-owned systemd worker executes it. */
export class Restarts {
 constructor(private readonly options:RestartOptions){
  if(!isAbsolute(options.stateDir)||!options.operators.length||options.operators.some(x=>!(/^(id:[1-9][0-9]*|login:[a-z0-9_.-]+)$/i.test(x))))throw Error('Invalid restart configuration');
 }
 allows(owner:string){return this.options.operators.includes(owner);}
 private async read(name='operation.json'):Promise<Operation|null>{
  try{const op=JSON.parse(await readFile(join(this.options.stateDir,name),'utf8'));
   if(!op||!uuid.test(op.id)||typeof op.owner!=='string'||!['scheduled','running','succeeded','failed'].includes(op.phase)||!Number.isFinite(op.createdAt)||!Number.isFinite(op.updatedAt))throw Error('Invalid restart state');
   return op;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw new RestartError(503,'restart_state_unavailable');}
 }
 private async current(){
  const pointer=await this.read();if(!pointer)return null;
  const receipt=await this.read('receipts/'+pointer.id+'.json');
  if(!receipt)throw new RestartError(503,'restart_state_unavailable');
  return receipt;
 }
 async status(owner:string,id?:string){
  if(id!==undefined&&!uuid.test(id))throw new RestartError(400,'invalid_restart_request');
  const current=await this.current(),op=id?await this.read('receipts/'+id+'.json'):current;
  return {available:true,busy:busy(current),operation:op?.owner===owner?{id:op.id,phase:op.phase,step:op.step,reason:op.reason,updatedAt:op.updatedAt}:null};
 }
 private async save(name:string,op:Operation){
  const path=join(this.options.stateDir,name),temp=path+'.'+randomUUID(),file=await open(temp,'wx',0o600);
  try{await file.writeFile(JSON.stringify(op)+'\n');await file.sync();}finally{await file.close();}
  await rename(temp,path);
  const dir=await open(join(path,'..'),'r');try{await dir.sync();}finally{await dir.close();}
 }
 async request(owner:string,input:unknown){
  if(!this.allows(owner))throw new RestartError(403,'restart_forbidden');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='confirmed,id'||(input as any).confirmed!==true||typeof (input as any).id!=='string'||!uuid.test((input as any).id))throw new RestartError(400,'invalid_restart_request');
  await mkdir(this.options.stateDir,{recursive:true,mode:0o700});
  await mkdir(join(this.options.stateDir,'receipts'),{recursive:true,mode:0o700});
  const lock=join(this.options.stateDir,'admission.lock');
  try{await mkdir(lock,{mode:0o700});}catch{throw new RestartError(409,'restart_busy');}
  let publicationStarted=false,publicationCompleted=false;
  try{
   const id=(input as {id:string}).id,receipt=await this.read('receipts/'+id+'.json'),previous=await this.current();
   if(receipt){if(receipt.owner!==owner)throw new RestartError(409,'restart_busy');return await this.status(owner,id);}
   if(busy(previous))throw new RestartError(409,'restart_busy');
   if(previous&&Date.now()-previous.updatedAt<60000)throw new RestartError(429,'restart_cooldown');
   const op:Operation={id,owner,phase:'scheduled',createdAt:Date.now(),updatedAt:Date.now()};
   // Publish the receipt before the trigger. A partial write fails closed.
   publicationStarted=true;
   await this.save('receipts/'+id+'.json',op);await this.save('operation.json',op);await this.save('request.json',op);
   publicationCompleted=true;
   return await this.status(owner,id);
  }finally{if(!publicationStarted||publicationCompleted)await rmdir(lock);}
 }
}
export function restartOptions(env:NodeJS.ProcessEnv=process.env):RestartOptions|undefined{
 if(!env.PI_COFFEE_RESTART_STATE_DIR&&!env.PI_COFFEE_RESTART_OPERATORS)return;
 return {stateDir:env.PI_COFFEE_RESTART_STATE_DIR??'',operators:(env.PI_COFFEE_RESTART_OPERATORS??'').split(',').map(x=>x.trim()).filter(Boolean)};
}
