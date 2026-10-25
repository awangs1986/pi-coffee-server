import {it,expect,afterEach} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {acquireFileLease,processProtection} from '../src/host/linux-file-lease.js';

const children=new Set<ChildProcess>();
afterEach(async()=>{await Promise.all([...children].map(child=>stop(child,'SIGKILL')));});
async function job(path:string,mode:'shared'|'exclusive'='exclusive'){
 const program=`import {acquireFileLease} from ${JSON.stringify(pathToFileURL(resolve('dist/src/host/linux-file-lease.js')).href)};const lease=acquireFileLease(process.argv[1],process.argv[2]);process.stdout.write(lease?'held\\n':'busy\\n');if(lease){process.stdin.resume();process.stdin.on('end',()=>{lease.assertHeld();lease.release();process.exit(0);});}`;
 const child=spawn(process.execPath,['--input-type=module','-e',program,path,mode],{env:{PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});let output='';children.add(child);child.once('exit',()=>children.delete(child));child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data));
 await expect.poll(()=>output,{timeout:5000}).toMatch(/^(held|busy)\n/);return {child,held:output.startsWith('held')};
}
async function stop(child:ChildProcess,signal?:NodeJS.Signals){if(child.exitCode!==null||child.signalCode!==null)return;const done=once(child,'exit');if(signal)child.kill(signal);else child.stdin!.end();await done;}

it('independent jobs exclude competing writers and release the real kernel lease after controller death',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-kernel-job-'));await mkdir(join(root,'private'),{mode:0o700});const path=join(root,'private','job.lock');let first:ChildProcess|undefined;
 try{const a=await job(path);first=a.child;expect(a.held).toBe(true);expect((await job(path)).held).toBe(false);expect(acquireFileLease(path,'shared')).toBeUndefined();
  await stop(first,'SIGKILL');const b=await job(path);first=b.child;expect(b.held).toBe(true);await stop(first);
  const lease=acquireFileLease(path,'exclusive');expect(lease).toBeDefined();lease!.assertHeld();const descriptor=await readFile('/proc/self/fdinfo/'+lease!.fd,'utf8'),flags=descriptor.match(/^flags:\s+([0-7]+)/m)![1];expect(parseInt(flags,8)&0o2000000).toBe(0o2000000);lease!.release();lease!.release();
 }finally{if(first)await stop(first,'SIGKILL');await rm(root,{recursive:true,force:true});}
},15000);

it('concurrent readers keep a publisher excluded until all lifetimes end',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-kernel-read-'));await mkdir(join(root,'private'),{mode:0o700});const path=join(root,'private','group.lock');let a:ChildProcess|undefined,b:ChildProcess|undefined;
 try{const one=await job(path,'shared'),two=await job(path,'shared');a=one.child;b=two.child;expect(one.held&&two.held).toBe(true);expect(acquireFileLease(path,'exclusive')).toBeUndefined();await stop(a);expect(acquireFileLease(path,'exclusive')).toBeUndefined();await stop(b);const cut=acquireFileLease(path,'exclusive');expect(cut).toBeDefined();cut!.release();
 }finally{if(a)await stop(a,'SIGKILL');if(b)await stop(b,'SIGKILL');await rm(root,{recursive:true,force:true});}
},15000);

it('refuses symlinked or replaced lease authority without overwriting unrelated data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-kernel-path-'));await mkdir(join(root,'private'),{mode:0o700});const path=join(root,'private','job.lock'),victim=join(root,'victim');
 try{await writeFile(victim,'PRESERVE');await symlink(victim,path);expect(()=>acquireFileLease(path,'exclusive')).toThrow();expect(await readFile(victim,'utf8')).toBe('PRESERVE');await rm(path);
  const lease=acquireFileLease(path,'exclusive')!;await rename(path,path+'.old');await writeFile(path,'replacement',{mode:0o600});expect(()=>lease.assertHeld()).toThrow();lease.release();
  expect(processProtection().dumpable).toBeGreaterThanOrEqual(0);
 }finally{await rm(root,{recursive:true,force:true});}
});


it('a hardened service process denies same-UID credential reads through host procfs',async()=>{
 const program=`import {hardenCurrentProcess} from ${JSON.stringify(pathToFileURL(resolve('dist/src/host/linux-file-lease.js')).href)};process.stdout.write(JSON.stringify(hardenCurrentProcess())+'\\n');process.stdin.resume();`;
 const child=spawn(process.execPath,['--input-type=module','-e',program],{env:{PATH:process.env.PATH,SYNTHETIC_BACKUP_SECRET:'synthetic-only-value'},stdio:['pipe','pipe','pipe']});let output='';children.add(child);child.once('exit',()=>children.delete(child));child.stdout.on('data',data=>output+=String(data));
 try{await expect.poll(()=>output,{timeout:5000}).toContain('"dumpable":0');expect(JSON.parse(output)).toEqual({dumpable:0,noNewPrivs:1});await expect(readFile('/proc/'+child.pid+'/environ','utf8')).rejects.toThrow();}finally{await stop(child,'SIGTERM');}
});
