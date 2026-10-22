import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {it,expect,afterEach} from 'vitest';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {Workspaces} from '../src/host/workspaces.js';
import {HostServer} from '../src/host/server.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const f of cleanup.reverse())await f();cleanup.length=0;});
async function setup(extraEnv:Record<string,string>={},kind:'chat'|'project'='chat'){
 const root=await mkdtemp(join(tmpdir(),'coffee-manual-handoff-'));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const workspaces=new Workspaces(join(root,'projects'),{taskRoot:join(root,'tasks')});
 let task;
 if(kind==='chat')task=await workspaces.createChatConversation(randomUUID(),'codex');
 else{
  const source=join(root,'source');await mkdir(source);const exec=promisify(execFile);
  const git=(args:string[])=>exec('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:source});
  await git(['init','-b','main']);await writeFile(join(source,'code.txt'),'base');await git(['add','.']);await git(['commit','-m','base']);await git(['clone','--bare',source,join(root,'remote.git')]);
  const project=await workspaces.registerProject('p',join(root,'remote.git'));task=await workspaces.createConversation(project.id,'main',randomUUID(),'codex');
 }

 const factory=new NativeAgentFactory({workspaces,pi:{list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Pi unused');}},codex:{command:process.execPath,args:[resolve('test/fixtures/fake-codex.mjs')]},codexSessionFactory:(id,cwd,onBound,environment,preparation)=>new CodexSessionFactory({cwd,preparation,env:{FORK_POLICY_ASSERT:'1',...extraEnv},cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],codexHome:join(root,'codex'),mappingFile:join(root,'maps',id+'.json'),envForSession:environment,onBound:async(_host,native)=>onBound(native)})});
 cleanup.push(()=>factory.close());
 const original=await factory.create({sessionId:task.id});await original.setModel('codex','gpt-fake');await original.setThinkingLevel('high');
 await original.prompt('Keep my pending question unanswered');await expect.poll(async()=>(await original.getHistory()).entries.some(e=>e.kind==='assistant')).toBe(true);
 await original.setContextPreset?.('maximum');await original.setSpeed?.('fast');await original.runCommand?.('plan','on');await original.rename('My handoff task');const oldId=(await workspaces.lookup(task.id))!.nativeBinding!.id!;await original.stop();
 const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();cleanup.push(()=>host.close());
 const socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer fixture'}});cleanup.push(async()=>{socket.close();});
 const frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(socket,'open');
 socket.send(JSON.stringify({v:1,type:'open',sessionId:task.id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='history')).toBe(true);
 return {root,workspaces,task,factory,host,socket,frames,oldId,send:(frame:Record<string,unknown>)=>socket.send(JSON.stringify({v:1,...frame}))};
}
it.each(['chat','project'] as const)('manually hands off Codex in the same %s, preserves history and selected settings across reopen',async kind=>{
 const app=await setup({},kind);app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'manual'});
 await expect.poll(()=>app.frames.find(f=>f.requestId==='manual'&&['ack','error'].includes(f.type)),{timeout:15000}).toMatchObject({type:'ack'});
 const task=(await app.workspaces.lookup(app.task.id))!;
 expect(task.nativeBinding?.id).not.toBe(app.oldId);expect(task.cwd).toBe(app.task.cwd);expect(task.engine).toBe('codex');
 expect(task.takeoverSegments?.at(-1)).toMatchObject({purpose:'compaction',version:'0.1.0',nativeId:app.oldId});
 const child=await app.factory.create({sessionId:app.task.id});cleanup.push(()=>child.stop());
 expect(await child.getModels()).toMatchObject({current:{id:'gpt-fake'},thinkingLevel:'high',context:{preset:'maximum'},speed:{mode:'fast'}});
 expect(await child.runCommand?.('plan','status')).toMatchObject({mode:'plan'});expect((await child.getState()).sessionName).toBe('My handoff task');
 const history=await child.getHistory();expect(history.entries.some(e=>e.kind==='user'&&e.text==='Keep my pending question unanswered')).toBe(true);
 expect(history.entries.some(e=>e.kind==='user'&&e.text.startsWith('[PI Coffee manual Codex handoff'))).toBe(false);
 const saved=JSON.parse(await readFile(join(app.root,'codex','fake-threads.json'),'utf8'));const fresh=Object.values(saved).find((t:any)=>t.id===task.nativeBinding?.id) as any;
 expect(fresh.turns).toHaveLength(1);expect(fresh.turns[0].items.some((i:any)=>i.type==='userMessage'&&JSON.stringify(i).includes('Pending: run tests'))).toBe(true);
 expect(app.frames.some(f=>f.type==='event'&&f.event.type==='context_operation'&&f.event.active===false&&f.event.success===true)).toBe(true);
});
it('retains the original binding on generation failure and never retries it automatically',async()=>{
 const app=await setup({FAKE_MANUAL_HANDOFF:'fail'});
 app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'failed'});
 await expect.poll(()=>app.frames.find(f=>f.requestId==='failed'&&['ack','error'].includes(f.type)),{timeout:15000}).toMatchObject({type:'error'});
 expect((await app.workspaces.lookup(app.task.id))?.nativeBinding?.id).toBe(app.oldId);
 expect((await app.workspaces.lookup(app.task.id))?.takeover?.status).toBe('failed');
 app.send({type:'prompt',text:'report model settings',requestId:'continue-original'});
 await expect.poll(()=>app.frames.some(f=>f.type==='event'&&JSON.stringify(f.event).includes('model=gpt-fake;effort=high'))).toBe(true);
});
it('requires drift confirmation; ordinary native compaction does not create a handoff',async()=>{
 const app=await setup();app.send({type:'compact',mode:'handoff',requestId:'unconfirmed'});
 await expect.poll(()=>app.frames.find(f=>f.type==='error'&&f.code==='invalid_frame')).toMatchObject({code:'invalid_frame'});
 expect((await app.workspaces.lookup(app.task.id))?.takeover).toBeUndefined();
});
it('keeps ordinary native compaction separate from manual Handoff',async()=>{
 const app=await setup();app.send({type:'compact',requestId:'native'});
 await expect.poll(()=>app.frames.find(f=>f.requestId==='native'&&['ack','error'].includes(f.type))).toMatchObject({type:'ack'});
 expect((await app.workspaces.lookup(app.task.id))?.nativeBinding?.id).toBe(app.oldId);expect((await app.workspaces.lookup(app.task.id))?.takeover).toBeUndefined();
});
it('keeps reconnect state, rejects conflicting operations and lets Stop cancel preparation',async()=>{
 const app=await setup({FAKE_MANUAL_HANDOFF:'hold'});
 app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'hold'});
 await expect.poll(()=>app.frames.some(f=>f.type==='event'&&f.event.type==='context_operation'&&f.event.active)).toBe(true);
 app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'duplicate'});
 app.send({type:'set_model',provider:'codex',id:'other',requestId:'model-change'});
 for(const requestId of ['duplicate','model-change'])await expect.poll(()=>app.frames.find(f=>f.type==='error'&&f.requestId===requestId)).toMatchObject({code:'busy'});
 const viewer=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer fixture'}});cleanup.push(async()=>{viewer.close();});
 const viewed:any[]=[];viewer.on('message',raw=>viewed.push(JSON.parse(String(raw))));await once(viewer,'open');viewer.send(JSON.stringify({v:1,type:'open',sessionId:app.task.id,nativeProtocol:1}));
 await expect.poll(()=>viewed.find(f=>f.type==='opened')).toMatchObject({state:{isCompacting:true}});
 app.send({type:'abort',requestId:'stop'});
 await expect.poll(()=>app.frames.find(f=>f.requestId==='hold'&&f.type==='error'),{timeout:15000}).toBeTruthy();
 expect((await app.workspaces.lookup(app.task.id))?.nativeBinding?.id).toBe(app.oldId);
 expect((await app.workspaces.lookup(app.task.id))?.takeover?.status).toBe('failed');
 expect(app.frames.some(f=>f.type==='event'&&f.event.type==='context_operation'&&f.event.active===false&&f.event.success===false)).toBe(true);
});
it('clears Chat after Handoff without restoring pre-clear history on reopen',async()=>{
 const app=await setup();app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'handoff-before-clear'});
 await expect.poll(()=>app.frames.find(f=>f.requestId==='handoff-before-clear'&&['ack','error'].includes(f.type)),{timeout:15000}).toMatchObject({type:'ack'});
 const current=(await app.workspaces.lookup(app.task.id))!;
 const response=await fetch(`http://127.0.0.1:${app.host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({action:'clear_chat_context',id:app.task.id,operationId:randomUUID(),expectedNativeId:current.nativeBinding!.id})});
 expect(response.status,await response.clone().text()).toBe(200);
 const reopened=await app.factory.create({sessionId:app.task.id});cleanup.push(()=>reopened.stop());
 expect((await reopened.getHistory()).entries).toEqual([]);
});
it('drains manual preparation on Host shutdown without committing or replaying it',async()=>{
 const app=await setup({FAKE_MANUAL_HANDOFF:'hold'});
 app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'shutdown'});
 await expect.poll(async()=>(await app.workspaces.lookup(app.task.id))?.takeover?.nativeId).toBeTruthy();
 await app.host.close();
 const task=(await app.workspaces.lookup(app.task.id))!;expect(task.takeover?.status).toBe('failed');expect(task.nativeBinding?.id).toBe(app.oldId);
});
it('uses the same hidden-seed projection for passive indexed history as live history',async()=>{
 const app=await setup();app.send({type:'compact',mode:'handoff',acceptDrift:true,requestId:'indexed-handoff'});
 await expect.poll(()=>app.frames.find(f=>f.requestId==='indexed-handoff'&&['ack','error'].includes(f.type)),{timeout:15000}).toMatchObject({type:'ack'});
 const task=(await app.workspaces.lookup(app.task.id))!,id=task.nativeBinding!.id!;
 const store=JSON.parse(await readFile(join(app.root,'codex','fake-threads.json'),'utf8')),native=store[id];
 const directory=join(app.root,'codex','sessions','2026','10','22');await mkdir(directory,{recursive:true});
 const rows:unknown[]=[{type:'session_meta',payload:{id,cwd:task.cwd}}];
 for(const turn of native.turns)for(const item of turn.items)rows.push({type:'event_msg',payload:{type:'item_completed',thread_id:id,turn_id:turn.id,item}});
 await writeFile(join(directory,`rollout-2026-10-22-${id}.jsonl`),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 const indexed=await app.factory.readHistory(app.task.id);
 expect(indexed.sourceFreshness).toBe('current');
 expect(indexed.history.entries.some(e=>e.kind==='user'&&e.text==='Keep my pending question unanswered')).toBe(true);
 expect(indexed.history.entries.some(e=>e.kind==='user'&&e.text.startsWith('[PI Coffee manual Codex handoff'))).toBe(false);
 expect(indexed.history.entries.some(e=>e.kind==='assistant'&&e.text.includes('[FORK_READY]'))).toBe(false);
 expect(indexed.history.entries.find(e=>e.kind==='note'&&e.id.endsWith(':switch'))).toMatchObject({text:'Codex 交接压缩 0.1.0：历史保留，继续使用同一对话和目录。'});
});
