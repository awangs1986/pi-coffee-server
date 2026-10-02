import {request as httpRequest} from "node:http";
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { HostServer } from '../src/host/server.js';
import { RpcPiSessionFactory } from '../src/host/pi-adapter.js';
import { Workspaces } from '../src/host/workspaces.js';
import { TransferServer } from '../src/host/transfer.js';

it('keeps task APIs, file grants and logout inside the authenticated shared Host user', async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-shared-workbench-'));
 let uploaded!:()=>void;const progress=new Promise<void>(resolve=>uploaded=resolve);
 const transfer=new TransferServer({onEvent:(_scope,event)=>{if((event as any).type==='transfer_progress')uploaded();},host:'127.0.0.1',port:0,advertiseHost:'127.0.0.1',workdir:root});await transfer.start();
 const host=new HostServer({port:0,token:'transport',requireUser:true,transfer,factory:new RpcPiSessionFactory(),scopeForUser:user=>({
  workdir:join(root,user),factory:new RpcPiSessionFactory(),workspaces:new Workspaces(join(root,user,'projects')),
  skills:{home:join(root,'owner-home'),root:join(root,'skills')},
 })});await host.start();
 const call=(user:string,path:string,body?:unknown)=>fetch(`http://127.0.0.1:${host.address().port}${path}`,{method:body?'POST':'GET',headers:{authorization:'Bearer transport','x-pi-coffee-user':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 try {
  const missing=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{headers:{authorization:'Bearer transport'}});expect(missing.status).toBe(400);
  const a=await (await call('alice','/api/workspace',{action:'conversation',workspaceKind:'chat',id:'alice-task',engine:'pi'})).json();
  const b=await (await call('bob','/api/workspace',{action:'conversation',workspaceKind:'chat',id:'bob-task',engine:'pi'})).json();
  expect(a.cwd).not.toBe(b.cwd);
  expect((await (await call('bob','/api/workspace')).json()).conversations.map((c:any)=>c.id)).toEqual(['bob-task']);
  for(const action of ['files','changes','archive'])expect((await call('bob','/api/workspace',{action,id:a.id})).status).toBe(409);
  await writeFile(join(a.cwd,'inbox','note.txt'),'alice');await writeFile(join(b.cwd,'inbox','note.txt'),'bob');
  const af=await (await call('alice','/api/workspace',{action:'files',id:a.id})).json();
  const bf=await (await call('bob','/api/workspace',{action:'files',id:b.id})).json();
  const download=(grant:any,token=grant.token)=>fetch(`${grant.url}/api/localsend/v2/download?`+new URLSearchParams({scope:grant.scope,token,fileId:'inbox/note.txt'}));
  expect(await (await download(af)).text()).toBe('alice');expect((await download(af,bf.token)).status).toBe(401);
  const prepared=await (await fetch(`${bf.url}/api/localsend/v2/prepare-upload?`+new URLSearchParams({scope:bf.scope,token:bf.token}),{method:'POST',body:JSON.stringify({files:{f:{fileName:'partial.txt',size:100}}})})).json();
  const stream=httpRequest(`${bf.url}/api/localsend/v2/upload?`+new URLSearchParams({sessionId:prepared.sessionId,fileId:'f',token:prepared.files.f}),{method:'POST'});
  stream.on('error',()=>{});stream.write('partial');await progress;
  expect((await call('bob','/api/revoke-files',{})).status).toBe(200);
  stream.destroy();
  expect((await fetch(`http://127.0.0.1:${host.address().port}/healthz`)).status).toBe(200);
  expect((await download(bf)).status).toBe(401);expect(await (await download(af)).text()).toBe('alice');
  for(const action of ['list','disable_native','restore_native'])expect((await call('bob','/api/skills',{action,scope:'user',engine:'codex',id:'external'})).status).toBe(403);
  for(const action of ['disable_native','restore_native'])expect((await call('bob','/api/skills',{action,scope:'project',engine:'pi',conversationId:a.id,id:'external'})).status).toBe(409);
 } finally {await host.close();await transfer.close();await rm(root,{recursive:true,force:true});}
});
