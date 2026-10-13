import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {it,expect} from 'vitest';
const exec=promisify(execFile);

it('lets both approved accounts use their own Gitea repository list on one built Host',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-two-user-'));
 await mkdir(join(root,'agent'));
 const accounts=join(root,'gitea-accounts.json');
 await writeFile(accounts,JSON.stringify({version:1,accounts:{default:{userId:1,login:'owner',token:'owner-fixture',gitName:'Owner',gitEmail:'owner@example.test'},'gitea-2':{userId:2,login:'participant',token:'participant-fixture',gitName:'Participant',gitEmail:'participant@example.test'}}}),{mode:0o600});
 const repositories=new Map<string,{id:number;name:string;clone_url:string;html_url:string;default_branch:string;owner:{login:string}}>();
 const forge=createServer(async(req,res)=>{
  const participant=req.headers.authorization==='token participant-fixture',login=participant?'participant':'owner',id=participant?2:1;
  res.setHeader('content-type','application/json');
  if(req.url==='/api/v1/user'){res.end(JSON.stringify({id,login,active:true,prohibit_login:false}));return;}
  if(req.url==='/api/v1/user/repos'&&req.method==='POST'){
   let body='';for await(const chunk of req)body+=chunk;
   const name=JSON.parse(body).name,remote=join(root,login+'-remote.git');
   await exec('git',['init','--bare','-b','main',remote]);
   const repo={id:id+20,name,clone_url:remote,html_url:'http://gitea.test/'+login+'/'+name,default_branch:'main',owner:{login}};repositories.set(String(repo.id),repo);
   res.writeHead(201);res.end(JSON.stringify(repo));return;
  }
  if(req.url?.startsWith('/api/v1/repositories/')){const repo=repositories.get(req.url.split('/').at(-1)!);if(repo?.owner.login===login){res.end(JSON.stringify(repo));return;}}
  if(req.url?.startsWith('/api/v1/repos/'+login+'/')&&req.url.includes('/pulls')){
   if(req.method==='GET'){res.end('[]');return;}
   let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);
   res.writeHead(201);res.end(JSON.stringify({number:1,html_url:'http://gitea.test/'+login+'/pulls/1',state:'open',head:{ref:data.head,repo_id:id+20},base:{ref:data.base,repo_id:id+20}}));return;
  }
  if(req.url?.startsWith('/api/v1/user/repos?')){
   res.end(JSON.stringify(req.url.includes('page=1')?[{id,full_name:login+'/private',clone_url:'http://gitea.test/'+login+'/private.git',html_url:'http://gitea.test/'+login+'/private',default_branch:'main',private:true,permissions:{push:true}}]:[]));return;
  }
  res.writeHead(404);res.end('{}');
 });
 await new Promise<void>(done=>forge.listen(0,'127.0.0.1',done));
 const address=forge.address();if(!address||typeof address==='string')throw Error('fixture address');
 const child=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'off',PI_COFFEE_AGENT_DIR:join(root,'agent'),PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_GITEA_URL:`http://127.0.0.1:${address.port}`,PI_COFFEE_GITEA_OWNER:'owner',PI_COFFEE_GITEA_TOKEN:'owner-fixture',PI_COFFEE_GITEA_ACCOUNTS_FILE:accounts},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 try{
  await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)/)?.[1],{timeout:10000}).toBeTruthy();
  const base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)/)![1];
  const call=(user?:string,body?:unknown)=>fetch(base+'/api/workspace',{method:body?'POST':'GET',headers:{authorization:'Bearer fixture','content-type':'application/json',...(user?{'x-pi-coffee-user':user}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const state=await (await call('gitea-2')).json();expect(state.capabilities.forges.gitea).toBe(true);
  expect(JSON.stringify(state)).not.toContain('participant-fixture');
  const own=await call(undefined,{action:'gitea_repos'}),other=await call('gitea-2',{action:'gitea_repos'});
  expect(own.status).toBe(200);expect(other.status).toBe(200);
  expect((await own.json()).map((r:{fullName:string})=>r.fullName)).toEqual(['owner/private']);
  expect((await other.json()).map((r:{fullName:string})=>r.fullName)).toEqual(['participant/private']);
  expect((await call('gitea-3',{action:'gitea_repos'})).status).toBe(409);
  for(const [scope,login,author] of [[undefined,'owner','Owner'],['gitea-2','participant','Participant']] as const){
   const projectResponse=await call(scope,{action:'project',name:'mine-'+login});expect(projectResponse.status).toBe(200);const project=await projectResponse.json();
   expect(project.webUrl).toContain('/'+login+'/');
   const taskResponse=await call(scope,{action:'conversation',workspaceKind:'project',engine:'pi',projectId:project.id,branch:'main',id:'work-'+login});expect(taskResponse.status).toBe(200);const task=await taskResponse.json();
   await writeFile(join(task.cwd,'README.md'),'work by '+login+'\n');
   const checkpoint=await call(scope,{action:'checkpoint',id:task.id,paths:['README.md'],message:'Own account checkpoint'});expect(checkpoint.status).toBe(200);const synced=await checkpoint.json();expect(synced.state).toBe('synced');expect(synced.remoteSha).toBe(synced.localSha);
   const commit=await exec('git',['--git-dir',join(root,login+'-remote.git'),'log','-1','--format=%an <%ae>',task.branch]);expect(commit.stdout.trim()).toBe(author+' <'+login+'@example.test>');
   const pr=await call(scope,{action:'pull_request',id:task.id,title:'Account work'});expect(pr.status).toBe(200);expect((await pr.json()).url).toContain('/'+login+'/');
  }
  expect((await call('gitea-2',{action:'files',id:'work-owner'})).status).toBe(409);
 }finally{
  if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}
  await new Promise<void>(done=>forge.close(()=>done()));await rm(root,{recursive:true,force:true});
 }
},15000);
