import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BackupCoordinator} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {BackupJobRunner} from '../src/host/backup-job-runner.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('exposes only own persistent alerts and permits only administrator policy changes within managed scopes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-http-'));let server:HostServer|undefined;
 try{
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'repository'),coordinator}),runner=new BackupJobRunner({root:join(root,'schedule'),coordinator,repository});
  await runner.configure({revision:'v1',scopes:['alice','bob'],hour:0});await runner.updateInventory('alice',[{taskId:'alice-private',engine:'pi'}]);await runner.updateInventory('bob',[{taskId:'bob-private',engine:'codex'}]);await runner.tick();
  const stores=new Map<string,Workspaces>();for(const name of ['alice','bob']){const store=new Workspaces(join(root,name,'projects'));await store.createChatConversation(name+'-private');stores.set(name,store);}
  const credential=join(root,'host-token');await writeFile(credential,'schedule-private',{mode:0o600});
  const connection={url:'http://127.0.0.1',tokenFile:credential,actor:'awangs'};
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native runtime needed');}};
  server=new HostServer({port:0,token:'schedule-private',requireUser:true,factory,backup:{coordinator,schedule:runner,scheduleConnection:connection,scopes:['alice','bob']},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();connection.url=`http://127.0.0.1:${server.address().port}`;
  const call=async(actor:string,body?:unknown)=>{const response=await fetch(connection.url+'/api/backup',{method:body?'POST':'GET',headers:{authorization:'Bearer schedule-private','x-pi-coffee-user':'bob','x-pi-coffee-actor':actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  const own=await call('bob');expect(own.status).toBe(200);expect(own.data.schedule.coverage.unprotected).toEqual(['bob-private']);expect(JSON.stringify(own.data.schedule)).not.toContain('alice-private');expect(own.data.schedule.alerts.some((a:any)=>a.kind==='job-failed')).toBe(true);
  expect((await call('bob',{action:'schedule-configure',revision:'v2',scopes:['bob']})).status).toBe(403);
  expect((await call('awangs',{action:'schedule-configure',revision:'v2',scopes:['foreign']})).status).toBe(403);
  expect((await call('awangs',{action:'schedule-configure',revision:'v2',scopes:['alice','bob']})).status).toBe(200);
  const policy=(await call('bob')).data.schedule.schedule;expect(policy).toMatchObject({revision:'v2',timeZone:'America/Toronto',hour:4,minute:0});expect(JSON.stringify(policy)).not.toContain(credential);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

it('keeps scoped status readable and marks repository unavailable when actor client creation fails',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-offline-'));let server:HostServer|undefined;
 try{
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),store=new Workspaces(join(root,'projects'));await store.createChatConversation('own-task');
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model');}};
  server=new HostServer({port:0,token:'private',requireUser:true,factory,backup:{coordinator,repositoryForActor:()=>{throw Error('private socket path must not leak');}},scopeForUser:()=>({factory,workspaces:store})});await server.start();
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/backup`,{headers:{authorization:'Bearer private','x-pi-coffee-user':'alice'}});
  expect(response.status).toBe(200);const data=await response.json();expect(data.tasks[0].taskId).toBe('own-task');expect(data.repository).toMatchObject({enabled:false,errorCode:'repository_status_unavailable',activationUnavailable:expect.any(String)});expect(JSON.stringify(data)).not.toContain('private socket path');
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
