import {it,expect,afterEach} from 'vitest';import {createServer,type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {GitHubAccounts} from '../src/host/github-accounts.js';import {Workspaces} from '../src/host/workspaces.js';import {HostServer} from '../src/host/server.js';
const exec=promisify(execFile);let root='',host:HostServer,api:Server;
afterEach(async()=>{await host?.close();await new Promise<void>(r=>api?.close(()=>r())??r());if(root)await rm(root,{recursive:true,force:true});});
it('pins the selected account to a new task, preserves it on reload, and rejects another user’s selection',async()=>{
 root=await mkdtemp(join(tmpdir(),'coffee-project-auth-'));const source=join(root,'source'),remote=join(root,'repo.git');await mkdir(source);
 const git=(args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});await git(['init','-b','main']);await writeFile(join(source,'readme'),'base');await git(['add','.']);await git(['commit','-m','base']);await git(['clone','--bare',source,remote]);
 const seen:string[]=[];api=createServer((req,res)=>{const auth=req.headers.authorization??'';seen.push(auth);res.setHeader('content-type','application/json');
 if(auth!=='Bearer token-work'){res.writeHead(401);res.end('{}');return;}
 if(req.url==='/user')res.end(JSON.stringify({id:11,login:'work-user'}));else res.end(JSON.stringify({id:90,full_name:'org/project',default_branch:'main',clone_url:remote,html_url:'https://github.com/org/project',permissions:{push:true}}));});
 await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const a=api.address();if(!a||typeof a==='string')throw Error();
 const accounts=new GitHubAccounts(join(root,'alice-accounts'),{apiUrl:`http://127.0.0.1:${a.port}`});
 const bound=await accounts.handle({action:'bind',token:'token-work'}) as {account:{id:string}};
 const workspaces=new Workspaces(join(root,'projects'),{ownerId:'alice',githubAccounts:accounts});
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No Agent expected');}};
 host=new HostServer({port:0,token:'transport',factory,requireUser:true,scopeForUser:user=>({factory,workspaces:user==='alice'?workspaces:new Workspaces(join(root,'bob-projects'),{githubAccounts:new GitHubAccounts(join(root,'bob-accounts'))})})});await host.start();
 const call=async(body:object,user='alice')=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer transport','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 expect((await call({action:'github_project',repository:'org/project',accountId:bound.account.id},'bob')).status).toBe(409);
 const project=await call({action:'github_project',repository:'org/project',accountId:bound.account.id});expect(project.status).toBe(200);expect(project.body.githubAccountId).toBe(bound.account.id);
 const created=await call({action:'conversation',projectId:project.body.id,id:'task-auth',workspaceKind:'project',engine:'pi'});expect(created.status).toBe(200);expect(created.body.githubAccountId).toBe(bound.account.id);
 const reopened=new Workspaces(join(root,'projects'),{ownerId:'alice',githubAccounts:accounts});expect((await reopened.lookup('task-auth'))?.githubAccountId).toBe(bound.account.id);
 expect(seen.every(s=>s==='Bearer token-work')).toBe(true);
 await accounts.handle({action:'delete',id:bound.account.id});expect((await call({action:'github_repos',accountId:bound.account.id})).status).toBe(409);
});
