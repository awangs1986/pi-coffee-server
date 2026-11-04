import {it,expect} from 'vitest';import {mkdtemp,mkdir,writeFile,rename,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('reconciles a repeated broker operation without source reads or another encrypted snapshot',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-broker-idempotence-'));try{
  const disk=join(root,'disk');await mkdir(disk,{mode:0o700});const source=join(root,'source');await mkdir(source,{mode:0o700});await writeFile(join(source,'draft'),'immutable generation');
  const fence=new WriterAdmissionFence({writerClasses:['synthetic'],uncoveredWriters:[],probe:async()=>({known:true})}),coordinator=new BackupCoordinator({root:join(root,'checkpoints'),adapter:{version:'synthetic-v1',resolve:async()=>({groupId:'synthetic',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['synthetic']}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:source},{id:'native',recoveryKey:'native',role:'native',data:Buffer.from('synthetic')},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
  await coordinator.capture('awangs','task','pi');const repository=new BackupRepository({root:join(root,'runtime'),coordinator});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const id='11111111-1111-4111-8111-111111111111',selection=[{scope:'awangs',taskId:'task'}],first=await repository.backup(selection,undefined,id);expect(first.id).toBe(id);
  await rename(join(root,'checkpoints'),join(root,'checkpoint-source-unavailable'));
  expect(await repository.backup(selection,undefined,id)).toEqual(first);expect(await repository.jobs()).toHaveLength(1);
  await expect(repository.backup([{scope:'bob',taskId:'other'}],undefined,id)).rejects.toMatchObject({code:'operation_conflict'});expect(await repository.jobs()).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
},120000);
