import {it,expect} from 'vitest';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';import {BackupCoordinator} from '../src/host/backup.js';
it('configures only the service-selected repository with the current administrator and selected managed scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-broker-configure-'));let server:HostServer|undefined;
 try{
  const store=new Workspaces(join(root,'projects'));await store.list();const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model');}},calls:[string|undefined,string][]=[];
  server=new HostServer({port:0,token:'private',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:store}),backup:{coordinator:new BackupCoordinator({root:join(root,'checkpoints')}),scopes:['alice','bob'],configureRepositoryForActor:async(actor,scope)=>{calls.push([actor,scope]);}}});await server.start();
  const call=async(actor:string)=>{const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer private','x-pi-coffee-user':'alice','x-pi-coffee-actor':actor,'content-type':'application/json'},body:JSON.stringify({action:'repository-configure',scope:'bob',destination:'/caller-controlled-path'})});return response.status;};
  expect(await call('alice')).toBe(403);expect(calls).toEqual([]);expect(await call('awangs')).toBe(200);expect(calls).toEqual([['awangs','bob']]);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
