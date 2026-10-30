import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocket} from 'ws';
import {WebServer} from '../src/web/server.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'backup-routed-')),token='synthetic-routed-token';let output='';
 const host=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_AGENT_DIR:join(root,'agent'),PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_BACKUP_USERS:'gitea-1,gitea-2,gitea-3,awangs,__legacy_default__',PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:token,PI_COFFEE_TRANSFER_BIND:'127.0.0.1',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_EXTENSIONS:'off',PI_COFFEE_TMP_ROOT:join(root,'tmp')},stdio:['ignore','pipe','pipe']});host.stdout!.on('data',chunk=>output+=chunk);host.stderr!.on('data',chunk=>output+=chunk);
 const webs:WebServer[]=[],sockets:WebSocket[]=[];
 const close=async()=>{for(const socket of sockets)socket.terminate();for(const web of webs)await web.close();if(host.exitCode===null&&host.signalCode===null){const exited=once(host,'exit'),timer=setTimeout(()=>host.kill('SIGKILL'),10000);host.kill('SIGTERM');await exited;clearTimeout(timer);}await rm(root,{recursive:true,force:true});};
 try{await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(host.exitCode!==null?output:''),{timeout:15000}).toMatch(/^\d+$/);}catch(error){await close();throw error;}
 const port=output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1],hostUrl='ws://127.0.0.1:'+port+'/host';
 const gateway=async(options:{legacy?:boolean;alias?:string}={})=>{
  const route={hostUrl,hostToken:token};let routes:Record<string,typeof route&{legacyDefault?:boolean;user?:string}>=options.alias?{'3':{...route,user:options.alias}}:{'1':{...route,...options.legacy?{legacyDefault:true}:{}},'2':route,'3':route};
  const web=new WebServer({port:0,hostUrl,hostToken:token,identity:{giteaUrl:'http://synthetic-gitea.test',clientId:'synthetic',clientSecret:'synthetic',publicUrl:'http://coffee.test',sharedHost:!options.alias,routes:()=>routes,fetch:async(url,options)=>{if(String(url).includes('access_token'))return Response.json({access_token:new URLSearchParams(String(options?.body)).get('code')});const id=Number(new Headers(options?.headers).get('authorization')?.replace('Bearer ',''));return Response.json({id,login:id===1?'awangs':id===2?'alice':'bob',active:true});}}});webs.push(web);await web.start();const base='http://127.0.0.1:'+web.address().port;
  const login=async(id:number)=>{const start=await fetch(base+'/auth/login',{redirect:'manual'}),state=new URL(start.headers.get('location')!).searchParams.get('state'),reply=await fetch(base+`/auth/callback?state=${state}&code=${id}`,{redirect:'manual',headers:{cookie:start.headers.get('set-cookie')!.split(';')[0]}});return reply.headers.get('set-cookie')!.split(';')[0];};
  const call=async(cookie:string,body?:unknown)=>{const response=await fetch(base+'/api/backup',{method:body?'POST':'GET',headers:{cookie,origin:'http://coffee.test','content-type':'application/json','x-pi-coffee-actor':'awangs','x-pi-coffee-user':'awangs'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});return {status:response.status,body:await response.json()};};
  const ws=async(cookie:string)=>{const socket=new WebSocket(base.replace('http:','ws:')+'/ws',{headers:{cookie,origin:'http://coffee.test','x-pi-coffee-actor':'awangs','x-pi-coffee-user':'awangs'}});sockets.push(socket);await once(socket,'open');return socket;};
  return {login,call,ws,revoke:(id:string)=>{delete routes[id];},hostPort:port};
 };
 return {gateway,close};
}
async function statusFrame(socket:WebSocket){return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{socket.off('message',frame);reject(Error('Backup status frame timed out'));},10000);const frame=(raw:unknown)=>{const value=JSON.parse(String(raw));if(['backup_status','error'].includes(value.type)){clearTimeout(timer);socket.off('message',frame);resolve(value);}};socket.on('message',frame);socket.send(JSON.stringify({v:1,type:'get_backup_status',actor:'awangs',scope:'awangs'}));});}
const jobId='11111111-1111-4111-8111-111111111111';

it('actual Web numeric scope can read/request/cancel through both real recovery coordinators without becoming administrator',async()=>{
 const f=await fixture();try{const web=await f.gateway(),alice=await web.login(2),status=await web.call(alice);expect(status.status).toBe(200);expect(status.body).toMatchObject({scope:'gitea-2',canManage:false,restores:[],accountRestores:[]});
  const request=await web.call(alice,{action:'restore-request',taskId:'lost-task',jobId,actor:'awangs'});expect(request.status).toBe(200);expect(request.body).toMatchObject({scope:'gitea-2',requestedBy:'alice',state:'requested'});
  const account=await web.call(alice,{action:'account-restore-request',jobIds:[jobId]});expect(account.status).toBe(200);expect(account.body).toMatchObject({scope:'gitea-2',requestedBy:'alice'});
  const ws=await web.ws(alice),frame=await statusFrame(ws);expect(frame).toMatchObject({type:'backup_status',scope:'gitea-2',restores:[{id:request.body.id,requestedBy:'alice'}]});expect(frame).not.toHaveProperty('retention');
  expect((await web.call(alice,{action:'restore-approve',id:request.body.id,revision:1,digest:'a'.repeat(64)})).status).toBe(403);expect((await web.call(alice,{action:'account-restore-publish',id:account.body.id,revision:1,digest:'a'.repeat(64)})).status).toBe(403);
  expect((await web.call(alice,{action:'restore-cancel',id:request.body.id,revision:1})).body.state).toBe('cancelled');expect((await web.call(alice,{action:'account-restore-cancel',id:account.body.id,revision:1})).body.state).toBe('cancelled');
 }finally{await f.close();}
},40000);

