import {lstat,readdir,mkdir,copyFile,readlink,symlink,chmod} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
const caches=new Set(['node_modules','.venv','venv','__pycache__','.cache']);
/** Stream/copy files into a new task; never share writable Git metadata or external links. */
export async function copyForkTree(source:string,target:string,options:{workspace?:boolean;tracked?:Set<string>}={}){
 const walk=async(from:string,to:string,parts:string[])=>{
  await mkdir(to,{recursive:true});
  for(const entry of await readdir(from,{withFileTypes:true})){
   const names=[...parts,entry.name],path=names.join('/');
   if(options.workspace&&names.length===1&&['.git','.pi-coffee'].includes(entry.name))continue;
   if(entry.name==='.git')throw new Error('Fork requires nested Git repositories/submodules to be handled separately: '+path);
   if(caches.has(entry.name)&&!options.tracked?.has(path)&&![...(options.tracked??[])].some(name=>name.startsWith(path+'/')))continue;
   const a=join(from,entry.name),b=join(to,entry.name),info=await lstat(a);
   if(info.isSymbolicLink()){
    const link=await readlink(a),destination=resolve(from,link),rel=relative(source,destination);
    if(rel.startsWith('..')||isAbsolute(rel)||rel==='.git'||rel.startsWith('.git/'))throw new Error('Fork cannot share external or Git-internal symlinks: '+path);
    // Translate absolute internal links, retaining relative ones inside the new tree.
    await symlink(isAbsolute(link)?resolve(target,rel):link,b);
   }else if(info.isDirectory()){await walk(a,b,names);await chmod(b,info.mode&0o777);}
   else if(info.isFile()){await copyFile(a,b);await chmod(b,info.mode&0o777);}
   else throw new Error('Fork cannot copy special files: '+path);
  }
 };
 await walk(source,target,[]);
}
