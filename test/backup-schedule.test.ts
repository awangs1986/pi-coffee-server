import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackupCoordinator} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {BackupJobRunner} from '../src/host/backup-job-runner.js';

it('persists a Toronto daily attempt, retries at 15/60 minutes, and catches up only the latest missed date',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-'));
 let time=Date.parse('2026-10-25T07:59:00Z');
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>time});
 const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});
 const create=()=>new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});
 let runner=create();
 try{
  await runner.configure({revision:'daily-v1',scopes:['alice','bob']});
  await runner.updateInventory('alice',[{taskId:'pi-task',engine:'pi'},{taskId:'later',engine:'claude'}]);
  await runner.updateInventory('bob',[{taskId:'codex-task',engine:'codex'}]);
  expect((await runner.tick()).dispatched).toBe(false);
  time=Date.parse('2026-10-25T08:00:00Z');
  expect((await runner.tick()).dispatched).toBe(true);
  let state=await runner.status('alice');
  expect(state.runs).toMatchObject([{date:'2026-10-25',state:'failed',attempts:[{number:1}]}]);
  expect(state.coverage).toMatchObject({state:'partial',unprotected:['pi-task'],excluded:[{taskId:'later',engine:'claude'}]});
  expect(JSON.stringify(state)).not.toContain('codex-task');
  expect(state.alerts.filter(a=>a.kind==='job-failed'&&!a.resolvedAt)).toHaveLength(1);
  runner=create();time+=14*60000;
  expect((await runner.tick()).dispatched).toBe(false);
  time+=60000;expect((await runner.tick()).dispatched).toBe(true);
  time=Date.parse('2026-10-25T08:59:59Z');expect((await runner.tick()).dispatched).toBe(false);
  time+=1000;expect((await runner.tick()).dispatched).toBe(true);
  time=Date.parse('2026-10-25T20:00:00Z');expect((await create().tick()).dispatched).toBe(false);
  state=await runner.status('alice');expect(state.runs[0].attempts).toHaveLength(3);
  expect(state.alerts.filter(a=>a.kind==='job-failed')).toHaveLength(1);
  time=Date.parse('2026-10-28T12:00:00Z');
  expect((await create().tick()).dispatched).toBe(true);
  state=await runner.status('alice');expect(state.runs.map(r=>r.date)).toEqual(['2026-10-28','2026-10-25']);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('dispatches once at 04:00 across Toronto fall-back and spring-forward without replaying a new revision in the past',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-dst-'));let time=Date.parse('2026-11-01T08:59:00Z');
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>time});
 const repository=new BackupRepository({root:join(root,'repository'),coordinator,now:()=>time});
 const runner=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator,now:()=>time});
 try{
  await runner.configure({revision:'fall',scopes:['alice']});await runner.updateInventory('alice',[{taskId:'task',engine:'pi'}]);
  expect((await runner.tick()).dispatched).toBe(false);time+=60000;expect((await runner.tick()).dispatched).toBe(true);
  expect((await runner.status('alice')).runs[0]).toMatchObject({date:'2026-11-01',startedAt:'2026-11-01T09:00:00.000Z'});
  time-=60000;expect((await runner.tick()).dispatched).toBe(false);time+=60000;expect((await runner.tick()).dispatched).toBe(false);
  time=Date.parse('2027-03-14T07:59:00Z');await runner.configure({revision:'spring',scopes:['alice']});
  expect((await runner.tick()).dispatched).toBe(false);time+=60000;expect((await runner.tick()).dispatched).toBe(true);
  expect((await runner.status('alice')).runs[0]).toMatchObject({date:'2027-03-14',startedAt:'2027-03-14T08:00:00.000Z'});
  await expect(runner.configure({revision:'spring',scopes:['alice'],hour:5})).rejects.toMatchObject({code:'schedule_revision_conflict'});
 }finally{await rm(root,{recursive:true,force:true});}
});
