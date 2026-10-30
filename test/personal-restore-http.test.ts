import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {it,expect} from 'vitest';
import {rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {restoreFixture} from './restore-fixture.js';
const binary=process.env.PI_COFFEE_TEST_RESTIC;
it.skipIf(!binary)('previews and confirms a personal restore through Host HTTP, preserving retries and account checks',async()=>{
 const f=await restoreFixture(binary!);let host:HostServer|undefined;
 try{
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider calls');}};
  host=new HostServer({port:0,token:'personal-fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:f.store}),backup:{personal:true,coordinator:new BackupCoordinator({root:join(f.root,'checkpoints')}),repository:f.repository,restore:f.restore,scopes:['alice']}});
  await host.start();
  const call=async(actor:string,body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${host!.address().port}/api/backup`,{method:body?'POST':'GET',headers:{authorization:'Bearer personal-fixture','x-pi-coffee-user':'alice','x-pi-coffee-actor':actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  expect((await call('awangs')).data.personal).toBe(true);
  const input={action:'restore-preview',scope:'alice',taskId:f.task.id,jobId:f.plan.jobId};
  expect((await call('alice',input)).status).toBe(403);
  const preview=await call('awangs',input);expect(preview).toMatchObject({status:200,data:{state:'staged',taskId:f.task.id}});
  const confirm={action:'restore-confirm',id:preview.data.id,revision:preview.data.revision,digest:preview.data.digest};
  expect((await call('awangs',{...confirm,digest:'wrong'})).status).toBe(409);
  const profile=join(f.root,'personal-cli.json');await writeFile(profile,JSON.stringify({schema:3,endpoint:`http://127.0.0.1:${host.address().port}/`,token:'personal-fixture',scope:'alice'}),{mode:0o600});
  const cli=await promisify(execFile)(process.execPath,['dist/src/restore-cli.js','confirm','--profile',profile,'--id',preview.data.id,'--revision',String(preview.data.revision),'--digest',preview.data.digest]);
  expect(JSON.parse(cli.stdout)).toMatchObject({state:'completed'});
  expect((await call('awangs',confirm))).toMatchObject({status:200,data:{state:'completed'}});
  expect(await readFile(join(f.task.cwd,'draft.md'),'utf8')).toBe('worker draft');
  expect((await f.store.list()).conversations.filter(t=>t.id===f.task.id)).toHaveLength(1);
 }finally{await host?.close();await rm(f.root,{recursive:true,force:true});}
},120000);
