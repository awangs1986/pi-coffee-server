import {mkdir,lstat,realpath,writeFile,rename,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Platform-owned task files; never reads or rewrites a native Agent store. */
export async function checkedTaskRoot(path:string):Promise<string>{
 const info=await lstat(path);
 if(!info.isDirectory() || info.isSymbolicLink() || await realpath(path)!==resolve(path))throw new Error('Task storage path changed or is unavailable');
 return path;
}
export async function claimTaskRoot(root:string,id:string):Promise<string>{
 await mkdir(root,{recursive:true,mode:0o700});await checkedTaskRoot(root);
 const path=join(root,id);await mkdir(path,{mode:0o700});
 await prepareTaskRoot(path);return path;
}
export async function prepareTaskRoot(path:string):Promise<void>{
 await checkedTaskRoot(path);
 for(const name of ['history','attachments','artifacts','research','images']){
  const dir=join(path,name);await mkdir(dir,{recursive:true,mode:0o700});await checkedTaskRoot(dir);
 }
}
export async function writeTaskJson(root:string,name:string,value:unknown):Promise<void>{
 await checkedTaskRoot(root);
 const temp=join(root,randomUUID()+'.tmp');
 try{await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,join(root,name));}
 finally{await rm(temp,{force:true});}
}

/** Account names are administrator mappings, never browser-supplied paths. */
export function taskRootForScope(root:string|undefined,defaultAccount:string|undefined,user:string|undefined,mapping:Record<string,string>={}):string|undefined{
 if(!root)return undefined;
 const account=user===undefined ? defaultAccount : Object.hasOwn(mapping,user)?mapping[user]:user;
 if(typeof account!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(account))throw new Error('Configure a safe task storage account name');
 if(user!==undefined && account===defaultAccount)throw new Error('Scoped task storage cannot share the default account directory');
 const values=Object.values(mapping);
 if(user!==undefined && !Object.hasOwn(mapping,user) && values.includes(account))throw new Error('Task storage account is reserved for another scope');
 if(values.some(value=>typeof value!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) || new Set(values).size!==values.length)throw new Error('Task storage account mappings must be safe and unique');
 return join(resolve(root),account,'projects');
}
