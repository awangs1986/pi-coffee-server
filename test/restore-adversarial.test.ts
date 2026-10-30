import {it,expect} from 'vitest';import {mkdtemp,rm,writeFile,mkdir,symlink,readdir,readFile,lstat,chmod,rename} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';import {fork} from 'node:child_process';import {once} from 'node:events';
import {restoreFixture} from './restore-fixture.js';
const binary=process.env.PI_COFFEE_TEST_RESTIC;
it.skipIf(!binary)('rejects a changed sealed manifest after administrator approval before any target publication',async()=>{
 const f=await restoreFixture(binary!);try{
  const stage=(await readdir(join(f.root,'restore-runtime'))).find(n=>n.startsWith(f.plan.id+'-r1-'))!;
  const extract=join(f.root,'restore-runtime',stage,'extract'),checkpoint=(await readdir(extract))[0];
  const manifest=join(extract,checkpoint,'manifest.json');await chmod(manifest,0o600);await writeFile(manifest,(await readFile(manifest,'utf8'))+'\n');
  await expect(f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'checkpoint_damaged'});
  await expect(lstat(f.task.cwd)).rejects.toMatchObject({code:'ENOENT'});expect((await f.store.list()).conversations.map(c=>c.id)).toEqual(['neighbor']);
 }finally{await rm(f.root,{recursive:true,force:true});}
},90000);
it.skipIf(!binary)('never replaces a new target, a symlink or a target parent with changed identity',async()=>{
 const f=await restoreFixture(binary!);try{
  const outside=join(f.root,'unowned');await mkdir(outside,{mode:0o700});await writeFile(join(outside,'new'),'new user content');await symlink(outside,f.task.cwd);
  await expect(f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'target_changed'});expect(await readFile(join(outside,'new'),'utf8')).toBe('new user content');
  await rm(f.task.cwd);await mkdir(f.task.cwd,{mode:0o700});await writeFile(join(f.task.cwd,'new'),'keep me');
  await expect(f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'target_changed'});expect(await readFile(join(f.task.cwd,'new'),'utf8')).toBe('keep me');
  await rm(f.task.cwd,{recursive:true});const parent=dirname(f.task.cwd);await rename(parent,parent+'-old');await mkdir(parent,{mode:0o700});
  await expect(f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'target_parent_changed'});
  const lock=join(f.root,'restore-runtime','operation.lock');await rename(lock,lock+'.old');await writeFile(lock,'replacement',{mode:0o600});
  await expect(f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'lock_identity_changed'});
  expect((await f.store.list()).conversations.map(c=>c.id)).toEqual(['neighbor']);
 }finally{await rm(f.root,{recursive:true,force:true});}
},90000);
it.skipIf(!binary)('cancels a prepared plan and truthfully reports completion after cancellation once publication has started',async()=>{
 const f=await restoreFixture(binary!);let child:ReturnType<typeof fork>|undefined;try{
  child=fork('test/fixtures/restore-worker.mjs',[f.root,f.plan.id,f.plan.digest!,'task'],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,HOME:f.root}});const exited=once(child,'exit');const [progress]=await once(child,'message');expect(progress).toMatchObject({phase:'task'});
  expect(await f.restore.operate('alice',f.plan.id,{action:'cancel',revision:1})).toMatchObject({cancelRequested:true});
  const next=once(child,'message');child.send({continue:true});const [message]=await next;expect(message).toMatchObject({result:{state:'completed-after-cancel',cancelRequested:true}});expect((await exited)[0]).toBe(0);child=undefined;
  const requested=await f.restore.request('alice','alice',{taskId:'lost-task',jobId:f.plan.jobId});expect((await f.restore.operate('alice',requested.id,{action:'cancel',revision:1})).state).toBe('cancelled');
  await expect(f.restore.operate('awangs',requested.id,{action:'plan',revision:1})).rejects.toMatchObject({code:'operation_cancelled'});
 }finally{if(child){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}await rm(f.root,{recursive:true,force:true});}
},90000);
