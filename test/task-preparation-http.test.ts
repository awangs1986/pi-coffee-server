import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {WebSocket} from 'ws';
import {once} from 'node:events';
import {afterEach, expect, it} from 'vitest';
import {mkdtemp, rm, mkdir, writeFile, rename, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';

const cleanup: Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.reverse())await close();cleanup.length=0;});
async function setup(env:Record<string,string>={}, budgets?:{stageMs:number;operationMs:number;cleanupMs:number}) {
 const root=await mkdtemp(join(tmpdir(),'coffee-preparation-'));
 cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const ws=new Workspaces(join(root,'projects'),{taskRoot:join(root,'tasks')});
 const factory=new NativeAgentFactory({workspaces:ws,pi:{list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Pi must not start for Codex');}},
  codex:{command:process.execPath,args:[resolve('test/fixtures/fake-codex.mjs')]},
  codexSessionFactory:(id,cwd,onBound,environment,preparation)=>new CodexSessionFactory({cwd,preparation,env,cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],codexHome:join(root,'codex'),mappingFile:join(root,'maps',id+'.json'),envForSession:environment,onBound:async(_id,native)=>onBound(native)})});
 cleanup.push(()=>factory.close());
 const host=new HostServer({preparationBudgets:budgets,port:0,token:'fixture',factory,workspaces:ws,scopeForUser:user=>user==='alice'?{factory,workspaces:ws}:{factory,workspaces:new Workspaces(join(root,'other-projects'))}});
 await host.start();cleanup.push(()=>host.close());
 const call=async(body:object,user='alice')=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const prompt=async(id:string)=>{
  const socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer fixture','x-pi-coffee-user':'alice'}});cleanup.push(async()=>{socket.close();});
  const frames:any[]=[];socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');
  socket.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened')).toBe(true);
  socket.send(JSON.stringify({v:1,type:'prompt',requestId:'source-input',text:'Keep the project unchanged and remember the pending review'}));
  await expect.poll(()=>frames.some(f=>f.type==='event'&&f.event.type==='agent_settled')).toBe(true);socket.close();
 };
 const project=async()=>{const source=join(root,'repo'),remote=join(root,'remote.git');await mkdir(source);const git=promisify(execFile);for(const args of [['init','-b','main'],['commit','--allow-empty','-m','base'],['clone','--bare',source,remote]])await git('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:source});const registered=await call({action:'project',name:'p',url:remote});expect(registered.status).toBe(200);return {projectId:registered.body.id,remote};};
 return {root,call,prompt,project,restart:async()=>{await host.close();const next=new HostServer({port:0,token:'fixture',factory,workspaces:ws,scopeForUser:user=>user==='alice'?{factory,workspaces:ws}:{factory,workspaces:new Workspaces(join(root,'other-projects'))}});await next.start();cleanup.push(()=>next.close());return async(body:object)=>{const r=await fetch(`http://127.0.0.1:${next.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'alice','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};}};
}
it('durably accepts one scoped Chat preparation and publishes a usable native binding without sending a model turn',async()=>{
 const {call}=await setup();
 const input={action:'preparation_start',kind:'create-chat',operationId:'new-chat-one',targetTaskId:'new-chat-one',engine:'codex'};
 const accepted=await call(input);
 expect(accepted.status,JSON.stringify(accepted.body)).toBe(202);
 expect(accepted.body).toMatchObject({operationId:'new-chat-one',targetTaskId:'new-chat-one',kind:'create-chat'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'new-chat-one'})).body.status).toBe('completed');
 const completed=(await call({action:'preparation_get',operationId:'new-chat-one'})).body;
 expect(completed.task).toMatchObject({id:'new-chat-one',engine:'codex',workspaceKind:'chat',creationState:'ready',nativeBinding:{state:'bound',id:expect.any(String)}});
 expect((await call(input)).body).toMatchObject({operationId:'new-chat-one',status:'completed',revision:completed.revision});
 expect((await call({...input,engine:'pi'})).status).toBe(409);
 expect((await call({action:'preparation_get',operationId:'new-chat-one'},'bob')).status).toBe(409);
});

it('cancels a stalled native preparation with revision checks and retains uncertainty instead of creating another thread',async()=>{
 const {call}=await setup({FAKE_PREPARATION_HANG_METHOD:'thread/start'});
 const input={action:'preparation_start',kind:'create-chat',operationId:'stalled-chat',targetTaskId:'stalled-chat',engine:'codex'};
 await call(input);
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'stalled-chat'})).body.phase).toBe('native-binding');
 const operation=(await call({action:'preparation_get',operationId:'stalled-chat'})).body;
 expect((await call({action:'preparation_cancel',operationId:'stalled-chat',expectedRevision:0})).status).toBe(409);
 expect((await call({action:'preparation_cancel',operationId:'stalled-chat',expectedRevision:operation.revision})).status).toBe(200);
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'stalled-chat'})).body.status).toBe('uncertain');
 const retained=(await call(input)).body;
 expect(retained.error).toContain('cancel');
 expect(retained.allowedActions).toEqual([]);
 expect((await call({action:'preparation_resume',operationId:'stalled-chat',expectedRevision:retained.revision})).status).toBe(409);
});

it('bounds native silence without treating a timeout as a successful cancellation',async()=>{
 const {call}=await setup({FAKE_PREPARATION_HANG_METHOD:'thread/start'},{stageMs:1000,operationMs:5000,cleanupMs:1000});
 const input={action:'preparation_start',kind:'create-chat',operationId:'deadline-chat',targetTaskId:'deadline-chat',engine:'codex'};
 expect((await call(input)).status).toBe(202);
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'deadline-chat'})).body.status,{timeout:4000}).toBe('uncertain');
 const result=(await call(input)).body;
 expect(result.error).toMatch(/deadline|timed out/);
 expect(result.allowedActions).toEqual([]);
});
it('prepares a Handoff Fork through the same durable HTTP lifecycle without an interactive source open',async()=>{
 const {call,prompt,root}=await setup({FORK_POLICY_ASSERT:'1',FAKE_FORK_DEFAULT_MODEL:'1',FAKE_CODEX_COLD_READ:'1'});
 await call({action:'preparation_start',kind:'create-chat',operationId:'fork-source',targetTaskId:'fork-source',engine:'codex'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'fork-source'})).body.status).toBe('completed');
 await prompt('fork-source');
 const source=(await call({action:'preparation_get',operationId:'fork-source'})).body.task;
 await writeFile(join(root,'codex','cold-source'),source.nativeBinding.id);
 const accepted=await call({action:'preparation_start',kind:'handoff-fork',operationId:'fork-target',sourceId:source.id,targetTaskId:'fork-target',acceptDrift:true});
 expect(accepted.status,JSON.stringify(accepted.body)).toBe(202);
 await expect.poll(async()=>{const r=(await call({action:'preparation_get',operationId:'fork-target'})).body;return r.error??r.status;},{timeout:10000}).toBe('completed');
 const completed=(await call({action:'preparation_get',operationId:'fork-target'})).body;
 expect(completed.receipts.turns.summary).toMatchObject({operationId:'fork-target',messageId:expect.any(String),binding:expect.any(String)});
 const target=completed.task;
 expect(target).toMatchObject({workspaceKind:'chat',engine:'codex',fork:{status:'completed',sourceId:source.id}});
 expect(target.nativeBinding.id).not.toBe(source.nativeBinding.id);
 expect(target.cwd).not.toBe(source.cwd);
},20000);

it('explicitly resumes a failed seed using the saved summary and the same target binding',async()=>{
 const {call,prompt}=await setup({FORK_POLICY_ASSERT:'1',FAKE_FORK_DEFAULT_MODEL:'1',FAKE_FORK_FAIL:'seed',FAKE_FORK_FAIL_ONCE:'1'});
 await call({action:'preparation_start',kind:'create-chat',operationId:'resume-source',targetTaskId:'resume-source',engine:'codex'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'resume-source'})).body.status).toBe('completed');
 await prompt('resume-source');
 await call({action:'preparation_start',kind:'handoff-fork',operationId:'resume-target',targetTaskId:'resume-target',sourceId:'resume-source',acceptDrift:true});
 await expect.poll(async()=>{const r=(await call({action:'preparation_get',operationId:'resume-target'})).body;return r.status==='uncertain'?r.error:r.status;},{timeout:10000}).toBe('failed');
 const failed=(await call({action:'preparation_get',operationId:'resume-target'})).body;
 expect(failed.allowedActions).toContain('resume');
 expect(failed.receipts.summary).toMatchObject({digest:expect.any(String)});
 expect((await call({action:'preparation_resume',operationId:'resume-target',expectedRevision:failed.revision})).status).toBe(200);
 await expect.poll(async()=>{const result=(await call({action:'preparation_get',operationId:'resume-target'})).body;return result.error??result.status;},{timeout:10000}).toBe('completed');
 const completed=(await call({action:'preparation_get',operationId:'resume-target'})).body;
 expect(completed.receipts.summary).toEqual(failed.receipts.summary);
 expect(completed.task.nativeBinding.id).toBe(failed.task.nativeBinding.id);
},20000);

it('keeps an uncertain native start quarantined after restart and exposes the retained operation in workspace listing',async()=>{
 const {call,restart}=await setup({FAKE_PREPARATION_HANG_METHOD:'thread/start'});
 await call({action:'preparation_start',kind:'create-chat',operationId:'restart-chat',targetTaskId:'restart-chat',engine:'codex'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'restart-chat'})).body.phase).toBe('native-binding');
 const next=await restart();
 const restored=await next({action:'preparation_get',operationId:'restart-chat'});
 expect(restored.body).toMatchObject({status:'uncertain',task:{creationState:'failed',preparationId:'restart-chat'}});
 expect((await next({action:'conversation',workspaceKind:'chat',id:'restart-chat',engine:'codex'})).status).toBe(409);
});

it('resumes a failed repository preparation with its original workspace and exact remote branch',async()=>{
 const {call,project}=await setup();const p=await project();await rename(p.remote,p.remote+'.offline');
 await call({action:'preparation_start',kind:'create-work',operationId:'work-retry',targetTaskId:'work-retry',projectId:p.projectId,branch:'main',engine:'codex'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'work-retry'})).body.status).toBe('failed');
 const failed=(await call({action:'preparation_get',operationId:'work-retry'})).body;expect(failed.allowedActions).toContain('resume');
 await rename(p.remote+'.offline',p.remote);
 expect((await call({action:'preparation_resume',operationId:'work-retry',expectedRevision:failed.revision})).status).toBe(200);
 await expect.poll(async()=>{const r=(await call({action:'preparation_get',operationId:'work-retry'})).body;return r.error??r.status;}).toBe('completed');
 const task=(await call({action:'preparation_get',operationId:'work-retry'})).body.task;
 expect(task.cwd).toBe(failed.task.cwd);expect(task.startBranch).toBe('main');
 const remote=await promisify(execFile)('git',['--git-dir',p.remote,'rev-parse','refs/heads/'+task.branch]);expect(remote.stdout.trim()).toBe(task.lastRemoteSha);
});

it('records the intended workspace before allocation and never adopts a pre-existing task directory',async()=>{
 const {call,root}=await setup();const directory=join(root,'tasks','occupied');await mkdir(directory,{recursive:true});await writeFile(join(directory,'keep.txt'),'unrelated files');await writeFile(join(directory,'task.json'),'foreign metadata');
 await call({action:'preparation_start',kind:'create-chat',operationId:'occupied-operation',targetTaskId:'occupied',engine:'codex'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'occupied-operation'})).body.status).toBe('failed');
 const failed=(await call({action:'preparation_get',operationId:'occupied-operation'})).body;
 expect(failed.task).toMatchObject({id:'occupied',preparationId:'occupied-operation',creationState:'failed'});
 expect(await readFile(join(directory,'keep.txt'),'utf8')).toBe('unrelated files');expect(await readFile(join(directory,'task.json'),'utf8')).toBe('foreign metadata');
 expect((await call({action:'preparation_resume',operationId:'occupied-operation',expectedRevision:failed.revision})).status).toBe(200);
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'occupied-operation'})).body.status).toBe('failed');
 expect(await readFile(join(directory,'keep.txt'),'utf8')).toBe('unrelated files');expect(await readFile(join(directory,'task.json'),'utf8')).toBe('foreign metadata');
});

it('publishes a task change without rewriting unrelated task metadata exports',async()=>{
 const {call}=await setup();
 for(const id of ['export-a','export-b']){await call({action:'preparation_start',kind:'create-chat',operationId:id,targetTaskId:id,engine:'codex'});await expect.poll(async()=>(await call({action:'preparation_get',operationId:id})).body.status).toBe('completed');}
 const task=(await call({action:'preparation_get',operationId:'export-b'})).body.task;
 const path=join(task.taskRoot,'task.json'),before=await stat(path);
 expect((await call({action:'archive',id:'export-a'})).status).toBe(200);
 expect((await stat(path)).ino).toBe(before.ino);
});
it('rejects mixed creation and Fork inputs before acceptance so creation cannot bypass Handoff consent',async()=>{
 const {call}=await setup();
 const mixed=await call({action:'preparation_start',operationId:'mixed',targetTaskId:'mixed',kind:'create-chat',engine:'codex',sourceId:'another-task'});
 expect(mixed.status).toBe(409);
 expect((await call({action:'preparation_get',operationId:'mixed'})).status).toBe(409);
});

it('refuses an oversized saved summary before native resume',async()=>{
 const {call,prompt}=await setup({FORK_POLICY_ASSERT:'1',FAKE_FORK_DEFAULT_MODEL:'1',FAKE_FORK_FAIL:'seed',FAKE_FORK_FAIL_ONCE:'1'});
 await call({action:'preparation_start',kind:'create-chat',operationId:'resume-source',targetTaskId:'resume-source',engine:'codex'});
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'resume-source'})).body.status).toBe('completed');
 await prompt('resume-source');
 await call({action:'preparation_start',kind:'handoff-fork',operationId:'resume-target',targetTaskId:'resume-target',sourceId:'resume-source',acceptDrift:true});
 await expect.poll(async()=>{const r=(await call({action:'preparation_get',operationId:'resume-target'})).body;return r.status==='uncertain'?r.error:r.status;},{timeout:10000}).toBe('failed');
 const failed=(await call({action:'preparation_get',operationId:'resume-target'})).body;
 expect(failed.allowedActions).toContain('resume');
 expect(failed.receipts.summary).toMatchObject({digest:expect.any(String)});
 await writeFile(join(failed.task.taskRoot,'fork','handoff.md'),'x'.repeat(262145));
 expect((await call({action:'preparation_resume',operationId:'resume-target',expectedRevision:failed.revision})).status).toBe(200);
 await expect.poll(async()=>(await call({action:'preparation_get',operationId:'resume-target'})).body.status,{timeout:10000}).toBe('failed');
 expect((await call({action:'preparation_get',operationId:'resume-target'})).body.error).toMatch(/artifact.*budget/i);
},20000);
