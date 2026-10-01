import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {afterEach, expect, it} from 'vitest';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import type {AgentSession,AgentSessionFactory} from '../src/host/agent-adapter.js';
import type {HistoryEntry} from '../src/shared/protocol.js';
import {WebSocket} from 'ws';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const f of cleanup.reverse())await f();cleanup.length=0;});
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'takeover-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source');await mkdir(source);const git=promisify(execFile);
 const run=(args:string[])=>git('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:source});
 await run(['init','-b','main']);await writeFile(join(source,'file.txt'),'base');await run(['add','.']);await run(['commit','-m','base']);await run(['clone','--bare',source,join(root,'repo.git')]);
 const workspaces=new Workspaces(join(root,'projects'));const project=await workspaces.registerProject('test',join(root,'repo.git'));const task=await workspaces.createConversation(project.id);
 const records=new Map<string,HistoryEntry[]>();records.set(task.id,[{id:'u1',kind:'user',text:'Keep the uncommitted fix. Continue testing.'},{id:'a1',kind:'assistant',text:'The fix needs verification.'}]);
 const calls:Array<{id:string;text:string}>=[];let sequence=0;let fail=false;let hold:Promise<void>|undefined;
 const factoryFor=(onBound?:(id:string)=>Promise<void>):AgentSessionFactory=>({
 async create({sessionId,requireExisting}){const id=onBound&&!requireExisting?'codex-'+(++sequence):sessionId;await onBound?.(id);const entries=records.get(id)??[];records.set(id,entries);const listeners=new Set<(event:unknown)=>void>();let streaming=false;
 const session:AgentSession={async prompt(text){calls.push({id,text});if(text==='hold'){streaming=true;for(const l of listeners)l({type:'agent_start'});return;}if(hold)await hold;if(fail)throw new Error('provider unavailable');entries.push({id:'u'+entries.length,kind:'user',text});entries.push({id:'a'+entries.length,kind:'assistant',text:'Verified current files; next: run tests.\n[TAKEOVER_READY]'});for(const l of listeners)l({type:'agent_settled'});},async steer(){},async followUp(){},async abort(){streaming=false;},async getState(){return {isStreaming:streaming,messageCount:entries.length};},async getHistory(){return {entries:[...entries],leafId:entries.at(-1)?.id??null};},async rename(){},async getModels(){return {models:[],current:null,thinkingLevel:'off',thinkingLevels:[]};},async setModel(){},async setThinkingLevel(){},async getCommands(){return [];},async getExtensions(){return [];},async getStats(){return {};},async compact(){},async respondUi(){},onEvent(l){listeners.add(l);return ()=>listeners.delete(l);},async stop(){},async backgroundState(){return {known:true,active:0};}};return session;},async list(){return [];},async delete(){return false;}});
 const factory=new NativeAgentFactory({workspaces,pi:factoryFor(),codex:{command:'fixture'},codexSessionFactory:(_id,_cwd,bound)=>factoryFor(bound)});
 factory.engines=async()=>[{id:'pi',name:'Pi',available:true},{id:'codex',name:'Codex',available:true}];
 const host=new HostServer({port:0,token:'test',factory,workspaces,scopeForUser:async user=>({factory,workspaces:user==='owner'?workspaces:new Workspaces(join(root,user))})});await host.start();cleanup.push(()=>host.close());
 const request=(body?:unknown)=>fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:body?'POST':'GET',headers:{authorization:'Bearer test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const readTask=async()=>((await (await request()).json()).conversations as any[]).find(c=>c.id===task.id);
 const restart=async()=>{
  await host.close();
  const store=new Workspaces(join(root,'projects'));
  const nextFactory=new NativeAgentFactory({workspaces:store,pi:factoryFor(),codex:{command:'fixture'},codexSessionFactory:(_id,_cwd,bound)=>factoryFor(bound)});
  nextFactory.engines=factory.engines;
  const next=new HostServer({port:0,token:'test',factory:nextFactory,workspaces:store});await next.start();cleanup.push(()=>next.close());return next;
 };
 return {root,task,host,request,readTask,calls,workspaces,records,restart,setHold:(value:Promise<void>|undefined)=>{hold=value;},setFail:(value:boolean)=>{fail=value;}};
}
it('takes over the same Work directory and preserves its old history without replaying old prompts',async()=>{
 const app=await setup();await writeFile(join(app.task.cwd,'file.txt'),'uncommitted fix');
 const response=await app.request({action:'takeover',id:app.task.id,engine:'codex',acceptDrift:true,expectedEngine:'pi'});
 expect(response.status).toBe(202);
 await expect.poll(async()=>(await app.readTask()).takeover?.status).toBe('completed');
 const task=await app.readTask();expect(task.engine).toBe('codex');expect(task.cwd).toBe(app.task.cwd);expect(await readFile(join(task.cwd,'file.txt'),'utf8')).toBe('uncommitted fix');
 expect(app.calls).toHaveLength(1);expect(app.calls[0].text).toContain('read-only');
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer test'}});cleanup.push(async()=>{socket.close();});
 const history=await new Promise<any>((resolve,reject)=>{socket.on('error',reject);socket.on('open',()=>socket.send(JSON.stringify({v:1,type:'open',sessionId:task.id,nativeProtocol:1})));socket.on('message',raw=>{const frame=JSON.parse(String(raw));if(frame.type==='history')resolve(frame);});});
 expect(history.entries).toEqual(expect.arrayContaining([expect.objectContaining({kind:'user',text:'Keep the uncommitted fix. Continue testing.'})]));
 expect(history.entries.filter((e:any)=>e.kind==='user')).toHaveLength(1);
});
it('keeps the original Agent after provider failure and permits an explicit later retry',async()=>{
 const app=await setup();app.setFail(true);
 expect((await app.request({action:'takeover',id:app.task.id,engine:'codex',expectedEngine:'pi',acceptDrift:true})).status).toBe(202);
 await expect.poll(async()=>(await app.readTask()).takeover?.status).toBe('failed');
 expect((await app.readTask()).engine).toBe('pi');expect(app.calls).toHaveLength(1);
 app.setFail(false);expect((await app.request({action:'takeover',id:app.task.id,engine:'codex',expectedEngine:'pi',acceptDrift:true})).status).toBe(202);
 await expect.poll(async()=>(await app.readTask()).engine).toBe('codex');expect(app.calls).toHaveLength(2);
});
it('switches back into a fresh Pi session and retains both previous segments',async()=>{
 const app=await setup();
 for(const [from,to] of [['pi','codex'],['codex','pi']]){
  expect((await app.request({action:'takeover',id:app.task.id,engine:to,expectedEngine:from,acceptDrift:true})).status).toBe(202);
  await expect.poll(async()=>(await app.readTask()).takeover?.status).toBe('completed');
 }
 const task=await app.readTask();expect(task.engine).toBe('pi');expect(task.takeoverSegments).toHaveLength(2);
 expect(app.calls).toHaveLength(2);expect(app.calls[1].id).not.toBe(app.task.id);
 expect(app.records.get(app.task.id)?.[0]).toMatchObject({text:'Keep the uncommitted fix. Continue testing.'});
});
it('requires explicit consent, rejects Chat and stale Agent selection',async()=>{
 const app=await setup();const chat=await app.workspaces.createChatConversation();
 for(const input of [{id:app.task.id},{id:chat.id,acceptDrift:true},{id:app.task.id,acceptDrift:true,expectedEngine:'codex'}]){
  expect((await app.request({action:'takeover',engine:'codex',expectedEngine:'pi',...input})).status).toBe(409);
 }
 expect(app.calls).toHaveLength(0);
});
it('rejects a symlink takeover directory without changing Agent or sending a model request',async()=>{
 const app=await setup();const {symlink}=await import('node:fs/promises');const data=await app.workspaces.dataRoot(app.task.id);const outside=join(app.root,'outside');await mkdir(outside);await symlink(outside,join(data,'takeover'));
 expect((await app.request({action:'takeover',id:app.task.id,engine:'codex',expectedEngine:'pi',acceptDrift:true})).status).toBe(202);
 await expect.poll(async()=>(await app.readTask()).takeover?.status).toBe('failed');expect((await app.readTask()).engine).toBe('pi');expect(app.calls).toHaveLength(0);
});
it('rejects foreign-scope task IDs before starting a candidate',async()=>{
 const app=await setup();const response=await fetch(`http://127.0.0.1:${app.host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer test','x-pi-coffee-user':'other','content-type':'application/json'},body:JSON.stringify({action:'takeover',id:app.task.id,engine:'codex',expectedEngine:'pi',acceptDrift:true})});
 expect(response.status).toBe(409);expect(app.calls).toHaveLength(0);expect((await app.readTask()).engine).toBe('pi');
});
it('rejects concurrent takeover and native input while preparation is pending',async()=>{
 const app=await setup();let release!:()=>void;app.setHold(new Promise<void>(r=>{release=r;}));
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer test'}});cleanup.push(async()=>socket.close());
 const frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await new Promise(r=>socket.once('open',r));socket.send(JSON.stringify({v:1,type:'open',sessionId:app.task.id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened')).toBe(true);
 const input={action:'takeover',id:app.task.id,engine:'codex',expectedEngine:'pi',acceptDrift:true};
 expect((await app.request(input)).status).toBe(202);
 expect((await app.request(input)).status).toBe(409);
 socket.send(JSON.stringify({v:1,type:'prompt',requestId:'during',text:'must not run'}));await expect.poll(()=>frames.find(f=>f.type==='error'&&f.requestId==='during')?.message).toContain('lifecycle');
 release();await expect.poll(async()=>(await app.readTask()).takeover?.status).toBe('completed');expect(app.calls).toHaveLength(1);
});
it('blocks takeover while a foreground turn and pending follow-up exist',async()=>{
 const app=await setup();const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer test'}});cleanup.push(async()=>socket.close());const frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await new Promise(r=>socket.once('open',r));socket.send(JSON.stringify({v:1,type:'open',sessionId:app.task.id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened')).toBe(true);
 socket.send(JSON.stringify({v:1,type:'prompt',requestId:'run',text:'hold'}));await expect.poll(()=>app.calls.length).toBe(1);
 socket.send(JSON.stringify({v:1,type:'prompt',requestId:'queue',mode:'follow_up',text:'later'}));await expect.poll(()=>frames.find(f=>f.type==='queue_state')?.items.length).toBe(1);
 expect((await app.request({action:'takeover',id:app.task.id,engine:'codex',expectedEngine:'pi',acceptDrift:true})).status).toBe(409);expect(app.calls).toHaveLength(1);
});
it('reopens a round-trip task after Host restart with both boundaries and no extra model call',async()=>{
 const app=await setup();for(const [from,to] of [['pi','codex'],['codex','pi']]){expect((await app.request({action:'takeover',id:app.task.id,engine:to,expectedEngine:from,acceptDrift:true})).status).toBe(202);await expect.poll(async()=>(await app.readTask()).takeover?.status).toBe('completed');}
 const host=await app.restart();const socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer test'}});cleanup.push(async()=>socket.close());const frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await new Promise(r=>socket.once('open',r));socket.send(JSON.stringify({v:1,type:'open',sessionId:app.task.id,nativeProtocol:1}));
 await expect.poll(()=>frames.some(f=>f.type==='history')).toBe(true);const history=frames.find(f=>f.type==='history').entries;
 expect(frames.find(f=>f.type==='opened').engine).toBe('pi');expect(history.filter((e:any)=>e.kind==='user')).toEqual([expect.objectContaining({text:'Keep the uncommitted fix. Continue testing.'})]);expect(history.filter((e:any)=>e.kind==='note'&&e.text.startsWith('Agent 交接：'))).toHaveLength(2);expect(app.calls).toHaveLength(2);
 socket.send(JSON.stringify({v:1,type:'list_sessions'}));await expect.poll(()=>frames.some(f=>f.type==='sessions')).toBe(true);
 const sessions=frames.filter(f=>f.type==='sessions').at(-1).sessions;expect(sessions).toEqual([expect.objectContaining({id:app.task.id,engine:'pi',preview:'Keep the uncommitted fix. Continue testing.'})]);
});
