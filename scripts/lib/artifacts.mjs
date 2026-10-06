import {readdir,lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
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
