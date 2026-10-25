import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackupCoordinator,WriterAdmissionFence,type NativeRecoveryAdapter} from '../src/host/backup.js';
import {Workspaces} from '../src/host/workspaces.js';
import {HostServer} from '../src/host/server.js';
async function fixture(options:{maxBytes?:number;captureTimeoutMs?:number}={}){
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-admission-')),store=new Workspaces(join(root,'projects'));
 const fence=new WriterAdmissionFence({writerClasses:['platform'],uncoveredWriters:[],probe:async()=>({known:true})});store.setBackupWriterFence(fence);const task=await store.createChatConversation('task');
 const native=join(root,'native.jsonl');await writeFile(native,'{"type":"session","id":"fixture"}\n');
 let release=()=>{},reached=()=>{},hold=false,entered=Promise.resolve();
 const adapter:NativeRecoveryAdapter={version:'controlled-fixture-v1',async resolve(scope,taskId){return {groupId:'fixture',fence,members:[{scope,taskId,engine:'pi',nativeBindings:['fixture']}],sources:[{id:'native',recoveryKey:'native/fixture',role:'native',path:native},{id:'workspace',recoveryKey:'workspace',role:'workspace',path:task.cwd},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from(JSON.stringify(await store.lookup(taskId)))},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],async validate(){if(hold){hold=false;reached();await new Promise<void>(r=>release=r);}}};}};
 const backup=new BackupCoordinator({root:join(root,'checkpoints'),adapter,...options});
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native runtime needed');}};
 const server=new HostServer({port:0,token:'fixture',requireUser:true,factory,backup:{coordinator:backup},scopeForUser:()=>({factory,workspaces:store})});await server.start();
 const call=async(body:unknown,path='/api/backup',attempt=0):Promise<{status:number;data:any}>=>{const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'awangs','content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(data.state==='waiting'&&data.reason==='Consistency group has active writers'&&attempt<40){await new Promise(r=>setTimeout(r,10));return call(body,path,attempt+1);}return {status:response.status,data};};
 await call({action:'status',id:'task'},'/api/mishu');
 return {root,task,backup,call,pause(){hold=true;entered=new Promise<void>(r=>reached=r);return ()=>entered;},release:()=>release(),async close(){release();await server.close();await rm(root,{recursive:true,force:true});}};
}
it('a new workspace write revokes capture before mutation and retains the older sealed point',async()=>{
 const f=await fixture();try{
  const old=await f.call({action:'capture',taskId:'task'});expect(old.data.coverage).toBe('complete');
  const reached=f.pause(),capture=f.call({action:'capture',taskId:'task'});await reached();
  expect((await f.call({action:'sidebar_pin',id:'task',pinned:true},'/api/workspace')).status).toBe(200);
  f.release();const result=await capture;expect(result.data).toMatchObject({state:'waiting',checkpointId:old.data.checkpointId,captureAt:old.data.captureAt});
  expect((await f.backup.sealedCheckpoint('awangs','task'))!.manifest.checkpointId).toBe(old.data.checkpointId);
 }finally{await f.close();}
});
it('cancel and deadline bound a stalled capture without publishing unfinished materials',async()=>{
 const f=await fixture({captureTimeoutMs:500});try{
  let reached=f.pause(),capture=f.call({action:'capture',taskId:'task'});await reached();
  expect((await f.call({action:'cancel',taskId:'task'})).data.cancelled).toBe(true);
  expect((await capture).data).toMatchObject({state:'failed',checkpointId:null,reason:'Capture cancelled; previous sealed checkpoint retained'});f.release();
  reached=f.pause();capture=f.call({action:'capture',taskId:'task'});await reached();
  expect((await capture).data).toMatchObject({state:'failed',checkpointId:null,reason:'Capture resource deadline exceeded'});f.release();
 }finally{await f.close();}
});
it('rejects symlink escapes and byte-budget overflow instead of calling partial material complete',async()=>{
 const f=await fixture({maxBytes:4096});try{
  await writeFile(join(f.root,'private-secret'),'must not leak');await symlink(join(f.root,'private-secret'),join(f.task.cwd,'escape'));
  expect((await f.call({action:'capture',taskId:'task'})).data).toMatchObject({state:'failed',coverage:'unavailable',checkpointId:null,reason:'Source contains an unsafe path or unsupported file type'});
  await rm(join(f.task.cwd,'escape'));await writeFile(join(f.task.cwd,'large'),Buffer.alloc(8192));
  expect((await f.call({action:'capture',taskId:'task'})).data).toMatchObject({state:'failed',checkpointId:null,reason:'Capture resource limit exceeded'});
  await rm(join(f.task.cwd,'large'));await writeFile(join(f.task.cwd,'local'),'inside-owned-tree');await symlink('local',join(f.task.cwd,'safe-link'));
  expect((await f.call({action:'capture',taskId:'task'})).data.coverage).toBe('complete');
  const safe=await f.backup.sealedCheckpoint('awangs','task');expect(safe!.manifest.objects.find(o=>o.path==='objects/workspace/safe-link')).toMatchObject({kind:'symlink',linkTarget:'local'});
  await mkdir(join(f.root,'checkpoints','staging','orphan'));await writeFile(join(f.root,'checkpoints','staging','orphan','seal'),'unfinished');
  expect((await f.backup.sealedCheckpoint('awangs','task'))!.manifest.checkpointId).toBe(safe!.manifest.checkpointId);
 }finally{await f.close();}
});
