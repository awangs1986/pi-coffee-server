import {cp,lstat,chmod,readdir,open,mkdir} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute} from 'node:path';
import type {CheckpointManifest} from './backup.js';
import type {RestoreAction} from './restore.js';
import {exists,privateDir,restoreFail,treeDigest,syncDir} from './restore-files.js';

/** Explicit personal recovery restores missing configuration; a healthy current
 * file wins even when the user replaces a task. Values never enter status. */
export async function personalConfigurationActions(input:{root:string;prefix:string;sources:CheckpointManifest['sources'];directory:string;stage:string}):Promise<RestoreAction[]>{
 const root=resolve(input.root);await privateDir(root,true);const actions:RestoreAction[]=[];
 const selected=input.sources.filter(s=>s.recoveryKey.startsWith(input.prefix));
 for(const item of selected){
  const name=item.recoveryKey.slice(input.prefix.length),target=resolve(root,name),rel=relative(root,target);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||item.originalPath!==target)throw restoreFail('configuration_target_changed');
  if(await exists(target))continue;
  // Sources are top-level files or resource directories, not arbitrary paths.
  if(dirname(target)!==root)throw restoreFail('configuration_target_changed');
  const source=join(input.stage,'configuration-'+item.id);await cp(join(input.directory,'objects',item.id),source,{recursive:true,errorOnExist:true,force:false});await syncPrivateTree(source);
  const info=await lstat(source),parent=await privateDir(root);
  if(info.dev!==parent.dev)throw restoreFail('incompatible_restore_filesystem');
  actions.push({source,target,phase:'native',digest:await treeDigest(source),dev:info.dev,ino:info.ino,parent});
 }
 return actions;
}
async function syncPrivateTree(path:string):Promise<void>{
 const info=await lstat(path);if(info.isSymbolicLink())throw restoreFail('unsafe_configuration');
 await chmod(path,info.isDirectory()?0o700:info.mode&0o111?0o700:0o600);
 if(info.isDirectory()){for(const name of await readdir(path))await syncPrivateTree(join(path,name));await syncDir(path);}
 else{const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
}
