import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import WebSocket from 'ws';import {once} from 'node:events';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator} from '../src/host/backup.js';import {BackupRepository} from '../src/host/backup-repository.js';import {BackupJobRunner} from '../src/host/backup-job-runner.js';
it('binds schedule HTTP and WS metadata to actual actor plus data scope and never reuses a privileged worker',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-actor-'));let server:HostServer|undefined;let socket:WebSocket|undefined;
 try{
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'repository'),coordinator}),schedule=new BackupJobRunner({root:join(root,'schedule'),coordinator,repository});
  await schedule.configure({revision:'initial',scopes:['alice','bob']});await schedule.updateInventory('bob',[{taskId:'bob-only',engine:'pi'}]);
  const calls:[string|undefined,string][]=[];let fallbackReads=0;
  const fallback={status:async()=>{fallbackReads++;throw Error('privileged worker must not be used');},configure:schedule.configure.bind(schedule)};
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model');}},store=new Workspaces(join(root,'projects'));await store.list();
  server=new HostServer({port:0,token:'private',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:store}),backup:{coordinator,scopes:['alice','bob'],schedule:fallback,scheduleForActor:(actor,scope)=>{calls.push([actor,scope]);return schedule;}}});await server.start();const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/backup',{headers:{authorization:'Bearer private','x-pi-coffee-user':'bob','x-pi-coffee-actor':'awangs'}});expect(response.status).toBe(200);expect((await response.json()).schedule.coverage.unprotected).toEqual(['bob-only']);
  socket=new WebSocket(base.replace('http','ws')+'/host',{headers:{authorization:'Bearer private','x-pi-coffee-user':'bob','x-pi-coffee-actor':'bob'}});await once(socket,'open');const message=once(socket,'message');socket.send(JSON.stringify({v:1,type:'get_backup_status'}));const data=JSON.parse(String((await message)[0]));expect(data.schedule.coverage.unprotected).toEqual(['bob-only']);
  expect(calls).toContainEqual(['awangs','bob']);expect(calls).toContainEqual(['bob','bob']);expect(fallbackReads).toBe(0);
 }finally{socket?.terminate();await server?.close();await rm(root,{recursive:true,force:true});}
});
