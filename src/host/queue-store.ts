import type {WriterAdmissionFence} from './backup.js';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,rename,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {ImageInput,QueueItem} from '../shared/protocol.js';
export type StoredInput=QueueItem&{images?:ImageInput[];requestId?:string};
export class QueueStore {
 constructor(private readonly root:string,private readonly writerFence?:WriterAdmissionFence){}
 private path(id:string){return join(this.root,createHash('sha256').update(id).digest('hex')+'.json');}
 async read(id:string):Promise<StoredInput[]>{
  const path=this.path(id);let raw:string;
  try{if((await stat(path)).size>18*1024*1024)throw Error('Queue recovery file exceeds limit');raw=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  let data;try{data=JSON.parse(raw);}catch{throw Error("Queue recovery data is corrupt; retain file for inspection");}
  if(data.version!==1||!Array.isArray(data.rows)||data.rows.length>100)throw Error('Queue recovery data is invalid; retain file for inspection');
  const ids=new Set<string>();let textBytes=0,imageBytes=0;
  for(const row of data.rows){
   if(!row||typeof row.id!=='string'||ids.has(row.id)||typeof row.text!=='string'||!Number.isSafeInteger(row.revision)||row.revision<1||!['pending','sending','failed'].includes(row.status)||row.readOnly||row.requestId!==undefined&&typeof row.requestId!=='string')throw Error('Invalid recovered queue row');
   ids.add(row.id);textBytes+=Buffer.byteLength(row.text);
   if(row.images!==undefined){if(!Array.isArray(row.images))throw Error('Invalid recovered images');for(const image of row.images){if(image.type!=='image'||typeof image.data!=='string'||typeof image.mimeType!=='string'||!image.mimeType.startsWith('image/'))throw Error('Invalid recovered image');imageBytes+=image.data.length;}}
  }
  if(textBytes>512*1024||imageBytes>16*1024*1024)throw Error('Recovered queue exceeds admission limits');
  return data.rows;
 }
 async write(id:string,rows:StoredInput[],admitted=false):Promise<void>{
  if(this.writerFence&&!admitted)return this.writerFence.runWriter('platform',()=>this.write(id,rows,true));
  await mkdir(this.root,{recursive:true,mode:0o700});const path=this.path(id),temp=path+'.'+randomUUID()+'.tmp';
  const file=await open(temp,'wx',0o600);
  try{await file.writeFile(JSON.stringify({version:1,rows}));await file.sync();}catch(error){await unlink(temp).catch(()=>{});throw error;}finally{await file.close();}
  try{await rename(temp,path);const dir=await open(this.root,'r');try{await dir.sync();}finally{await dir.close();}}finally{await unlink(temp).catch(()=>{});}
 }
}
