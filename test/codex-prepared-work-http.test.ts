import {it,expect} from 'vitest';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';

it.each(['new','legacy','unproven'] as const)('opens only proven empty Codex Work after preparation cleanup (%s), without replacing used history',async(mode)=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-prepared-work-')),work=join(root,'work'),native=join(root,'codex'),source=join(root,'source'),remote=join(root,'remote.git');
 for(const dir of [work,native,source])await mkdir(dir);
 const git=promisify(execFile);for(const args of [['init','-b','main'],['commit','--allow-empty','-m','Fixture'],['clone','--bare',source,remote]])await git('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:source});
 const cli=join(root,'codex-cli');await writeFile(cli,`#!/bin/sh\nif [ "$1" = "--version" ]; then\n echo 'codex-cli 0.159.1'\n exit 0\nfi\nexec "${process.execPath}" "${resolve('test/fixtures/fake-codex-app-server.mjs')}" "$@"\n`,{mode:0o700});
 let child:ChildProcess|undefined,socket:WebSocket|undefined,base='';
 const start=async()=>{
  let output='';const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PI_COFFEE_')));
  child=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{detached:true,env:{...env,PI_COFFEE_WORKDIR:work,PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_TASK_ROOT:join(root,'tasks'),PI_COFFEE_TASK_DEFAULT_USER:'fixture',PI_COFFEE_AGENT_DIR:join(root,'pi'),PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'127.0.0.1',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_CODEX_COMMAND:cli,PI_COFFEE_CODEX_HOME:native,PI_COFFEE_CODEX_MODEL:'gpt-6-luna',PI_COFFEE_EXTENSIONS:'off',FAKE_CODEX_EMPTY_NOT_DURABLE:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout!.on('data',data=>{output+=String(data);});child.stderr!.on('data',data=>{output+=String(data);});
  await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child?.exitCode!==null?'Host exited: '+output:''),{timeout:10000}).toMatch(/^\d+$/);
  base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
 };
 const stop=async()=>{socket?.terminate();socket=undefined;if(child&&child.exitCode===null){const exited=once(child,'exit');const pid=child.pid!;child.kill('SIGTERM');const force=setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch{}},3000);await exited;clearTimeout(force);}child=undefined;};
 const post=async(body:unknown)=>{const response=await fetch(base+'/api/workspace',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const open=async(id:string)=>{
  const frames:any[]=[];socket=new WebSocket(base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');
  const next=async(predicate:(frame:any)=>boolean)=>{await expect.poll(()=>frames.find(predicate)??null,{timeout:10000}).not.toBeNull();return frames.find(predicate);};
  socket.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));
  return {opened:await next(frame=>frame.type==='opened'||frame.type==='error'),next,send:(frame:object)=>socket!.send(JSON.stringify({v:1,...frame}))};
 };
 const id='prepared-work';
 const task=async()=>{const state=await(await fetch(base+'/api/workspace',{headers:{authorization:'Bearer fixture'}})).json();return state.conversations.find((row:any)=>row.id===id);};
 try{
  await start();const registered=await post({action:'project',name:'Fixture',url:remote});expect(registered.status).toBe(200);
  const admitted=await post({action:'preparation_start',kind:'create-work',operationId:id,targetTaskId:id,projectId:registered.body.id,engine:'codex'});expect(admitted.status).toBe(202);
  await expect.poll(async()=>(await post({action:'preparation_get',operationId:id})).body.status,{timeout:10000}).toBe('completed');
  const prepared=await task();await writeFile(join(prepared.cwd,'keep.txt'),'Retain this independent project');
  if(mode!=='new'){
   await stop();const file=join(work,'projects/.coffee/state.json'),state=JSON.parse(await readFile(file,'utf8'));
   delete state.conversations.find((row:any)=>row.id===id).nativeContextEmpty;
   await writeFile(file,JSON.stringify(state));
   if(mode==='unproven'){
    const file=join(work,'projects/.coffee/preparations',id+'.json'),operation=JSON.parse(await readFile(file,'utf8'));
    operation.receipts.publication.digest='0'.repeat(64);await writeFile(file,JSON.stringify(operation));
   }
   await start();
  }
  let client=await open(id);
  if(mode==='unproven'){
   expect(client.opened).toMatchObject({type:'error',code:'operation_failed',message:expect.stringContaining('Native conversation is unavailable')});
   expect((await task()).nativeBinding.id).toBe(prepared.nativeBinding.id);return;
  }
  expect(client.opened,JSON.stringify(client.opened)).toMatchObject({type:'opened'});
  await stop();await start();client=await open(id);expect(client.opened).toMatchObject({type:'opened'});
  client.send({type:'prompt',requestId:'first-work-message',text:'Synthetic first task'});await client.next(frame=>frame.type==='event'&&frame.event.type==='agent_settled');
  const used=await task();expect(used.nativeContextEmpty).toBe(false);
  await stop();await rm(join(native,'fake-threads.json'));await start();client=await open(id);
  expect(client.opened).toMatchObject({type:'error',code:'operation_failed',message:expect.stringContaining('Native conversation is unavailable')});
  expect((await task()).nativeBinding.id).toBe(used.nativeBinding.id);
  expect(await readFile(join(prepared.cwd,'keep.txt'),'utf8')).toBe('Retain this independent project');
 }finally{await stop();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},45000);
