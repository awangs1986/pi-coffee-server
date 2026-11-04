import {it,expect} from 'vitest';
import {rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {preparedCodexRecovery,groupCodexWithPi} from './codex-recovery-fixture.js';
import {RestoreCoordinator,restorePlanDigest} from '../src/host/restore.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('Codex restores its verified projection from a shared Pi/Codex account cut and persists intent before Host admission',async()=>{
 const f=await preparedCodexRecovery(process.env.PI_COFFEE_TEST_RESTIC!,{populate:async f=>{await groupCodexWithPi(f);}});
 try{
  const original=await readFile(join(f.root,'synthetic-pi','projects','.coffee','state.json'),'utf8');let entered=false;
  const restore=new RestoreCoordinator({root:join(f.root,'restores'),repository:f.repository,authorize:async(actor,scope,manage)=>scope==='alice'&&(actor==='awangs'||!manage&&actor==='alice'),scope:async()=>({workspaces:f.store,adapter:f.adapter,withPublication:async(_task,run,id,preparation)=>{await preparation.preflight();await preparation.commitIntent();
   const plan=JSON.parse(await readFile(join(f.root,'restores',id+'.json'),'utf8'));expect(plan.state).toBe('publishing');expect(plan.publicationAttempted).toBe(true);expect(plan.digest).toBe(restorePlanDigest(plan));expect(plan.approvedRevision).toBe(plan.revision);expect(plan.approvalDigest).toBe(plan.digest);if(!entered){entered=true;throw Object.assign(Error('Interrupted Host admission'),{code:'fixture_host_interrupted'});}return run();
  }})});
  expect(f.plan.checkpointGroup).toMatchObject({id:'shared-pi-codex-fixture',externalMemberCount:1});expect(JSON.stringify(f.plan)).not.toContain('synthetic-pi-native');expect(JSON.stringify(f.plan)).not.toContain('Other account private history');
  await expect(restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).rejects.toMatchObject({code:'fixture_host_interrupted'});await expect(restore.operate('awangs',f.plan.id,{action:'revise',revision:1})).rejects.toMatchObject({code:'publication_started'});expect((await restore.pendingPublications()).map(row=>row.operationId)).toContain(f.plan.id);
  expect((await restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).state).toBe('completed');expect(await restore.pendingPublications()).toEqual([]);expect((await f.store.lookup(f.task.id))?.nativeBinding?.id).toBe(f.id);expect(await readFile(join(f.root,'synthetic-pi','projects','.coffee','state.json'),'utf8')).toBe(original);
 }finally{await rm(f.root,{recursive:true,force:true});}
},90000);
