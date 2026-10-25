import {lstat,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {durableJson,exists,privateDir,readJson,restoreFail} from './restore-files.js';

export interface QualifiedSourceIdentity {profileDigest:string;paths:{path:string;dev:number;ino:number;uid:number;directory:boolean}[];}
/** Continuation of sources that already passed the actual independent-UID,
 * namespace and live-retirement qualification. This never allocates/adopts a
 * directory, clears unknown custody or qualifies an added/replaced source. */
export class ManagedSourceContinuation {
 constructor(readonly path:string){}
 async available(){return exists(this.path);}
 async record(identity:QualifiedSourceIdentity){await privateDir(dirname(this.path));if(await exists(this.path))throw restoreFail('source_continuation_exists');await this.validate(identity);await durableJson(this.path,{schema:1,identity});}
 async verify(identity:QualifiedSourceIdentity){await privateDir(dirname(this.path));const record=await readJson(this.path);if(record.schema!==1||JSON.stringify(record.identity)!==JSON.stringify(identity))throw restoreFail('source_continuation_changed');await this.validate(identity);}
 private async validate(identity:QualifiedSourceIdentity){if(!identity.profileDigest||!identity.paths.length)throw restoreFail('source_continuation_unqualified');for(const item of identity.paths){const stat=await lstat(item.path);if(resolve(item.path)!==item.path||await realpath(item.path)!==item.path||stat.isSymbolicLink()||stat.dev!==item.dev||stat.ino!==item.ino||stat.uid!==item.uid||stat.uid!==process.getuid?.()||item.directory!==stat.isDirectory()||!item.directory&&(!stat.isFile()||stat.nlink!==1)||(stat.mode&0o077)!==0)throw restoreFail('source_continuation_changed');}}
}
