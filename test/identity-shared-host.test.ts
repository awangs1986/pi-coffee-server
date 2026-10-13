import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {WebSocket} from 'ws';
import {WebServer} from '../src/web/server.js';
import {HostServer} from '../src/host/server.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {Workspaces} from '../src/host/workspaces.js';
import {parseUserRoutes} from '../src/web/identity.js';

it('admits a scoped participant without moving the legacy owner or sharing HTTP/WS tasks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-routing-'));
 const factory=(scope:string)=>{
  const value=new RpcPiSessionFactory({cwd:join(root,scope),sessionDir:join(root,scope,'sessions')});
  value.list=async()=>[{id:scope==='owner'?'owner-task':'participant-task',createdAt:'2026-10-13T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z',messageCount:2,preview:'fixture'}];
  return value;
 };
 const host=new HostServer({port:0,token:'fixture',factory:factory('owner'),workspaces:new Workspaces(join(root,'owner','projects')),
  scopeForUser:user=>({factory:factory(user),workspaces:new Workspaces(join(root,user,'projects'))})});
 await host.start();
 let routes=parseUserRoutes(JSON.stringify({'1':{hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',legacyDefault:true},'2':{hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture'}}));
 const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',identity:{giteaUrl:'http://gitea.test',clientId:'fixture',clientSecret:'fixture',publicUrl:'http://coffee.test',sharedHost:true,routes:()=>routes,
  fetch:async(url,options)=>Response.json(String(url).includes('access_token')?{access_token:new URLSearchParams(String(options?.body)).get('code')}:{id:Number(new Headers(options?.headers).get('authorization')?.replace('Bearer ','')),login:'fixture',active:true})}});
 await web.start();const base=`http://127.0.0.1:${web.address().port}`;
 const login=async(id:number)=>{
  const start=await fetch(base+'/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')!).searchParams.get('state');
  return fetch(base+`/auth/callback?state=${state}&code=${id}`,{redirect:'manual',headers:{cookie:start.headers.get('set-cookie')!.split(';')[0]}});
 };
 const cookie=(r:Response)=>r.headers.get('set-cookie')!.split(';')[0];
 const call=(key:string,body?:unknown)=>fetch(base+'/api/workspace',{method:body?'POST':'GET',headers:{cookie:key,origin:'http://coffee.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const listing=(key:string)=>new Promise<string[]>((resolve,reject)=>{
  const ws=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{cookie:key,origin:'http://coffee.test'}});
  const timer=setTimeout(()=>{ws.terminate();reject(Error('list deadline'));},4000);
  ws.on('error',e=>{clearTimeout(timer);reject(e);});
  ws.on('open',()=>ws.send(JSON.stringify({v:1,type:'list_sessions'})));
  ws.on('message',data=>{const frame=JSON.parse(String(data));if(frame.type==='sessions'){clearTimeout(timer);ws.close();resolve(frame.sessions.map((s:{id:string})=>s.id));}});
 });
 try{
  const owner=await login(1),participant=await login(2);expect(owner.status).toBe(302);expect(participant.status).toBe(302);
  const a=await (await call(cookie(owner),{action:'conversation',workspaceKind:'chat',engine:'pi',id:'owner-task'})).json();
  const b=await (await call(cookie(participant),{action:'conversation',workspaceKind:'chat',engine:'pi',id:'participant-task'})).json();
  expect(a.cwd).toContain(join(root,'owner'));expect(b.cwd).toContain(join(root,'gitea-2'));
  expect((await (await call(cookie(owner))).json()).conversations.map((c:{id:string})=>c.id)).toEqual(['owner-task']);
  expect((await (await call(cookie(participant))).json()).conversations.map((c:{id:string})=>c.id)).toEqual(['participant-task']);
  await writeFile(join(a.cwd,'inbox','private.txt'),'owner fixture');
  expect((await call(cookie(participant),{action:'files',id:'owner-task'})).status).toBe(409);
  expect(await listing(cookie(owner))).toContain('owner-task');
  expect(await listing(cookie(participant))).toEqual(['participant-task']);
  expect((await login(3)).status).toBe(401);
  // Changing only the authorization scope must revoke the old browser session.
  routes=parseUserRoutes(JSON.stringify({...routes,'1':{...routes['1'],legacyDefault:false}}));
  expect((await fetch(base+'/api/me',{headers:{cookie:cookie(owner)}})).status).toBe(401);
  // A second route must never inherit the default owner's registry.
  routes=parseUserRoutes(JSON.stringify({...routes,'1':{...routes['1'],legacyDefault:true},'2':{...routes['2'],legacyDefault:true}}));
  expect((await login(2)).status).toBe(401);
 }finally{await web.close();await host.close();await rm(root,{recursive:true,force:true});}
});
