import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HostServer} from '../src/host/server.js';
import {WebServer} from '../src/web/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('authorizes authenticated legacy owner by actor while preserving data scope and rejecting ordinary actor spoofing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-identity-')),owner=new Workspaces(join(root,'owner','projects')),participant=new Workspaces(join(root,'participant','projects'));
 await owner.createChatConversation('owner-task');await participant.createChatConversation('participant-task');
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Backup identity must not start native');}};
 const scopes:string[]=[];const host=new HostServer({port:0,token:'identity-fixture',factory,workspaces:owner,scopeForUser:user=>{scopes.push(user);if(user!=='gitea-2')throw Error('Unexpected source scope');return {factory,workspaces:participant};}});await host.start();
 const routes={'1':{hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'identity-fixture',legacyDefault:true},'2':{hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'identity-fixture'}};
 const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',identity:{giteaUrl:'http://gitea.test',clientId:'fixture',clientSecret:'fixture',publicUrl:'http://coffee.test',sharedHost:true,routes:()=>routes,fetch:async(url,options)=>{if(String(url).includes('access_token'))return Response.json({access_token:new URLSearchParams(String(options?.body)).get('code')});const id=Number(new Headers(options?.headers).get('authorization')?.replace('Bearer ',''));return Response.json({id,login:id===1?'awangs':'participant',active:true});}}});await web.start();
 const base=`http://127.0.0.1:${web.address().port}`;
 const login=async(id:number)=>{const start=await fetch(base+'/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')!).searchParams.get('state'),result=await fetch(base+`/auth/callback?state=${state}&code=${id}`,{redirect:'manual',headers:{cookie:start.headers.get('set-cookie')!.split(';')[0]}});return result.headers.get('set-cookie')!.split(';')[0];};
 const call=(cookie:string,body?:unknown)=>fetch(base+'/api/backup',{method:body?'POST':'GET',headers:{cookie,origin:'http://coffee.test','content-type':'application/json','x-pi-coffee-actor':'awangs','x-pi-coffee-user':'awangs'},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const a=await login(1),b=await login(2),status=await(await call(a)).json();expect(status).toMatchObject({canManage:true,scope:'__legacy_default__',tasks:[{taskId:'owner-task'}]});
  expect((await call(a,{action:'capture',scope:'__legacy_default__',taskId:'owner-task'})).status).toBe(409);
  expect((await call(a,{action:'status',scope:'__legacy_default__'})).status).toBe(200);
  const other=await(await call(b)).json();expect(other).toMatchObject({canManage:false,scope:'gitea-2',tasks:[{taskId:'participant-task'}]});expect(JSON.stringify(other)).not.toContain('owner-task');
  expect((await call(b,{action:'capture',scope:'__legacy_default__',taskId:'owner-task'})).status).toBe(403);
  expect((await call(b,{action:'status',scope:'__legacy_default__'})).status).toBe(403);
  expect(scopes).toEqual(['gitea-2']);
 }finally{await web.close();await host.close();await rm(root,{recursive:true,force:true});}
});
