import {it,expect} from 'vitest';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {restoreFixture} from './restore-fixture.js';
import {AccountRecoveryCoordinator} from '../src/host/account-recovery.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {HostServer} from '../src/host/server.js';
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('restores missing account tasks with one confirmation while keeping a healthy task outside the old point',async()=>{
 const f=await restoreFixture(process.env.PI_COFFEE_TEST_RESTIC!);let host:HostServer|undefined;
 try{
  const accounts=new AccountRecoveryCoordinator({personal:true,root:join(f.root,'accounts'),restore:f.restore,scope:async()=>({workspaces:f.store}),authorize:async(actor,scope)=>actor==='awangs'&&scope==='alice',materialSource:async()=>f.repository,pins:async()=>f.repository});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider');}};
  host=new HostServer({port:0,token:'account-fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:f.store}),backup:{personal:true,coordinator:new BackupCoordinator({root:join(f.root,'checkpoints')}),repository:f.repository,restore:f.restore,accountRecovery:accounts,scopes:['alice']}});await host.start();
  const call=async(body:unknown)=>{const response=await fetch(`http://127.0.0.1:${host!.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer account-fixture','x-pi-coffee-user':'alice','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const preview=await call({action:'account-restore-preview',scope:'alice',jobIds:[f.plan.jobId]});
  expect(preview).toMatchObject({status:200,data:{state:'staged',blocked:false}});
  const confirm={action:'account-restore-confirm',id:preview.data.id,revision:preview.data.revision,digest:preview.data.digest};
  expect(await call(confirm)).toMatchObject({status:200,data:{state:'completed'}});
  expect(await call(confirm)).toMatchObject({status:200,data:{state:'completed'}});
  expect((await f.store.list()).conversations.map(c=>c.id).sort()).toEqual(['lost-task','neighbor']);
  expect((await f.other.list()).conversations.map(c=>c.id)).toEqual(['other-account']);
 }finally{await host?.close();await rm(f.root,{recursive:true,force:true});}
},120000);
