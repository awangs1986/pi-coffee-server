import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
it('persists scoped sidebar placement and collapse without changing task identity or execution',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-sidebar-'));let server:HostServer|undefined;
 try{
  const source=join(root,'repo');await mkdir(source);const exec=promisify(execFile);
  const git=(...args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});
  await git('init','-b','main');await writeFile(join(source,'README.md'),'fixture');await git('add','.');await git('commit','-m','base');
  const store=new Workspaces(join(root,'alice'));const p=await store.registerProject('demo',source);const c=await store.createChatConversation('chat');await store.markRun(c.id,'running');
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw new Error('Must not start an Agent');}};
  const start=async()=>{server=new HostServer({port:0,token:'test-sidebar',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:new Workspaces(join(root,user))})});await server.start();};await start();
  const call=async(body?:unknown,user='alice',token='test-sidebar')=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'x-pi-coffee-user':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  const move={action:'sidebar_move',id:c.id,projectId:p.id};
  expect((await call({action:'sidebar_pin',id:c.id,pinned:true})).status).toBe(200);
  expect((await call()).data.sidebar.pinned).toEqual([c.id]);
  expect((await call({action:'sidebar_pin',id:c.id,pinned:true},'bob')).status).toBe(409);
  expect((await call({action:'sidebar_pin',id:c.id,pinned:'yes'})).status).toBe(409);
  await server!.close();await start();expect((await call()).data.sidebar.pinned).toEqual([c.id]);
  expect((await call({action:'sidebar_pin',id:c.id,pinned:false})).status).toBe(200);
  expect((await call(move,'alice','wrong')).status).toBe(401);
  expect((await call(move)).status).toBe(200);
  expect((await call({action:'sidebar_collapse',projectId:p.id,collapsed:true})).status).toBe(200);
  expect((await call()).data.sidebar).toEqual({assignments:{chat:p.id},collapsed:[p.id]});
  expect((await call()).data.conversations[0]).toMatchObject({id:c.id,cwd:c.cwd,branch:'',engine:'pi',workspaceKind:'chat'});
  expect((await call(move,'bob')).status).toBe(409);
  expect((await call(undefined,'bob')).data.sidebar).toBeUndefined();
  expect((await call({...move,projectId:'unknown'})).status).toBe(409);
  expect((await call({...move,id:{bad:true}})).status).toBe(409);
  expect((await call({action:'sidebar_collapse',projectId:p.id,collapsed:'yes'})).status).toBe(409);
  await server!.close();await start();expect((await call()).data.sidebar).toEqual({assignments:{chat:p.id},collapsed:[p.id]});
  expect((await call({...move,projectId:null})).status).toBe(200);
  expect((await call()).data.sidebar.assignments.chat).toBeNull();
  expect((await call({action:'sidebar_display',showGroups:false})).status).toBe(200);
  expect((await call({action:'sidebar_display',showGroups:'false'})).status).toBe(409);
  await server!.close();await start();
  expect((await call()).data.sidebar).toEqual({assignments:{chat:null},collapsed:[p.id],showGroups:false});
  expect((await call(undefined,'bob')).data.sidebar).toBeUndefined();
  expect((await call({action:'sidebar_display',showGroups:true})).status).toBe(200);
  expect((await call()).data.sidebar).toEqual({assignments:{chat:null},collapsed:[p.id],showGroups:true});
  const created=await call({action:'sidebar_group_create',name:'  阅读资料  '});expect(created.status).toBe(200);
  const group=created.data.groups[0];expect(group.name).toBe('阅读资料');
  expect((await call({action:'sidebar_group_create',name:'阅读资料'})).status).toBe(409);
  expect((await call({action:'sidebar_group_create',name:'  '})).status).toBe(409);
  expect((await call({action:'sidebar_group_delete',groupId:group.id},'bob')).status).toBe(409);
  expect((await call({...move,projectId:group.id})).status).toBe(200);
  expect((await call({action:'sidebar_collapse',projectId:group.id,collapsed:true})).status).toBe(200);
  expect((await call({action:'sidebar_group_delete',groupId:group.id})).status).toBe(409);
  expect((await call({action:'archive',id:c.id})).status).toBe(200);
  expect((await call({action:'sidebar_group_delete',groupId:group.id})).status).toBe(409);
  await server!.close();await start();expect((await call()).data.sidebar.groups).toEqual([group]);
  expect((await call({...move,projectId:null})).status).toBe(200);
  expect((await call({action:'sidebar_group_delete',groupId:group.id})).status).toBe(200);
  expect((await call({...move,projectId:group.id})).status).toBe(409);
  expect((await call({action:'sidebar_group_delete',groupId:p.id})).status).toBe(200);
  const saved=(await call()).data;expect(saved.projects[0].id).toBe(p.id);expect(saved.sidebar.hiddenProjects).toContain(p.id);
  expect(saved.sidebar.collapsed).not.toContain(p.id);expect(saved.conversations[0].cwd).toBe(c.cwd);
  await server!.close();await start();expect((await call()).data.sidebar.hiddenProjects).toContain(p.id);
  const later=await call({action:'conversation',id:'later-work',engine:'pi',workspaceKind:'project',projectId:p.id,branch:'main'});expect(later.status).toBe(200);expect(later.data.projectId).toBe(p.id);expect((await call()).data.sidebar.hiddenProjects).toContain(p.id);

  const concurrent=(await call({action:'sidebar_group_create',name:'并发测试'})).data.groups[0];
  const race=await Promise.all([call({...move,projectId:concurrent.id}),call({action:'sidebar_group_delete',groupId:concurrent.id})]);
  expect(race.map(x=>x.status).sort()).toEqual([200,409]);

 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

