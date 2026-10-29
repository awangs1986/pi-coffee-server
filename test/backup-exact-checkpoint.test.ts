import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {BackupJobRunner} from '../src/host/backup-job-runner.js';

const binary=process.env.PI_COFFEE_TEST_RESTIC;
it.skipIf(!binary)('restores the exact historical point selected before a newer capture, and never substitutes a missing or damaged point',async()=>{
 const root=await mkdtemp(join(tmpdir(),'exact-point-'));
 try{
  const source=join(root,'source'),disk=join(root,'disk');await mkdir(source,{mode:0o700});await mkdir(disk,{mode:0o700});
  let time=Date.parse('2026-10-29T07:00:00Z');
  // This fixture has one explicitly controlled writer; it makes no native coverage claim.
  const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})});
  const coordinator=new BackupCoordinator({root:join(root,'points'),now:()=>time,adapter:{version:'controlled-exact-point-fixture-v1',resolve:async(scope,taskId)=>({groupId:'fixture',fence,members:[{scope,taskId,engine:'pi',nativeBindings:[taskId]}],sources:[{id:'workspace',role:'workspace',recoveryKey:'workspace',path:source},...(['native','registry','task-data'] as const).map(role=>({id:role,role,recoveryKey:role,data:Buffer.from('controlled '+role)}))],validate:async()=>{}})}});
  await writeFile(join(source,'draft'),'before deletion');const old=await coordinator.capture('alice','task','pi');expect(old.state).toBe('protected');
  time+=60000;await fence.runWriter('fixture',()=>writeFile(join(source,'draft'),'newer content'));const newest=await coordinator.capture('alice','task','pi');expect(newest.state).toBe('protected');expect(newest.checkpointId).not.toBe(old.checkpointId);
  const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});await repository.configure({destination:disk,binary:binary!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const selection=[{scope:'alice',taskId:'task',expectedCheckpointId:old.checkpointId!}],requestId=randomUUID();
  const saved=await repository.backup(selection,undefined,requestId);
  expect(saved.points).toMatchObject([{checkpointId:old.checkpointId,captureAt:old.captureAt}]);
  expect(saved.selection).toEqual(selection);
  const restored=join(root,'restored');await repository.extract(saved.id,restored);
  expect(await readFile(join(restored,old.checkpointId!,'objects','workspace','draft'),'utf8')).toBe('before deletion');
  expect(await repository.backup(selection,undefined,requestId)).toEqual(saved);
  await expect(repository.backup([{...selection[0],expectedCheckpointId:newest.checkpointId!}],undefined,requestId)).rejects.toMatchObject({code:'operation_conflict'});
  expect(await coordinator.status('alice','task','pi')).toMatchObject({checkpointId:newest.checkpointId});
  await expect(repository.backup([{...selection[0],expectedCheckpointId:randomUUID()}])).rejects.toMatchObject({code:'checkpoint_unavailable'});
  await expect(repository.backup([{...selection[0],taskId:'other-task'}])).rejects.toMatchObject({code:'checkpoint_unavailable'});
  const point=await coordinator.sealedCheckpoint('alice','task',old.checkpointId!);expect(point?.manifest.checkpointId).toBe(old.checkpointId);
  await chmod(join(point!.directory,'seal'),0o600);await writeFile(join(point!.directory,'seal'),'broken seal');
  await expect(repository.backup(selection)).rejects.toMatchObject({code:'checkpoint_unavailable'});
  expect(await coordinator.sealedCheckpoint('alice','task')).toMatchObject({manifest:{checkpointId:newest.checkpointId}});
 }finally{await rm(root,{recursive:true,force:true});}
},120000);

