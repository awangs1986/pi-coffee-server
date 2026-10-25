import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {randomUUID,createHash} from 'node:crypto';import {mkdir,open,rename,rm,lstat,realpath,symlink,type FileHandle} from 'node:fs/promises';import {join,resolve,dirname,isAbsolute} from 'node:path';
import {verifySealedCheckpoint,type SealedCheckpoint,type CheckpointManifest,type CheckpointObject} from './backup.js';import {BackupBrokerError} from './backup-key-protocol.js';
const identifier=/^[0-9a-f]{8}-[0-9a-f-]{27}$/;
/** Incoming paths are manifest-relative objects, never Host-selected source paths.
 * This root belongs to the key service and is never exposed to Host callers. */
export class BackupCheckpointReceiver {
 constructor(private options:{root:string;socket:string;sourceUid:number;allowedScopes?:string[];maxBytes?:number;maxFiles?:number;timeoutMs?:number}){}
 async receive(scope:string,taskId:string,expectedCheckpointId?:string):Promise<SealedCheckpoint>{
  const root=resolve(this.options.root);await mkdir(root,{recursive:true,mode:0o700});await privateDirectory(root);const staging=join(root,'transfer-'+randomUUID());await mkdir(staging,{mode:0o700});
  const helper=new URL(import.meta.url.endsWith('.ts')?'../../src/host/backup-unix-peer.py':'./backup-unix-peer.py',import.meta.url).pathname;
  const child=spawn('/usr/bin/python3',[helper,'client-stream',this.options.socket,String(this.options.sourceUid),String(Math.floor(Math.min(2*1024**3,(this.options.maxBytes??1024**3)*1.4+64*1024**2)))],{stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}});const timer=setTimeout(()=>child.kill('SIGKILL'),this.options.timeoutMs??5*60*1000);let processError=false;const exited=new Promise<number|null>(resolveExit=>{child.on('error',()=>{processError=true;resolveExit(1);});child.on('close',resolveExit);});child.stdin.on('error',()=>undefined);child.stdin.end(JSON.stringify({schema:1,id:randomUUID(),operation:'export-checkpoint',scope,taskId,...expectedCheckpointId?{expectedCheckpointId}:{}})+'\n');
  let file:FileHandle|undefined;
  try{
   let checkpointId='',manifestBytes=0,manifestChunks:Buffer[]=[],manifestSize=0,manifest:CheckpointManifest|undefined,index=0,current:CheckpointObject|undefined,fileBytes=0,totalBytes=0,ended=false;
   const parseManifest=async()=>{
    if(manifest)return;if(!checkpointId||manifestSize!==manifestBytes)throw new BackupBrokerError('source_transfer_invalid');
    const bytes=Buffer.concat(manifestChunks);manifestChunks=[];manifest=JSON.parse(bytes.toString('utf8'));
    if(!manifest||manifest.schemaVersion!==1||manifest.checkpointId!==checkpointId||manifest.coverage!=='complete'||!Array.isArray(manifest.members)||!manifest.members.some(m=>m.scope===scope&&m.taskId===taskId)||manifest.members.some(m=>!['pi','codex'].includes(m.engine)||!(this.options.allowedScopes??[scope]).includes(m.scope))||!Array.isArray(manifest.objects)||manifest.objects.length>(this.options.maxFiles??100000))throw new BackupBrokerError('source_transfer_invalid');
    let declaredBytes=0;const paths=new Set<string>();for(const object of manifest.objects){if(!safePath(object.path)||paths.has(object.path)||!['directory','file','symlink'].includes(object.kind)||!Number.isSafeInteger(object.size)||object.size<0||object.size>(this.options.maxBytes??1024**3))throw new BackupBrokerError('source_transfer_invalid');paths.add(object.path);if(object.kind==='file')declaredBytes+=object.size;}
    if(!Number.isSafeInteger(manifest.totalBytes)||manifest.totalBytes!==declaredBytes||declaredBytes>(this.options.maxBytes??1024**3))throw new BackupBrokerError('source_transfer_limit');
    await writeNew(join(staging,'manifest.json'),bytes);await writeNew(join(staging,'seal'),Buffer.from(createHash('sha256').update(bytes).digest('hex')+'\n'));await mkdir(join(staging,'objects'),{mode:0o700});
   };
   for await(const line of createInterface({input:child.stdout,crlfDelay:Infinity})){
    if(Buffer.byteLength(line)>1024*1024||ended)throw new BackupBrokerError('source_transfer_invalid');const frame=JSON.parse(line);if(frame.schema!==undefined&&frame.schema!==1)throw new BackupBrokerError('source_transfer_invalid');
    switch(frame.type){
     case 'header':if(checkpointId||!identifier.test(frame.checkpointId)||expectedCheckpointId&&frame.checkpointId!==expectedCheckpointId||!Number.isSafeInteger(frame.manifestBytes)||frame.manifestBytes<2||frame.manifestBytes>32*1024*1024)throw new BackupBrokerError('source_transfer_invalid');checkpointId=frame.checkpointId;manifestBytes=frame.manifestBytes;break;
     case 'manifest':{if(manifest||!checkpointId)throw new BackupBrokerError('source_transfer_invalid');const data=decode(frame.data);manifestSize+=data.length;if(manifestSize>manifestBytes)throw new BackupBrokerError('source_transfer_invalid');manifestChunks.push(data);break;}
     case 'object':{
      await parseManifest();if(current||index>=manifest!.objects.length)throw new BackupBrokerError('source_transfer_invalid');const expected=manifest!.objects[index];if(JSON.stringify(frame.object)!==JSON.stringify(expected))throw new BackupBrokerError('source_transfer_invalid');current=expected;fileBytes=0;const target=join(staging,current.path);await privateDirectory(dirname(target));
      if(current.kind==='directory')await mkdir(target,{mode:0o700});else if(current.kind==='file')file=await open(target,'wx',0o400);else{if(typeof current.linkTarget!=='string'||isAbsolute(current.linkTarget))throw new BackupBrokerError('source_transfer_invalid');await symlink(current.linkTarget,target);}break;
     }
     case 'chunk':{if(current?.kind!=='file'||!file)throw new BackupBrokerError('source_transfer_invalid');const data=decode(frame.data);fileBytes+=data.length;totalBytes+=data.length;if(fileBytes>current.size||totalBytes>(this.options.maxBytes??1024**3))throw new BackupBrokerError('source_transfer_limit');await file.writeFile(data);break;}
     case 'object-end':if(!current||current.kind==='file'&&fileBytes!==current.size)throw new BackupBrokerError('source_transfer_invalid');if(file){await file.sync();await file.close();file=undefined;}current=undefined;index++;break;
     case 'end':await parseManifest();if(current||index!==manifest!.objects.length||frame.checkpointId!==checkpointId||frame.manifestSha256!==createHash('sha256').update(await import('node:fs/promises').then(fs=>fs.readFile(join(staging,'manifest.json')))).digest('hex'))throw new BackupBrokerError('source_transfer_invalid');ended=true;break;
     default:throw new BackupBrokerError('source_transfer_invalid');
    }
   }
   if(await exited!==0||processError||!ended)throw new BackupBrokerError('source_transfer_failed');
   const verified=await verifySealedCheckpoint(staging);await syncDirectory(staging);await mkdir(join(root,'sealed'),{recursive:true,mode:0o700});await privateDirectory(join(root,'sealed'));const destination=join(root,'sealed',verified.checkpointId);
   try{await rename(staging,destination);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;const old=await verifySealedCheckpoint(destination);if(JSON.stringify(old)!==JSON.stringify(verified))throw new BackupBrokerError('checkpoint_identity_conflict');await rm(staging,{recursive:true});}
   await syncDirectory(join(root,'sealed'));return {directory:destination,manifest:verified};
  }catch(error){child.kill('SIGKILL');await exited;throw error instanceof BackupBrokerError?error:new BackupBrokerError('source_transfer_failed');}
  finally{clearTimeout(timer);await file?.close();await rm(staging,{recursive:true,force:true});}
 }
}
function safePath(path:unknown):path is string{return typeof path==='string'&&path.startsWith('objects/')&&!path.includes('\\')&&!isAbsolute(path)&&path.split('/').every(part=>part&&part!=='.'&&part!=='..');}
function decode(data:unknown){if(typeof data!=='string'||data.length>262144||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw new BackupBrokerError('source_transfer_invalid');return Buffer.from(data,'base64');}
async function privateDirectory(path:string){const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)||await realpath(path)!==resolve(path))throw new BackupBrokerError('source_transfer_invalid');}
async function writeNew(path:string,bytes:Uint8Array){const file=await open(path,'wx',0o400);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}}
async function syncDirectory(path:string){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
