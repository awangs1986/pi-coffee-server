import {codexFixture,nativeReadResume} from './codex-recovery-fixture.js';
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';import {execFileSync,spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import {once} from 'node:events';
import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {CodexNativeRecoveryAdapter} from '../src/host/codex-recovery.js';
import {RestoreCoordinator} from '../src/host/restore.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {readCodexHistory} from '../src/host/codex/history.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';

it('a scoped Codex job seals the effective shared SQLite home and committed WAL with its ordinary native history',async()=>{
 const f=await codexFixture();try{
  await f.adapter.resolve('alice',f.task.id).catch(e=>{throw new Error(e.code);});const result=await f.coordinator.capture('alice',f.task.id,'codex');expect(result.state).toBe('protected');const point=(await f.coordinator.sealedCheckpoint('alice',f.task.id))!;expect(point.manifest.members).toEqual([{scope:'alice',taskId:f.task.id,engine:'codex',nativeBindings:[f.id]}]);
  const source=point.manifest.sources.find(s=>s.recoveryKey==='codex/group-v1')!;const material=JSON.parse(await readFile(join(point.directory,'objects',source.id),'utf8'));expect(material.sqliteHome).toBe(f.sql);expect(material.databases['state_5.sqlite'].tables.threads[0].id).toBe(f.id);expect(material.databases['thread_history_1.sqlite']).toBeDefined();
  const before=result.checkpointId,release=f.fence.beginWriter('native');expect((await f.coordinator.capture('alice',f.task.id,'codex')).checkpointId).toBe(before);release();
  await expect(f.adapter.resolve('bob',f.task.id)).rejects.toMatchObject({code:'closure_incomplete'});
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('the Codex checkpoint includes committed WAL rows and preserves its earlier point when an unknown migration appears',async()=>{
 const f=await codexFixture();try{
  execFileSync('/usr/bin/python3',['-c',"import sqlite3,os,sys;c=sqlite3.connect(sys.argv[1]);c.execute('PRAGMA journal_mode=WAL');c.execute('UPDATE threads SET title=? WHERE id=?',('Committed WAL title',sys.argv[2]));c.commit();os._exit(0)",join(f.sql,'state_5.sqlite'),f.id]);
  expect((await readFile(join(f.sql,'state_5.sqlite-wal'))).length).toBeGreaterThan(0);const result=await f.coordinator.capture('alice',f.task.id,'codex');expect(result.state).toBe('protected');const point=(await f.coordinator.sealedCheckpoint('alice',f.task.id))!,source=point.manifest.sources.find(s=>s.recoveryKey==='codex/group-v1')!;expect(JSON.parse(await readFile(join(point.directory,'objects',source.id),'utf8')).databases['state_5.sqlite'].tables.threads[0].title).toBe('Committed WAL title');
  execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('CREATE TABLE unknown_future_schema(value TEXT)');c.commit();c.close()",join(f.sql,'state_5.sqlite')]);const rejected=await f.coordinator.capture('alice',f.task.id,'codex');expect(rejected.state).toBe('unavailable');expect(rejected.reason).toContain('schema');expect(rejected.checkpointId).toBe(result.checkpointId);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('an approved encrypted Codex recovery merges original native IDs and browser history while preserving neighboring rows',async()=>{
 const f=await codexFixture();try{
  if(process.env.PI_COFFEE_TEST_CODEX_ROOT){for(const name of await (await import('node:fs/promises')).readdir(f.sql))await rm(join(f.sql,name));await nativeReadResume(f);}
  expect((await f.coordinator.capture('alice',f.task.id,'codex')).state).toBe('protected');const disk=join(f.root,'disk');await mkdir(disk,{mode:0o700});const repository=new BackupRepository({root:join(f.root,'repository'),coordinator:f.coordinator});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());const job=await repository.backup([{scope:'alice',taskId:f.task.id}]);
  execFileSync('/usr/bin/python3',['-c',`import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);cols=[r[1] for r in c.execute('PRAGMA table_info(threads)')];row=dict(zip(cols,c.execute('SELECT * FROM threads WHERE id=?',(sys.argv[2],)).fetchone()));row['id']='neighbor-native';row['title']='Preserved neighbor';c.execute('INSERT INTO threads ('+','.join(cols)+') VALUES ('+','.join('?' for _ in cols)+')',[row[k] for k in cols]);c.execute('DELETE FROM threads WHERE id=?',(sys.argv[2],));c.commit();c.close()`,join(f.sql,'state_5.sqlite'),f.id]);
  execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);[c.execute('DELETE FROM '+t+' WHERE thread_id=?',(sys.argv[2],)) for t in ['thread_turns','thread_items','thread_realtime_items','thread_history_projection_state']];c.commit();c.close()",join(f.sql,'thread_history_1.sqlite'),f.id]);
  await f.store.archive(f.task.id,true);await f.store.deleteWorkspace(f.task.id,f.task.id,()=>rm(f.rollout),true);
  const restore=new RestoreCoordinator({root:join(f.root,'restores'),repository,authorize:async(actor,scope,manage)=>scope==='alice'&&(manage?actor==='awangs':actor==='alice'),scope:async()=>({workspaces:f.store,adapter:f.adapter})});
  const request=await restore.request('alice','alice',{taskId:f.task.id,jobId:job.id});const plan=await restore.operate('awangs',request.id,{action:'plan',revision:1});await expect(restore.operate('alice',request.id,{action:'approve',revision:1,digest:plan.digest})).rejects.toMatchObject({code:'forbidden'});await restore.operate('awangs',request.id,{action:'approve',revision:1,digest:plan.digest});expect((await restore.operate('awangs',request.id,{action:'publish',revision:1,digest:plan.digest}).catch(e=>{throw new Error(e.code);})).state).toBe('completed');
  const history=await readCodexHistory({cwd:f.task.cwd,codexHome:f.home},f.id);expect(history.history.entries.map(e=>({id:e.id,text:e.text}))).toMatchObject([{id:'original-user-item',text:'The ordinary question'},{id:'original-agent-item',text:'The ordinary answer'}]);
  const rows=execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys,json;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute('SELECT id,title FROM threads ORDER BY id').fetchall()))",join(f.sql,'state_5.sqlite')],{encoding:'utf8'});expect(rows).toContain('Preserved neighbor');expect(rows).toContain(f.id);expect((await f.store.lookup(f.task.id))?.nativeBinding?.id).toBe(f.id);
  if(process.env.PI_COFFEE_TEST_CODEX_ROOT)await nativeReadResume(f);
 }finally{await rm(f.root,{recursive:true,force:true});}
},120000);

