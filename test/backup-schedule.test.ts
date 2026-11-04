import {it,expect,vi} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {BackupJobRunner} from '../src/host/backup-job-runner.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('persists a Toronto daily attempt, retries at 15/60 minutes, and catches up only the latest missed date',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-'));
 let time=Date.parse('2026-10-25T07:59:00Z');
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>time});
 const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});
 const create=()=>new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});
 let runner=create();
 try{
  await runner.configure({revision:'daily-v1',scopes:['alice','bob']});
  await runner.updateInventory('alice',[{taskId:'pi-task',engine:'pi'},{taskId:'later',engine:'claude'}]);
  await runner.updateInventory('bob',[{taskId:'codex-task',engine:'codex'}]);
  expect((await runner.tick()).dispatched).toBe(false);
  time=Date.parse('2026-10-25T08:00:00Z');
  expect((await runner.tick()).dispatched).toBe(true);
  let state=await runner.status('alice');
  expect(state.runs).toMatchObject([{date:'2026-10-25',state:'failed',attempts:[{number:1}]}]);
  expect(state.coverage).toMatchObject({state:'partial',unprotected:['pi-task'],excluded:[{taskId:'later',engine:'claude'}]});
  expect(JSON.stringify(state)).not.toContain('codex-task');
  expect(state.alerts.filter(a=>a.kind==='job-failed'&&!a.resolvedAt)).toHaveLength(1);
  runner=create();time+=14*60000;
  expect((await runner.tick()).dispatched).toBe(false);
  time+=60000;expect((await runner.tick()).dispatched).toBe(true);
  time=Date.parse('2026-10-25T08:59:59Z');expect((await runner.tick()).dispatched).toBe(false);
  time+=1000;expect((await runner.tick()).dispatched).toBe(true);
  time=Date.parse('2026-10-25T20:00:00Z');expect((await create().tick()).dispatched).toBe(false);
  state=await runner.status('alice');expect(state.runs[0].attempts).toHaveLength(3);
  expect(state.alerts.filter(a=>a.kind==='job-failed')).toHaveLength(1);
  time=Date.parse('2026-10-28T12:00:00Z');
  expect((await create().tick()).dispatched).toBe(true);
  state=await runner.status('alice');expect(state.runs.map(r=>r.date)).toEqual(['2026-10-28','2026-10-25']);
 }finally{await rm(root,{recursive:true,force:true});}
});

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('persists failure, stale, retry and recovery alerts without native launches or HTTP reminders',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-real-'));let server:HostServer|undefined;let fetchObserver:ReturnType<typeof vi.spyOn>|undefined;const requests:{url:string;method:string;action?:string;scope?:string}[]=[];let nativeLaunches=0;
 let time=Date.parse('2026-10-24T07:00:00Z');
 const stores=new Map<string,Workspaces>(),fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})});
 try{
  for(const scope of ['alice','bob']){const store=new Workspaces(join(root,scope,'projects'));await store.createChatConversation('task');await writeFile(join((await store.lookup('task'))!.cwd,'draft'),scope+' historical draft');stores.set(scope,store);}
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>time,adapter:{version:'bounded-schedule-fixture-v1',resolve:async(scope,id)=>{
   const task=(await stores.get(scope)!.lookup(id))!;return {groupId:'fixture',fence,members:[{scope,taskId:id,engine:'pi',nativeBindings:[id]}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:task.cwd},{id:'native',recoveryKey:'native',role:'native',data:Buffer.from('controlled native fixture')},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}};
  }}});
  await coordinator.capture('alice','task','pi');await coordinator.capture('bob','task','pi');
  await stores.get('alice')!.createChatConversation('new-task');await stores.get('alice')!.createChatConversation('deferred');
  // The actual Host inventory contains a newly created task even though no point exists for it.
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{nativeLaunches++;throw Error('Schedule must not launch a model');}};
  server=new HostServer({port:0,token:'private-schedule-test',requireUser:true,factory,backup:{coordinator,scopes:['alice','bob']},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const inventoryUrl=`http://127.0.0.1:${server.address().port}/api/backup`,originalFetch=globalThis.fetch;
  fetchObserver=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const url=input instanceof Request?input.url:String(input),request:{url:string;method:string;action?:string;scope?:string}={url,method:init?.method??(input instanceof Request?input.method:'GET')};requests.push(request);if(typeof init?.body==='string'){try{const body=JSON.parse(init.body);request.action=body?.action;request.scope=body?.scope;}catch{/* Non-JSON attempts stay recorded and fail the final allowlist. */}}if(url!==inventoryUrl)throw Error('Synthetic fixture refuses unexpected outbound request');return originalFetch(input,init);});
  const credential=join(root,'host-token');await writeFile(credential,'private-schedule-test',{mode:0o600});
  const disk=join(root,'disk');await mkdir(disk,{mode:0o700});
  const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  time=Date.parse('2026-10-25T07:59:00Z');const runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});
  await runner.configure({revision:'real-v1',scopes:['alice','bob'],host:{url:`http://127.0.0.1:${server.address().port}`,tokenFile:credential,actor:'awangs'}});
  const release=fence.beginWriter('fixture');time+=60000;
  expect((await runner.tick()).dispatched).toBe(true);release();
  let status=await runner.status('alice');expect(status.coverage).toMatchObject({state:'partial',unprotected:['new-task','deferred'],stale:['task']});
  expect(status.coverage.points[0].captureAt).toBe('2026-10-24T07:00:00.000Z');
  expect((await repository.jobs())[0].state).toBe('succeeded');
  time+=60000;for(const [scope,store] of stores)for(const task of (await store.list()).conversations)await coordinator.capture(scope,task.id,'pi');
  await rename(disk,disk+'-offline');time=Date.parse('2026-10-25T08:15:00Z');await runner.tick();
  status=await runner.status('alice');expect(status.coverage.stale).toEqual(['task']);expect(status.alerts.filter(a=>a.kind==='point-stale'&&!a.resolvedAt)).toHaveLength(1);
  expect(status.coverage.points[0].captureAt).toBe('2026-10-24T07:00:00.000Z');
  await rename(disk+'-offline',disk);time=Date.parse('2026-10-25T09:00:00Z');await runner.tick();
  status=await runner.status('alice');expect(status.coverage.state).toBe('complete');expect(status.runs[0].state).toBe('succeeded');
  expect(status.alerts.filter(a=>a.kind==='point-stale')).toHaveLength(1);expect(status.alerts.find(a=>a.kind==='point-stale')!.resolvedAt).toBe('2026-10-25T09:00:00.000Z');
  const successful=(await repository.jobs()).filter(j=>j.state==='succeeded');expect(successful).toHaveLength(2);
  // Model a repository service outage through its actual durable boundary.
  await rename(join(root,'repository'),join(root,'repository-offline'));await writeFile(join(root,'repository'),'unavailable service storage');
  status=await runner.status('alice');expect(status.coverage).toMatchObject({state:'unknown',repositoryAvailable:false});expect(status.coverage.points).toHaveLength(3);expect(status.coverage.points.every(p=>p.captureAt==='2026-10-25T08:01:00.000Z')).toBe(true);
  await runner.tick();expect((await runner.status('alice')).alerts.filter(a=>a.kind==='repository-unavailable'&&!a.resolvedAt)).toHaveLength(1);
  await rm(join(root,'repository'));await rename(join(root,'repository-offline'),join(root,'repository'));

  await server.close();server=undefined;time=Date.parse('2026-10-26T08:00:00Z');await runner.tick();
  status=await runner.status('alice');expect(status.coverage.state).toBe('unknown');expect(status.coverage.points.every(p=>p.captureAt==='2026-10-25T08:01:00.000Z')).toBe(true);
  expect(status.alerts.filter(a=>a.kind==='inventory-unavailable'&&!a.resolvedAt)).toHaveLength(1);
  expect((await repository.jobs()).filter(j=>j.state==='succeeded')).toHaveLength(3);
  expect(JSON.stringify(await runner.status('bob'))).not.toContain('new-task');
  expect(nativeLaunches).toBe(0);expect(requests.length).toBeGreaterThan(0);expect(requests.filter(request=>request.url!==inventoryUrl||request.method!=='POST'||request.action!=='status'||!['alice','bob'].includes(request.scope??''))).toEqual([]);
  const reopened=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});const persisted=await reopened.status('alice');expect(persisted.alerts.filter(alert=>alert.kind==='point-stale')).toMatchObject([{resolvedAt:'2026-10-25T09:00:00.000Z'}]);expect(persisted.alerts.filter(alert=>alert.kind==='point-stale')).toHaveLength(1);
 }finally{fetchObserver?.mockRestore();await server?.close();await rm(root,{recursive:true,force:true});}
},180000);

