import {it,expect,afterEach} from 'vitest';import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomUUID} from 'node:crypto';
import {Workspaces} from '../src/host/workspaces.js';import {HostServer} from '../src/host/server.js';import type {AgentSessionFactory} from '../src/host/agent-adapter.js';
const exec=promisify(execFile);const clean:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const f of clean.reverse())await f();clean.length=0;});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'coffee-fork-'));clean.push(()=>rm(root,{recursive:true,force:true}));const source=join(root,'repo');await mkdir(source);
 const git=(cwd:string,args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd});
 await git(source,['init','-b','main']);await writeFile(join(source,'file.txt'),'base');await git(source,['add','.']);await git(source,['commit','-m','base']);await git(source,['clone','--bare',source,join(root,'remote.git')]);
 const ws=new Workspaces(join(root,'projects'),{taskRoot:join(root,'tasks'),ownerId:'alice'});const p=await ws.registerProject('repo',join(root,'remote.git'));const c=await ws.createConversation(p.id);let busy=false,fail=false,calls=0;
 const session={getState:async()=>({isStreaming:busy,messageCount:2}),getHistory:async()=>({entries:[{id:'u1',kind:'user',text:'Finish the patch'},{id:'a1',kind:'assistant',text:'Next: test'}],leafId:'a1'}),getModels:async()=>({models:[],current:{provider:'fake',id:'chosen'},thinkingLevel:'medium',thinkingLevels:['medium'],context:{preset:'272k'}}),getCommands:async()=>[],getExtensions:async()=>[],onEvent:()=>()=>{},stop:async()=>{},backgroundState:async()=>({known:true,active:busy?1:0})};
 const factory:AgentSessionFactory={list:async()=>[],delete:async()=>false,create:async()=>session as any,forkModes:()=>['native','handoff'],forkConversation:async()=>{calls++;if(fail)throw Error('fixture handoff failed');}};
 const host=new HostServer({port:0,token:'fixture',factory,workspaces:ws,scopeForUser:user=>({factory,workspaces:user==='alice'?ws:new Workspaces(join(root,user))})});await host.start();clean.push(()=>host.close());
 const call=async(body:object,user='alice')=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {root,ws,c,git,call,calls:()=>calls,setBusy:(v:boolean)=>busy=v,setFail:(v:boolean)=>fail=v};
}
it('forks into an independent clone with staged/unstaged code and attachments while retaining the source',async()=>{
 const a=await setup();await writeFile(join(a.c.cwd,'file.txt'),'staged');await a.git(a.c.cwd,['add','file.txt']);await writeFile(join(a.c.cwd,'file.txt'),'working');await writeFile(join(a.c.cwd,'new.txt'),'untracked');await writeFile(join(await a.ws.inboxDirectory(a.c.id),'picture.txt'),'attachment');
 const before=(await a.git(a.c.cwd,['status','--porcelain'])).stdout,branch=(await a.git(a.c.cwd,['branch','--show-current'])).stdout;
 const id=randomUUID();const response=await a.call({action:'fork',id:a.c.id,targetId:id,mode:'native'});expect(response.status,JSON.stringify(response.body)).toBe(202);
 await expect.poll(async()=>(await a.ws.lookup(id))?.fork?.status).toBe('completed');const fork=(await a.ws.lookup(id))!;
 expect(fork.cwd).not.toBe(a.c.cwd);expect(fork.branch).not.toBe(a.c.branch);expect(await readFile(join(fork.cwd,'file.txt'),'utf8')).toBe('working');expect((await a.git(fork.cwd,['show',':file.txt'])).stdout).toBe('staged');expect(await readFile(join(fork.cwd,'new.txt'),'utf8')).toBe('untracked');expect(await readFile(join(await a.ws.inboxDirectory(id),'picture.txt'),'utf8')).toBe('attachment');
 await writeFile(join(fork.cwd,'file.txt'),'child');expect(await readFile(join(a.c.cwd,'file.txt'),'utf8')).toBe('working');expect((await a.git(a.c.cwd,['status','--porcelain'])).stdout).toBe(before);expect((await a.git(a.c.cwd,['branch','--show-current'])).stdout).toBe(branch);
 expect((await a.call({action:'fork',id:a.c.id,targetId:id,mode:'native'})).status).toBe(200);expect(a.calls()).toBe(1);
});
it('rejects foreign sources and missing Handoff consent, and preserves failed destinations',async()=>{
 const a=await setup();const id=randomUUID();expect((await a.call({action:'fork',id:a.c.id,targetId:id,mode:'native'},'bob')).status).toBe(409);
 expect((await a.call({action:'fork',id:a.c.id,targetId:id,mode:'handoff'})).status).toBe(409);a.setFail(true);
 expect((await a.call({action:'fork',id:a.c.id,targetId:id,mode:'handoff',acceptDrift:true})).status).toBe(202);
 await expect.poll(async()=>(await a.ws.lookup(id))?.fork?.status).toBe('failed');expect((await a.ws.lookup(a.c.id))?.archived).toBe(false);expect(await readFile(join((await a.ws.lookup(id))!.cwd,'file.txt'),'utf8')).toBe('base');
});
it('rejects a busy source before allocating a destination',async()=>{
 const a=await setup();a.setBusy(true);const first=randomUUID();expect((await a.call({action:'fork',id:a.c.id,targetId:first,mode:'native'})).status).toBe(409);expect(await a.ws.lookup(first)).toBeUndefined();
});
it('retains failure evidence when the source contains an external link instead of sharing its target',async()=>{
 const a=await setup();const {symlink}=await import('node:fs/promises');const outside=join(a.root,'outside');await mkdir(outside);await writeFile(join(outside,'private.txt'),'untouched');await symlink(outside,join(a.c.cwd,'external'));
 const id=randomUUID();expect((await a.call({action:'fork',id:a.c.id,targetId:id,mode:'native'})).status).toBe(202);
 await expect.poll(async()=>(await a.ws.lookup(id))?.fork?.status).toBe('failed');expect(a.calls()).toBe(0);expect(await readFile(join(outside,'private.txt'),'utf8')).toBe('untouched');
});
it('marks an interrupted preparation failed on reload without retrying native work',async()=>{
 const a=await setup();const id=randomUUID();await a.ws.beginFork(a.c.id,id,'handoff','Retained fork',{});await a.ws.copyForkWorkspace(id,{entries:[],leafId:null});
 const reopened=new Workspaces(a.ws.root,{taskRoot:join(a.root,'tasks'),ownerId:'alice'});const target=await reopened.lookup(id);expect(target?.fork?.status).toBe('failed');expect((await reopened.lookup(a.c.id))?.forking?.status).toBe('failed');expect(a.calls()).toBe(0);expect(await readFile(join(target!.cwd,'file.txt'),'utf8')).toBe('base');
});
