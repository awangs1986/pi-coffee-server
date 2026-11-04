import {it,expect} from 'vitest';
import {rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {preparedCodexRecovery,nativeReadResume} from './codex-recovery-fixture.js';
import {codexStore} from '../src/host/codex-recovery.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC||!process.env.PI_COFFEE_TEST_CODEX_ROOT)('restores an entirely missing Codex SQL store and original native history while capture still refuses absent state',async()=>{
 let config='',root='';try{const f=await preparedCodexRecovery(process.env.PI_COFFEE_TEST_RESTIC!,{lose:async f=>{
  root=f.root;config=await readFile(join(f.home,'config.toml'),'utf8');for(const name of await readdir(f.sql))await rm(join(f.sql,name),{recursive:true,force:true});
  await expect(codexStore({operation:'snapshot',home:f.home,sqliteHome:f.sql})).rejects.toMatchObject({code:'native_binding_missing'});
  await rm(f.sql,{recursive:true});await rm(join(f.home,'config.toml'));
 }});
  expect((await f.restore.operate('awangs',f.plan.id,{action:'publish',revision:1,digest:f.plan.digest})).state).toBe('completed');
  expect((await f.store.lookup(f.task.id))?.nativeBinding?.id).toBe(f.id);expect(await readFile(f.rollout,'utf8')).toContain('original-agent-item');
  expect((await f.other.list()).conversations.map(t=>t.id)).toEqual(['other-account']);expect((await f.store.list()).conversations.map(t=>t.id).sort()).toEqual(['codex-task','neighbor']);
  await expect(readFile(join(f.home,'config.toml'))).rejects.toMatchObject({code:'ENOENT'});
  // Authentication/configuration is explicit fixture reconfiguration after
  // recovery; the restored native history itself supplies the original IDs.
  await writeFile(join(f.home,'config.toml'),config,{mode:0o600});await nativeReadResume(f);
 }finally{if(root)await rm(root,{recursive:true,force:true});}
},90000);

for(const fault of ['unknown-database','index-conflict'])it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)(`missing-state restore refuses ${fault} in the original target homes`,async()=>{
 let root='';try{
  await expect(preparedCodexRecovery(process.env.PI_COFFEE_TEST_RESTIC!,{lose:async f=>{root=f.root;for(const name of await readdir(f.sql))await rm(join(f.sql,name),{recursive:true,force:true});
   if(fault==='unknown-database')await writeFile(join(f.sql,'unknown_1.sqlite'),'unknown existing database');
   else await writeFile(join(f.home,'session_index.jsonl'),JSON.stringify({id:f.id,thread_name:'Conflicting native index',updated_at:'2026-10-25T12:30:00Z'})+'\n');
  }})).rejects.toMatchObject({code:fault==='unknown-database'?'unsupported_native_schema':'native_index_conflict'});
 }finally{if(root)await rm(root,{recursive:true,force:true});}
},90000);