it('dispatches once at 04:00 across Toronto fall-back and spring-forward without replaying a new revision in the past',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-dst-'));let time=Date.parse('2026-11-01T08:59:00Z');
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>time});
 const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});
 const runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});
 try{
  await runner.configure({revision:'fall',scopes:['alice']});await runner.updateInventory('alice',[{taskId:'task',engine:'pi'}]);
  expect((await runner.tick()).dispatched).toBe(false);time+=60000;expect((await runner.tick()).dispatched).toBe(true);
  expect((await runner.status('alice')).runs[0]).toMatchObject({date:'2026-11-01',startedAt:'2026-11-01T09:00:00.000Z'});
  time-=60000;expect((await runner.tick()).dispatched).toBe(false);time+=60000;expect((await runner.tick()).dispatched).toBe(false);
  time=Date.parse('2027-03-14T07:59:00Z');await runner.configure({revision:'spring',scopes:['alice']});
  expect((await runner.tick()).dispatched).toBe(false);time+=60000;expect((await runner.tick()).dispatched).toBe(true);
  expect((await runner.status('alice')).runs[0]).toMatchObject({date:'2027-03-14',startedAt:'2027-03-14T08:00:00.000Z'});
  await expect(runner.configure({revision:'spring',scopes:['alice'],hour:5})).rejects.toMatchObject({code:'schedule_revision_conflict'});
 }finally{await rm(root,{recursive:true,force:true});}
});

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('reconciles a lost successful repository response after SIGKILL and serializes concurrent scheduler processes',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{pathToFileURL}=await import('node:url');
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-crash-'));const children:import('node:child_process').ChildProcess[]=[];let held:()=>void=()=>{};
 const time=Date.parse('2026-10-25T08:00:00Z'),coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>time,adapter:{version:'controlled-ipc-scheduler-v1',resolve:async()=>({groupId:'fixture',fence:new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})}),members:[{scope:'alice',taskId:'task',engine:'pi',nativeBindings:['task']}],sources:[{id:'workspace',role:'workspace',recoveryKey:'workspace',data:Buffer.from('private draft')},{id:'native',role:'native',recoveryKey:'native',data:Buffer.from('native notes')},{id:'registry',role:'registry',recoveryKey:'registry',data:Buffer.from('{}')},{id:'task-data',role:'task-data',recoveryKey:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
 const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});
 try{
  await coordinator.capture('alice','task','pi');const disk=join(root,'disk');await mkdir(disk,{mode:0o700});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});await runner.configure({revision:'ipc-v1',scopes:['alice']});await runner.updateInventory('alice',[{taskId:'task',engine:'pi'}]);
  const worker=join(root,'scheduler.mjs');await writeFile(worker,`
import {BackupJobRunner} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'dist/src/host/backup-job-runner.js')).href)};
import {BackupCoordinator} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'dist/src/host/backup.js')).href)};
let sequence=0;const pending=new Map();process.on('message',message=>{const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Object.assign(Error('transport error'),{code:message.error})):item.resolve(message.result);}});
const call=(method,args=[])=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});process.send({method,args,id});});
const repository={status:scope=>call('status',[scope]),jobs:()=>call('jobs'),backup:(selection,signal,id)=>call('backup',[selection,null,id]),recoverInterruptedOperation:()=>call('recoverInterruptedOperation')};
const runner=new BackupJobRunner({root:process.argv[2]+'/schedule',repository,coordinator:new BackupCoordinator({root:process.argv[2]+'/checkpoints'}),now:()=>${time}});
try{process.send({done:await runner.tick()});}catch(error){process.send({failed:error.code||'unknown'});}process.disconnect();
`,{mode:0o600});
  let dispatches=0;let notify!:()=>void;const committed=new Promise<void>(resolve=>notify=resolve);
  const start=(delay:false|'kill'|'timeout'=false)=>{
   const child=spawn(process.execPath,[worker,root],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);
   const result=new Promise<any>((resolve,reject)=>{let error='';child.stderr!.on('data',chunk=>error+=chunk);child.on('error',reject);child.on('message',async(message:any)=>{
    if(message.done||message.failed){resolve(message);return;}const {method,args,id}=message;
    try{let value;if(method==='backup'){dispatches++;value=await repository.backup(args[0],undefined,args[2]);if(delay==='kill'){notify();await new Promise<void>(r=>held=r);}if(delay==='timeout'){if(child.connected)child.send({id,error:'broker_timeout'});return;}}else if(method==='status')value=await repository.status(args[0]);else if(method==='jobs')value=await repository.jobs();else if(method==='recoverInterruptedOperation')value=await repository.recoverInterruptedOperation();else throw Error('Invalid fixture transport operation');if(child.connected)child.send({id,result:value});}catch(error){if(child.connected)child.send({id,error:error&&typeof error==='object'&&'code'in error?error.code:'transport_unavailable'});}
   });child.on('exit',code=>{if(code)reject(Error(error||'Worker exited '+code));});});return {child,result};
  };
  const first=start('kill');first.result.catch(()=>{});await committed;
  expect((await start().result).failed).toBe('schedule_busy');
  const exited=once(first.child,'exit');first.child.kill('SIGKILL');await exited;held();
  const restart=await start().result;expect(restart.done).toMatchObject({dispatched:false,run:{state:'partial'}});
  expect((await repository.jobs()).filter(job=>job.state==='succeeded')).toHaveLength(1);expect(dispatches).toBe(1);
  expect((await runner.status('alice')).runs[0].attempts).toHaveLength(1);
  await runner.configure({revision:'ipc-v2',scopes:['alice']});
  expect((await start('timeout').result).done.run.state).toBe('uncertain');
  expect((await start().result).done).toMatchObject({dispatched:false,run:{state:'partial'}});
  expect((await repository.jobs()).filter(job=>job.state==='succeeded')).toHaveLength(2);
 }finally{held();for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await once(child,'exit');}await rm(root,{recursive:true,force:true});}
},180000);
