import {acquireFileLease,type FileLease} from './linux-file-lease.js';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,readFile,readdir,readlink,realpath,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import {BackupError} from './backup.js';
export const restoreFail=(code:string)=>new BackupError(code,'Recovery refused: '+code);
export const sha=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
export async function syncDir(path:string){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
export async function durableJson(path:string,value:unknown){await durableFile(path,JSON.stringify(value));}
export async function durableFile(path:string,bytes:string|Uint8Array){const temporary=join(dirname(path),'.restore-'+randomUUID());const h=await open(temporary,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await rename(temporary,path);await syncDir(dirname(path));}
export async function privateDir(path:string,create=false){if(create)await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)||await realpath(path)!==resolve(path))throw restoreFail('unsafe_directory');return {dev:s.dev,ino:s.ino,uid:s.uid};}
/** Native runtimes create 0755 descendants beneath their private 0700 home.
 * The private root remains mandatory; every descendant is owned, canonical and
 * reachable only through that private root. Never chmod a native store to pass. */
export async function restoreParent(path:string,guardRoot?:string){if(!guardRoot)return privateDir(path);await privateDir(guardRoot);const rel=relative(guardRoot,path);if(rel.startsWith('..')||isAbsolute(rel))throw restoreFail('unsafe_directory');let current=guardRoot;for(const part of rel.split('/').filter(Boolean)){current=join(current,part);const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||await realpath(current)!==current)throw restoreFail('unsafe_directory');}const info=await lstat(path);return {dev:info.dev,ino:info.ino,uid:info.uid,guardRoot};}
export async function readJson(path:string){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||s.nlink!==1||s.size>32*1024*1024||await realpath(path)!==resolve(path))throw restoreFail('unsafe_journal');const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const t=await h.stat();if(t.dev!==s.dev||t.ino!==s.ino)throw restoreFail('journal_changed');return JSON.parse(await h.readFile('utf8'));}finally{await h.close();}}
export async function exists(path:string){return lstat(path).then(()=>true,(e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return false;throw e;});}
export async function processBirth(pid:number){try{const stat=await readFile('/proc/'+pid+'/stat','utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');return ['Z','X'].includes(fields[0])?undefined:fields[19];}catch{return undefined;}}
/** Stable kernel lease; never unlink or replace the authority file. The audit
 * record identifies the previous process, but kernel lifetime is the mutex. */
export async function restoreLock<T>(root:string,run:(lease:FileLease)=>Promise<T>):Promise<T>{
 await privateDir(root,true);let lease:FileLease|undefined;
 try{lease=acquireFileLease(join(root,'operation.lock'),'exclusive');}catch{throw restoreFail('lock_identity_changed');}
 if(!lease)throw restoreFail('operation_active');
 try{
  lease.assertHeld();const authority=await lstat(join(root,'operation.lock'));
  const path=join(root,'operation-owner.json');
  if(await exists(path)){const previous=await readJson(path);if(previous.schema!==1||previous.authorityDev!==authority.dev||previous.authorityIno!==authority.ino||previous.uid!==process.getuid?.())throw restoreFail('lock_identity_changed');}
  await durableJson(path,{schema:1,uid:process.getuid?.(),pid:process.pid,birth:await processBirth(process.pid),nonce:randomUUID(),authorityDev:authority.dev,authorityIno:authority.ino});
  lease.assertHeld();return await run(lease);
 }finally{lease.release();}
}
export async function treeDigest(path:string):Promise<string>{
 const info=await lstat(path);if(info.isSymbolicLink())return sha('link:'+await readlink(path));if(await realpath(path)!==resolve(path))throw restoreFail('unsafe_target');
 if(info.isFile()){if(info.nlink!==1)throw restoreFail('unsafe_target');const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');try{const buffer=Buffer.alloc(256*1024);for(;;){const {bytesRead}=await h.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}return hash.digest('hex');}finally{await h.close();}}
 if(!info.isDirectory())throw restoreFail('unsafe_target');const entries=[];for(const name of (await readdir(path)).sort())entries.push([name,await treeDigest(join(path,name))]);return sha(JSON.stringify(entries));
}
