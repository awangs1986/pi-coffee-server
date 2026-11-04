import {it,expect} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';import {BackupCoordinator} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';
it('requires actual administrator authority and managed scopes for retention preview or execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-retention-http-'));let server:HostServer|undefined;try{
  const store=new Workspaces(join(root,'projects'));await store.list();const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'repository'),coordinator}),factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No models');}};
  server=new HostServer({port:0,token:'private',requireUser:true,factory,backup:{coordinator,repository,scopes:['alice','bob']},scopeForUser:()=>({factory,workspaces:store})});await server.start();
  const call=async(actor:string,body:unknown)=>{const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer private','x-pi-coffee-user':'alice','x-pi-coffee-actor':actor,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  expect((await call('alice',{action:'retention-preview',scopes:['alice']})).status).toBe(403);
  expect((await call('alice',{action:'retention-execute',id:'11111111-1111-4111-8111-111111111111',revision:1,digest:'0'.repeat(64)})).status).toBe(403);
  expect((await call('awangs',{action:'retention-preview',scopes:['foreign']})).status).toBe(403);
  expect((await call('awangs',{action:'retention-preview',scopes:['alice']})).status).toBe(409);
  expect((await call('awangs',{action:'retention-status',scope:'alice'})).data).toMatchObject({plans:[],pins:[]});
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
