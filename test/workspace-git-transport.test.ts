import {it,expect} from 'vitest';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {AddressInfo} from 'node:net';
import {workspaceGitTransport} from '../src/host/workspace-git-transport.js';
import {GitHubAccounts} from '../src/host/github-accounts.js';

it('concurrent Git endpoints pin repository, verb and current account authority; caller headers and redirects cannot export credentials',async()=>{
 const root=await mkdtemp(join(tmpdir(),'git-endpoint-')),seen:Array<{url:string;authorization?:string}>=[];let redirect=false,revoked=false;
 const upstream=createServer((req,res)=>{seen.push({url:req.url!,authorization:req.headers.authorization});req.resume();res.writeHead(redirect?302:200,redirect?{location:'/other/repository'}:{'content-type':'application/x-git-upload-pack-advertisement'});res.end('fixture');});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const url=`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
 const alice=await workspaceGitTransport(join(root,'group.lock'),{repository:url+'/alice/repo.git',credentials:async()=>{if(revoked)throw Error('revoked');return {authorization:'alice-synthetic'};}},false);
 const bob=await workspaceGitTransport(join(root,'group.lock'),{repository:url+'/bob/repo.git',credentials:async()=>({authorization:'bob-synthetic'})},true);
 const call=(socket:string,path:string,method='GET')=>new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request({socketPath:socket,path,method,headers:{authorization:'attacker','proxy-authorization':'attacker','x-target':url+'/other',host:'attacker.invalid','content-type':'application/x-git-receive-pack-request'}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.end();});
 try{
  const results=await Promise.all([call(alice.socket,'/repository/info/refs?service=git-upload-pack'),call(bob.socket,'/repository/info/refs?service=git-receive-pack')]);expect(results.map(r=>r.status)).toEqual([200,200]);
  expect(seen).toEqual(expect.arrayContaining([{url:'/alice/repo.git/info/refs?service=git-upload-pack',authorization:'alice-synthetic'},{url:'/bob/repo.git/info/refs?service=git-receive-pack',authorization:'bob-synthetic'}]));
  for(const path of ['/repository/info/refs?service=git-receive-pack','/other/info/refs?service=git-upload-pack','/repository/../other/info/refs?service=git-upload-pack','/repository/info/refs?service=git-upload-pack&x=1',url+'/other','/repository/git-receive-pack'])expect((await call(alice.socket,path,path==='/repository/git-receive-pack'?'POST':'GET')).status).toBe(403);
  expect(seen).toHaveLength(2);redirect=true;expect((await call(alice.socket,'/repository/info/refs?service=git-upload-pack')).status).toBe(502);expect(seen).toHaveLength(3);
  revoked=true;expect((await call(alice.socket,'/repository/info/refs?service=git-upload-pack')).status).toBe(403);expect(seen).toHaveLength(3);
  await alice.close();await expect(call(alice.socket,'/repository/info/refs?service=git-upload-pack')).rejects.toThrow();
 }finally{await bob.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},15000);

it('managed GitHub transport uses only the selected account and rechecks disconnects without putting secrets in command identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'git-account-')),accounts=new GitHubAccounts(root,{gitIdentity:{name:'Synthetic',email:'fixture@example.invalid'}});
 await writeFile(accounts.file,JSON.stringify({version:1,accounts:[{id:'alice',githubId:'1',login:'alice',token:'alice-test-token',connectedAt:'fixture'},{id:'bob',githubId:'2',login:'bob',token:'bob-test-token',connectedAt:'fixture'}]}),{mode:0o600});
 try{
  const alice=await accounts.workspaceGitTransport('https://github.com/team/repo.git','alice'),bob=await accounts.workspaceGitTransport('https://github.com/team/repo.git','bob');
  expect((await alice.credentials()).authorization).toBe('Basic '+Buffer.from('x-access-token:alice-test-token').toString('base64'));
  expect((await bob.credentials()).authorization).toBe('Basic '+Buffer.from('x-access-token:bob-test-token').toString('base64'));
  await expect(accounts.workspaceGitTransport('https://github.com/team/repo.git',undefined)).rejects.toThrow();
  await expect(accounts.workspaceGitTransport('https://github.com.attacker.invalid/team/repo.git','alice')).rejects.toThrow();
  await expect(accounts.workspaceGitTransport('https://github.com@attacker.invalid/team/repo.git','alice')).rejects.toThrow();
  await accounts.handle({action:'delete',id:'alice'});await expect(alice.credentials()).rejects.toThrow();expect((await bob.credentials()).authorization).toContain('Basic ');
 }finally{await accounts.close();await rm(root,{recursive:true,force:true});}
});

it('a concurrent ordinary native namespace cannot discover or connect to a Host Git command endpoint',async()=>{
 const {ManagedNativeCustody}=await import('../src/host/managed-native.js'),{spawn}=await import('node:child_process'),{dirname}=await import('node:path'),{mkdir}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'git-endpoint-grant-')),source=join(root,'source'),authority=join(root,'authority');await mkdir(source,{mode:0o700});await mkdir(authority,{mode:0o700});
 const relay=await workspaceGitTransport(join(authority,'group.lock'),{repository:'https://github.com/fixture/repo.git',credentials:async()=>{throw Error('Must not reach authorization');}},false);
 const custody=new ManagedNativeCustody(join(authority,'custody'),{sourceParent:root,lock:join(authority,'group.lock'),sources:[{path:source,destination:source}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:source,PATH:'/usr/bin:/bin'},cwd:source,requireProviderTransport:true});
 try{
  const prepared=await custody.prepare({executable:'/usr/bin/python3',args:['-c',`import socket,os\nfor path in ${JSON.stringify([relay.socket,'/run/pi-coffee/provider.sock'])}:\n try:\n  socket.socket(socket.AF_UNIX).connect(path)\n  raise RuntimeError('endpoint escaped')\n except FileNotFoundError:pass\n`]}),child=spawn(process.execPath,[prepared.cliPath],{env:{PATH:'/usr/bin:/bin',...prepared.env},stdio:'ignore'});expect((await once(child,'exit'))[0]).toBe(0);
  await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');
 }finally{await relay.close();await rm(root,{recursive:true,force:true});}
},15000);

it('closing a Git command while credential renewal is pending prevents a later upstream request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'git-closing-'));let calls=0,connections=0,release!:()=>void,entered!:()=>void;
 const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve);
 const server=createServer((req,res)=>{calls++;req.resume();res.end('fixture');});server.on('connection',()=>connections++);server.listen(0,'127.0.0.1');await once(server,'listening');
 const relay=await workspaceGitTransport(join(root,'group.lock'),{repository:`http://127.0.0.1:${(server.address() as AddressInfo).port}/repo`,credentials:async()=>{entered();await waiting;return {authorization:'synthetic'};}},false);
 try{
  const attempt=new Promise<void>(resolve=>{const req=request({socketPath:relay.socket,path:'/repository/info/refs?service=git-upload-pack'},res=>{res.resume();res.once('end',resolve);});req.on('error',()=>resolve());req.end();});
  await started;await relay.close();release();await attempt;await new Promise(resolve=>setTimeout(resolve,100));expect(calls).toBe(0);expect(connections).toBe(0);
 }finally{release();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
