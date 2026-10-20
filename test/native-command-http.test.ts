import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';import {WebSocket} from 'ws';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';
it('scopes native commands and complete exports to the opened account task',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-command-'));const stores=new Map<string,Workspaces>();const calls:any[]=[];
 const host=new HostServer({port:0,token:'secret',requireUser:true,factory:{} as any,scopeForUser:async user=>{
  const workspaces=new Workspaces(join(root,user,'projects'));await workspaces.createChatConversation('same','codex');stores.set(user,workspaces);
  const entries=Array.from({length:80},(_,i)=>({id:String(i),kind:'assistant',text:user+' message '+i}));
  return {workspaces,factory:{list:async()=>[],create:async()=>({getState:async()=>({isStreaming:false}),getHistory:async()=>({entries,leafId:'79'}),getHistoryBinding:()=>user,runCommand:async(name:string,args:string)=>{calls.push({user,name,args});return {user};},onEvent:()=>()=>{},stop:async()=>{}})} as any};
 }});await host.start();const sockets:WebSocket[]=[];const base=`http://127.0.0.1:${host.address().port}`;
 try{
  for(const user of ['alice','bob']){
   const ws=new WebSocket(base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer secret','x-pi-coffee-user':user}});sockets.push(ws);const frames:any[]=[];ws.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',nativeProtocol:1,engine:'codex',sessionId:'same'}));await vi.waitFor(()=>expect(frames).toEqual(expect.arrayContaining([expect.objectContaining({type:'history'})])));
   ws.send(JSON.stringify({v:1,type:'agent_command',requestId:user,name:'goal',args:'',threadId:'other-user'}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='agent_command_result')).toBe(true));expect(JSON.parse(frames.find(f=>f.type==='agent_command_result').text)).toEqual({user});
   const response=await fetch(base+'/api/conversations/same/native-export',{headers:{authorization:'Bearer secret','x-pi-coffee-user':user}});expect(response.status).toBe(200);const text=await response.text();expect(text).toContain(user+' message 0');expect(text).toContain(user+' message 79');expect(text).not.toContain((user==='alice'?'bob':'alice')+' message');
  }
  expect(calls.map(c=>c.user)).toEqual(['alice','bob']);
  expect((await fetch(base+'/api/conversations/same/native-export')).status).toBe(401);
  await stores.get('bob')!.archive('same',true);
  expect((await fetch(base+'/api/conversations/same/native-export',{headers:{authorization:'Bearer secret','x-pi-coffee-user':'bob'}})).status).toBe(409);
 }finally{for(const ws of sockets)ws.close();await host.close();await rm(root,{recursive:true,force:true});}
});
