import {it,expect} from 'vitest';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('reconciles actual SIGKILL after forget, prune and retirement journal without losing the last incremental restore point',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-retention-crash-'));let now=Date.parse('2026-10-25T08:00:00Z');const children:import('node:child_process').ChildProcess[]=[];
 try{
  const source=join(root,'source');await mkdir(source,{mode:0o700});const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})});
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>now,adapter:{version:'retention-crash-fixture-v1',resolve:async()=>({groupId:'fixture',fence,members:[{scope:'alice',taskId:'task',engine:'pi',nativeBindings:['task']}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:source},{id:'native',recoveryKey:'native',role:'native',data:Buffer.from('context')},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
  const repository=new BackupRepository({root:join(root,'repository-runtime'),coordinator,now:()=>now});const disk=join(root,'disk');await mkdir(disk,{mode:0o700});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});const copy=await repository.exportRecoveryPackage();await repository.verifyRecoveryPackage(copy);
  const save=async(text:string)=>{now+=60000;await writeFile(join(source,'draft'),text);await coordinator.capture('alice','task','pi');return repository.backup([{scope:'alice',taskId:'task'}]);};
  let previous=await save('baseline');let generation=0;
  for(const phase of ['forgotten','pruned','journaled']){
   const expected='generation '+(++generation),latest=await save(expected),plan=await repository.previewRetention({scopes:['alice']});expect(plan.remove.map(row=>row.snapshotId)).toContain(previous.snapshotId);
   const child=spawn(process.execPath,[resolve('test/fixtures/retention-worker.mjs'),root,plan.id,String(plan.revision),plan.digest,phase,String(now)],{stdio:['ignore','ignore','pipe','ipc']});children.push(child);const event=await once(child,'message');expect(event[0]).toEqual({phase});const exited=once(child,'exit');child.kill('SIGKILL');expect((await exited)[1]).toBe('SIGKILL');
   expect((await repository.retentionPlans('alice')).find(row=>row.id===plan.id)!.state).toBe('executing');
   const restart=spawn(process.execPath,[resolve('test/fixtures/retention-worker.mjs'),root,plan.id,String(plan.revision),plan.digest,'restart',String(now)],{stdio:['ignore','ignore','pipe','ipc']});children.push(restart);expect((await once(restart,'message'))[0]).toEqual({completed:'completed'});expect((await once(restart,'exit'))[0]).toBe(0);expect((await repository.executeRetention(plan.id,plan.revision,plan.digest)).state).toBe('completed');
   const restored=join(root,'restored-'+phase);await repository.extract(latest.id,restored,copy);expect(await readFile(join(restored,(await readdir(restored))[0],'objects','workspace','draft'),'utf8')).toBe(expected);
   await expect(repository.extract(previous.id,join(root,'obsolete-'+phase))).rejects.toMatchObject({code:'unknown_snapshot'});expect((await repository.status('alice')).points[0].checkpointId).toBe(latest.points[0].checkpointId);previous=latest;
  }
 }finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await rm(root,{recursive:true,force:true});}
},240000);
