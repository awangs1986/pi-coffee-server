import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('shares viewed completions across browsers and Host restart, with scoped exact-run admission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-shared-completion-'));let server:HostServer|undefined;
 const stores=new Map<string,Workspaces>(),factory={list:async()=>[{id:'same-id',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',messageCount:2,preview:'Synthetic',running:false}],delete:async()=>false,create:async()=>{throw Error('Acknowledgement must not start an Agent');}};
 const start=async()=>{server=new HostServer({port:0,token:'synthetic-completion',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();};
 const call=async(user:string,body?:unknown)=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:body?'POST':'GET',headers:{authorization:'Bearer synthetic-completion','x-pi-coffee-user':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 try{
  for(const user of ['alice','bob']){const store=new Workspaces(join(root,user,'projects'),{chatRoot:join(root,user,'chats')});stores.set(user,store);await store.createChatConversation('same-id');await store.recordRunStatus('same-id','settled');}
  await stores.get('alice')!.createChatConversation('alice-only');await stores.get('alice')!.recordRunStatus('alice-only','settled');
  await start();const a=(await call('alice')).data.conversations.find((c:any)=>c.id==='same-id');
  const ack={id:a.id,completionId:a.completionId};
  expect((await call('alice',{action:'completion_read',reads:[ack]}))).toMatchObject({status:200,data:{reads:[ack]}});
  const socket=new WebSocket(`ws://127.0.0.1:${server!.address().port}/host`,{headers:{authorization:'Bearer synthetic-completion','x-pi-coffee-user':'alice'}});
  const listed=await new Promise<any[]>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('WS list deadline')),3000);socket.on('error',reject);socket.on('open',()=>socket.send(JSON.stringify({v:1,type:'list_sessions'})));socket.on('message',raw=>{const f=JSON.parse(String(raw));if(f.type==='sessions'){clearTimeout(timer);resolve(f.sessions);}});});socket.close();
  expect(listed.find(s=>s.id==='same-id').readCompletionId).toBe(a.completionId);
  // Browser B has no Browser A storage; its independent account-scoped response carries the receipt.
  expect((await call('alice')).data.conversations.find((c:any)=>c.id==='same-id').readCompletionId).toBe(a.completionId);
  expect((await call('bob')).data.conversations[0].readCompletionId).toBeUndefined();
  expect((await call('bob',{action:'completion_read',reads:[ack]})).data.reads).toEqual([]);
  expect((await call('bob',{action:'completion_read',reads:[{id:'alice-only',completionId:'unknown'}]})).data.reads).toEqual([]);
  expect((await call('alice',{action:'completion_read',user:'bob',reads:[ack]})).status).toBe(409);
  expect((await call('alice',{action:'completion_read',reads:[{...ack,user:'bob'}]})).status).toBe(409);
  await server!.close();for(const user of ['alice','bob'])stores.set(user,new Workspaces(join(root,user,'projects'),{chatRoot:join(root,user,'chats')}));await start();
  expect((await call('alice')).data.conversations.find((c:any)=>c.id==='same-id').readCompletionId).toBe(a.completionId);
  await stores.get('alice')!.markRun('same-id','running');await stores.get('alice')!.recordRunStatus('same-id','settled');
  const next=(await call('alice')).data.conversations.find((c:any)=>c.id==='same-id');expect(next.completionId).not.toBe(next.readCompletionId);
  expect((await call('alice',{action:'completion_read',reads:[ack]})).data.reads).toEqual([]);
  expect((await call('alice',{action:'completion_read',reads:[{id:next.id,completionId:next.completionId}]})).data.reads).toHaveLength(1);
  expect((await call('alice')).data.conversations.find((c:any)=>c.id==='same-id').readCompletionId).toBe(next.completionId);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
