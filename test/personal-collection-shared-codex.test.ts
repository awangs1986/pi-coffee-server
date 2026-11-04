import {it,expect} from 'vitest';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {codexFixture} from './codex-recovery-fixture.js';
import {CodexNativeRecoveryAdapter,codexStore} from '../src/host/codex-recovery.js';
import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {GroupedRecoveryAdapter} from '../src/host/grouped-recovery.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {RestoreCoordinator} from '../src/host/restore.js';
import {AccountRecoveryCoordinator} from '../src/host/account-recovery.js';
import {PersonalRecoveryCollection} from '../src/host/personal-recovery-collection.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('restores two accounts when their shared Codex database is entirely missing',async()=>{
 const f=await codexFixture({personalConfiguration:true});
 try{
  const bob=new Workspaces(join(f.root,'bob','projects'));await bob.createChatConversation('bob-task','codex');const bobId=randomUUID();await bob.setNativeBinding('bob-task',{state:'bound',id:bobId});const bobTask=(await bob.lookup('bob-task'))!;
  const rollout=f.rollout.replace(f.id,bobId);await writeFile(rollout,(await readFile(f.rollout,'utf8')).replaceAll(f.id,bobId).replaceAll(f.task.cwd,bobTask.cwd));
  execFileSync('/usr/bin/python3',['-c',`import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.execute('INSERT INTO threads(id,rollout_path,created_at,updated_at,source,model_provider,cwd,title,sandbox_policy,approval_mode,cli_version,history_mode) VALUES (?,?,1,1,?,?,?,?,?,?,?,?)',(sys.argv[2],sys.argv[3],'cli','fixture',sys.argv[4],'Bob','{"type":"read-only"}','never','0.159.1','paginated'));c.commit();c.close()
`,join(f.sql,'state_5.sqlite'),bobId,rollout,bobTask.cwd]);
  const bobAdapter=new CodexNativeRecoveryAdapter({scope:'bob',workspaces:bob,codexHome:f.home,sqliteHome:f.sql,cliVersion:'0.159.1',restoreConfiguration:true,fence:f.fence,sourceCustody:async()=>({known:true})});
  const coordinator=new BackupCoordinator({root:join(f.root,'group-checkpoints'),adapter:new GroupedRecoveryAdapter({groupId:'shared-codex',fence:f.fence,inventory:async()=>[{scope:'alice',taskId:f.task.id,engine:'codex'},{scope:'bob',taskId:bobTask.id,engine:'codex'}],resolve:(scope,id)=>scope==='alice'?f.adapter.resolve(scope,id):bobAdapter.resolve(scope,id)})});
  expect(await coordinator.capture('alice',f.task.id,'codex')).toMatchObject({state:'protected'});
  const disk=join(f.root,'disk');await mkdir(disk,{mode:0o700});const repository=new BackupRepository({root:join(f.root,'repository'),coordinator});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const job=await repository.backup([{scope:'alice',taskId:f.task.id},{scope:'bob',taskId:bobTask.id}]);
  await f.store.archive(f.task.id,true);await f.store.deleteWorkspace(f.task.id,f.task.id,()=>rm(f.rollout),true);await bob.archive(bobTask.id,true);await bob.deleteWorkspace(bobTask.id,bobTask.id,()=>rm(rollout),true);
  await rm(f.sql,{recursive:true});await mkdir(f.sql,{mode:0o700});
  const authorize=async(actor:string,scope:string)=>actor==='awangs'&&['alice','bob'].includes(scope),scoped=async(scope:string)=>({workspaces:scope==='alice'?f.store:bob,adapter:scope==='alice'?f.adapter:bobAdapter});
  const restore=new RestoreCoordinator({root:join(f.root,'restore'),repository,scope:scoped,authorize});const accounts=new AccountRecoveryCoordinator({personal:true,root:join(f.root,'accounts'),restore,scope:scoped,authorize,materialSource:async()=>repository,pins:async()=>repository});
  const collection=new PersonalRecoveryCollection({root:join(f.root,'collections'),accounts,authorize});
  const preview=await collection.preview('awangs',{selections:['alice','bob'].map(scope=>({scope,jobIds:[job.id]}))});expect(preview.accounts.every(a=>!a.blocked)).toBe(true);
  const result=await collection.confirm('awangs',preview.id,preview.digest!);expect(result,JSON.stringify(result.accounts.map(a=>({scope:a.scope,state:a.state,error:a.errorCode})))).toMatchObject({state:'completed'});
  const snapshot=await codexStore({operation:'snapshot',home:f.home,sqliteHome:f.sql});expect(snapshot.databases['state_5.sqlite'].tables.threads.map(row=>row.id).sort()).toEqual([f.id,bobId].sort());
  expect((await f.store.lookup(f.task.id))?.nativeBinding?.id).toBe(f.id);expect((await bob.lookup(bobTask.id))?.nativeBinding?.id).toBe(bobId);
 }finally{await rm(f.root,{recursive:true,force:true});}
},180000);
