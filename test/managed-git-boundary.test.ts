import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,readdir,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {Workspaces} from '../src/host/workspaces.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {ManagedWriterFence} from '../src/host/managed-writer-fence.js';
import {HostServer} from '../src/host/server.js';

it('a workspace Git fsmonitor cannot execute as the source Host outside native grants through authenticated changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-git-boundary-')),source=join(root,'source'),authority=join(root,'authority'),upstream=join(root,'upstream');for(const path of [source,authority,upstream])await mkdir(path,{mode:0o700});const git=(cwd:string,...args:string[])=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Synthetic boundary',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Synthetic boundary',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}});
 git(upstream,'init','--quiet','-b','main');await writeFile(join(upstream,'README.md'),'initial');git(upstream,'add','.');git(upstream,'commit','--quiet','-m','initial');const store=new Workspaces(join(source,'projects'));const project=await store.registerProject('fixture',upstream),task=await store.createConversation(project.id,undefined,'task','pi');git(task.cwd,'config','user.name','Synthetic boundary');git(task.cwd,'config','user.email','fixture@example.invalid');
 const marker=join(authority,'outside-grants'),lock=join(authority,'group.lock'),custody=new ManagedNativeCustody(join(authority,'custody'),{sourceParent:root,lock,sources:[{path:source,destination:source}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:source,PATH:'/usr/bin:/bin'},cwd:task.cwd}),setup=await custody.prepare({executable:process.execPath,args:['-e',`const fs=require('node:fs');try{fs.writeFileSync(${JSON.stringify(marker)},'namespace-escaped');process.exit(90);}catch{process.exit(0);}`]}),native=spawn(process.execPath,[setup.cliPath],{env:{PATH:process.env.PATH,...setup.env},stdio:'ignore'});expect((await once(native,'exit'))[0]).toBe(0);await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');const fence=new ManagedWriterFence({lock,custody});store.setBackupWriterFence(fence);
 await writeFile(join(task.cwd,'unsafe-filter.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'privileged-host-side-effect');process.stdout.write('synthetic-token\\0');`);git(task.cwd,'config','core.fsmonitor',process.execPath+' '+join(task.cwd,'unsafe-filter.mjs'));await writeFile(join(task.cwd,'.gitattributes'),'*.txt filter=fixture\n');await writeFile(join(task.cwd,'safe.txt'),'new user content');const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider');}},host=new HostServer({port:0,token:'fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:store})});
 try{await host.start();const result=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'alice','content-type':'application/json'},body:JSON.stringify({action:'changes',id:task.id})});const body=await result.text();console.log(JSON.stringify({status:result.status,body}));expect([200,409]).toContain(result.status);await expect(stat(marker)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(task.cwd,'safe.txt'),'utf8')).toBe('new user content');
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},15000);

async function managedFixture(){
 const root=await mkdtemp(join(tmpdir(),'managed-git-http-')),source=join(root,'source'),authority=join(root,'authority'),upstream=join(source,'upstream');
 for(const path of [source,authority,upstream])await mkdir(path,{mode:0o700});
 const git=(cwd:string,...args:string[])=>execFileSync('/usr/bin/git',['-C',cwd,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Synthetic boundary',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Synthetic boundary',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}});
 git(upstream,'init','--quiet','-b','main');await writeFile(join(upstream,'README.md'),'initial\n');git(upstream,'add','.');git(upstream,'commit','--quiet','-m','initial');
 const custody=new ManagedNativeCustody(join(authority,'custody'),{sourceParent:root,lock:join(authority,'group.lock'),sources:[{path:source,destination:source}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:source,PATH:'/usr/bin:/bin'},cwd:source});
 const store=new Workspaces(join(source,'projects'),{managedGitCustody:custody});store.setBackupWriterFence(new ManagedWriterFence({lock:custody.profile.lock,custody}));
 const project=await store.registerProject('fixture',upstream),task=await store.createConversation(project.id,undefined,'task','pi');
 const marker=join(authority,'outside-grants');
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No provider');}},host=new HostServer({port:0,token:'fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:store})});
 await host.start();
 const request=async(input:Record<string,unknown>)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'alice','content-type':'application/json'},body:JSON.stringify({id:task.id,...input})});return {status:response.status,body:await response.json()};};
 return {root,source,authority,upstream,custody,store,task,git,marker,request,close:async()=>{await host.close();await rm(root,{recursive:true,force:true});}};
}

