import {it,expect} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';

it('opens Codex Chat through the production Host without repository or Work guidance and restores native model/history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-codex-chat-')),work=join(root,'work'),native=join(root,'codex'),log=join(root,'native-start.json');
 await mkdir(work);await mkdir(native);
 const cli=join(root,'codex-cli');await writeFile(cli,`#!/bin/sh\nif [ "$1" = "--version" ]; then\n echo 'codex-cli 0.159.1'\n exit 0\nfi\nexec "${process.execPath}" "${resolve('test/fixtures/fake-codex-app-server.mjs')}" "$@"\n`,{mode:0o700});
 let child:ChildProcess|undefined,socket:WebSocket|undefined,base='';
 const start=async()=>{
  let output='';
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PI_COFFEE_')));
  child=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{env:{...env,PI_COFFEE_WORKDIR:work,PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_TASK_ROOT:join(root,'tasks'),PI_COFFEE_TASK_DEFAULT_USER:'fixture',PI_COFFEE_AGENT_DIR:join(root,'pi'),PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'127.0.0.1',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_CODEX_COMMAND:cli,PI_COFFEE_CODEX_HOME:native,PI_COFFEE_CODEX_MODEL:'gpt-6-luna',PI_COFFEE_CODEX_EFFORT:'medium',PI_COFFEE_EXTENSIONS:'off',RUNNER_ARGS_LOG:log,FAKE_DEVELOPER_INSTRUCTIONS:'Native user guidance.',FAKE_CODEX_EMPTY_NOT_DURABLE:'1',FAKE_CODEX_EMPTY_LINEAGE:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout!.on('data',data=>{output+=String(data);});child.stderr!.on('data',data=>{output+=String(data);});
  await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child?.exitCode!==null?'Host exited: '+output:''),{timeout:15000}).toMatch(/^\d+$/);
  base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
 };
 const stop=async()=>{socket?.terminate();socket=undefined;if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}child=undefined;};
 const post=(body:unknown,token='fixture')=>fetch(base+'/api/workspace',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});
 const open=async(id:string,allowError=false)=>{
  const frames:any[]=[];socket=new WebSocket(base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');
  socket.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));
  const next=async(predicate:(frame:any)=>boolean)=>{await expect.poll(()=>frames.find(predicate)??null,{timeout:10000}).not.toBeNull();return frames.find(predicate);};
  const opened=await next(frame=>frame.type==='opened'||frame.type==='error');if(!allowError)expect(opened).toMatchObject({type:'opened'});return {next,send:(frame:unknown)=>socket!.send(JSON.stringify({v:1,...frame as object}))};
 };
 try{
  await start();const id=randomUUID();
  expect((await post({action:'conversation',workspaceKind:'chat',engine:'codex',id},'wrong')).status).toBe(401);
  const created=await post({action:'conversation',workspaceKind:'chat',engine:'codex',id});expect(created.status,await created.clone().text()).toBe(200);const chat=await created.json();
  expect(chat.projectId).toBeUndefined();expect(chat.cwd).toBe(join(root,'tasks','fixture','projects',id,'workspace'));
  let client=await open(id);
  const launch=JSON.parse(await readFile(log,'utf8'));
  expect(launch.developerInstructions).toContain('Native user guidance.');expect(launch.developerInstructions).not.toMatch(/Linux server|runner configuration|independent fork/);
  const files=await post({action:'files',id});expect(files.status).toBe(200);
  await writeFile(join(chat.cwd,'keep.txt'),'Keep local Chat files');
  client.send({type:'get_models',requestId:'models'});expect(await client.next(frame=>frame.type==='models'&&frame.requestId==='models')).toMatchObject({current:{provider:'codex',id:'gpt-6-luna'},thinkingLevel:'medium'});
  client.send({type:'set_context',preset:'maximum',requestId:'context'});expect(await client.next(frame=>frame.requestId==='context'&&['ack','error'].includes(frame.type))).toMatchObject({type:'ack'});
  client.send({type:'prompt',requestId:'first',text:'CHAT_NATIVE_HISTORY'});await client.next(frame=>frame.type==='event'&&frame.event.type==='agent_settled');
  expect((await post({action:'archive',id})).status).toBe(200);expect((await post({action:'restore',id})).status).toBe(200);
  await stop();await start();client=await open(id);
  const history=await client.next(frame=>frame.type==='history');expect(history.entries).toEqual(expect.arrayContaining([expect.objectContaining({kind:'user',text:'CHAT_NATIVE_HISTORY'})]));
  client.send({type:'get_models',requestId:'restored'});expect(await client.next(frame=>frame.type==='models'&&frame.requestId==='restored')).toMatchObject({current:{provider:'codex',id:'gpt-6-luna'},thinkingLevel:'medium'});
  expect(await readFile(join(chat.cwd,'keep.txt'),'utf8')).toBe('Keep local Chat files');
  client.send({type:'set_model',provider:'codex',id:'gpt-fake',requestId:'choose-model'});await client.next(frame=>frame.type==='ack'&&frame.requestId==='choose-model');
  client.send({type:'set_thinking',level:'high',requestId:'choose-effort'});await client.next(frame=>frame.type==='ack'&&frame.requestId==='choose-effort');
  const state=await (await fetch(base+'/api/workspace',{headers:{authorization:'Bearer fixture'}})).json();
  const current=state.conversations.find((task:any)=>task.id===id),operation={action:'clear_chat_context',id,expectedNativeId:current.nativeBinding.id,operationId:randomUUID()};
  const cleared=await post(operation);expect(cleared.status,await cleared.clone().text()).toBe(200);const changed=await cleared.json();
  expect(changed.nativeBinding.id).not.toBe(current.nativeBinding.id);expect(changed.retainedNativeIds).toContain(current.nativeBinding.id);
  expect((await post(operation)).status).toBe(200);
  expect((await post({...operation,operationId:randomUUID()})).status).toBe(409);
  await stop();await start();client=await open(id);
  expect((await client.next(frame=>frame.type==='history')).entries).toEqual([]);
  client.send({type:'get_models',requestId:'cleared'});expect(await client.next(frame=>frame.type==='models'&&frame.requestId==='cleared')).toMatchObject({current:{provider:'codex',id:'gpt-fake'},thinkingLevel:'high',context:{preset:'maximum'}});
  expect(await readFile(join(chat.cwd,'keep.txt'),'utf8')).toBe('Keep local Chat files');
  client.send({type:'prompt',requestId:'first',text:'CHAT_NATIVE_HISTORY'});expect(await client.next(frame=>frame.requestId==='first'&&['ack','error'].includes(frame.type))).toMatchObject({type:'error',message:expect.stringContaining('already accepted')});
  client.send({type:'prompt',requestId:'after-clear',text:'AFTER_CLEAR_ONLY'});await client.next(frame=>frame.type==='event'&&frame.event.type==='agent_settled');
  const accepted=await (await fetch(base+'/api/workspace',{headers:{authorization:'Bearer fixture'}})).json();const acceptedId=accepted.conversations.find((task:any)=>task.id===id).nativeBinding.id;
  await stop();await rm(join(native,'fake-threads.json'));await start();client=await open(id,true);
  expect(await client.next(frame=>frame.type==='error')).toMatchObject({code:'operation_failed',message:expect.stringContaining('Native conversation is unavailable')});
  const retained=await (await fetch(base+'/api/workspace',{headers:{authorization:'Bearer fixture'}})).json();expect(retained.conversations.find((task:any)=>task.id===id).nativeBinding.id).toBe(acceptedId);
 }finally{await stop();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},45000);
