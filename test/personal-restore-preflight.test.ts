import {it,expect} from 'vitest';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {restoreFixture} from './restore-fixture.js';
import {RestoreCoordinator} from '../src/host/restore.js';
const binary=process.env.PI_COFFEE_TEST_RESTIC;
it.skipIf(!binary)('refuses incompatible restore staging before asking the owner to confirm',async()=>{
 const f=await restoreFixture(binary!),stage=await mkdtemp('/dev/shm/coffee-personal-preflight-');
 try{
  expect((await stat(stage)).dev).not.toBe((await stat(f.root)).dev);
  const original=await f.restore.status('awangs','alice');
  // Use the public native adapter from the fixture's source configuration.
  const {PiNativeRecoveryAdapter}=await import('../src/host/pi-recovery.js');
  const {WriterAdmissionFence}=await import('../src/host/backup.js');
  const adapter=new PiNativeRecoveryAdapter({scope:'alice',workspaces:f.store,sessionDir:join(f.root,'native'),agentDir:f.agentDir,fence:new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true})}),sourceCustody:async()=>({known:true})});
  const restore=new RestoreCoordinator({root:stage,repository:f.repository,authorize:async()=>true,scope:async()=>({workspaces:f.store,adapter})});
  const requested=await restore.request('awangs','alice',{taskId:f.task.id,jobId:original[0].jobId});
  await expect(restore.operate('awangs',requested.id,{action:'plan',revision:1})).rejects.toMatchObject({code:'incompatible_restore_filesystem'});
 }finally{await rm(stage,{recursive:true,force:true});await rm(f.root,{recursive:true,force:true});}
},120000);
