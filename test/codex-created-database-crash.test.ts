import {it,expect} from 'vitest';
import {fork,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {rm,readFile,writeFile,rename,lstat,readdir} from 'node:fs/promises';
import {preparedCodexRecovery} from './codex-recovery-fixture.js';

for(const loss of ['optional','all'])it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)(`first-created Codex database reconciles SIGKILL after SQL commit before its receipt (${loss} stores lost)`,async()=>{
 const f=await preparedCodexRecovery(process.env.PI_COFFEE_TEST_RESTIC!,{
  populate:async f=>{execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(\"INSERT INTO thread_goals(thread_id,goal_id,objective,status,created_at_ms,updated_at_ms) VALUES (?,?,'Historical objective','active',1,1)\",(sys.argv[2],'original-goal'));c.commit();c.close()",join(f.sql,'goals_1.sqlite'),f.id]);},
  lose:async f=>{if(loss==='all'){for(const name of await readdir(f.sql))await rm(join(f.sql,name),{recursive:true,force:true});}else await rm(join(f.sql,'goals_1.sqlite'));}
 });let child:ReturnType<typeof fork>|undefined;
 try{
  child=fork('test/fixtures/codex-restore-worker.mjs',[f.root,f.plan.id,f.plan.digest!,'created-database'],{stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,HOME:f.root}});
  const exit=once(child,'exit');expect((await once(child,'message'))[0]).toMatchObject({phase:'created-database',operationId:f.plan.id});child.kill('SIGKILL');expect((await exit)[1]).toBe('SIGKILL');child=undefined;
  const persistedBefore=JSON.parse(await readFile(join(f.root,'restores',f.plan.id+'.json'),'utf8')),journalPath=persistedBefore.plan.nativeMerge.journal,journalBytes=await readFile(journalPath),journal=JSON.parse(String(journalBytes)),database=join(f.sql,'goals_1.sqlite'),databaseBytes=await readFile(database),databaseIdentity=await lstat(database);
  const publish=()=>f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest});
  // A plausible receipt alone never licenses a different operation, approval,
  // database, SQL image, schema or inode. Each persisted fault is repaired only
  // by this synthetic fixture before trying the next independent boundary.
  for(const fault of [
   {...journal,operationId:'foreign-operation'},
   {...journal,digest:'0'.repeat(64)},
   {...journal,databases:{...journal.databases,'goals_1.sqlite':undefined}},
   {...journal,databases:{...journal.databases,'goals_1.sqlite':'unknown'}},
  ]){await writeFile(journalPath,JSON.stringify(fault));await expect(publish()).rejects.toMatchObject({code:'native_receipt_changed'});await writeFile(journalPath,journalBytes);}
  const change=(statement:string)=>execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute(sys.argv[2]);c.commit();c.close()",database,statement]);
  for(const statement of [
   "UPDATE thread_goals SET objective='Unknown changed objective'",
   "INSERT INTO thread_goals(thread_id,goal_id,objective,status,created_at_ms,updated_at_ms) VALUES ('unknown-thread','unknown-goal','Unplanned extra row','paused',1,1)",
  ]){change(statement);await expect(publish()).rejects.toMatchObject({code:expect.stringMatching(/^(native_store_changed|native_row_conflict)$/)});await writeFile(database,databaseBytes);}
  change('CREATE TABLE unknown_extra_table(id TEXT)');await expect(publish()).rejects.toMatchObject({code:'unsupported_native_schema'});await writeFile(database,databaseBytes);
  await rename(database,database+'.original');await writeFile(database,databaseBytes);await expect(publish()).rejects.toMatchObject({code:'target_changed'});await rm(database);await rename(database+'.original',database);expect((await lstat(database)).ino).toBe(databaseIdentity.ino);
  expect(await f.store.lookup('codex-task')).toBeUndefined();
  const result=await publish();expect(result.state).toBe('completed');
  const goal=JSON.parse(execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in c.execute('SELECT * FROM thread_goals')]))",join(f.sql,'goals_1.sqlite')],{encoding:'utf8'}));expect(goal).toMatchObject([{thread_id:f.id,goal_id:'original-goal',status:'paused'}]);
  expect((await f.other.list()).conversations.map(t=>t.id)).toEqual(['other-account']);expect((await f.store.list()).conversations.map(t=>t.id).sort()).toEqual(['codex-task','neighbor']);
  const persisted=JSON.parse(await readFile(join(f.root,'restores',f.plan.id+'.json'),'utf8'));expect(JSON.parse(await readFile(persisted.plan.nativeMerge.journal,'utf8')).databases['goals_1.sqlite']).toBe('done');
 }finally{if(child){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}await rm(f.root,{recursive:true,force:true});}
},90000);