it('managed local Git serves actual HTTP diffs, snapshot indexes and blob contents without changing the checkout index',async()=>{
 const fixture=await managedFixture();const {store,task,git,request,custody}=fixture;
 try{
  const index=await readFile(join(task.cwd,'.git','index'));
  await store.markRun(task.id,'running','managed-git-turn');
  expect((await store.lookup(task.id))?.turnSnapshot?.tree).toMatch(/^[a-f0-9]{40}$/);
  await writeFile(join(task.cwd,'README.md'),'initial\nmanaged update\n');await writeFile(join(task.cwd,'new.txt'),'managed new file\n');
  const changes=await request({action:'changes'});expect(changes.status).toBe(200);expect(changes.body.patch).toContain('+managed update');expect(changes.body.patch).toContain('+managed new file');
  const file=await request({action:'change_file',scope:'branch',path:'README.md',base:changes.body.base,contents:true});expect(file.status,file.body.error).toBe(200);expect(file.body.oldContents).toBe('initial\n');expect(file.body.newContents).toBe('initial\nmanaged update\n');
  const turn=await store.turnChanges(task.id);expect(turn.patch).toContain('+managed new file');
  const turnFile=await store.changeFile(task.id,{scope:'turn',path:'new.txt',contents:true});expect(turnFile.patch).toContain('+managed new file');
  expect(await readFile(join(task.cwd,'.git','index'))).toEqual(index);expect((await readdir(join(task.cwd,'.git'))).filter(name=>name.startsWith('pi-coffee-'))).toEqual([]);
  expect(git(task.cwd,'status','--porcelain')).toContain(' M README.md');
  await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');
 }finally{await fixture.close();}
},30000);

it('authenticated managed changes reject executable config, transport helpers and external Git metadata before any authority write',async()=>{
 const fixture=await managedFixture();const {task,git,request,marker,authority}=fixture;
 try{
  const config=join(task.cwd,'.git','config'),original=await readFile(config),script=join(task.cwd,'attempt.mjs');
  await writeFile(script,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'outside');process.stdout.write('content\\n');`);
  const command=process.execPath+' '+script;
  const included=join(authority,'included-config');await writeFile(included,'[core]\n fsmonitor = '+command+'\n');
  const configCases:Array<[string,string]>=[
   ['core.fsmonitor',command],['filter.fixture.clean',command],['filter.fixture.process',command],['diff.fixture.textconv',command],['diff.external',command],
   ['credential.helper','!'+command],['core.sshCommand',command],['remote.origin.url','ext::'+command],['include.path',included],['includeIf.gitdir:/.path',included],
   ['core.worktree',authority],['core.gitProxy',command],['core.excludesFile',included],['core.attributesFile',included],['extensions.worktreeConfig','true'],
  ];
  for(const [key,value] of configCases){
   await writeFile(config,original);git(task.cwd,'config',key,value);
   const response=await request({action:'changes'});expect(response.status,key).toBe(409);expect(response.body.error,key).toContain('unsupported');await expect(stat(marker),key).rejects.toMatchObject({code:'ENOENT'});
  }
  await writeFile(config,original);
  for(const name of ['commondir','gitdir','config.worktree','objects/info/alternates','objects/info/http-alternates']){
   const path=join(task.cwd,'.git',name);await writeFile(path,authority+'\n');
   try{const response=await request({action:'changes'});expect(response.status,name).toBe(409);await expect(stat(marker),name).rejects.toMatchObject({code:'ENOENT'});}finally{await rm(path);}
  }
  const metadata=join(task.cwd,'.git'),retained=join(task.cwd,'.retained-git');
  await rename(metadata,retained);await symlink(authority,metadata);
  try{expect((await request({action:'changes'})).status).toBe(409);}finally{await rm(metadata);await rename(retained,metadata);}
  const info=join(metadata,'info'),retainedInfo=join(metadata,'retained-info');await rename(info,retainedInfo);await symlink(authority,info);
  try{await expect(fixture.store.dataRoot(task.id)).rejects.toThrow();expect((await request({action:'changes'})).status).toBe(409);await expect(stat(join(authority,'exclude'))).rejects.toMatchObject({code:'ENOENT'});}finally{await rm(info);await rename(retainedInfo,info);}
  const gitFile=join(task.cwd,'.git');await rename(gitFile,retained);await writeFile(gitFile,'gitdir: '+authority+'\n');
  try{expect((await request({action:'changes'})).status).toBe(409);}finally{await rm(gitFile);await rename(retained,gitFile);}
  expect((await request({action:'changes'})).status).toBe(200);await expect(stat(marker)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await fixture.close();}
},45000);

it('native Git keeps ordinary in-grant config execution while its real namespace denies the same authority marker',async()=>{
 const fixture=await managedFixture();const {source,task,custody,git,marker}=fixture;
 try{
  const inside=join(source,'native-git-ran'),script=join(task.cwd,'native-fsmonitor.mjs');
  await writeFile(script,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(inside)},'native');try{fs.writeFileSync(${JSON.stringify(marker)},'outside');}catch{}process.stdout.write('token\\0');`);
  git(task.cwd,'config','core.fsmonitor',process.execPath+' '+script);
  const prepared=await custody.prepare({executable:'/usr/bin/git',args:['status','--porcelain'],cwd:task.cwd}),child=spawn(process.execPath,[prepared.cliPath],{env:{PATH:'/usr/bin:/bin',...prepared.env},stdio:'ignore'});
  expect((await once(child,'exit'))[0]).toBe(0);expect(await readFile(inside,'utf8')).toBe('native');await expect(stat(marker)).rejects.toMatchObject({code:'ENOENT'});
  await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');
 }finally{await fixture.close();}
},20000);