it.skipIf(!binary)('keeps the selected checkpoint vector after a lost dispatch and scheduler restart while newer points appear',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events'),{pathToFileURL}=await import('node:url');
 const root=await mkdtemp(join(tmpdir(),'exact-schedule-')),children:import('node:child_process').ChildProcess[]=[];
 try{
  let time=Date.parse('2026-10-29T08:00:00Z'),generation='selected draft';
  const coordinator=new BackupCoordinator({root:join(root,'points'),now:()=>time,adapter:{version:'controlled-scheduler-ipc-v1',resolve:async(scope,taskId)=>({groupId:scope,fence:new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})}),members:[{scope,taskId,engine:'pi',nativeBindings:[taskId]}],sources:(['workspace','native','registry','task-data'] as const).map(role=>({id:role,recoveryKey:role,role,data:Buffer.from(generation)})),validate:async()=>{}})}});
  const oldAlice=await coordinator.capture('alice','alice-task','pi'),oldBob=await coordinator.capture('bob','bob-task','pi');
  const disk=join(root,'disk');await mkdir(disk,{mode:0o700});const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});await repository.configure({destination:disk,binary:binary!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});await runner.configure({revision:'exact-v1',scopes:['alice','bob']});await runner.updateInventory('alice',[{taskId:'alice-task',engine:'pi'}]);await runner.updateInventory('bob',[{taskId:'bob-task',engine:'pi'}]);
  const worker=join(root,'worker.mjs');await writeFile(worker,`
import {BackupJobRunner} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'dist/src/host/backup-job-runner.js')).href)};
import {BackupCoordinator} from ${JSON.stringify(pathToFileURL(join(process.cwd(),'dist/src/host/backup.js')).href)};
let next=0;const pending=new Map();
process.on('message',message=>{const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);message.error?entry.reject(Object.assign(Error('synthetic transport failure'),{code:message.error})):entry.resolve(message.result);});
const call=(method,args=[])=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});process.send({id,method,args});});
const repository={status:scope=>call('status',[scope]),jobs:()=>call('jobs'),backup:(selection,signal,id)=>call('backup',[selection,id]),recoverInterruptedOperation:()=>call('recover')};
const runner=new BackupJobRunner({root:process.argv[2]+'/schedule',repository,coordinator:new BackupCoordinator({root:process.argv[2]+'/points'}),now:()=>Number(process.argv[3])});
try{process.send({done:await runner.tick()});}catch(error){process.send({failed:error.code||'unknown'});}process.disconnect();
`,{mode:0o600});
  const start=async(drop:boolean)=>{
   const child=spawn(process.execPath,[worker,root,String(time)],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);let stderr='';child.stderr!.on('data',chunk=>stderr+=chunk);let result:unknown;
   child.on('message',async(message:any)=>{
    if(message.done||message.failed){result=message;return;}const {id,method,args}=message;
    try{let value;if(method==='backup'){if(drop){child.send({id,error:'transport_unavailable'});return;}value=await repository.backup(args[0],undefined,args[1]);}else if(method==='status')value=await repository.status(args[0]);else if(method==='jobs')value=await repository.jobs();else if(method==='recover')value=await repository.recoverInterruptedOperation();else throw Error('Unexpected IPC method');if(child.connected)child.send({id,result:value});}catch(error){if(child.connected)child.send({id,error:error&&typeof error==='object'&&'code'in error?error.code:'transport_unavailable'});}
   });
   expect((await once(child,'exit'))[0],stderr).toBe(0);return result;
  };
  expect(await start(true)).toMatchObject({done:{run:{state:'uncertain'}}});expect(await repository.jobs()).toEqual([]);
  time+=60000;generation='newer draft';const latest=await coordinator.capture('alice','alice-task','pi');await coordinator.capture('bob','bob-task','pi');expect(latest.checkpointId).not.toBe(oldAlice.checkpointId);
  expect(await start(false)).toMatchObject({done:{dispatched:false,run:{state:'partial'}}});
  const jobs=await repository.jobs();expect(jobs).toHaveLength(1);expect(jobs[0].state).toBe('succeeded');
  expect(jobs[0].points.map(point=>point.checkpointId).sort()).toEqual([oldAlice.checkpointId,oldBob.checkpointId].sort());
  expect(jobs[0].selection).toEqual([{scope:'alice',taskId:'alice-task',expectedCheckpointId:oldAlice.checkpointId},{scope:'bob',taskId:'bob-task',expectedCheckpointId:oldBob.checkpointId}]);
  const restored=join(root,'restored');await repository.extract(jobs[0].id,restored);expect(await readFile(join(restored,oldAlice.checkpointId!,'objects','workspace'),'utf8')).toBe('selected draft');
  const own=JSON.stringify(await runner.status('alice'));expect(own).not.toContain('bob-task');expect(own).not.toContain(oldBob.checkpointId!);expect((await runner.status('alice')).runs[0].attempts).toHaveLength(1);
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(root,{recursive:true,force:true});}
},120000);

it('keeps an older ambiguous in-flight attempt uncertain when no repository job can reconcile its original selection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'legacy-dispatch-'));
 try{
  const time=Date.parse('2026-10-29T08:00:00Z');
  const coordinator=new BackupCoordinator({root:join(root,'points'),now:()=>time,adapter:{version:'legacy-dispatch-fixture-v1',resolve:async(scope,taskId)=>({groupId:'fixture',fence:new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})}),members:[{scope,taskId,engine:'pi',nativeBindings:[taskId]}],sources:(['workspace','native','registry','task-data'] as const).map(role=>({id:role,recoveryKey:role,role,data:Buffer.from('available newer material')})),validate:async()=>{}})}});
  await coordinator.capture('alice','task','pi');
  const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time}),runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});
  await runner.configure({revision:'legacy-v1',scopes:['alice']});await runner.updateInventory('alice',[{taskId:'task',engine:'pi'}]);
  // Version-1 on-disk input produced before durable checkpoint selections existed.
  // Its absence of a selection cannot prove a prior transport call did not run.
  await writeFile(join(root,'schedule','state.json'),JSON.stringify({schema:1,runs:[{id:'legacy-v1:2026-10-29',date:'2026-10-29',revision:'legacy-v1',scopes:['alice'],startedAt:new Date(time).toISOString(),state:'uncertain',attempts:[{number:1,id:randomUUID(),startedAt:new Date(time).toISOString(),state:'uncertain'}]}],alerts:[]}),{mode:0o600});
  expect(await runner.tick()).toMatchObject({dispatched:false,run:{state:'uncertain',attempts:[{number:1,errorCode:'operation_uncertain'}]}});
  expect((await runner.status('alice')).runs[0].attempts).toHaveLength(1);expect(await repository.jobs()).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
