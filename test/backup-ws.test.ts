import {BackupJobRunner} from '../src/host/backup-job-runner.js';
import {BackupCoordinator} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';
import {it,expect} from 'vitest';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
it('reports only the authenticated scope over WebSocket, ignoring a requested foreign scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-ws-'));let server:HostServer|undefined;const sockets:WebSocket[]=[];
 try{
  const stores=new Map<string,Workspaces>();for(const user of ['alice','bob']){const store=new Workspaces(join(root,user,'projects'));stores.set(user,store);await store.createChatConversation(user+'-task');}
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Protection status must not start native');}};
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'repository-runtime'),coordinator});
  const schedule=new BackupJobRunner({root:join(root,'schedule'),repository,coordinator});await schedule.configure({revision:'ws-v1',scopes:['alice','bob'],hour:0});for(const user of ['alice','bob'])await schedule.updateInventory(user,[{taskId:user+'-task',engine:'pi'}]);await schedule.tick();
  server=new HostServer({port:0,token:'ws-backup',requireUser:true,factory,backup:{coordinator,repository,schedule},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  for(const user of ['alice','bob']){
   const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/host`,{headers:{authorization:'Bearer ws-backup','x-pi-coffee-user':user}});sockets.push(socket);await once(socket,'open');
   const next=once(socket,'message');socket.send(JSON.stringify({v:1,type:'get_backup_status',scope:user==='alice'?'bob':'alice'}));const [raw]=await next;const result=JSON.parse(raw.toString());
   expect(result).toMatchObject({type:'backup_status',scope:user,repository:{configured:false,enabled:false,jobs:[],points:[]},tasks:[{taskId:user+'-task',checkpointId:null,coverage:'unavailable'}]});expect(result.schedule.coverage.unprotected).toEqual([user+'-task']);expect(JSON.stringify(result)).not.toContain((user==='alice'?'bob':'alice')+'-task');
  }
 }finally{for(const socket of sockets)socket.terminate();await server?.close();await rm(root,{recursive:true,force:true});}
});

it('rejects malformed forwarded actor identities at WebSocket admission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-ws-actor-'));let server:HostServer|undefined;
 try{
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model');}};
  server=new HostServer({port:0,token:'private',requireUser:true,factory});await server.start();
  const response=await new Promise<number>((resolve,reject)=>{const socket=new WebSocket(`ws://127.0.0.1:${server!.address().port}/host`,{headers:{authorization:'Bearer private','x-pi-coffee-user':'alice','x-pi-coffee-actor':'invalid/actor'}});socket.on('unexpected-response',(_req,res)=>{res.resume();socket.terminate();resolve(res.statusCode!);});socket.on('open',()=>{socket.terminate();resolve(101);});socket.on('error',()=>{});setTimeout(()=>{socket.terminate();reject(Error('Admission timeout'));},5000).unref();});
  expect(response).toBe(400);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
