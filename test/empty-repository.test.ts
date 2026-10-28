import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect,vi} from 'vitest';
import {Workspaces} from '../src/host/workspaces.js';
import {HostServer} from '../src/host/server.js';

it('selects an empty repository without modifying it, then creates usable independent Work checkouts through HTTP',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-empty-')),remote=join(root,'empty.git');
 const git=async(cwd:string,args:string[])=>(await promisify(execFile)('git',args,{cwd})).stdout.trim();
 await git(root,['init','--bare','--initial-branch=main',remote]);
 for(const name of ['GIT_AUTHOR_NAME','GIT_COMMITTER_NAME'])vi.stubEnv(name,'Fixture');
 for(const name of ['GIT_AUTHOR_EMAIL','GIT_COMMITTER_EMAIL'])vi.stubEnv(name,'fixture@example.test');
 const repo={id:'42',fullName:'owner/empty',defaultBranch:'main',cloneUrl:remote,webUrl:'http://fixture/owner/empty',canPush:true,archived:false,private:true};
 const workspaces=new Workspaces(join(root,'work'),{ownerId:'fixture',forge:{repository:async()=>repo}});
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native Agent in this test');}};
 const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
 const call=async(body:unknown)=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  const registered=await call({action:'gitea_project',repository:'owner/empty'});
  expect(registered.status).toBe(200);
  expect(await git(root,['ls-remote','--refs',remote])).toBe('');
  const wrong=await call({action:'conversation',projectId:registered.data.id,workspaceKind:'project',id:'wrong-branch',branch:'typo'});
  expect(wrong.status).toBe(409);expect(await git(root,['ls-remote','--refs',remote])).toBe('');
  const created=await call({action:'conversation',projectId:registered.data.id,workspaceKind:'project',id:'first',branch:'main'});
  expect(created.status).toBe(200);expect(created.data.creationState).toBe('ready');
  expect(await git(created.data.cwd,['ls-tree','--name-only','HEAD'])).toBe('');
  expect(await git(root,['--git-dir='+remote,'rev-parse','main'])).toBe(created.data.startSha);
  expect((await call({action:'conversation',projectId:registered.data.id,workspaceKind:'project',id:'first',branch:'main'})).data.cwd).toBe(created.data.cwd);
  await writeFile(join(created.data.cwd,'hello.txt'),'from zero\n');
  expect((await workspaces.changes('first')).files.map(f=>f.path)).toContain('hello.txt');
  expect((await workspaces.checkpoint('first',['hello.txt'],'First code')).state).toBe('synced');
  const second=await workspaces.createConversation(registered.data.id,'main','second');
  expect(second.cwd).not.toBe(created.data.cwd);expect(second.startSha).toBe(created.data.startSha);
  await expect(workspaces.registerProject('bad-branch',remote,'missing')).rejects.toThrow();
 }finally{await host.close();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
},20000);
