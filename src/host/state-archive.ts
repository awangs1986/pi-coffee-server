import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp,mkdir,lstat,readdir,readlink,readFile,open,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {durableJson,restoreFail,syncDir} from './restore-files.js';

export type StateArchiveKind='gitea'|'bootstrap'|'safety';
export interface StateArchiveManifest {
 recovery?:Record<string,unknown>;schema:1;id:string;kind:StateArchiveKind;version:string;captureAt:string;
 roots:Record<string,string>;files:Record<string,{type:'directory'|'file'|'link';sha256?:string;size?:number;link?:string}>;omitted:string[];
}
const kinds=new Set(['gitea','bootstrap','safety']);
async function inventory(root:string){
 const files:StateArchiveManifest['files']={};
 const walk=async(path:string)=>{for(const name of (await readdir(path)).sort()){
  if(path===root&&name==='archive.json')continue;
  const file=join(path,name),key=relative(root,file),info=await lstat(file);
  if(info.isSymbolicLink())files[key]={type:'link',link:await readlink(file)};
  else if(info.isDirectory()){files[key]={type:'directory'};await walk(file);}
  else if(info.isFile()){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);files[key]={type:'file',sha256:hash.digest('hex'),size:info.size};}
  else throw restoreFail('archive_unsupported_file');
 }};await walk(root);return files;
}
async function syncTree(root:string):Promise<void>{
 const info=await lstat(root);if(info.isSymbolicLink())return;
 if(info.isDirectory()){for(const name of await readdir(root))await syncTree(join(root,name));await syncDir(root);}
 else{const file=await open(root,'r');try{await file.sync();}finally{await file.close();}}
}
export async function createStateArchive(input:{recovery?:Record<string,unknown>;destination:string;kind:StateArchiveKind;version:string;roots:Record<string,string>;assertQuiescent:()=>Promise<void>}){
 if(!kinds.has(input.kind)||!input.version||!Object.keys(input.roots).length)throw restoreFail('invalid_archive');
 const destination=resolve(input.destination);
 for(const [name,path] of Object.entries(input.roots)){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)||name==='archive.json'||!isAbsolute(path)||await realpath(path)!==resolve(path))throw restoreFail('invalid_archive_root');
  const rel=relative(path,destination);if(!rel||!rel.startsWith('..')&&!isAbsolute(rel))throw restoreFail('archive_source_overlap');
 }
 await input.assertQuiescent();await mkdir(destination,{mode:0o700});const omitted:string[]=[];
 for(const [name,path] of Object.entries(input.roots))await cp(path,join(destination,name),{recursive:true,errorOnExist:true,force:false,verbatimSymlinks:true,filter:async source=>{const info=await lstat(source);if(info.isSymbolicLink()){const target=await realpath(source);if(!Object.values(input.roots).some(root=>{const rel=relative(root,target);return !rel||!rel.startsWith('..')&&!isAbsolute(rel);}))throw restoreFail('archive_external_link');}if(info.isSocket()||info.isFIFO()){omitted.push(source);return false;}return true;}});
 await input.assertQuiescent();await syncTree(destination);
 const manifest:StateArchiveManifest={...(input.recovery?{recovery:input.recovery}:{}),schema:1,id:randomUUID(),kind:input.kind,version:input.version,captureAt:new Date().toISOString(),roots:input.roots,files:await inventory(destination),omitted};
 await durableJson(join(destination,'archive.json'),manifest);await verifyStateArchive(destination);return manifest;
}
export async function verifyStateArchive(root:string):Promise<StateArchiveManifest>{
 const manifest:StateArchiveManifest=JSON.parse(await readFile(join(root,'archive.json'),'utf8'));
 if(manifest.schema!==1||!kinds.has(manifest.kind)||!manifest.roots||!manifest.files||!Number.isFinite(Date.parse(manifest.captureAt))||!/^[a-f0-9-]{36}$/.test(manifest.id)||JSON.stringify(await inventory(root))!==JSON.stringify(manifest.files))throw restoreFail('archive_corrupt');
 for(const [label,path] of Object.entries(manifest.roots))if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(label)||!isAbsolute(path)||!manifest.files[label])throw restoreFail('archive_corrupt');
 return manifest;
}