it('actual authenticated bob routed to admin-looking awangs never gains WebSocket administrator retention reads',async()=>{
 const f=await fixture();try{const web=await f.gateway({alias:'awangs'}),bob=await web.login(3),socket=await web.ws(bob),frame=await statusFrame(socket);expect(frame).toMatchObject({type:'backup_status',scope:'awangs'});expect(frame).not.toHaveProperty('retention');
  expect((await web.call(bob)).body).toMatchObject({canManage:false,scope:'awangs',restores:[],accountRestores:[]});expect((await web.call(bob,{action:'retention-preview',scope:'awangs'})).status).toBe(403);
 }finally{await f.close();}
},40000);

it('concurrent numeric users cannot cancel or impersonate another scoped operation, and route revocation ends existing WS reads',async()=>{
 const f=await fixture();try{const web=await f.gateway(),alice=await web.login(2),bob=await web.login(3);
  const a=await web.call(alice,{action:'restore-request',taskId:'alice-lost',jobId}),b=await web.call(bob,{action:'restore-request',taskId:'bob-lost',jobId});expect(a.status).toBe(200);expect(b.status).toBe(200);
  const account=await web.call(bob,{action:'account-restore-request',jobIds:[jobId]});expect(account.status).toBe(200);
  const [as,bs]=await Promise.all([web.call(alice),web.call(bob)]);expect(as.body.restores.map((row:any)=>row.id)).toEqual([a.body.id]);expect(bs.body.restores.map((row:any)=>row.id)).toEqual([b.body.id]);
  expect((await web.call(alice,{action:'restore-request',taskId:'foreign',jobId,scope:'gitea-3',actor:'awangs'})).status).toBe(403);
  expect((await web.call(alice,{action:'restore-cancel',id:b.body.id,revision:1,scope:'gitea-2',actor:'awangs'})).status).toBe(403);
  expect((await web.call(alice,{action:'account-restore-cancel',id:account.body.id,revision:1,scope:'gitea-2'})).status).toBe(403);
  expect((await web.call(bob)).body).toMatchObject({restores:[{id:b.body.id,state:'requested'}],accountRestores:[{id:account.body.id,state:'requested'}]});
  const socket=await web.ws(alice);expect((await statusFrame(socket)).type).toBe('backup_status');web.revoke('2');expect((await web.call(alice)).status).toBe(401);
  const closed=once(socket,'close');socket.send(JSON.stringify({v:1,type:'get_backup_status'}));await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Revoked WS did not close')),3000))]);
 }finally{await f.close();}
},40000);

it.each([true,false])('genuine administrator retains approved managed-scope actions through actual Web (legacy=%s)',async legacy=>{
 const f=await fixture();try{const web=await f.gateway({legacy}),admin=await web.login(1),own=legacy?'__legacy_default__':'gitea-1';
  const status=await web.call(admin);expect(status.status).toBe(200);expect(status.body).toMatchObject({scope:own,canManage:true});expect((await web.call(admin,{action:'status',scope:'gitea-2'})).status).toBe(200);expect((await web.call(admin,{action:'status',scope:'unmanaged'})).status).toBe(403);
  const request=await web.call(admin,{action:'restore-request',scope:'gitea-2',taskId:'lost-task',jobId});expect(request.status).toBe(200);expect(request.body).toMatchObject({scope:'gitea-2',requestedBy:'awangs'});
  const revised=await web.call(admin,{action:'restore-revise',id:request.body.id,revision:1});expect(revised.status).toBe(200);expect(revised.body.revision).toBe(2);
  const account=await web.call(admin,{action:'account-restore-request',scope:'gitea-3',jobIds:[jobId]});expect(account.status).toBe(200);expect((await web.call(admin,{action:'account-restore-revise',id:account.body.id,revision:1})).body.revision).toBe(2);
  const frame=await statusFrame(await web.ws(admin));expect(frame).toMatchObject({type:'backup_status',scope:own});expect(frame).toHaveProperty('retention');
 }finally{await f.close();}
},40000);

it('private Host transport with a routed administrator-looking scope but no actor cannot manage recovery',async()=>{
 const f=await fixture();try{const web=await f.gateway(),base='http://127.0.0.1:'+web.hostPort,headers={authorization:'Bearer synthetic-routed-token','x-pi-coffee-user':'awangs','content-type':'application/json'};
  const response=await fetch(base+'/api/backup',{method:'POST',headers,body:JSON.stringify({action:'restore-request',taskId:'lost-task',jobId})});expect(response.status).toBe(403);
  const socket=new WebSocket(base.replace('http:','ws:')+'/host',{headers});try{await once(socket,'open');const frame=await statusFrame(socket);expect(frame.type).toBe('backup_status');expect(frame).not.toHaveProperty('retention');}finally{socket.terminate();}
 }finally{await f.close();}
},40000);
