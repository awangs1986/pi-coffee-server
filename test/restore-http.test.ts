import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {RestoreCoordinator} from '../src/host/restore.js';

it('persists an own-scope recovery request without granting approval, execution or another account visibility',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-restore-http-'));let server:HostServer|undefined;
 try{
  const stores=new Map<string,Workspaces>();for(const user of ['awangs','alice','bob']){const store=new Workspaces(join(root,user,'projects'));stores.set(user,store);await store.list();}
  const restore=new RestoreCoordinator({root:join(root,'restore'),scope:async scope=>({workspaces:stores.get(scope)!}),authorize:async(actor,scope,manage)=>actor==='awangs'||!manage&&['alice','bob'].includes(actor)&&actor===scope});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider calls');}};
  server=new HostServer({port:0,token:'restore',requireUser:true,factory,backup:{coordinator:new BackupCoordinator({root:join(root,'checkpoints')}),restore,scopes:['alice','bob']},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const call=async(user:string,body?:unknown)=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:body?'POST':'GET',headers:{authorization:'Bearer restore','x-pi-coffee-user':user,'x-pi-coffee-actor':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const requested=await call('alice',{action:'restore-request',taskId:'lost-task',jobId:'12345678-1234-4234-8234-123456789abc'});expect(requested.status).toBe(200);expect(requested.data).toMatchObject({state:'requested',scope:'alice',requestedBy:'alice',revision:1});
  const id=requested.data.id;
  for(const action of ['restore-plan','restore-approve','restore-publish','restore-revise'])expect((await call('alice',{action,id,revision:1,digest:'untrusted'})).status).toBe(403);
  expect((await call('bob',{action:'restore-cancel',id,revision:1})).status).toBe(403);
  expect((await call('alice',{action:'restore-request',scope:'bob',taskId:'lost-task',jobId:'12345678-1234-4234-8234-123456789abc'})).status).toBe(403);
  expect(JSON.stringify((await call('bob')).data)).not.toContain(id);
  expect((await call('alice')).data.restores).toMatchObject([{id,state:'requested'}]);
  const restarted=new RestoreCoordinator({root:join(root,'restore'),scope:async scope=>({workspaces:stores.get(scope)!}),authorize:async(actor,scope,manage)=>actor==='awangs'||!manage&&actor===scope});expect(await restarted.status('alice','alice')).toMatchObject([{id,state:'requested'}]);
  expect((await call('alice',{action:'restore-cancel',id,revision:1})).data.state).toBe('cancelled');
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
