import {lstat,mkdir,mkdtemp,readFile,readdir,rename,rm,stat,statfs,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

const leaseName='.coffee-temp-owner.json';
const maxMemoryBytes=2*1024**3;
type Lease={version:1;pid:number;start:string;boot:string;cgroup:string};
async function identity(pid:number):Promise<string>{
 const value=await readFile(`/proc/${pid}/stat`,'utf8');
 return value.slice(value.lastIndexOf(')')+2).split(' ')[19];
}
async function processUses(path:string,cgroup:string,createdAfter:string):Promise<boolean>{
 // An orphan CLI can outlive its Host. Do not treat the dead parent as proof
 // that its temporary files are unused. Unreadable relevant processes retain data.
 for(const entry of await readdir('/proc')){
  if(!/^\d+$/.test(entry))continue;
  try{
   const base='/proc/'+entry;
   const owner=await stat(base);
   if(owner.uid!==process.getuid?.() && await readFile(base+'/cgroup','utf8')!==cgroup)continue;
   let environment:string;
   try{environment=await readFile(base+'/environ','utf8');}catch(error){
    // Pre-existing protected daemons in unrelated units cannot have inherited
    // a directory created later. New or same-unit unreadable processes retain it.
    if((error as NodeJS.ErrnoException).code==='EACCES'&&BigInt(await identity(Number(entry)))<BigInt(createdAfter)&&await readFile(base+'/cgroup','utf8')!==cgroup)continue;
    throw error;
   }
   const values=environment.split('\0');
   if(values.some(v=>['TMPDIR=','TMP=','TEMP='].some(k=>v.startsWith(k)&&(v.slice(k.length)===path||v.slice(k.length).startsWith(path+'/')))))return true;
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as NodeJS.ErrnoException).code!=='ESRCH')return true;}
 }
 return false;
}
async function reap(root:string,boot:string):Promise<void>{
 for(const item of await readdir(root,{withFileTypes:true})){
  if(!item.isDirectory()||!/^(host-[A-Za-z0-9]+|reaping-[a-f0-9-]+)$/.test(item.name))continue;
  const path=join(root,item.name);
  try{
   const info=await lstat(path);if(info.uid!==process.getuid?.()||(info.mode&0o077)!==0)continue;
   const file=join(path,leaseName),meta=await lstat(file);
   if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==process.getuid?.()||meta.size>4096)continue;
   const lease:Lease=JSON.parse(await readFile(file,'utf8'));
   if(lease.version!==1||!Number.isSafeInteger(lease.pid)||lease.pid<=0||typeof lease.start!=='string'||typeof lease.boot!=='string'||typeof lease.cgroup!=='string')continue;
   if(lease.boot===boot){
    try{if(await identity(lease.pid)===lease.start)continue;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'&&(error as NodeJS.ErrnoException).code!=='ESRCH')continue;}
    if(await processUses(path,lease.cgroup,lease.start))continue;
   }
   // Claim once; concurrent collectors cannot remove a replacement directory.
   const claimed=join(root,'reaping-'+randomUUID());await rename(path,claimed);await rm(claimed,{recursive:true,force:true});
  }catch{ /* Unknown, inaccessible and incomplete directories are retained. */ }
 }
}

/** A disposable Host lifetime directory. Persistent data never belongs here. */
export async function createRuntimeTemp(root:string,storage:string='disk'){
 root=resolve(root);
 if(!['disk','memory'].includes(storage))throw Error('PI_COFFEE_TMP_STORAGE must be disk or memory');
 if(storage==='memory'){
  const info=await lstat(root),fs=await statfs(root);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||fs.type!==0x01021994||fs.blocks<=0||fs.blocks*fs.bsize>maxMemoryBytes||fs.files<=0||fs.files>131072)throw Error('Memory temporary storage requires a private tmpfs capped at 2 GiB');
 }else await mkdir(root,{recursive:true,mode:0o700});
 const boot=await readFile('/proc/sys/kernel/random/boot_id','utf8');
 await reap(root,boot);
 const path=await mkdtemp(join(root,'host-'));
 const lease:Lease={version:1,pid:process.pid,start:await identity(process.pid),boot,cgroup:await readFile('/proc/self/cgroup','utf8')};
 try{await writeFile(join(path,leaseName),JSON.stringify(lease),{mode:0o600,flag:'wx'});}catch(error){await rm(path,{recursive:true,force:true});throw error;}
 let collecting=false;
 const timer=setInterval(()=>{if(collecting)return;collecting=true;void reap(root,boot).catch(()=>undefined).finally(()=>{collecting=false;});},300_000);timer.unref();
 return {path,close:async()=>{clearInterval(timer);if(!await processUses(path,lease.cgroup,lease.start))await rm(path,{recursive:true,force:true});}};
}
