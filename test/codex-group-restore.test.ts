import {it,expect} from 'vitest';
import {mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {preparedCodexRecovery} from './codex-recovery-fixture.js';
import {Workspaces} from '../src/host/workspaces.js';
import {PiNativeRecoveryAdapter} from '../src/host/pi-recovery.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {GroupedRecoveryAdapter} from '../src/host/grouped-recovery.js';
import {RestoreCoordinator,restorePlanDigest} from '../src/host/restore.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('Codex restores its verified projection from a shared Pi/Codex account cut and persists intent before Host admission',async()=>{
 const f=await preparedCodexRecovery(process.env.PI_COFFEE_TEST_RESTIC!,{populate:async f=>{
  const other=new Workspaces(join(f.root,'synthetic-pi','projects'));await other.createChatConversation('pi-member');const task=(await other.lookup('pi-member'))!,native=join(f.root,'synthetic-pi','sessions'),agent=join(f.root,'synthetic-pi','agent');await mkdir(native,{mode:0o700});await mkdir(agent,{mode:0o700});SessionManager.create(task.cwd,native,{id:'synthetic-pi-native'}).appendMessage({role:'user',content:'Other account private history',timestamp:1});await other.setNativeBinding(task.id,{state:'bound',id:'synthetic-pi-native'});
  const pi=new PiNativeRecoveryAdapter({scope:'synthetic-pi',workspaces:other,sessionDir:native,agentDir:agent,fence:f.fence,sourceCustody:async()=>({known:true})});
  f.coordinator=new BackupCoordinator({root:join(f.root,'checkpoints'),adapter:new GroupedRecoveryAdapter({groupId:'shared-pi-codex-fixture',fence:f.fence,inventory:async()=>[{scope:'alice',taskId:f.task.id,engine:'codex'},{scope:'synthetic-pi',taskId:task.id,engine:'pi'}],resolve:(scope,id)=>scope==='alice'?f.adapter.resolve(scope,id):pi.resolve(scope,id)})});
 }});
 try{
  const original=await readFile(join(f.root,'synthetic-pi','projects','.coffee','state.json'),'utf8');let entered=false;
  const restore=new RestoreCoordinator({root:join(f.root,'restores'),repository:f.repository,authorize:async(actor,scope,manage)=>scope==='alice'&&(manage?actor==='awangs':actor==='alice'),scope:async()=>({workspaces:f.store,adapter:f.adapter,withPublication:async(_task,run,id)=>{
   const plan=JSON.parse(await readFile(join(f.root,'restores',id+'.json'),'utf8'));expect(plan.state).toBe('publishing');expect(plan.publicationAttempted).toBe(true);expect(plan.digest).toBe(restorePlanDigest(plan));expect(plan.approvedRevision).toBe(plan.revision);expect(plan.approvalDigest).toBe(plan.digest);if(!entered){entered=true;throw Object.assign(Error('Interrupted Host admission'),{code:'fixture_host_interrupted'});}return run();
  }})});
  expect(f.plan.checkpointGroup).toMatchObject({id:'shared-pi-codex-fixture',externalMemberCount:1});expect(JSON.stringify(f.plan)).not.toContain('synthetic-pi-native');expect(JSON.stringify(f.plan)).not.toContain('Other account private history');
  await expect(restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'fixture_host_interrupted'});await expect(restore.operate('awangs',f.plan.id,{action:'revise',revision:1})).rejects.toMatchObject({code:'publication_started'});expect((await restore.pendingPublications()).map(row=>row.operationId)).toContain(f.plan.id);
  expect((await restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).state).toBe('completed');expect(await restore.pendingPublications()).toEqual([]);expect((await f.store.lookup(f.task.id))?.nativeBinding?.id).toBe(f.id);expect(await readFile(join(f.root,'synthetic-pi','projects','.coffee','state.json'),'utf8')).toBe(original);
 }finally{await rm(f.root,{recursive:true,force:true});}
},90000);
