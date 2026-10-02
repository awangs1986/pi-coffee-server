import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {GiteaClient} from '../src/host/gitea.js';
import {Workspaces} from '../src/host/workspaces.js';
import {HostServer} from '../src/host/server.js';

it('lists all Gitea pages and registers existing repositories through the scoped Host API without remote creation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gitea-picker-')),remote=join(root,'repo');await mkdir(remote);
  const git=(args:string[])=>promisify(execFile)('git',args,{cwd:remote});
  await git(['init','-b','trunk']);await git(['-c','user.name=Test','-c','user.email=test@localhost','commit','--allow-empty','-m','base']);
  const repo={id:88,full_name:'awangs/ArenaModels',default_branch:'trunk',clone_url:remote,html_url:'http://gitea/awangs/ArenaModels',private:true,permissions:{push:true}};
  const repos=[...Array.from({length:50},(_,i)=>({...repo,id:i+100,full_name:`other/filler-${i}`})),repo,{...repo,id:89,full_name:'other/readonly',permissions:{push:false}},{...repo,id:90,full_name:'other/archived',archived:true}];
  const requests:string[]=[];
  const api=createServer((req,res)=>{
    requests.push(`${req.method} ${req.url}`);res.setHeader('content-type','application/json');
    if(req.headers.authorization!=='token fixture'){res.statusCode=401;return res.end('{}');}
    const url=new URL(req.url!,'http://fixture');
    if(url.pathname==='/api/v1/user/repos'){const page=Number(url.searchParams.get('page'));return res.end(JSON.stringify(repos.slice((page-1)*50,page*50)));}
    const found=repos.find(r=>url.pathname==='/api/v1/repos/'+r.full_name);
    if(found)return res.end(JSON.stringify(found));res.statusCode=404;res.end('{}');
  });
  api.listen(0,'127.0.0.1');await once(api,'listening');const address=api.address();if(!address||typeof address==='string')throw Error('address');
  const forge=new GiteaClient({baseUrl:`http://127.0.0.1:${address.port}`,owner:'awangs',token:'fixture'});
  const legacy=new Workspaces(join(root,'bob'),{ownerId:'bob',forge});
  await legacy.registerProject('legacy-alias',remote,'trunk','88');
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No Agent should start');}};
  const host=new HostServer({port:0,token:'host-token',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:user==='bob'?legacy:new Workspaces(join(root,user),{ownerId:user,forge})})});
  await host.start();
  const call=async(body:unknown,user='alice',token='host-token')=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'x-pi-coffee-user':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  try{
    expect((await call({action:'gitea_repos'},'alice','wrong')).status).toBe(401);
    const listed=await call({action:'gitea_repos'});expect(listed.status).toBe(200);expect(listed.data).toHaveLength(53);
    expect(listed.data[50]).toMatchObject({fullName:'awangs/ArenaModels',canPush:true,defaultBranch:'trunk'});
    const selected=await call({action:'gitea_project',repository:'awangs/ArenaModels'});
    expect(selected).toMatchObject({status:200,data:{id:'gitea-88',forge:'gitea',branch:'trunk'}});
    expect(await call({action:'gitea_project',repository:'awangs/ArenaModels'})).toEqual(selected);
    expect((await call(undefined)).data.projects).toHaveLength(1);
    expect((await call(undefined,'bob')).data.projects).toMatchObject([{id:'88',name:'legacy-alias'}]);
    expect((await call({action:'gitea_repos'})).data[50].projectId).toBe('gitea-88');
    expect((await call({action:'gitea_repos'},'bob')).data[50].projectId).toBe('88');
    expect(await call({action:'gitea_project',repository:'awangs/ArenaModels'},'bob')).toMatchObject({status:200,data:{id:'88',name:'legacy-alias'}});
    expect((await call(undefined,'bob')).data.projects).toHaveLength(1);
    for(const name of ['other/readonly','other/archived','../bad','https://evil.example/a/b'])expect((await call({action:'gitea_project',repository:name})).status).toBe(409);
    expect(requests.every(r=>r.startsWith('GET '))).toBe(true);
    expect(requests).toContain('GET /api/v1/user/repos?limit=50&page=2');
  }finally{await host.close();api.close();await once(api,'close');await rm(root,{recursive:true,force:true});}
});
