import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,lstat,readFile,readdir,readlink,realpath,mkdir,rename,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {BackupError} from './backup.js';
export const restoreFail=(code:string)=>new BackupError(code,'Recovery refused: '+code);
export const sha=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
export async function syncDir(path:string){const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
export async function durableJson(path:string,value:unknown){await durableFile(path,JSON.stringify(value));}
export async function durableFile(path:string,bytes:string|Uint8Array){const temporary=join(dirname(path),'.restore-'+randomUUID());const h=await open(temporary,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}await rename(temporary,path);await syncDir(dirname(path));}
export async function privateDir(path:string,create=false){if(create)await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)||await realpath(path)!==resolve(path))throw restoreFail('unsafe_directory');return {dev:s.dev,ino:s.ino,uid:s.uid};}
export async function readJson(path:string){const s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||s.nlink!==1||s.size>32*1024*1024||await realpath(path)!==resolve(path))throw restoreFail('unsafe_journal');const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const t=await h.stat();if(t.dev!==s.dev||t.ino!==s.ino)throw restoreFail('journal_changed');return JSON.parse(await h.readFile('utf8'));}finally{await h.close();}}
export async function exists(path:string){return lstat(path).then(()=>true,(e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return false;throw e;});}
export async function processBirth(pid:number){try{const stat=await readFile('/proc/'+pid+'/stat','utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');return ['Z','X'].includes(fields[0])?undefined:fields[19];}catch{return undefined;}}
/** Only reclaim a dead owner's exact lock inode. PID reuse never counts as death. */
export async function restoreLock<T>(root:string,run:()=>Promise<T>):Promise<T>{
 await privateDir(root,true);const path=join(root,'operation.lock');
 let h;
 for(let attempts=0;attempts<2;attempts++){
  try{h=await open(path,'wx',0o600);break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   const before=await lstat(path),owner=await readJson(path);if(owner.schema!==1||owner.uid!==process.getuid?.()||!Number.isSafeInteger(owner.pid)||typeof owner.birth!=='string')throw restoreFail('lock_owner_unknown');
   if(await processBirth(owner.pid)!==undefined)throw restoreFail('operation_active');
   const after=await lstat(path);if(before.dev!==after.dev||before.ino!==after.ino||JSON.stringify(owner)!==JSON.stringify(await readJson(path)))throw restoreFail('lock_identity_changed');await unlink(path);await syncDir(root);
  }
 }
 if(!h)throw restoreFail('operation_active');const identity=await h.stat(),owner={schema:1,uid:process.getuid?.(),pid:process.pid,birth:await processBirth(process.pid),nonce:randomUUID()};
 try{await h.writeFile(JSON.stringify(owner));await h.sync();await syncDir(root);return await run();}finally{await h.close();const current=await lstat(path).catch(()=>undefined);if(current&&current.dev===identity.dev&&current.ino===identity.ino&&JSON.stringify(await readJson(path))===JSON.stringify(owner)){await unlink(path);await syncDir(root);}}
}
export async function treeDigest(path:string):Promise<string>{
 const info=await lstat(path);if(info.isSymbolicLink())return sha('link:'+await readlink(path));if(await realpath(path)!==resolve(path))throw restoreFail('unsafe_target');
 if(info.isFile()){if(info.nlink!==1)throw restoreFail('unsafe_target');const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');try{const buffer=Buffer.alloc(256*1024);for(;;){const {bytesRead}=await h.read(buffer,0,buffer.length,null);if(!bytesRead)break;hash.update(buffer.subarray(0,bytesRead));}return hash.digest('hex');}finally{await h.close();}}
 if(!info.isDirectory())throw restoreFail('unsafe_target');const entries=[];for(const name of (await readdir(path)).sort())entries.push([name,await treeDigest(join(path,name))]);return sha(JSON.stringify(entries));
}
