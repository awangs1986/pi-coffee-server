import {constants} from 'node:fs';
import {open,link,rm,realpath,readdir,lstat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,relative,resolve} from 'node:path';
import {checkedTaskRoot} from '../task-storage.js';

const MAX_IMAGE_BYTES=256*1024*1024;
function imageHeader(bytes:Buffer,extension:string){
 if(extension==='png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(extension==='webp')return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
 return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
}
async function checkedImage(file:Awaited<ReturnType<typeof open>>,extension:string){
 const info=await file.stat();
 if(!info.isFile()||info.uid!==process.getuid?.()||info.nlink!==1||info.size<12||info.size>MAX_IMAGE_BYTES)throw Error('Unsafe native image');
 const bytes=Buffer.alloc(12);await file.read(bytes,0,12,0);if(!imageHeader(bytes,extension))throw Error('Native output is not the declared image type');return info;
}
async function recoverPublishedImage(directory:string,file:Awaited<ReturnType<typeof open>>){
 const info=await file.stat();if(info.nlink!==2||!info.isFile()||info.uid!==process.getuid?.())return;
 // A crash after publication can retain our second, temporary name. Remove
 // only that same-inode staging link, never an arbitrary external hardlink.
 for(const name of (await readdir(directory)).slice(0,5000)){
  if(!/^\.native-image-[0-9a-f-]{36}$/.test(name))continue;
  const path=join(directory,name),temporary=await lstat(path).catch(()=>undefined);
  if(temporary?.isFile()&&temporary.uid===info.uid&&temporary.dev===info.dev&&temporary.ino===info.ino){await rm(path);return;}
 }
}

/** Only the configured native home + an owned binding can supply a new image.
 * Directory descriptors anchor reads/copies even if named directories change. */
export async function importCodexImage(input:{home:string;nativeIds:string[];path:string;directory:string;validate:()=>Promise<void>}):Promise<string|undefined>{
 const root=resolve(input.home,'generated_images'),parts=relative(root,input.path).split('/');
 if(input.path!==resolve(input.path)||parts.length!==2||! /^[a-zA-Z0-9-]{1,100}$/.test(parts[0])||! /^exec-[a-zA-Z0-9-]+\.(png|jpe?g|webp)$/i.test(parts[1]))return;
 const extension=parts[1].split('.').at(-1)!.toLowerCase();
 const name='codex-'+createHash('sha256').update(input.path).digest('hex')+'.'+extension;
 await checkedTaskRoot(input.directory);await input.validate();
 const destination=await open(input.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 const at='/proc/self/fd/'+destination.fd,target=join(at,name);
 let source:Awaited<ReturnType<typeof open>>|undefined,base:Awaited<ReturnType<typeof open>>|undefined,thread:Awaited<ReturnType<typeof open>>|undefined,output:Awaited<ReturnType<typeof open>>|undefined,temporary:string|undefined;
 try{
  // Previously imported copies, including copied Fork data, survive native cleanup.
  try{const existing=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{await recoverPublishedImage(at,existing);await checkedImage(existing,extension);return name;}finally{await existing.close();}}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(!input.nativeIds.includes(parts[0]))throw Error('Generated image is not owned by this task');
  if(await realpath(root)!==root)throw Error('Unsafe native image directory');
  base=await open(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  if((await base.stat()).uid!==process.getuid?.())throw Error('Unsafe native image owner');
  thread=await open(join('/proc/self/fd/'+base.fd,parts[0]),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  if((await thread.stat()).uid!==process.getuid?.())throw Error('Unsafe native image owner');
  source=await open(join('/proc/self/fd/'+thread.fd,parts[1]),constants.O_RDONLY|constants.O_NOFOLLOW);
  const before=await checkedImage(source,extension),buffer=Buffer.alloc(64*1024);
  temporary=join(at,'.native-image-'+randomUUID());output=await open(temporary,'wx',0o600);
  for(let position=0;position<before.size;){
   const {bytesRead}=await source.read(buffer,0,Math.min(buffer.length,before.size-position),position);
   if(!bytesRead)throw Error('Native image changed during copy');await output.writeFile(buffer.subarray(0,bytesRead));position+=bytesRead;
  }
  const after=await source.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('Native image changed during copy');
  await input.validate();if(await realpath(input.directory)!==input.directory)throw Error('Task image directory changed');
  const current=await open(input.directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  try{const a=await destination.stat(),b=await current.stat();if(a.dev!==b.dev||a.ino!==b.ino)throw Error('Task image directory changed');}finally{await current.close();}
  await output.sync();await output.close();output=undefined;
  try{await link(temporary,target);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);try{await checkedImage(existing,extension);}finally{await existing.close();}}
  await rm(temporary);temporary=undefined;await destination.sync();return name;
 }finally{
  try{await output?.close();if(temporary)await rm(temporary,{force:true});}
  finally{await Promise.allSettled([source?.close(),thread?.close(),base?.close(),destination.close()]);}
 }
}
