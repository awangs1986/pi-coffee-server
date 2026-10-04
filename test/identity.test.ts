import { describe,it,expect } from 'vitest';
import { WebServer } from '../src/web/server.js';
import { parseUserRoutes, type UserRoute } from '../src/web/identity.js';
import { WebSocket } from 'ws';
import { createServer } from 'node:http';
describe('Gitea identity and fixed VM routing',()=> {
 it('accepts the UTF-8 BOM emitted by Windows PowerShell route files',()=> {
  expect(parseUserRoutes('\uFEFF{"4":{"hostUrl":"ws://127.0.0.1:8788/host","hostToken":"token"}}')).toEqual({
   '4':{hostUrl:'ws://127.0.0.1:8788/host',hostToken:'token'},
  });
 });
 it('invalidates login immediately even when the VM file-revocation endpoint is stalled',async()=> {
  let release!:()=>void;
  let requested!:()=>void;
  const stalled=new Promise<void>(resolve=>{release=resolve;});
  const revoking=new Promise<void>(resolve=>{requested=resolve;});
  const host=createServer(async(_req,res)=>{requested();await stalled;res.writeHead(200);res.end('{}');});
  await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));
  const address=host.address() as {port:number};
  const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',identity:{
   giteaUrl:'http://gitea.test',clientId:'app',clientSecret:'test-only',publicUrl:'http://coffee.test',
   routes:()=>({'7':{hostUrl:`ws://127.0.0.1:${address.port}/host`,hostToken:'test-only'}}),
   fetch:(async(url)=>new Response(JSON.stringify(String(url).includes('access_token') ? {access_token:'test-only'} : {id:7,login:'owner',active:true}))) as typeof fetch,
  }});
  await web.start();const base=`http://127.0.0.1:${web.address().port}`;
  let logout:Promise<Response>|undefined;
  try {
   const login=await fetch(base+'/auth/login',{redirect:'manual'});
   const state=new URL(login.headers.get('location')!).searchParams.get('state');
   const callback=await fetch(base+`/auth/callback?state=${state}&code=x`,{redirect:'manual',headers:{cookie:login.headers.get('set-cookie')!.split(';')[0]}});
   const cookie=callback.headers.get('set-cookie')!.split(';')[0];
   logout=fetch(base+'/auth/logout',{method:'POST',headers:{cookie,origin:'http://coffee.test'}});
   await revoking;
   expect((await fetch(base+'/api/me',{headers:{cookie}})).status).toBe(401);
   expect((await logout).status).toBe(204);
  }finally {
   release();await logout;await web.close();await new Promise<void>(resolve=>host.close(()=>resolve()));
  }
 });
 it('uses PKCE/state and HttpOnly sessions; denies absent routes, revoked routes and foreign origins',async()=> {
  let routes:Record<string,UserRoute>={'7':{hostUrl:'ws://127.0.0.1:1/host',hostToken:'vm-only-secret'}};
  let challenge='';
  const fakeFetch=async(url:any,options:any)=>{
   if(String(url).includes('access_token')){expect(String(options.body)).toContain('code_verifier=');return new Response(JSON.stringify({access_token:'gitea-token'}));}
   expect(options.headers.authorization).toBe('Bearer gitea-token');return new Response(JSON.stringify({id:7,login:'owner',active:true}));
  };
  const web=new WebServer({port:0,hostUrl:'ws://127.0.0.1:1/host',identity:{giteaUrl:'http://gitea.test',clientId:'app',clientSecret:'server-only',publicUrl:'http://coffee.test',routes:()=>routes,fetch:fakeFetch as typeof fetch}});
  await web.start();const base=`http://127.0.0.1:${web.address().port}`;
  try {
   expect((await fetch(base+'/api/me')).status).toBe(401);
   const unauthMe=await fetch(base+'/auth/me');expect(unauthMe.status).toBe(401);expect(await unauthMe.json()).toEqual({error:'Login required',loginUrl:'/auth/login'});
   expect((await fetch(base+'/auth/callback?state=invalid&code=x',{redirect:'manual'})).status).toBe(401);
   const deep=await fetch(base+'/conversations/task',{redirect:'manual'});expect(deep.headers.get('location')).toBe('/auth/login?returnTo=%2Fconversations%2Ftask');
   const login=await fetch(base+deep.headers.get('location'),{redirect:'manual'});const target=new URL(login.headers.get('location')!);
   expect(target.searchParams.get('code_challenge_method')).toBe('S256');challenge=target.searchParams.get('state')!;
   const result=await fetch(base+`/auth/callback?state=${challenge}&code=x`,{redirect:'manual',headers:{cookie:login.headers.get('set-cookie')!.split(';')[0]}});
   expect(result.status).toBe(302);expect(result.headers.get('location')).toBe('/conversations/task');expect(result.headers.get('set-cookie')).toContain('HttpOnly');
   const cookie=result.headers.get('set-cookie')!.split(';')[0];
   const me=await fetch(base+'/api/me',{headers:{cookie}});expect(await me.json()).toEqual({id:'7',login:'owner'});
   const authMe=await fetch(base+'/auth/me',{headers:{cookie}});expect(await authMe.json()).toEqual({auth:true,user:{id:'7',login:'owner'}});
   const forbidden=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{cookie,origin:'http://evil.test'}});
   const status=await new Promise<number>((resolve,reject)=>{forbidden.on('unexpected-response',(_,res)=>{res.resume();forbidden.terminate();resolve(res.statusCode!);});forbidden.on('error',()=>{});});expect(status).toBe(403);
   routes={};expect((await fetch(base+'/api/me',{headers:{cookie}})).status).toBe(401);
   const replay=await fetch(base+`/auth/callback?state=${challenge}&code=x`,{headers:{cookie:'coffee_oauth='+challenge},redirect:'manual'});expect(replay.status).toBe(401);
  }finally{await web.close();}
 });
});
