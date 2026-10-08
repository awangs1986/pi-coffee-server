import {afterEach,it,expect} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {GitHubAccounts} from '../src/host/github-accounts.js';
const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw new Error('No Agent expected');}};
let host:HostServer,api:Server,root='';
afterEach(async()=>{await host?.close();await new Promise<void>(r=>api?.close(()=>r())??r());if(root)await rm(root,{recursive:true,force:true});});
it('binds several verified GitHub identities to one user without sharing secrets or another user’s bindings',async()=>{
 root=await mkdtemp(join(tmpdir(),'coffee-accounts-'));
 api=createServer((req,res)=>{const token=req.headers.authorization?.replace('Bearer ','');res.setHeader('content-type','application/json');if(!['alice-personal','alice-work','bob-private'].includes(token??'')){res.writeHead(401);res.end('{}');return;}res.end(JSON.stringify({id:token==='alice-personal'?1:token==='alice-work'?2:3,login:token}));});
 await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const address=api.address();if(!address||typeof address==='string')throw Error('address');
 const managers=new Map<string,GitHubAccounts>();const manager=(user:string)=>{let m=managers.get(user);if(!m){m=new GitHubAccounts(join(root,user),{apiUrl:`http://127.0.0.1:${address.port}`});managers.set(user,m);}return m;};
 host=new HostServer({port:0,token:'transport',factory,requireUser:true,scopeForUser:user=>({factory,githubAccounts:manager(user)})});await host.start();
 const call=async(body:object,user='alice',token='transport')=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/github-accounts`,{method:'POST',headers:{authorization:`Bearer ${token}`,'x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 expect((await call({action:'list'},'alice','wrong')).status).toBe(401);
 const first=await call({action:'bind',token:'alice-personal'});expect(first.status).toBe(200);
 expect(first.body.account).toMatchObject({login:'alice-personal',githubId:'1'});
 expect(first.body.account).not.toHaveProperty('token');
 const second=await call({action:'bind',token:'alice-work'});expect(second.status).toBe(200);
 expect((await call({action:'list'})).body.accounts).toHaveLength(2);
 expect((await call({action:'list'},'bob')).body.accounts).toEqual([]);
 expect((await call({action:'delete',id:first.body.account.id},'bob')).status).toBe(409);
 expect((await call({action:'bind',token:'bad'})).status).toBe(409);
 expect((await call({action:'bind',token:'alice-personal'})).body.account.id).toBe(first.body.account.id);
 expect((await call({action:'delete',id:first.body.account.id})).status).toBe(200);
 expect((await call({action:'list'})).body.accounts.map((a:{login:string})=>a.login)).toEqual(['alice-work']);
});
it('requires an explicit owned GitHub binding for repository listing, even when a legacy shared client is configured',async()=>{
 root=await mkdtemp(join(tmpdir(),'coffee-scoped-forge-'));
 const {Workspaces}=await import('../src/host/workspaces.js');
 const accounts=new GitHubAccounts(join(root,'alice'));
 const shared={webHost:'github.com',listRepositories:async()=>[{id:'shared',fullName:'owner/private'}],repository:async()=>{throw Error('shared must not run');},createPullRequest:async()=>{throw Error('shared must not run');}};
 const workspaces=new Workspaces(join(root,'projects'),{ownerId:'alice',github:shared,githubAccounts:accounts});
 host=new HostServer({port:0,token:'transport',factory,requireUser:true,scopeForUser:()=>({factory,workspaces,githubAccounts:accounts})});await host.start();
 const r=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer transport','x-pi-coffee-user':'alice','content-type':'application/json'},body:JSON.stringify({action:'github_repos'})});
 expect(r.status).toBe(409);expect(await r.text()).not.toContain('owner/private');
});

it('creates the transport root privately before recursive tool directories',async()=>{
 const {stat}=await import('node:fs/promises');root=await mkdtemp(join(tmpdir(),'coffee-transport-mode-'));const accounts=new GitHubAccounts(join(root,'new-account'));
 await accounts.environment(undefined);expect((await stat(accounts.root)).mode&0o777).toBe(0o700);expect((await stat(join(accounts.root,'transport.json'))).mode&0o777).toBe(0o600);
});
