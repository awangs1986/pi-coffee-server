import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {GroupedRecoveryAdapter} from '../src/host/grouped-recovery.js';
import {PiNativeRecoveryAdapter} from '../src/host/pi-recovery.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {RestoreCoordinator} from '../src/host/restore.js';
import {AccountRecoveryCoordinator} from '../src/host/account-recovery.js';
import {PersonalRecoveryCollection} from '../src/host/personal-recovery-collection.js';
import {HostServer} from '../src/host/server.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('restores two enrolled accounts from one repository with one preview and confirmation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-personal-collection-'));
 let host:HostServer|undefined;
 try{
  const fence=new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true})});
  const stores=new Map<string,Workspaces>(),adapters=new Map<string,PiNativeRecoveryAdapter>(),nativeFiles=new Map<string,string>();
  for(const scope of ['alice','bob']){
   const store=new Workspaces(join(root,scope,'projects'));stores.set(scope,store);await store.createChatConversation('same-id');
   const task=(await store.lookup('same-id'))!;await writeFile(join(task.cwd,'attachment'),scope+' attachment');
   const nativeDir=join(root,scope,'native'),agentDir=join(root,scope,'agent');await mkdir(nativeDir,{recursive:true,mode:0o700});await mkdir(agentDir,{recursive:true,mode:0o700});
   const native=SessionManager.create(task.cwd,nativeDir,{id:'same-id'});native.appendMessage({role:'user',content:scope+' history',timestamp:1});nativeFiles.set(scope,native.getSessionFile()!);
   adapters.set(scope,new PiNativeRecoveryAdapter({scope,workspaces:store,sessionDir:nativeDir,agentDir,fence,sourceCustody:async()=>({known:true})}));
  }
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),adapter:new GroupedRecoveryAdapter({groupId:'two-accounts',fence,inventory:async()=>[...stores.keys()].map(scope=>({scope,taskId:'same-id',engine:'pi'})),resolve:(scope,id)=>adapters.get(scope)!.resolve(scope,id)})});
  expect(await coordinator.capture('alice','same-id','pi')).toMatchObject({state:'protected'});
  const disk=join(root,'disk');await mkdir(disk,{mode:0o700});const repository=new BackupRepository({root:join(root,'repository'),coordinator});
  await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());
  const job=await repository.backup([{scope:'alice',taskId:'same-id'},{scope:'bob',taskId:'same-id'}]);
  for(const [scope,store] of stores){await store.archive('same-id',true);await store.deleteWorkspace('same-id','same-id',()=>rm(nativeFiles.get(scope)!),true);}
  await stores.get('alice')!.createChatConversation('healthy-later');
  const authorize=async(actor:string,scope:string)=>actor==='awangs'&&stores.has(scope),scoped=async(scope:string)=>({workspaces:stores.get(scope)!,adapter:adapters.get(scope)!});
  const restore=new RestoreCoordinator({root:join(root,'restore'),repository,scope:scoped,authorize});
  let failRefresh=true;
  const accounts=new AccountRecoveryCoordinator({onCollectionRefreshPrepared:async()=>{if(failRefresh){failRefresh=false;throw Error('Synthetic lost reply after refreshed plan');}},personal:true,root:join(root,'accounts'),restore,scope:scoped,authorize,materialSource:async()=>repository,pins:async()=>repository});
  const collection=new PersonalRecoveryCollection({root:join(root,'collections'),accounts,authorize});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider');}};
  host=new HostServer({port:0,token:'collection-fixture',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!}),backup:{personal:true,coordinator,repository,restore,accountRecovery:accounts,collection,scopes:['alice','bob']}});await host.start();
  const call=async(actor:string,body:unknown)=>{const response=await fetch(`http://127.0.0.1:${host!.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer collection-fixture','x-pi-coffee-user':'alice','x-pi-coffee-actor':actor,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const input={action:'collection-preview',selections:['alice','bob'].map(scope=>({scope,jobIds:[job.id]}))};
  expect((await call('alice',input)).status).toBe(403);
  const preview=await call('awangs',input);expect(preview).toMatchObject({status:200,data:{state:'staged'}});expect(preview.data.accounts).toHaveLength(2);
  const confirm={action:'collection-confirm',id:preview.data.id,digest:preview.data.digest};
  expect((await call('awangs',{...confirm,digest:'wrong'})).status).toBe(409);
  const profile=join(root,'cli.json');await writeFile(profile,JSON.stringify({schema:3,endpoint:`http://127.0.0.1:${host.address().port}/`,token:'collection-fixture',scope:'alice'}),{mode:0o600});
  const cli=await promisify(execFile)(process.execPath,['dist/src/restore-cli.js','collection-confirm','--profile',profile,'--id',preview.data.id,'--digest',preview.data.digest]);expect(JSON.parse(cli.stdout).state).toBe('partial');
  const alice=(await stores.get('alice')!.lookup('same-id'))!;await writeFile(join(alice.cwd,'attachment'),'alice later work');
  const restarted=new PersonalRecoveryCollection({root:join(root,'collections'),accounts,authorize});expect((await restarted.confirm('awangs',preview.data.id,preview.data.digest)).state).toBe('completed');
  expect(await call('awangs',confirm)).toMatchObject({status:200,data:{state:'completed'}});
  for(const [scope,store] of stores){const task=(await store.lookup('same-id'))!;expect(await readFile(join(task.cwd,'attachment'),'utf8')).toBe(scope==='alice'?'alice later work':'bob attachment');expect(SessionManager.open(nativeFiles.get(scope)!).buildSessionContext().messages).toHaveLength(1);}
  expect(await stores.get('alice')!.lookup('healthy-later')).toBeDefined();
 }finally{await host?.close();await rm(root,{recursive:true,force:true});}
},180000);
