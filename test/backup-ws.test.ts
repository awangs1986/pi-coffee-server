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
  server=new HostServer({port:0,token:'ws-backup',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  for(const user of ['alice','bob']){
   const socket=new WebSocket(`ws://127.0.0.1:${server.address().port}/host`,{headers:{authorization:'Bearer ws-backup','x-pi-coffee-user':user}});sockets.push(socket);await once(socket,'open');
   const next=once(socket,'message');socket.send(JSON.stringify({v:1,type:'get_backup_status',scope:user==='alice'?'bob':'alice'}));const [raw]=await next;const result=JSON.parse(raw.toString());
   expect(result).toMatchObject({type:'backup_status',scope:user,tasks:[{taskId:user+'-task',checkpointId:null,coverage:'unavailable'}]});expect(JSON.stringify(result)).not.toContain((user==='alice'?'bob':'alice')+'-task');
  }
 }finally{for(const socket of sockets)socket.terminate();await server?.close();await rm(root,{recursive:true,force:true});}
});
