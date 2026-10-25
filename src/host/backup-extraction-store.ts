import {mkdir,readdir,lstat,realpath,open,rm} from 'node:fs/promises';import {constants} from 'node:fs';import {join,resolve} from 'node:path';import {acquireFileLease,type FileLease} from './linux-file-lease.js';import {BackupBrokerError} from './backup-key-protocol.js';
const identifier=/^[0-9a-f]{8}-[0-9a-f-]{27}$/;
/** Material may be removed; the kernel authority inode never is. Read root and
 * receipt only after acquiring the stable lease and bind deletion to that root. */
export class BackupExtractionStore {
 readonly materialRoot:string;readonly lockRoot:string;
 constructor(privateRoot:string){this.materialRoot=join(privateRoot,'restore-exports');this.lockRoot=join(privateRoot,'restore-export-locks');}
 private async lock(id:string,mode:'shared'|'exclusive'){if(!identifier.test(id))throw new BackupBrokerError('invalid_restore_request');await mkdir(this.lockRoot,{recursive:true,mode:0o700});const lease=acquireFileLease(join(this.lockRoot,id+'.lock'),mode);if(!lease)throw new BackupBrokerError('extraction_busy');return lease;}
 private async handle(id:string,lease:FileLease){
  const root=join(this.materialRoot,id);try{const identity=await lstat(root);if(!identity.isDirectory()||identity.isSymbolicLink()||identity.uid!==process.getuid?.()||(identity.mode&0o077)||await realpath(root)!==resolve(root))throw new BackupBrokerError('extraction_invalid');
   const assertHeld=async()=>{lease.assertHeld();const now=await lstat(root);if(!now.isDirectory()||now.isSymbolicLink()||now.dev!==identity.dev||now.ino!==identity.ino||now.uid!==identity.uid||(now.mode&0o077)||await realpath(root)!==resolve(root))throw new BackupBrokerError('extraction_invalid');};
   return {root,lease,assertHeld,receipt:async()=>{await assertHeld();const file=await open(join(root,'receipt.json'),constants.O_RDONLY|constants.O_NOFOLLOW);try{const stat=await file.stat();if(!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o077)||stat.nlink!==1||stat.size>1024*1024)throw new BackupBrokerError('extraction_invalid');const raw=await file.readFile();if(raw.length!==stat.size)throw new BackupBrokerError('extraction_invalid');return JSON.parse(raw.toString('utf8'));}finally{await file.close();}},remove:async()=>{if(lease.mode!=='exclusive')throw new BackupBrokerError('extraction_busy');await assertHeld();await rm(root,{recursive:true});}};
  }catch(error){lease.release();throw error;}
 }
 async create(id:string){const lease=await this.lock(id,'exclusive');try{await mkdir(this.materialRoot,{recursive:true,mode:0o700});await this.cleanupExpired();if((await readdir(this.materialRoot)).length>=8)throw new BackupBrokerError('extraction_capacity');await mkdir(join(this.materialRoot,id),{mode:0o700});return await this.handle(id,lease);}catch(error){lease.release();throw error;}}
 async open(id:string,mode:'shared'|'exclusive'){return this.handle(id,await this.lock(id,mode));}
 async cleanupExpired(){
  for(const name of await readdir(this.materialRoot)){if(!identifier.test(name))continue;let handle:Awaited<ReturnType<BackupExtractionStore['open']>>|undefined;try{handle=await this.open(name,'exclusive');const receipt=await handle.receipt();if(Number.isFinite(Date.parse(receipt.expiresAt))&&Date.parse(receipt.expiresAt)<Date.now())await handle.remove();}catch{/* Busy or incomplete exports remain private, counted against capacity. */}finally{handle?.lease.release();}}
 }
}
