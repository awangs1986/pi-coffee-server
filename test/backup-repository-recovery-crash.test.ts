import {it,expect} from 'vitest';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,stat,rm,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
import {BackupCoordinator} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('can restart the recovery controller itself after SIGKILL without deleting an unknown recovery authority',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-recovery-crash-'));let child:import('node:child_process').ChildProcess|undefined;
 try{
  const repositoryRoot=join(root,'repository-runtime'),repository=new BackupRepository({root:repositoryRoot,coordinator:new BackupCoordinator({root:join(root,'checkpoints')})}),disk=join(root,'disk');await mkdir(disk,{mode:0o700});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const pause=join(root,'pause-lock-directory.mjs');await writeFile(pause,`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import {dirname,basename} from 'node:path';const mkdir=fs.mkdir;fs.mkdir=async(path,...args)=>{const result=await mkdir(path,...args);if(typeof path==='string'&&dirname(path)===${JSON.stringify(repositoryRoot)}&&basename(path).startsWith('operation-lock')){process.stdout.write('lock-directory-created\\n');await new Promise(()=>setInterval(()=>{},1000));}return result;};syncBuiltinESMExports();`);
  child=spawn(process.execPath,['--import',pause,resolve('dist/src/backup-cli.js'),'recover','--root',root],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:root}});let output='';child.stdout!.on('data',chunk=>output+=chunk);

  // Delay the real filesystem mkdir return, then kill this controller before
  // owner metadata can be written. Recovery/status remain the real public APIs.
  await expect.poll(()=>{if(child!.exitCode!==null)throw Error('Recovery finished before crash window');return output.includes('lock-directory-created');},{timeout:5000,interval:1}).toBe(true);
  const exited=once(child,'exit');child.kill('SIGKILL');expect((await exited)[1]).toBe('SIGKILL');
  await expect.poll(()=>repository.recoverInterruptedOperation().then(()=>true,error=>error.code==='repository_busy'?false:Promise.reject(error)),{timeout:10000,interval:100}).toBe(true);
  expect(await repository.status('alice')).toMatchObject({configured:true,enabled:true,points:[]});
  const legacy=join(repositoryRoot,'recovery-lock');await mkdir(legacy,{mode:0o700});const identity=await stat(legacy);await expect(repository.recoverInterruptedOperation()).rejects.toMatchObject({code:'repository_busy'});expect((await stat(legacy)).ino).toBe(identity.ino);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}await rm(root,{recursive:true,force:true});}
},30000);
