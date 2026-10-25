import {it,expect} from 'vitest';import {mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {preparedCodexRecovery,type codexFixture} from './codex-recovery-fixture.js';
const sql=(f:Awaited<ReturnType<typeof codexFixture>>,code:string)=>execFileSync('/usr/bin/python3',['-c',code,f.sql,f.id],{encoding:'utf8'});
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('restores a populated conflict-free global memory context, pauses goals and archives only selected queued inputs without reactivation',async()=>{
 const f=await preparedCodexRecovery(process.env.PI_COFFEE_TEST_RESTIC!,{
  populate:async f=>{await mkdir(join(f.home,'memories'),{mode:0o700});await writeFile(join(f.home,'memories','MEMORY.md'),'Selected task approved shared memory');
   sql(f,`import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1]);id=sys.argv[2]
c=sqlite3.connect(root/'memories_1.sqlite');c.execute('INSERT INTO stage1_outputs(thread_id,source_updated_at,raw_memory,rollout_summary,generated_at,selected_for_phase2,selected_for_phase2_source_updated_at) VALUES (?,20,?,?,21,1,20)',(id,'Selected raw memory','Selected rollout summary'));c.execute("INSERT INTO jobs(kind,job_key,status,retry_remaining,last_success_watermark) VALUES ('memory_stage1',?,'done',0,20)",(id,));c.execute("INSERT INTO jobs(kind,job_key,status,retry_remaining,last_success_watermark) VALUES ('memory_consolidate_global','global','done',0,20)");c.execute('INSERT INTO consolidation_progress VALUES (1,1)');c.commit();c.close()
c=sqlite3.connect(root/'goals_1.sqlite');c.execute("INSERT INTO thread_goals(thread_id,goal_id,objective,status,created_at_ms,updated_at_ms) VALUES (?,?,'Historical objective','active',1,1)",(id,'original-goal'));c.execute('INSERT INTO thread_goal_continuation_deferrals VALUES (?)',(id,));c.commit();c.close()
c=sqlite3.connect(root/'queue_1.sqlite');c.execute('INSERT INTO queued_items VALUES (?,?,?,0,1,1)',('old-queued-input',id,'{"text":"Selected historical queued command"}'));c.execute('INSERT INTO queued_items VALUES (?,?,?,0,1,1)',('foreign-queued-input','foreign-native','{"text":"FOREIGN PRIVATE INPUT"}'));c.commit();c.close()
`);},
  lose:async f=>{await rm(join(f.home,'memories','MEMORY.md'));sql(f,`import sqlite3,sys,pathlib
root=pathlib.Path(sys.argv[1]);id=sys.argv[2]
for name,tables in [('memories_1.sqlite',['stage1_outputs','jobs','consolidation_progress']),('goals_1.sqlite',['thread_goal_continuation_deferrals','thread_goals']),('queue_1.sqlite',['queued_items','queued_thread_revisions'])]:
 c=sqlite3.connect(root/name)
 for table in tables:c.execute('DELETE FROM '+table)
 c.commit();c.close()
`);}
 });try{
  expect((await f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).state).toBe('completed');expect(await readFile(join(f.home,'memories','MEMORY.md'),'utf8')).toBe('Selected task approved shared memory');
  const state=JSON.parse(sql(f,`import sqlite3,sys,pathlib,json
root=pathlib.Path(sys.argv[1]);result={}
for name,table in [('queue_1.sqlite','queued_items'),('goals_1.sqlite','thread_goals'),('goals_1.sqlite','thread_goal_continuation_deferrals'),('memories_1.sqlite','jobs'),('memories_1.sqlite','stage1_outputs'),('memories_1.sqlite','consolidation_progress')]:
 c=sqlite3.connect(root/name);c.row_factory=sqlite3.Row;result[table]=[dict(r) for r in c.execute('SELECT * FROM '+table)];c.close()
print(json.dumps(result))`));expect(state.queued_items).toEqual([]);expect(state.thread_goal_continuation_deferrals).toEqual([]);expect(state.thread_goals).toMatchObject([{goal_id:'original-goal',status:'paused'}]);expect(state.stage1_outputs).toMatchObject([{thread_id:f.id,raw_memory:'Selected raw memory'}]);expect(state.jobs).toHaveLength(2);expect(state.jobs.every((row:any)=>row.status==='done'&&row.ownership_token===null&&row.worker_id===null&&row.lease_until===null)).toBe(true);expect(state.consolidation_progress).toEqual([{singleton:1,max_thread_count:1}]);
  const archive=JSON.parse(await readFile(join(f.task.cwd,'.recovery-history',f.plan.checkpointId!,'codex-inert-execution.json'),'utf8'));expect(JSON.stringify(archive)).toContain('Selected historical queued command');expect(JSON.stringify(archive)).not.toContain('FOREIGN PRIVATE INPUT');expect(archive.automaticReplay).toBe(false);
 }finally{await rm(f.root,{recursive:true,force:true});}
},90000);
