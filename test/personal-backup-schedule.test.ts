import {HostServer} from '../src/host/server.js';
import {it,expect} from 'vitest';
import {rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {restoreFixture} from './restore-fixture.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {BackupJobRunner} from '../src/host/backup-job-runner.js';
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('automatically retains verified daily backups and resumes the daily worker without new approval',async()=>{
 const f=await restoreFixture(process.env.PI_COFFEE_TEST_RESTIC!);let host:HostServer|undefined;
 try{
  await f.restore.operate('awangs',f.plan.id,{action:'publish',revision:f.plan.revision,digest:f.plan.digest});
  await f.store.archive('neighbor',true);await f.store.deleteWorkspace('neighbor','neighbor',async()=>{},true);
  const coordinator=new BackupCoordinator({root:join(f.root,'checkpoints')});
  let now=Date.now();const create=()=>new BackupJobRunner({root:join(f.root,'schedule'),repository:f.repository,coordinator,now:()=>now});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider');}};
  host=new HostServer({port:0,token:'schedule-fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:f.store}),backup:{personal:true,coordinator,repository:f.repository,scopes:['alice']}});await host.start();
  const tokenFile=join(f.root,'host-token');await writeFile(tokenFile,'schedule-fixture',{mode:0o600});
  const runner=create();await runner.configure({revision:'personal',scopes:['alice'],timeZone:'UTC',hour:0,automaticRetention:true,host:{url:`http://127.0.0.1:${host.address().port}`,tokenFile,actor:'awangs'}});
  await runner.updateInventory('alice',[{taskId:f.task.id,engine:'pi'}]);
  expect((await runner.tick()).run?.state).toBe('succeeded');
  const plans=await f.repository.retentionPlans('alice');expect(plans).toHaveLength(1);expect(plans[0].state).toBe('completed');
  expect((await create().tick()).dispatched).toBe(false);expect(await f.repository.retentionPlans('alice')).toHaveLength(1);
  expect((await runner.status('alice')).runs[0].retention).toMatchObject({state:'completed'});
  const restored=join(f.root,'retained-readback');await f.repository.extract(f.plan.jobId,restored);
  await runner.configure({revision:'service-failure',scopes:['alice'],timeZone:'UTC',hour:0,giteaProfile:join(f.root,'missing-profile.json'),automaticRetention:true,host:{url:`http://127.0.0.1:${host.address().port}`,tokenFile,actor:'awangs'}});
  const partial=(await runner.tick()).run!;expect(partial.state).toBe('partial');expect(partial.gitea).toMatchObject({state:'failed',attempts:1});expect(partial.attempts).toHaveLength(1);
  const jobs=(await f.repository.jobs()).length;expect((await create().tick()).run?.gitea?.attempts).toBe(1);
  now+=15*60000;expect((await create().tick()).run?.gitea?.attempts).toBe(2);
  now+=60*60000;expect((await create().tick()).run?.gitea?.attempts).toBe(3);
  now+=60*60000;const final=(await create().tick()).run!;expect(final.gitea?.attempts).toBe(3);expect(final.attempts).toHaveLength(1);expect((await f.repository.jobs()).length).toBe(jobs);
  expect((await runner.status('alice')).runs[0].state).toBe('partial');

 }finally{await host?.close();await rm(f.root,{recursive:true,force:true});}
},120000);
