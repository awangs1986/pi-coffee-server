import {it,expect} from 'vitest';
import {mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {codexFixture,groupCodexWithPi} from './codex-recovery-fixture.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {validateColdEnrollmentArchive} from '../src/host/cold-enrollment-control.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('cold archive validation accepts a real verified multi-member repository job and refuses incomplete or mismatched results',async()=>{
 const f=await codexFixture();
 try{
  const other=await groupCodexWithPi(f);expect(await f.coordinator.capture('alice',f.task.id,'codex')).toMatchObject({state:'protected'});
  const point=(await f.coordinator.sealedCheckpoint('alice',f.task.id))!,disk=join(f.root,'disk');await mkdir(disk,{mode:0o700});
  const repository=new BackupRepository({root:join(f.root,'repository'),coordinator:f.coordinator});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const job=await repository.backup([{scope:'alice',taskId:f.task.id},{scope:'synthetic-pi',taskId:other.task.id}]);expect(job).toMatchObject({state:'succeeded',verification:'repository-read'});expect(job.points).toHaveLength(2);
  // This exercises only the trusted repository-result contract. No qualified
  // export object or physical cold source cut is manufactured for account plan.
  expect(validateColdEnrollmentArchive('awangs','awangs',point.manifest,job)).toEqual({jobId:job.id,manifestSha256:job.points[0].manifestSha256,verification:'repository-read'});
  for(const fault of ['missing-member','wrong-digest','wrong-checkpoint','failed-job','no-snapshot','not-verified','wrong-scope','wrong-task'] as const){
   const invalid=structuredClone(job);
   if(fault==='missing-member')invalid.points.pop();
   if(fault==='wrong-digest')invalid.points[0].manifestSha256='0'.repeat(64);
   if(fault==='wrong-checkpoint')invalid.points[0].checkpointId='different-checkpoint';
   if(fault==='failed-job')invalid.state='failed';
   if(fault==='no-snapshot')delete invalid.snapshotId;
   if(fault==='not-verified')invalid.verification='none';
   if(fault==='wrong-scope')invalid.points[0].scope='unrelated-account';
   if(fault==='wrong-task')invalid.points[0].taskId='unrelated-task';
   expect(()=>validateColdEnrollmentArchive('awangs','awangs',point.manifest,invalid),fault).toThrow('enrollment_archive_unverified');
  }
  expect(()=>validateColdEnrollmentArchive('unapproved','awangs',point.manifest,job)).toThrow('enrollment_archive_unverified');
 }finally{await rm(f.root,{recursive:true,force:true});}
},60000);
