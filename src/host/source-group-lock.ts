import {constants,openSync,closeSync,lstatSync,fstatSync,realpathSync} from 'node:fs';
import {dirname,resolve} from 'node:path';

/** Identity, not a claim that all writers participate in this advisory lock. */
export interface SourceGroupLockIdentity {schema:1;path:string;dev:number;ino:number;uid:number;parentDev:number;parentIno:number;}
export function sourceGroupLockIdentity(path:string,create=false):SourceGroupLockIdentity {
 const file=resolve(path),parent=dirname(file);if(path!==file)throw Error('Source group lock must be canonical');
 const directory=lstatSync(parent);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid?.()||(directory.mode&0o077)||realpathSync(parent)!==parent)throw Error('Source group lock parent changed');
 const fd=openSync(file,constants.O_RDWR|constants.O_NOFOLLOW|(create?constants.O_CREAT:0),0o600);
 try{const info=fstatSync(fd),named=lstatSync(file);if(!info.isFile()||info.nlink!==1||info.uid!==process.getuid?.()||(info.mode&0o077)||named.isSymbolicLink()||named.dev!==info.dev||named.ino!==info.ino)throw Error('Source group lock changed');return {schema:1,path:file,dev:info.dev,ino:info.ino,uid:info.uid,parentDev:directory.dev,parentIno:directory.ino};}finally{closeSync(fd);}
}
export function assertSourceGroupLock(identity:SourceGroupLockIdentity){if(JSON.stringify(sourceGroupLockIdentity(identity.path))!==JSON.stringify(identity))throw Error('Source group lock identity changed');}