it('the browser history reader resolves a bounded native fork prefix with original item IDs and excludes later parent turns',async()=>{
 const f=await codexFixture();try{const parent=JSON.parse(JSON.stringify(f.task)),child=randomUUID(),bytes=await readFile(f.rollout),rows=bytes.toString('utf8').trimEnd().split('\n').map(line=>JSON.parse(line));const meta={...rows[0].payload,id:child,history_base:{thread_id:f.id,end_ordinal_exclusive:rows.length,end_byte_offset:bytes.length},forked_from_id:f.id};
  const childPath=join(dirname(f.rollout),'rollout-2026-10-25T13-00-00-'+child+'.jsonl');await writeFile(childPath,JSON.stringify({timestamp:'2026-10-25T13:00:00Z',ordinal:rows.length,type:'session_meta',payload:meta})+'\n');
  await writeFile(f.rollout,bytes.toString('utf8')+JSON.stringify({timestamp:'2026-10-25T14:00:00Z',ordinal:rows.length,type:'event_msg',payload:{type:'item_completed',thread_id:f.id,turn_id:randomUUID(),item:{type:'AgentMessage',id:'later-parent',text:'This later parent turn must stay outside the fork'}}})+'\n');
  const factory=new CodexSessionFactory({cwd:f.task.cwd,codexHome:f.home});const history=await factory.readHistory(child);expect(history.sourceFreshness).toBe('current');expect(history.history.entries.map(e=>e.id)).toEqual(['original-user-item','original-agent-item']);expect(JSON.stringify(history)).not.toContain('later parent turn');
 }finally{await rm(f.root,{recursive:true,force:true});}
});
