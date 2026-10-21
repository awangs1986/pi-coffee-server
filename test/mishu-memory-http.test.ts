import {it,expect} from 'vitest';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
it('manages opt-in private memory with optimistic revisions and tombstones across Host restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-memory-')),workspaces=new Workspaces(join(root,'work')),source=await workspaces.createChatConversation(),other=await workspaces.createChatConversation();
 const make=()=>new HostServer({port:0,token:'fixture',factory:new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions')}),workspaces});let host=make();
 const call=async(id:string,body:Record<string,unknown>)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({id,...body})});return {status:response.status,body:await response.json()};};
 try{await host.start();for(const id of [source.id,other.id])await call(id,{action:'select',selected:true});
  expect((await call(source.id,{action:'memory',operation:'status'})).body.enabled).toBe(false);
  expect((await call(source.id,{action:'memory',operation:'configure',operationId:'enable',enabled:true})).status).toBe(200);
  const created=await call(source.id,{action:'memory',operation:'save',operationId:'create',kind:'preference',text:'请简短回答'});expect(created.status).toBe(200);expect(created.body.entry.revision).toBe(1);
  const id=created.body.entry.id;
  expect((await call(other.id,{action:'memory',operation:'get',entryId:id})).status).toBe(409);
  expect((await call(source.id,{action:'memory',operation:'save',operationId:'edit',entryId:id,expectedRevision:1,kind:'preference',text:'请用中文简短回答'})).body.entry.revision).toBe(2);
  expect((await call(source.id,{action:'memory',operation:'save',operationId:'stale',entryId:id,expectedRevision:1,kind:'preference',text:'stale'})).status).toBe(409);
  expect((await call(source.id,{action:'memory',operation:'delete',operationId:'delete',entryId:id,expectedRevision:2})).body.entry.deleted).toBe(true);
  await host.close();host=make();await host.start();
  const list=await call(source.id,{action:'memory',operation:'list'});expect(list.body.entries).toHaveLength(1);expect(list.body.entries[0].deleted).toBe(true);
  expect((await call(source.id,{action:'memory',operation:'save',operationId:'resurrect',entryId:id,expectedRevision:3,kind:'preference',text:'stale'})).status).toBe(409);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
it('isolates actual saved entries across authenticated accounts and reports failed writes without committing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-memory-scope-')),workspaces=new Workspaces(join(root,'owner')),other=new Workspaces(join(root,'other')),source=await workspaces.createChatConversation(),factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions')}),host=new HostServer({port:0,token:'fixture',requireUser:true,factory,workspaces,scopeForUser:user=>({factory,workspaces:user==='alice'?workspaces:other})});
 const call=async(user:string,body:Record<string,unknown>)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json','x-pi-coffee-user':user},body:JSON.stringify({id:source.id,action:'memory',...body})});return {status:response.status,body:await response.json()};};
 try{await host.start();await call('alice',{action:'select',selected:true});await call('alice',{operation:'configure',operationId:'enable',enabled:true});const saved=await call('alice',{operation:'save',operationId:'save',kind:'preference',text:'private preference'});expect(saved.status).toBe(200);expect((await call('bob',{operation:'get',entryId:saved.body.entry.id})).status).toBe(409);
 await mkdir(join(workspaces.root,'.coffee','mishu','memory.json.tmp'));expect((await call('alice',{operation:'save',operationId:'fails',kind:'preference',text:'uncommitted'})).status).toBe(409);expect((await call('alice',{operation:'list'})).body.entries.map((e:any)=>e.text)).toEqual(['private preference']);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
it('does not inherit memory after context replacement and restores only explicitly selected notes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-memory-reset-')),workspaces=new Workspaces(join(root,'work')),source=await workspaces.createChatConversation(),host=new HostServer({port:0,token:'fixture',factory:new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions')}),workspaces});
 const call=async(body:Record<string,unknown>)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({id:source.id,action:'memory',...body})});return {status:response.status,body:await response.json()};};
 try{await host.start();await call({action:'select',selected:true});await call({operation:'configure',operationId:'enable',enabled:true});const saved=await call({operation:'save',operationId:'save',kind:'preference',text:'restore me'});await workspaces.commitContextReset(source.id,{id:'reset',expectedNativeId:source.id},'replacement');
 const status=await call({operation:'status'});expect(status.body.enabled).toBe(false);expect((await call({operation:'list'})).body.entries).toEqual([]);await call({operation:'configure',operationId:'enable-new',enabled:true});const restored=await call({operation:'restore',operationId:'restore',fromBinding:status.body.oldBindings[0].binding,entryId:saved.body.entry.id});expect(restored.body.noteOnly).toBe(true);expect(restored.body.entry.source.kind).toBe('restored');const authority=await call({action:'status'});expect(authority.body.enabled).toBe(false);expect(authority.body.targets).toEqual([]);
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
