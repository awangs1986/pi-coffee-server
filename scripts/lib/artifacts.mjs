import {readdir,lstat,readFile,readlink,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
export const sha256=body=>createHash('sha256').update(body).digest('hex');
export async function artifacts(root){
 const result=Object.create(null);
 async function walk(relative=''){
  for(const name of (await readdir(join(root,relative))).sort()){
   const path=relative?relative+'/'+name:name,file=join(root,path),meta=await lstat(file);
   if(meta.isDirectory())await walk(path);else if(meta.isFile())result[path]=sha256(await readFile(file));else throw Error('Non-regular artifact');
  }
 }
 await walk();return result;
}
export async function optionalArtifacts(root){try{return await artifacts(root);}catch(error){if(error.code==='ENOENT')return {};throw error;}}

// Runtime dependency closure permits only links resolving inside the copied tree.
export async function dependencyArtifacts(root){
 const result=Object.create(null),base=resolve(root);
 let rootMeta;try{rootMeta=await lstat(base);}catch(error){if(error.code==='ENOENT')return {};throw error;}
 if(!rootMeta.isDirectory()||rootMeta.isSymbolicLink())throw Error('Dependency root must be a real directory');
 async function walk(prefix=''){
  for(const name of (await readdir(join(base,prefix))).sort()){
   const key=prefix?prefix+'/'+name:name,file=join(base,key),meta=await lstat(file);
   if(meta.isDirectory())await walk(key);
   else if(meta.isFile())result[key]={sha256:sha256(await readFile(file)),executable:!!(meta.mode&0o111)};
   else if(meta.isSymbolicLink()){
    const target=await readlink(file),resolved=relative(base,await realpath(file));
    if(isAbsolute(target)||resolved==='..'||resolved.startsWith('../')||isAbsolute(resolved))throw Error('Dependency link escapes release');
    result[key]={link:target};
   }else throw Error('Non-regular dependency');
  }
 }
 try{await walk();}catch(error){if(error.code==='ENOENT'&&await lstat(base).catch(()=>null)===null)return {};throw error;}
 return result;
}