it('keeps last native run boundaries scoped and durable without inferring completion from idle',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-completion-scope-'));let server:HostServer|undefined;
 try{
  const stores=new Map<string,Workspaces>();
  for(const user of ['alice','bob']){const store=new Workspaces(join(root,user,'projects'));stores.set(user,store);await store.createChatConversation('same-id');}
  await stores.get('alice')!.recordRunStatus('same-id','settled');
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No Agent needed');}};
  server=new HostServer({port:0,token:'completion-scope',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const get=async(user:string)=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/workspace`,{headers:{authorization:'Bearer completion-scope','x-pi-coffee-user':user}});expect(r.status).toBe(200);return (await r.json()).conversations[0];};
  const completed=await get('alice');
  expect(completed).toMatchObject({id:'same-id',lastRunStatus:'settled',runState:'idle',completionId:expect.any(String),completedAt:expect.any(String)});
  await stores.get('alice')!.recordRunStatus('same-id','settled');
  expect((await get('alice')).completionId).toBe(completed.completionId);
  await stores.get('alice')!.markRun('same-id','running');
  await stores.get('alice')!.recordRunStatus('same-id','settled');
  expect((await get('alice')).completionId).not.toBe(completed.completionId);
  expect((await get('bob')).lastRunStatus).toBeUndefined();
  await stores.get('alice')!.markRun('same-id','running');
  expect((await get('alice')).lastRunStatus).toBe('running');
  const restored=new Workspaces(join(root,'alice','projects'));expect((await restored.list()).conversations[0]).toMatchObject({lastRunStatus:'interrupted',runState:'interrupted'});
  await restored.recordRunStatus('same-id','settled');
  expect((await new Workspaces(restored.root).list()).conversations[0].lastRunStatus).toBe('settled');
  const c=await stores.get('bob')!.lookup('same-id');
  await stores.get('bob')!.recordRunStatus('same-id','settled');
  await stores.get('bob')!.commitContextReset('same-id',{id:'synthetic-reset',expectedNativeId:'same-id'},'reset-binding');
  expect((await get('bob')).lastRunStatus).toBeUndefined();
  expect((await get('bob')).completionId).toBeUndefined();
  expect((await get('bob')).cwd).toBe(c!.cwd);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

 it('preserves the original completion identity when context reset cannot persist',async()=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-reset-completion-'));
  try{
   const store=new Workspaces(join(root,'projects'));await store.createChatConversation('reset');
   await store.recordRunStatus('reset','settled');const before=structuredClone(await store.lookup('reset'));
   const state=join(store.root,'.coffee','state.json');
   await rename(state,state+'.backup');await mkdir(state);
   await expect(store.commitContextReset('reset',{id:'reset-attempt',expectedNativeId:'reset'},'new-binding')).rejects.toThrow();
   expect(await store.lookup('reset')).toMatchObject({lastRunStatus:'settled',completionId:before!.completionId,completedAt:before!.completedAt});
  }finally{await rm(root,{recursive:true,force:true});}
 });
