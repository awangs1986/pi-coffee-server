import {lstat,opendir} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {MAX_MISHU_STATE_BYTES} from './mishu-state.js';
import {normalizeUsername} from '../shared/identity.js';

const MAX_DIRECTORY_ENTRIES=4096;
const MAX_RECOVERY_SCOPES=256;
const diagnostic=(reason:string)=>console.warn(`[pi-coffee] MISHU saved-scope discovery: ${reason}; saved state retained.`);

/**
 * Discover existing coordination stores only. The coordinator owns schema,
 * current source/target authorization, native evidence and report admission.
 * Fixed-depth non-symlink paths prevent a directory name from changing scope.
 */
export async function* savedMishuScopes(workdir:string,defaultProjectRoot:string):AsyncGenerator<string|undefined> {
 let recovered=0,totalBytes=0;
 const layout=relative(resolve(workdir),resolve(defaultProjectRoot)).split(sep);
 const ambiguousUser=layout.length===2&&layout[1]==='projects'&&normalizeUsername(layout[0])===layout[0]?layout[0]:undefined;
 // A configured default root overlapping a named-user layout has no unambiguous
 // account identity. Never choose one scope's authority by enumeration order.
 if(ambiguousUser)diagnostic('default and user roots overlap; explicit scope repair required');
 else {const bytes=await stateBytes(defaultProjectRoot);if(bytes!==undefined){totalBytes+=bytes;recovered++;yield undefined;}}
 const names:string[]=[];
 try{
  const directory=await opendir(workdir);let entries=0;
  for await(const entry of directory){
   if(++entries>MAX_DIRECTORY_ENTRIES){diagnostic('directory entry limit reached');break;}
   if(entry.isDirectory()&&normalizeUsername(entry.name)===entry.name)names.push(entry.name);
  }
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')diagnostic('user directory unavailable');return;}
 // Stable order gives bounded discovery deterministic behavior on each restart.
 for(const user of names.sort()){
  const userRoot=join(workdir,user),projectRoot=join(userRoot,'projects');
  if(user===ambiguousUser)continue;
  if(!await realDirectory(userRoot))continue;
  const bytes=await stateBytes(projectRoot);if(bytes===undefined)continue;
  if(totalBytes+bytes>MAX_MISHU_STATE_BYTES){diagnostic('aggregate store capacity reached; skipped scope recovers on authenticated access');continue;}
  if(recovered>=MAX_RECOVERY_SCOPES){diagnostic('scope capacity reached; remaining scopes recover on authenticated access');return;}
  totalBytes+=bytes;recovered++;yield user;
 }
}
async function realDirectory(path:string):Promise<boolean>{
 try{return (await lstat(path)).isDirectory();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')diagnostic('store path unavailable');return false;}
}
async function stateBytes(root:string):Promise<number|undefined>{
 for(const path of [root,join(root,'.coffee'),join(root,'.coffee','mishu')])if(!await realDirectory(path))return undefined;
 try{
  const info=await lstat(join(root,'.coffee','mishu','state.json'));
  if(!info.isFile())return undefined;
  if(info.size>MAX_MISHU_STATE_BYTES){diagnostic('store capacity exceeded');return undefined;}
  return info.size;
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')diagnostic('store unavailable');return undefined;}
}
