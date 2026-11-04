import {readFile,open} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';import {verifySealedCheckpoint} from './backup.js';
/** Used only after current peer/actor/policy authorization at a fixed service root. */
export async function emitSealedCheckpoint(directory:string,emit:(frame:unknown)=>Promise<void>,expectedDigest?:string){
 const manifest=await verifySealedCheckpoint(directory,expectedDigest),raw=await readFile(join(directory,'manifest.json'));await emit({schema:1,type:'header',checkpointId:manifest.checkpointId,manifestBytes:raw.length});
 for(let offset=0;offset<raw.length;offset+=192*1024)await emit({type:'manifest',data:raw.subarray(offset,offset+192*1024).toString('base64')});
 for(const object of manifest.objects){await emit({type:'object',object});if(object.kind==='file'){const file=await open(join(directory,object.path),'r');try{const buffer=Buffer.alloc(192*1024);for(;;){const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;await emit({type:'chunk',data:buffer.subarray(0,bytesRead).toString('base64')});}}finally{await file.close();}}await emit({type:'object-end'});}
 await emit({type:'end',checkpointId:manifest.checkpointId,manifestSha256:createHash('sha256').update(raw).digest('hex')});
}