it('managed authenticated HTTP repositories can clone, inspect and publish checkpoints without handing credentials to the workspace',async()=>{
 const {createServer}=await import('node:http'),{GitHubAccounts}=await import('../src/host/github-accounts.js');
 const fixture=await managedFixture();const requests:string[]=[];const secret='synthetic-gitea-secret';
 const server=createServer((req,res)=>{
  if(req.headers.authorization!=='Basic '+Buffer.from('alice:'+secret).toString('base64')){res.writeHead(401);res.end();return;}
  requests.push(req.method+' '+req.url);
  const url=new URL(req.url!,'http://fixture');
  const child=spawn('/usr/lib/git-core/git-http-backend',[],{env:{PATH:'/usr/bin:/bin',GIT_PROJECT_ROOT:fixture.source,GIT_HTTP_EXPORT_ALL:'1',PATH_INFO:url.pathname,QUERY_STRING:url.search.slice(1),REQUEST_METHOD:req.method!,CONTENT_TYPE:String(req.headers['content-type']??''),REMOTE_USER:'alice'},stdio:['pipe','pipe','ignore']});
  let headers=Buffer.alloc(0),started=false;
  child.stdout.on('data',chunk=>{if(started){res.write(chunk);return;}headers=Buffer.concat([headers,chunk]);const end=headers.indexOf('\r\n\r\n');if(end<0)return;const lines=headers.subarray(0,end).toString().split('\r\n');let code=200;for(const line of lines){const split=line.indexOf(':');const key=line.slice(0,split),value=line.slice(split+1).trim();if(key==='Status')code=Number(value.split(' ')[0]);else res.setHeader(key,value);}res.writeHead(code);started=true;res.write(headers.subarray(end+4));});child.stdout.on('end',()=>res.end());req.pipe(child.stdin);child.stdin.on('error',()=>{});
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address() as import('node:net').AddressInfo,url=`http://127.0.0.1:${address.port}`;
 const accounts=new GitHubAccounts(join(fixture.authority,'github'),{gitea:{url,owner:'alice',token:secret},gitIdentity:{name:'Alice fixture',email:'alice@example.invalid'}});
 const store=new Workspaces(join(fixture.source,'http-projects'),{managedGitCustody:fixture.custody,githubAccounts:accounts});store.setBackupWriterFence(new ManagedWriterFence({lock:fixture.custody.profile.lock,custody:fixture.custody}));
 try{
  fixture.git(fixture.upstream,'config','http.receivepack','true');fixture.git(fixture.upstream,'config','receive.denyCurrentBranch','updateInstead');
  const project=await store.registerProject('http-fixture',url+'/upstream'),task=await store.createConversation(project.id,undefined,'http-task','pi');
  const {RpcPiSessionFactory}=await import('../src/host/pi-adapter.js');const factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(fixture.source,'fake-native'),cwd:task.cwd,env:{FIXTURE_FORK_RPC_LOG:join(fixture.source,'fake-rpc.log')}}),host=new HostServer({port:0,token:'fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:store})});await host.start();
  const request=async(input:Record<string,unknown>)=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'alice','content-type':'application/json'},body:JSON.stringify({id:task.id,...input})});return {status:r.status,body:await r.json()};};
  try{
   await writeFile(join(task.cwd,'README.md'),'HTTP checkpoint\n');const diff=await request({action:'changes'});expect(diff.status,diff.body.error).toBe(200);expect(diff.body.patch).toContain('+HTTP checkpoint');
   const saved=await request({action:'checkpoint',paths:['README.md'],message:'Managed remote checkpoint'});expect(saved.status,saved.body.error).toBe(200);expect(saved.body.state).toBe('synced');expect(fixture.git(fixture.upstream,'show',`refs/heads/${task.branch}:README.md`)).toBe('HTTP checkpoint\n');expect(fixture.git(task.cwd,'log','-1','--format=%ae').trim()).toBe('alice@example.invalid');
   expect(requests.some(value=>value==='POST /upstream/git-receive-pack')).toBe(true);
   expect(await readFile(join(task.cwd,'.git','config'),'utf8')).not.toContain(secret);
  }finally{await host.close();}
 }finally{await accounts.close();server.closeAllConnections();await new Promise<void>(ok=>server.close(()=>ok()));await fixture.close();}
},60000);
