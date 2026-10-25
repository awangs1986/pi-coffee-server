import {it,expect} from 'vitest';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,stat,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {BackupCoordinator} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('can restart the recovery controller itself after SIGKILL without deleting an unknown recovery authority',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-recovery-crash-'));let child:import('node:child_process').ChildProcess|undefined;
 try{
  const repositoryRoot=join(root,'repository-runtime'),repository=new BackupRepository({root:repositoryRoot,coordinator:new BackupCoordinator({root:join(root,'checkpoints')})}),disk=join(root,'disk');await mkdir(disk,{mode:0o700});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  child=spawn(process.execPath,[resolve('dist/src/backup-cli.js'),'recover','--root',root],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:root}});
  // Fault injection observes only the lifetime of this synthetic controller's
  // authority; success is judged through the real recovery/status APIs.
  await expect.poll(async()=>{if(child!.exitCode!==null)throw Error('Recovery finished before crash window');for(const name of ['recovery-lock','recovery.lock'])if(await stat(join(repositoryRoot,name)).then(()=>true,()=>false))return true;return false;},{timeout:5000,interval:1}).toBe(true);
  const exited=once(child,'exit');child.kill('SIGKILL');expect((await exited)[1]).toBe('SIGKILL');
  await expect.poll(()=>repository.recoverInterruptedOperation().then(()=>true,error=>error.code==='repository_busy'?false:Promise.reject(error)),{timeout:10000,interval:100}).toBe(true);
  expect(await repository.status('alice')).toMatchObject({configured:true,enabled:true,points:[]});
  const legacy=join(repositoryRoot,'recovery-lock');await mkdir(legacy,{mode:0o700});const identity=await stat(legacy);await expect(repository.recoverInterruptedOperation()).rejects.toMatchObject({code:'repository_busy'});expect((await stat(legacy)).ino).toBe(identity.ino);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await rm(root,{recursive:true,force:true});}
},30000);
