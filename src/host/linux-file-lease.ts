import {constants,openSync,closeSync,lstatSync,fstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

interface Kernel {tryLock(fd:number,operation:number):boolean;protection():{dumpable:number;noNewPrivs:number};harden():{dumpable:number;noNewPrivs:number};peerCredentials(fd:number):{pid:number;uid:number;gid:number};}
let loaded:Kernel|undefined;
function kernel():Kernel{
 if(process.platform!=='linux')throw Error('Linux kernel authority unavailable');
 if(!loaded){const local=fileURLToPath(new URL('./linux-kernel.node',import.meta.url)),development=fileURLToPath(new URL('../../dist/src/host/linux-kernel.node',import.meta.url));let artifact=local;try{lstatSync(local);}catch{artifact=development;}loaded=createRequire(import.meta.url)(artifact) as Kernel;}
 return loaded;
}
export interface FileLease {readonly fd:number;readonly mode:'shared'|'exclusive';assertHeld():void;release():void;}

/** Nonblocking kernel flock held by this Node process's CLOEXEC descriptor.
 * The private authority file is stable: callers must never unlink/replace it to
 * reclaim a lock. Kernel exit cleanup reclaims it without PID/age heuristics. */
export function acquireFileLease(path:string,mode:'shared'|'exclusive'):FileLease|undefined{
 if(mode!=='shared'&&mode!=='exclusive')throw Error('Invalid kernel lease mode');
 const file=resolve(path),parent=dirname(file),directory=lstatSync(parent);
 if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid?.()||(directory.mode&0o077)!==0||realpathSync(parent)!==parent)throw Error('Kernel lease authority directory is unsafe');
 let fd:number|undefined;
 try{
  fd=openSync(file,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  const identity=fstatSync(fd),named=lstatSync(file);
  if(!identity.isFile()||identity.nlink!==1||identity.uid!==process.getuid?.()||(identity.mode&0o077)!==0||identity.dev!==named.dev||identity.ino!==named.ino||named.isSymbolicLink())throw Error('Kernel lease authority file is unsafe');
  if(!kernel().tryLock(fd,mode==='shared'?1:2)){closeSync(fd);fd=undefined;return undefined;}
  const descriptor=fd;fd=undefined;let released=false;
  return {fd:descriptor,mode,assertHeld(){if(released)throw Error('Kernel lease already released');const current=fstatSync(descriptor),named=lstatSync(file),parentNow=lstatSync(parent);if(current.dev!==identity.dev||current.ino!==identity.ino||current.nlink!==1||current.uid!==identity.uid||(current.mode&0o077)!==0||named.dev!==identity.dev||named.ino!==identity.ino||named.isSymbolicLink()||parentNow.dev!==directory.dev||parentNow.ino!==directory.ino||parentNow.uid!==directory.uid||(parentNow.mode&0o077)!==0||realpathSync(parent)!==parent)throw Error('Kernel lease authority changed');},release(){if(!released){released=true;closeSync(descriptor);}}};
 }catch{if(fd!==undefined)closeSync(fd);throw Error('Kernel lease authority unavailable or unsafe');}
}
/** Call only at managed-service startup; never changes global OS settings. */
export function hardenCurrentProcess(){return kernel().harden();}
export function processProtection(){return kernel().protection();}
/** Requires a live connected Unix socket descriptor; no caller-supplied UID claim. */
export function kernelPeerCredentials(fd:number){return kernel().peerCredentials(fd);}
