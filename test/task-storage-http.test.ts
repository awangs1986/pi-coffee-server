import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {taskRootForScope} from '../src/host/task-storage.js';
import {TransferServer} from '../src/host/transfer.js';
it('creates new task bundles through Host HTTP, keeps legacy paths and confines sibling attachments',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-bundles-'));let server:HostServer|undefined,transfer:TransferServer|undefined;
 try{
  const registry=join(root,'old/projects');const legacy=new Workspaces(registry);const old=await legacy.createChatConversation('old');
  const taskRoot=join(root,'coffee/awang/projects');
  const ws=new Workspaces(registry,{taskRoot});
  const source=join(root,'source');await mkdir(source);const exec=promisify(execFile);const git=(...args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});
  await git('init','-b','main');await writeFile(join(source,'README.md'),'base');await git('add','.');await git('commit','-m','base');
  const remote=join(root,'remote.git');await exec('git',['clone','--bare',source,remote]);const project=await ws.registerProject('demo',remote);
  transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root,workspaces:ws});await transfer.start();
  const factory={list:async()=>[],delete:async()=>false,create:async()=>({getState:async()=>({isStreaming:false,messageCount:0}),getHistory:async()=>({entries:[],leafId:null}),onEvent:()=>()=>{},stop:async()=>{},backgroundState:async()=>({known:true,active:0}),prompt:async()=>{throw new Error('No model calls');}} as any)};
  server=new HostServer({port:0,token:'bundle-test',factory,workspaces:ws,transfer,scopeForUser:user=>({factory,workspaces:new Workspaces(join(root,'scoped',user),{taskRoot:taskRootForScope(join(root,'coffee'),'awang',user,{'gitea-2':'fengge'})})})});await server.start();
  const post=async(body:unknown)=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer bundle-test','content-type':'application/json'},body:JSON.stringify(body)});expect(r.status,await r.clone().text()).toBe(200);return r.json();};
  const other=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer bundle-test','x-pi-coffee-user':'gitea-2','content-type':'application/json'},body:JSON.stringify({action:'conversation',workspaceKind:'chat',id:'fengge-chat'})});
  expect(other.status).toBe(200);expect((await other.json()).cwd).toBe(join(root,'coffee/fengge/projects/fengge-chat/workspace'));
  const denied=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer bundle-test','content-type':'application/json'},body:JSON.stringify({action:'files',id:'fengge-chat'})});expect(denied.status).toBe(409);
  const chat=await post({action:'conversation',workspaceKind:'chat',id:'new-chat'});
  expect(chat.cwd).toBe(join(taskRoot,'new-chat/workspace'));
  expect((await ws.lookup('old'))?.cwd).toBe(old.cwd);
  expect(await readdir(join(taskRoot,'new-chat'))).toEqual(expect.arrayContaining(['task.json','history','attachments','artifacts','workspace']));
  expect(JSON.parse(await readFile(join(taskRoot,'new-chat/task.json'),'utf8'))).toMatchObject({schemaVersion:1,conversation:{id:'new-chat',engine:'pi',cwd:chat.cwd}});
  const work=await post({action:'conversation',projectId:project.id,branch:'main',id:'new-work'});
  expect(work.cwd).toBe(join(taskRoot,'new-work/workspace'));expect(await readFile(join(work.cwd,'README.md'),'utf8')).toBe('base');
  const grant=await post({action:'files',id:work.id});expect(grant.inbox).toBe('../attachments');
  const base=`http://127.0.0.1:${transfer.address().port}/api/localsend/v2/`,params=new URLSearchParams({scope:grant.scope,token:grant.token});
  const prepare=await fetch(base+'prepare-upload?'+params,{method:'POST',body:JSON.stringify({files:{f:{fileName:'note.txt',size:3,fileType:'text/plain'}}})});expect(prepare.status).toBe(200);const uploaded=await prepare.json();
  expect((await fetch(base+'upload?'+new URLSearchParams({sessionId:uploaded.sessionId,fileId:'f',token:uploaded.files.f}),{method:'POST',body:'abc'})).status).toBe(200);
  expect(await readFile(join(taskRoot,'new-work/attachments/note.txt'),'utf8')).toBe('abc');
  expect((await fetch(base+'download?'+params+'&fileId=../attachments/note.txt')).status).toBe(200);
  expect((await fetch(base+'download?'+params+'&fileId=../../new-chat/task.json')).status).toBe(403);
  expect((await fetch(base+'download?'+params+'&fileId=../task.json')).status).toBe(403);
  await symlink(join(taskRoot,'new-chat'),join(taskRoot,'new-work/attachments/escape'));
  expect((await fetch(base+'download?'+params+'&fileId=../attachments/escape/task.json')).status).toBe(403);
  await writeFile(join(taskRoot,'new-work/artifacts/report.md'),'report');
  expect((await (await fetch(base+'artifacts?'+params)).json()).artifacts.map((a:any)=>a.path)).toContain('../artifacts/report.md');
  const continued=await post({action:'continue',projectId:project.id,sourceBranch:work.branch,sourceSha:work.startSha,id:'continued'});
  expect(continued.cwd).toBe(join(taskRoot,'continued/workspace'));
  await post({action:'archive',id:chat.id});expect(await readFile(join(taskRoot,'new-chat/task.json'),'utf8')).toContain('"archived": true');
  const restarted=new Workspaces(registry,{taskRoot});expect((await restarted.lookup(chat.id))?.cwd).toBe(chat.cwd);
  await post({action:'delete',id:chat.id,confirmation:chat.id,includeLocalFiles:true});
  await expect(readdir(join(taskRoot,'new-chat'))).rejects.toMatchObject({code:'ENOENT'});
  expect(await readFile(join(taskRoot,'new-work/attachments/note.txt'),'utf8')).toBe('abc');
 }finally{await server?.close();await transfer?.close();await rm(root,{recursive:true,force:true});}
});

it('rejects ambiguous or unsafe account mappings',()=>{
 expect(taskRootForScope('/coffee','awang','gitea-2',{'gitea-2':'fengge'})).toBe('/coffee/fengge/projects');
 for(const [user,map] of [['fengge',{'gitea-2':'fengge'}],['awang',{}],['../escape',{}],['x',{x:'same',y:'same'}]] as const){
  expect(()=>taskRootForScope('/coffee','awang',user,map)).toThrow();
 }
});
