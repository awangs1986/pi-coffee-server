import {it,expect} from 'vitest';
import {planRetention,type RetentionSnapshot} from '../src/host/backup-retention.js';
const snapshot=(id:string,captureAt:string,scope='alice',taskId='task'):RetentionSnapshot=>({snapshotId:id.repeat(64),jobIds:[id.repeat(36)],verified:true,points:[{scope,taskId,checkpointId:id.repeat(36),captureAt,engine:'pi',manifestSha256:'0'.repeat(64)}]});
it('retains the daily/weekly/monthly union by original capture time and each scope/task last verified point',()=>{
 const records=[snapshot('a','2026-10-25T08:00:00Z'),snapshot('b','2026-10-25T09:00:00Z'),snapshot('c','2026-10-24T09:00:00Z'),snapshot('d','2025-01-01T10:00:00Z','bob'),snapshot('e','2025-01-01T10:00:00Z','alice','archived')];
 const plan=planRetention(records,[],{scopes:['alice','bob'],now:Date.parse('2026-10-26T08:00:00Z'),timeZone:'America/Toronto'});
 expect(plan.remove.map(row=>row.snapshotId)).toEqual(['a'.repeat(64)]);
 expect(plan.keep.find(row=>row.snapshotId==='d'.repeat(64))!.reasons).toContainEqual({kind:'last-complete',scope:'bob',taskId:'task'});
 expect(plan.keep.find(row=>row.snapshotId==='e'.repeat(64))!.reasons).toContainEqual({kind:'last-complete',scope:'alice',taskId:'archived'});
 expect(plan.policy).toEqual({daily:30,weekly:12,monthly:12});
});

it('keeps exactly the 30/12/12 union across real calendar periods without job-time promotion',()=>{
 const records:RetentionSnapshot[]=[];let index=1;
 for(let time=Date.parse('2025-09-01T08:00:00Z');time<=Date.parse('2026-10-25T08:00:00Z');time+=86400000){const id=(index++).toString(16).padStart(64,'0');records.push({...snapshot('a',new Date(time).toISOString()),snapshotId:id});}
 const plan=planRetention(records,[],{scopes:['alice'],now:Date.parse('2026-10-26T08:00:00Z')});
 const reasons=plan.keep.flatMap(row=>row.reasons);
 expect(reasons.filter(row=>row.kind==='daily')).toHaveLength(30);expect(reasons.filter(row=>row.kind==='weekly')).toHaveLength(12);expect(reasons.filter(row=>row.kind==='monthly')).toHaveLength(12);
 expect(plan.keep).toHaveLength(47);
 expect(reasons).toContainEqual({kind:'weekly',scope:'alice',period:'2026-08-03'});expect(reasons).toContainEqual({kind:'monthly',scope:'alice',period:'2025-11'});
 expect(reasons).not.toContainEqual({kind:'monthly',scope:'alice',period:'2025-10'});
});

// Calendar identity uses the configured local civil date, including year/week
// boundaries and the repeated hour when daylight saving time ends.
it('uses Toronto civil day and Monday week boundaries across years and repeated hours',()=>{
 const records=[snapshot('a','2026-01-01T00:30:00Z'),snapshot('b','2026-01-01T05:30:00Z'),snapshot('c','2026-01-05T04:30:00Z'),snapshot('d','2026-01-05T05:30:00Z'),snapshot('e','2026-11-01T05:30:00Z'),snapshot('f','2026-11-01T06:30:00Z')];
 const toronto=planRetention(records,[],{scopes:['alice'],now:Date.parse('2026-11-02T08:00:00Z'),timeZone:'America/Toronto'});
 const reasons=(id:string)=>toronto.keep.find(row=>row.snapshotId===id.repeat(64))?.reasons??[];
 expect(reasons('a')).toContainEqual({kind:'daily',scope:'alice',period:'2025-12-31'});
 expect(reasons('a')).toContainEqual({kind:'monthly',scope:'alice',period:'2025-12'});
 expect(reasons('c')).toContainEqual({kind:'weekly',scope:'alice',period:'2025-12-29'});
 expect(reasons('d')).toContainEqual({kind:'weekly',scope:'alice',period:'2026-01-05'});
 expect(reasons('f')).toContainEqual({kind:'daily',scope:'alice',period:'2026-11-01'});
 expect(toronto.remove.map(row=>row.snapshotId)).toContain('e'.repeat(64));
 const utc=planRetention(records,[],{scopes:['alice'],now:Date.parse('2026-11-02T08:00:00Z'),timeZone:'UTC'});
 expect(utc.keep.flatMap(row=>row.reasons)).not.toContainEqual({kind:'monthly',scope:'alice',period:'2025-12'});
});
it('keeps the last point of an archived task even when another task owns every calendar bucket',()=>{
 const records=[snapshot('a','2026-10-25T07:00:00Z','alice','archived'),snapshot('b','2026-10-25T08:00:00Z','alice','archived'),snapshot('c','2026-10-25T09:00:00Z','alice','active')];
 const plan=planRetention(records,[],{scopes:['alice'],now:Date.parse('2026-10-26T08:00:00Z')});
 expect(plan.keep.find(row=>row.snapshotId==='b'.repeat(64))?.reasons).toEqual([{kind:'last-complete',scope:'alice',taskId:'archived'}]);
 expect(plan.remove.map(row=>row.snapshotId)).toEqual(['a'.repeat(64)]);
});

it('rejects an invalid civil-time zone as a typed retention input error',()=>{expect(()=>planRetention([],[],{scopes:['alice'],now:0,timeZone:'Invalid/Zone'})).toThrow(expect.objectContaining({code:'invalid_retention'}));});
