import {NativeAgentFactory} from '../src/host/native/factory.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {GitHubClient} from '../src/host/github.js';
import {WebSocket} from 'ws';import {once} from 'node:events';
import {it,expect,afterEach} from 'vitest';import {createServer,type Server} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {GitHubAccounts} from '../src/host/github-accounts.js';import {Workspaces} from '../src/host/workspaces.js';import {HostServer} from '../src/host/server.js';
const exec=promisify(execFile);let root='',host:HostServer,api:Server;
afterEach(async()=>{await host?.close();await new Promise<void>(r=>api?.close(()=>r())??r());if(root)await rm(root,{recursive:true,force:true});});
it.each([false,true])('pins account identity and safely binds legacy Codex tasks (unopened background work: %s)',async backgroundUnknown=>{
 root=await mkdtemp(join(tmpdir(),'coffee-project-auth-'));const source=join(root,'source'),remote=join(root,'repo.git');await mkdir(source);
 const git=(args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});await git(['init','-b','main']);await writeFile(join(source,'readme'),'base');await git(['add','.']);await git(['commit','-m','base']);await git(['clone','--bare',source,remote]);
 const seen:string[]=[];api=createServer((req,res)=>{const auth=req.headers.authorization??'';seen.push(auth);res.setHeader('content-type','application/json');
 if(auth!=='Bearer token-work'){res.writeHead(401);res.end('{}');return;}
 if(req.url==='/user')res.end(JSON.stringify({id:11,login:'work-user'}));else res.end(JSON.stringify({id:90,full_name:'org/project',default_branch:'main',clone_url:remote,html_url:'https://github.com/org/project',permissions:{push:true}}));});
 await new Promise<void>(r=>api.listen(0,'127.0.0.1',r));const a=api.address();if(!a||typeof a==='string')throw Error();
 const accounts=new GitHubAccounts(join(root,'alice-accounts'),{apiUrl:`http://127.0.0.1:${a.port}`});
 const bound=await accounts.handle({action:'bind',token:'token-work'}) as {account:{id:string}};
 const legacy=new Workspaces(join(root,'projects'),{ownerId:'alice',github:new GitHubClient({apiUrl:`http://127.0.0.1:${a.port}`,token:'token-work'})});
 const oldProject=await legacy.registerGitHubProject('org/project');const oldTask=await legacy.createConversation(oldProject.id,'main','legacy-task','codex');
 const workspaces=new Workspaces(join(root,'projects'),{ownerId:'alice',githubAccounts:accounts});
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No Agent expected');}};
 const envLog=join(root,'codex-env.json');const native=new NativeAgentFactory({pi:factory,workspaces,codex:{command:process.execPath,args:[resolve('test/fixtures/fake-codex.mjs')]},codexSessionFactory:(id,cwd,onBound,environment)=>new CodexSessionFactory({cwd,cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],env:{FIXTURE_GITHUB_ENV_LOG:envLog,FAKE_CODEX_BACKGROUND_FILE:join(root,'background-active')},envForSession:environment,idleTimeoutMs:600000,onBound:async(_host,native)=>onBound(native)})});
 host=new HostServer({port:0,token:'transport',factory:native,requireUser:true,scopeForUser:user=>({factory:user==='alice'?native:factory,workspaces:user==='alice'?workspaces:new Workspaces(join(root,'bob-projects'),{githubAccounts:new GitHubAccounts(join(root,'bob-accounts'))})})});await host.start();
 const call=async(body:object,user='alice')=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer transport','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 expect((await call({action:'github_project',repository:'org/project',accountId:bound.account.id},'bob')).status).toBe(409);
 const project=await call({action:'github_project',repository:'org/project',accountId:bound.account.id});expect(project.status).toBe(200);expect(project.body.githubAccountId).toBe(bound.account.id);
 const created=await call({action:'conversation',projectId:project.body.id,id:'task-auth',workspaceKind:'project',engine:'pi'});expect(created.status).toBe(200);expect(created.body.githubAccountId).toBe(bound.account.id);
 const reopened=new Workspaces(join(root,'projects'),{ownerId:'alice',githubAccounts:accounts});expect((await reopened.lookup('task-auth'))?.githubAccountId).toBe(bound.account.id);
 expect(seen.every(s=>s==='Bearer token-work')).toBe(true);
 const open=async()=>{
  const socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer transport','x-pi-coffee-user':'alice'}});const frames:any[]=[];socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:oldTask.id,nativeProtocol:1}));
  for(let i=0;i<150&&!frames.some(f=>f.type==='opened'||f.type==='error');i++)await new Promise(r=>setTimeout(r,20));expect(frames.some(f=>f.type==='opened'),JSON.stringify(frames)).toBe(true);return socket;
 };
 if(backgroundUnknown){await writeFile(join(root,'background-active'),'active');expect((await call({action:'github_bind',projectId:oldProject.id,accountId:bound.account.id})).status).toBe(409);return;}
 const first=await open();expect(JSON.parse(await readFile(envLog,'utf8')).githubConfig).toContain('/tools/unbound/config');
 const boundProject=await call({action:'github_bind',projectId:oldProject.id,accountId:bound.account.id});expect(boundProject.status).toBe(200);first.close();
 const second=await open();expect(JSON.parse(await readFile(envLog,'utf8')).githubConfig).toBe(join(accounts.root,'tools',bound.account.id,'config'));second.close();
 await accounts.handle({action:'delete',id:bound.account.id});expect((await call({action:'github_repos',accountId:bound.account.id})).status).toBe(409);
});
