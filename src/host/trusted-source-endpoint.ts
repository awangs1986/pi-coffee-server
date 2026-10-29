import {constants} from 'node:fs';
import {mkdir,lstat,realpath,open,readFile,rename,link,rm,chmod} from 'node:fs/promises';
import {dirname,basename,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {BackupBrokerError,type BackupHostClientIdentity} from './backup-key-protocol.js';

interface SocketIdentity {dev:number;ino:number;uid:number;}
interface Receipt {schema:1;path:string;temporary:string;owner:BackupHostClientIdentity;socket:SocketIdentity;}
const fail=()=>new BackupBrokerError('source_endpoint_exists');
async function exists(path:string){try{return await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}}
function same(info:SocketIdentity,expected:SocketIdentity){return info.dev===expected.dev&&info.ino===expected.ino&&info.uid===expected.uid;}
async function owner():Promise<BackupHostClientIdentity>{const raw=await readFile('/proc/'+process.pid+'/stat','utf8');return {pid:process.pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function gone(expected:BackupHostClientIdentity):Promise<boolean>{
 if(expected.boot!==(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim())return true;
 try{const raw=await readFile('/proc/'+expected.pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');return fields[19]!==expected.birth||['Z','X'].includes(fields[0]);}
 catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw fail();}
}
async function notListening(path:string):Promise<boolean>{return new Promise(resolve=>{const socket=createConnection(path);const finish=(value:boolean)=>{clearTimeout(timer);socket.destroy();resolve(value);},timer=setTimeout(()=>finish(false),500);socket.once('connect',()=>finish(false));socket.once('error',error=>finish(['ECONNREFUSED','ENOENT'].includes((error as NodeJS.ErrnoException).code??'')));});}
async function removeOwned(path:string,identity:SocketIdentity){const info=await exists(path);if(!info)return;if(!info.isSocket()||!same(info,identity))throw fail();await rm(path);}

/** The public socket is linked only after a durable owner/inode receipt exists.
 * Kernel flock coordinates cooperating Host instances; neither a missing PID
 * alone nor an unknown refused socket permits unlinking an endpoint. */
export class TrustedSourceEndpoint {
 readonly temporary:string;private socket?:SocketIdentity;private released=false;
 private constructor(readonly path:string,private directory:string,private lease:FileLease){
  const parent=dirname(path),size=Math.min(32,107-Buffer.byteLength(parent+'/'));if(size<8)throw fail();this.temporary=join(parent,randomUUID().replaceAll('-','').slice(0,size));
 }
 static async acquire(path:string):Promise<TrustedSourceEndpoint>{
  if(resolve(path)!==path)throw fail();const directory=join(dirname(path),'.'+basename(path)+'.authority');await mkdir(directory,{mode:0o700,recursive:true});
  const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)||await realpath(directory)!==directory)throw fail();
  const lease=acquireFileLease(join(directory,'owner.lock'),'exclusive');if(!lease)throw fail();
  try{
   const endpoint=new TrustedSourceEndpoint(path,directory,lease),receipt=await endpoint.receipt(),current=await exists(path);
   if(current){if(!current.isSocket()||!receipt||!same(current,receipt.socket)||!await gone(receipt.owner)||!await notListening(path))throw fail();lease.assertHeld();await removeOwned(path,receipt.socket);}
   if(receipt&&await gone(receipt.owner)){const temporary=await exists(receipt.temporary);if(temporary){if(!same(temporary,receipt.socket)||!temporary.isSocket()||!await notListening(receipt.temporary))throw fail();await removeOwned(receipt.temporary,receipt.socket);}}
   return endpoint;
  }catch(error){lease.release();throw error;}
 }
 private async receipt():Promise<Receipt|undefined>{
  const path=join(this.directory,'owner.json');if(!await exists(path))return;
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{
   const stat=await file.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid?.()||(stat.mode&0o077)||stat.size>8192||await realpath(path)!==path)throw fail();const bytes=Buffer.alloc(8193),{bytesRead}=await file.read(bytes,0,bytes.length,0);if(bytesRead!==stat.size)throw fail();const value=JSON.parse(bytes.subarray(0,bytesRead).toString('utf8')) as Receipt;
   if(value.schema!==1||value.path!==this.path||typeof value.temporary!=='string'||dirname(value.temporary)!==dirname(this.path)||!/^\w{8,32}$/.test(basename(value.temporary))||!value.owner||!Number.isSafeInteger(value.owner.pid)||value.owner.pid<1||value.owner.uid!==process.getuid?.()||!/^[a-f0-9-]{36}$/.test(value.owner.boot)||!/^\d+$/.test(value.owner.birth)||!value.socket||![value.socket.dev,value.socket.ino,value.socket.uid].every(Number.isSafeInteger)||value.socket.uid!==process.getuid?.())throw fail();return value;
  }finally{await file.close();}
 }
 async publish(){
  this.lease.assertHeld();const info=await lstat(this.temporary);if(!info.isSocket()||info.uid!==process.getuid?.())throw fail();this.socket={dev:info.dev,ino:info.ino,uid:info.uid};await chmod(this.temporary,0o660);
  const receipt:Receipt={schema:1,path:this.path,temporary:this.temporary,owner:await owner(),socket:this.socket},temp=join(this.directory,randomUUID()+'.tmp'),file=await open(temp,'wx',0o600);
  try{await file.writeFile(JSON.stringify(receipt));await file.sync();}finally{await file.close();}
  this.lease.assertHeld();await rename(temp,join(this.directory,'owner.json'));const directory=await open(this.directory,'r');try{await directory.sync();}finally{await directory.close();}
  // link(2) never replaces an unrelated or newly appeared destination. Unix
  // domain lookup addresses this inode, independently of its temporary name.
  this.lease.assertHeld();await link(this.temporary,this.path);await removeOwned(this.temporary,this.socket);
  const parent=await open(dirname(this.path),'r');try{await parent.sync();}finally{await parent.close();}
 }
 async close(){if(this.released)return;this.released=true;try{this.lease.assertHeld();if(this.socket){await removeOwned(this.path,this.socket);await removeOwned(this.temporary,this.socket);}}finally{this.lease.release();}}
}
