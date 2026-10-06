import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {WebSocket} from 'ws';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';
const roots:string[]=[],hosts:HostServer[]=[];
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function start(root?:string,engine?:'codex'|'claude'|'cursor'|'grok',nativePi=false,fixtureModel=false,auditGate?:(id:string,runId?:string)=>Promise<void>,loseDispatchAck=false,extraExtensions:string[]=[],productionCodex=false,trackingOutcome='completed'){
 root??=await mkdtemp(join(tmpdir(),'coffee-mishu-'));roots.push(root);
 const workspaces=new Workspaces(join(root,'work'));
 let host:HostServer;
 const fixturePi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions'),cwdForSession:id=>workspaces.file(id,'')});
 const realPi=new RpcPiSessionFactory({agentDir:join(root,'pi-home'),sessionDir:join(root,'sessions'),...(fixtureModel?{provider:'fixture',model:'fixture',extensions:resolveHostPiExtensions({PI_COFFEE_SUBAGENTS:"off",PI_COFFEE_LSP:"off",PI_COFFEE_WEB:"off",PI_COFFEE_HANDOFF:"off"})}:{}),args:['--no-extensions','--offline'],cwdForSession:id=>workspaces.file(id,''),extensionsForSession:async id=>{const runtime=await host.mishuRuntime('owner',id);return [...(runtime.extensions.length&&process.env.MISHU_PLUGIN_ROOT?[resolve(process.env.MISHU_PLUGIN_ROOT)]:runtime.extensions),...extraExtensions];},envForSession:async id=>({...await workspaces.runtimeEnvironment(id),...(await host.mishuRuntime('owner',id)).env})});
 const pi=nativePi?realPi:{create:async(options:{sessionId:string})=>((await host.mishuRuntime('owner',options.sessionId)).extensions.length?realPi:fixturePi).create(options),list:()=>realPi.list(),readHistory:(id:string)=>realPi.readHistory(id),delete:(id:string)=>realPi.delete(id)};
 const command=engine?{command:process.execPath,args:[resolve('test/fixtures/fake-'+(engine==='grok'?'cursor':engine)+'.mjs')],env:{TRACKING_END_STATUS:trackingOutcome,CLAUDE_CONFIG_DIR:join(root,'native'),...(engine==='grok'?{FIXTURE_GROK:'1'}:{})}}:undefined;
 const codexCli=join(root,'codex-fixture');if(productionCodex)await writeFile(codexCli,`#!/bin/sh\nexec "${process.execPath}" "${resolve('test/fixtures/fake-codex-app-server.mjs')}" "$@"\n`,{mode:0o755});
 const factory=engine||nativePi?new NativeAgentFactory({pi,workspaces,...(engine?{[engine]:command}:{}),...(productionCodex?{codexSessionFactory:(_id:string,cwd:string,onBound:(id:string)=>Promise<void>)=>new CodexSessionFactory({cliPath:codexCli,cwd,codexHome:join(root,'codex-home'),env:{TRACKING_END_STATUS:trackingOutcome},approvalPolicy:'on-request',onBound:async(_session,native)=>onBound(native)})}:{})}):pi;
 if(auditGate&&factory.readRunEvidence){const read=factory.readRunEvidence.bind(factory);factory.readRunEvidence=async(id:string,runId?:string)=>{const evidence=await read(id,runId);await auditGate(id,runId);return evidence;};}
 if(loseDispatchAck){const create=factory.create.bind(factory);factory.create=async options=>{const session=await create(options),prompt=session.prompt.bind(session);session.prompt=async(text,images,correlation)=>{await prompt(text,images,correlation);if(correlation)throw Error('Synthetic native acceptance acknowledgement lost');};return session;};}
 const other=new Workspaces(join(root,'other'));
 host=new HostServer({port:0,token:'host-test',requireUser:true,factory,workspaces,scopeForUser:user=>({factory,workspaces:user==='owner'?workspaces:other})});hosts.push(host);await host.start();
 const call=(body:unknown,user='owner',token='host-test',path='/api/mishu')=>fetch(`http://127.0.0.1:${host.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer '+token,'x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});
 return {root,workspaces,host,call};
}

it('selected Chat knows MISHU identity through the installed plugin, including disable and context reset',async()=>{
 const requests:any[]=[];
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;requests.push(JSON.parse(raw));
  res.writeHead(200,{'content-type':'text/event-stream'});
  const frame={id:'identity-fixture',object:'chat.completion.chunk',created:1,model:'fixture'};
  res.end('data: '+JSON.stringify({...frame,choices:[{index:0,delta:{role:'assistant',content:'IDENTITY_FIXTURE_OK'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...frame,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const app=await start(undefined,undefined,true,true),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await mkdir(join(app.root,'pi-home'),{recursive:true});
 await writeFile(join(app.root,'pi-home','models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 await writeFile(join(app.root,'pi-home','settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 await app.call({action:'select',id:source.id,selected:true});
 const frames:any[]=[];
 let socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});
 socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
 async function prompt(text:string){
  const offset=frames.length;socket.send(JSON.stringify({v:1,type:'prompt',requestId:randomUUID(),text}));
  await expect.poll(()=>frames.slice(offset).some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);
  expect(frames.slice(offset).filter(f=>f.type==='error'||f.event?.type==='extension_error')).toEqual([]);
 }
 function identity(state:string){
  const request=requests.at(-1);expect(request).toBeDefined();
  expect(request.messages.some((m:any)=>['system','developer'].includes(m.role))).toBe(false);
  const latest=JSON.stringify(request.messages.at(-1));
  expect(latest).toContain('你是 MISHU');expect(latest).toContain(state);
  expect(latest).toContain('亲切、细心、可靠');
  expect(latest).toContain('最新偏好为准');
  expect(latest).not.toContain('PI_COFFEE_MISHU_TOKEN');
  if(state==='协调已启用'){
   expect(latest).toContain('已是该事项的授权');
   expect(latest).toContain('同一任务中');
   expect(latest).toContain('目标原生权限问题仍由用户处理');
   expect(latest).toContain('未获授权');
  }
 }
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:source.id,nativeProtocol:1}));
  await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);
  await prompt('Explain your role and current coordination state.');identity('尚未启用');
  expect(requests.at(-1).tools.some((t:any)=>t.function?.name==='mishu')).toBe(false);
  await setupThroughChat(app,source.id,target.id,false);
  await prompt('Explain your role and current coordination state again.');identity('协调已启用');
  expect(requests.at(-1).tools.some((t:any)=>t.function?.name==='mishu')).toBe(true);
  await prompt('/mishu-disable');await prompt('Explain your current coordination state after disable.');identity('尚未启用');
  const nativeId=(await app.workspaces.lookup(source.id))!.nativeBinding?.id??source.id;
  const reset=await app.call({action:'clear_chat_context',id:source.id,operationId:randomUUID(),expectedNativeId:nativeId},'owner','host-test','/api/workspace');
  expect(reset.status,await reset.clone().text()).toBe(200);
  socket.close();
  socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});
  socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
  await once(socket,'open');
  socket.send(JSON.stringify({v:1,type:'open',sessionId:source.id,nativeProtocol:1}));
  await expect.poll(()=>frames.filter(f=>f.type==='opened').length,{timeout:10000}).toBe(2);
  await prompt('Explain your current role after context reset.');identity('尚未启用');
  expect(await (await app.call({action:'status',id:source.id})).json()).toMatchObject({selected:true,enabled:false});
 }finally{
  socket.close();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));
 }
},30000);

it('exposes the current native title in directory and enabled target status after a WebSocket rename',async()=>{
 const app=await start(undefined,undefined,true),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 const native=SessionManager.create(target.cwd,join(app.root,'sessions'),{id:target.id});
 native.appendSessionInfo('Original project title');
 native.appendMessage({role:'user',content:'Synthetic title fixture',timestamp:Date.now()});
 native.appendMessage({role:'assistant',content:[{type:'text',text:'Synthetic reply'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 await app.call({action:'select',id:source.id,selected:true});const runtime=await app.host.mishuRuntime('owner',source.id);
 const req=(body:unknown)=>app.call(body,'owner',runtime.env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime');
 const initial=(await (await req({action:'directory'})).json()).conversations.find((c:any)=>c.id===target.id);
 expect(initial.title).toBe('Original project title');
 await setupThroughChat(app,source.id,target.id,false);
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];
 socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'rename_session',requestId:'rename-title',sessionId:target.id,name:'Renamed current project'}));
  await expect.poll(()=>frames.find(f=>f.requestId==='rename-title'&&['ack','error'].includes(f.type)),{timeout:10000}).toMatchObject({type:'ack'});
  const fresh=(await (await req({action:'directory'})).json()).conversations.find((c:any)=>c.id===target.id);
  expect(fresh).toMatchObject({title:'Renamed current project',binding:initial.binding});
  expect(await (await req({action:'status'})).json()).toMatchObject({enabled:true,targets:[{id:target.id,title:'Renamed current project',binding:initial.binding}]});
 }finally{socket.close();}
 await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const resumed=await start(app.root,undefined,true),env=(await resumed.host.mishuRuntime('owner',source.id)).env;
 expect(await (await resumed.call({action:'status'},'owner',env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime')).json()).toMatchObject({enabled:true,targets:[{id:target.id,title:'Renamed current project',binding:initial.binding}]});
},30000);
it('requires per-Chat selection and explicit setup before scoped cross-conversation messages, retaining receipts on restart',async()=>{
 const app=await start();const source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 expect((await app.call({action:'status',id:source.id},'owner','wrong')).status).toBe(401);
 expect((await app.call({action:'select',id:source.id,selected:true},'other')).status).toBe(409);
 const selected=await app.call({action:'select',id:source.id,selected:true});
 expect(selected.status,await selected.clone().text()).toBe(200);
 expect(await selected.json()).toMatchObject({selected:true,enabled:false});
 const runtime=await app.host.mishuRuntime('owner',source.id);
 const request=(body:unknown)=>app.call(body,'other',runtime.env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime');
 const directory=await (await request({action:'directory'})).json();
 const choice=directory.conversations.find((c:any)=>c.id===target.id);
 expect(choice).toMatchObject({id:target.id,engine:'pi',binding:expect.any(String)});
 const send={action:'send',targetId:target.id,binding:choice.binding,messageId:'message-1',kind:'information-only',text:'MISHU_TEST_MARKER'};
 expect((await request(send)).status).toBe(409);
 // Browser cannot impersonate the explicit slash command's setup operation.
 expect((await app.call({action:'setup',id:source.id,targets:[choice],allowInstructions:true})).status).toBe(409);
 expect((await request({action:'setup',targets:[choice],allowInstructions:false})).status).toBe(409);
 await setupThroughChat(app,source.id,target.id,false);
 expect((await request({...send,kind:'authorized-execution',authorizationRef:'test user instruction'})).status).toBe(409);
 expect((await request({...send,text:'x'.repeat(4001)})).status).toBe(409);
 const sent=await request(send);expect(sent.status,await sent.clone().text()).toBe(200);
 await expect.poll(async()=>(await (await request({action:'inbox'})).json()).messages[0],{timeout:5000}).toMatchObject({messageId:'message-1',state:'settled',result:expect.stringContaining('MISHU_TEST_MARKER')});
 expect((await request(send)).status).toBe(200);
 expect((await request({...send,text:'different intent'})).status).toBe(409);
 expect((await request({...send,messageId:'stale',binding:'stale'})).status).toBe(409);
 await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const resumed=await start(app.root);const env=(await resumed.host.mishuRuntime('owner',source.id)).env;
 const inbox=await resumed.call({action:'inbox'},'owner',env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime');
 expect(await inbox.json()).toMatchObject({messages:[{messageId:'message-1',state:'settled',result:expect.stringContaining('MISHU_TEST_MARKER')}]});
 expect((await resumed.call({action:'select',id:source.id,selected:false})).status).toBe(200);
 expect((await resumed.call({action:'status'},'owner',env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime')).status).toBe(401);
},30000);

it.each(['codex','claude','cursor','grok'] as const)('relays to the existing %s native binding and collects only its reply',async engine=>{
 const app=await start(undefined,engine),source=await app.workspaces.createChatConversation();
 const seed=join(app.root,'seed'),remote=join(app.root,'remote.git');await mkdir(seed);const git=promisify(execFile);
 const run=(args:string[])=>git('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:seed});
 await run(['init','-b','main']);await writeFile(join(seed,'note.txt'),'base');await run(['add','.']);await run(['commit','-m','fixture']);await run(['clone','--bare',seed,remote]);
 const project=await app.workspaces.registerProject('synthetic-project',remote);
 const target=await app.workspaces.createConversation(project.id,undefined,undefined,engine);
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});const frames:any[]=[];socket.on('message',data=>frames.push(JSON.parse(String(data))));
 await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
 await expect.poll(()=>frames.some(f=>f.type==='opened'||f.type==='error'),{timeout:10000}).toBe(true);
 const opened=frames.find(f=>f.type==='opened'||f.type==='error');expect(opened,JSON.stringify(opened)).toMatchObject({type:'opened'});
 socket.send(JSON.stringify({v:1,type:'prompt',requestId:'prime',text:'Initialize this existing conversation'}));
 await expect.poll(()=>frames.some(f=>f.type==='event'&&f.event.type==='run_completed'),{timeout:10000}).toBe(true);
 const original=(await app.workspaces.lookup(target.id))!.nativeBinding!.id;
 await app.call({action:'select',id:source.id,selected:true});const runtime=await app.host.mishuRuntime('owner',source.id);
 const req=(input:unknown)=>app.call(input,'owner',runtime.env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime');
 const choice=(await (await req({action:'directory'})).json()).conversations.find((t:any)=>t.id===target.id);
 await setupThroughChat(app,source.id,target.id,true);
 const message={action:'send',targetId:target.id,binding:choice.binding,messageId:'native-message',kind:'authorized-execution',authorizationRef:'User requested this synthetic adapter validation',text:'Reply with the fixture marker'};
 expect((await req(message)).status).toBe(200);
 await expect.poll(async()=>(await (await req({action:'inbox'})).json()).messages[0],{timeout:10000}).toMatchObject({state:'settled',result:expect.stringContaining(engine==='claude'?'Claude':engine==='codex'?'native':'Cursor')});
 expect((await app.workspaces.lookup(target.id))!.nativeBinding!.id).toBe(original);

 socket.close();
},30000);

async function setupThroughChat(app:Awaited<ReturnType<typeof start>>,sourceId:string,targetId:string,allow:boolean,exclusive=false){
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});
 const frames:any[]=[];let chosen=false;
 socket.on('message',raw=>{const f=JSON.parse(String(raw));frames.push(f);const e=f.event;if(e?.type!=='extension_ui_request')return;
  if(e.method==='select'){
   const target=e.options.find((v:string)=>v.includes(targetId));
   const unwanted=exclusive?e.options.find((v:string)=>v.startsWith('✓')&&!v.includes(targetId)):undefined;
   const value=unwanted??(e.title.includes('消息权限')?e.options[allow?1:0]:chosen||target?.startsWith('✓')?e.options.find((v:string)=>v.startsWith('完成选择')):target);
   if(!unwanted&&!e.title.includes('消息权限'))chosen=true;
   socket.send(JSON.stringify({v:1,type:'ui_response',requestId:'answer-'+e.id,id:e.id,value}));
  }else if(e.method==='confirm')socket.send(JSON.stringify({v:1,type:'ui_response',requestId:'answer-'+e.id,id:e.id,confirmed:true}));
 });
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:sourceId,nativeProtocol:1}));
  await expect.poll(()=>frames.some(f=>f.type==='opened'||f.type==='error'),{timeout:10000}).toBe(true);
  expect(frames.find(f=>f.type==='opened'||f.type==='error')).toMatchObject({type:'opened'});
  frames.length=0; // Exclude prior command notifications replayed on reconnect.
  socket.send(JSON.stringify({v:1,type:'prompt',requestId:'explicit-setup-'+randomUUID(),text:'/mishu-setup'}));
  // An already-enabled Chat must wait for this setup's completion, not old status.
  await expect.poll(()=>frames.some(f=>f.event?.method==='notify'&&String(f.event.message).startsWith('MISHU 已启用，可联系')),{timeout:10000}).toBe(true);
  expect(await (await app.call({action:'status',id:sourceId})).json()).toMatchObject({enabled:true});
 }finally{socket.close();}
}

it('continues an unperformed announcement and returns the selected Codex reply before settling',async()=>{
 const requests:any[]=[];let phase=0,targetId='';
 const model=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);requests.push(input);
  const last=input.messages.filter((m:any)=>m.role==='tool').at(-1),data=last?JSON.parse(typeof last.content==='string'?last.content:last.content[0].text):{};
  const tool=(args:unknown)=>({role:'assistant',tool_calls:[{index:0,id:'coordinate-'+phase,type:'function',function:{name:'mishu',arguments:JSON.stringify(args)}}]});
  let delta:any,reason='stop';
  if(phase===0)delta={role:'assistant',content:'我先帮你联系选中的对话，问问情况。'};
  else if(phase===1){delta=tool({action:'directory'});reason='tool_calls';}
  else if(phase===2){const target=data.conversations.find((t:any)=>t.id===targetId);delta=tool({action:'send',targetId:target.id,binding:target.binding,messageId:'model-loop-send',kind:'information-only',text:'只汇报合成测试状态，不修改代码。'});reason='tool_calls';}
  else {
   const receipt=data.messages?.find((m:any)=>m.messageId==='model-loop-send');
   if(receipt?.state==='settled')delta={role:'assistant',content:'COORDINATION_NATIVE_LOOP_OK '+receipt.result};
   else {await new Promise(r=>setTimeout(r,50));delta=tool({action:'inbox'});reason='tool_calls';}
  }
  phase++;
  res.writeHead(200,{'content-type':'text/event-stream'});const base={id:'coordinate-fixture',object:'chat.completion.chunk',created:1,model:'fixture'};
  res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:reason}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));
 const app=await start(undefined,'codex',false,true),source=await app.workspaces.createChatConversation();
 await mkdir(join(app.root,'pi-home'),{recursive:true});
 await writeFile(join(app.root,'pi-home','models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(model.address() as {port:number}).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 await writeFile(join(app.root,'pi-home','settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 const seed=join(app.root,'seed'),remote=join(app.root,'fixture.git');await mkdir(seed);const git=promisify(execFile);
 const run=(args:string[])=>git('git',['-c','user.name=Fixture','-c','user.email=fixture@localhost',...args],{cwd:seed});
 await run(['init','-b','main']);await writeFile(join(seed,'status.txt'),'Synthetic fixture only');await run(['add','.']);await run(['commit','-m','fixture']);await run(['clone','--bare',seed,remote]);
 const project=await app.workspaces.registerProject('coordination-fixture',remote),target=await app.workspaces.createConversation(project.id,undefined,undefined,'codex');targetId=target.id;
 const sockets:WebSocket[]=[];
 async function open(id:string){const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];sockets.push(socket);socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);return {socket,frames};}
 try{
  const targetChat=await open(target.id);targetChat.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'prime',text:'Initialize synthetic target'}));await expect.poll(()=>targetChat.frames.some(f=>f.event?.type==='run_completed'),{timeout:10000}).toBe(true);
  await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
  const sourceChat=await open(source.id);sourceChat.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'ordinary-coordination',text:'请向已选演示项目询问进展，仅信息通知，并把回复告诉我。'}));
  await expect.poll(()=>sourceChat.frames.some(f=>f.event?.type==='agent_settled'),{timeout:15000}).toBe(true);
  expect(JSON.stringify(sourceChat.frames)).toContain('COORDINATION_NATIVE_LOOP_OK');
  expect(JSON.stringify(sourceChat.frames)).toContain('native marker');
  const env=(await app.host.mishuRuntime('owner',source.id)).env;
  const inbox=await (await app.call({action:'inbox'},'owner',env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime')).json();
  expect(inbox.messages).toHaveLength(1);expect(inbox.messages[0]).toMatchObject({state:'settled',kind:'information-only',result:expect.stringContaining('native marker')});
  expect(sourceChat.frames.filter(f=>f.type==='error'||f.event?.type==='extension_error')).toEqual([]);
 }finally{for(const s of sockets)s.close();model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));}
},30000);

it('retains an aged confirmed binding during incremental setup but never carries archived targets',async()=>{
 const app=await start(undefined,undefined,true),source=await app.workspaces.createChatConversation(),older=await app.workspaces.createChatConversation(),recent=await app.workspaces.createChatConversation();
 const native=SessionManager.create(older.cwd,join(app.root,'sessions'),{id:older.id});native.appendSessionInfo('Existing configured target');
 native.appendMessage({role:'user',content:'Synthetic previous work',timestamp:Date.now()});
 native.appendMessage({role:'assistant',content:[{type:'text',text:'Synthetic reply'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 await app.call({action:'select',id:source.id,selected:true});const runtime=await app.host.mishuRuntime('owner',source.id);
 const req=async(body:unknown)=>await(await app.call(body,'owner',runtime.env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime')).json();
 await setupThroughChat(app,source.id,older.id,false);
 const initial=(await req({action:'status'})).targets[0];
 const old=new Date(Date.now()-96*3600000),file=native.getSessionFile()!;
 const entries=(await readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 for(const entry of entries){if(entry.type!=='session')entry.timestamp=old.toISOString();if(entry.message)entry.message.timestamp=old.getTime();}
 await writeFile(file,entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
 const directory=await req({action:'directory'});
 expect(directory.conversations.some((t:any)=>t.id===older.id)).toBe(false);
 expect(directory.configuredTargets).toContainEqual(expect.objectContaining({id:older.id,binding:initial.binding}));
 await setupThroughChat(app,source.id,recent.id,false);
 expect((await req({action:'status'})).targets.map((t:any)=>t.id)).toEqual([older.id,recent.id]);
 await app.workspaces.archive(older.id,true);
 expect((await req({action:'directory'})).configuredTargets.some((t:any)=>t.id===older.id)).toBe(false);
 await setupThroughChat(app,source.id,recent.id,false);
 expect((await req({action:'status'})).targets.map((t:any)=>t.id)).toEqual([recent.id]);
},30000);

it('queues behind an existing task and cancels undelivered messages when the secretary is disabled',async()=>{
 const app=await start(),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await app.call({action:'select',id:source.id,selected:true});
 const runtime=await app.host.mishuRuntime('owner',source.id),req=(input:unknown)=>app.call(input,'owner',runtime.env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime');
 await setupThroughChat(app,source.id,target.id,false);
 const choice=(await (await req({action:'directory'})).json()).conversations.find((t:any)=>t.id===target.id);
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];
 socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
  await expect.poll(()=>frames.some(f=>f.type==='opened')).toBe(true);
  socket.send(JSON.stringify({v:1,type:'prompt',requestId:'existing-user-work',text:'ask: Finish the existing task?'}));
  await expect.poll(()=>frames.find(f=>f.event?.method==='confirm')).toBeTruthy();
  const dialog=frames.find(f=>f.event?.method==='confirm').event;
  expect((await req({action:'send',targetId:target.id,binding:choice.binding,messageId:'queued-revoked',kind:'information-only',text:'MUST_NOT_DELIVER_AFTER_REVOKE'})).status).toBe(200);
  await expect.poll(async()=>(await (await req({action:'inbox'})).json()).messages[0].state).toBe('queued');
  await req({action:'disable'});
  socket.send(JSON.stringify({v:1,type:'ui_response',requestId:'human-answer',id:dialog.id,confirmed:true}));
  await expect.poll(()=>frames.filter(f=>f.type==='queue_state').at(-1),{timeout:3000}).toMatchObject({items:[{status:'failed'}]});
  expect(JSON.stringify(frames.filter(f=>f.type==='event'))).not.toContain('MUST_NOT_DELIVER_AFTER_REVOKE');
  await setupThroughChat(app,source.id,target.id,false);
  expect((await (await req({action:'inbox'})).json()).messages[0]).toMatchObject({state:'cancelled'});
 }finally{socket.close();}
},30000);

it('offers the plugin a loopback-only capability endpoint when the Host binds another local address',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-mishu-bind-'));roots.push(root);
 const workspaces=new Workspaces(join(root,'projects')),source=await workspaces.createChatConversation();
 const host=new HostServer({host:'127.0.0.2',port:0,token:'host-test',workspaces,factory:new RpcPiSessionFactory()});hosts.push(host);await host.start();
 const selected=await fetch(`http://127.0.0.2:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer host-test','content-type':'application/json'},body:JSON.stringify({action:'select',id:source.id,selected:true})});expect(selected.status).toBe(200);
 const runtime=await host.mishuRuntime(undefined,source.id);
 const response=await fetch(runtime.env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+runtime.env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify({action:'status'})});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({selected:true,enabled:false});
 const forbidden=await fetch(new URL('/api/workspace',runtime.env.PI_COFFEE_MISHU_URL),{headers:{authorization:'Bearer host-test'}});expect(forbidden.status).toBe(404);
});

it('records task briefs only after durable admission, rejects conflicting retries and preserves revisions after restart',async()=>{
 const app=await start(),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const env=(await app.host.mishuRuntime('owner',source.id)).env;
 const req=(body:unknown)=>app.call(body,'other',env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime');
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0];
 const save={action:'tasks',version:1,operation:'register',operationId:'brief-register',targetId:target.id,binding:contact.binding,purpose:'Verify the synthetic build',scope:'Read-only synthetic fixture',summary:'Waiting for evidence',nextStep:'Inspect build results'};
 const {binding:_omittedBinding,...missingBinding}=save;expect((await req(missingBinding)).status).toBe(409);
 const response=await req(save);expect(response.status,await response.clone().text()).toBe(200);
 const initial=await response.json();expect(initial).toMatchObject({version:1,task:{revision:1,observation:'not-started',workState:'recorded',acceptance:'pending',purpose:save.purpose}});
 expect(await(await req(save)).json()).toEqual(initial);
 expect((await req({...save,purpose:'different'})).status).toBe(409);
 const update={action:'tasks',version:1,operation:'update',operationId:'brief-update',taskId:initial.task.taskId,expectedRevision:1,summary:'Corrected synthetic scope'};
 expect((await req({...update,acceptance:'accepted'})).status).toBe(409);
 expect((await req({...save,operationId:'forged',sourceId:'another'})).status).toBe(409);
 const failedWrite=join(app.workspaces.root,'.coffee','mishu','state.json.tmp');await mkdir(failedWrite);
 expect((await req({...update,operationId:'disk-failed'})).status).toBe(409);await rm(failedWrite,{recursive:true});
 expect(await(await req({action:'tasks',version:1,operation:'get',taskId:initial.task.taskId})).json()).toMatchObject({task:{revision:1,summary:'Waiting for evidence'}});
 const raced=await Promise.all([req(update),req({...update,operationId:'race'})]);expect(raced.map(r=>r.status).sort()).toEqual([200,409]);
 expect((await req({...update,operationId:'stale'})).status).toBe(409);
 await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const resumed=await start(app.root),token=(await resumed.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 const read=(body:unknown)=>resumed.call(body,'owner',token,'/api/mishu/runtime');
 const list=await(await read({action:'tasks',version:1,operation:'list',limit:1})).json();
 expect(list.tasks).toEqual([expect.objectContaining({taskId:initial.task.taskId,revision:2,summary:'Corrected synthetic scope'})]);
 expect((await read({...update,operationId:'oversize',expectedRevision:2,summary:'x'.repeat(4001)})).status).toBe(409);
 const stop={action:'tasks',version:1,operation:'stop',operationId:'stop-record',taskId:initial.task.taskId,expectedRevision:2};
 expect(await(await read(stop)).json()).toMatchObject({task:{revision:3,workState:'stopped',acceptance:'pending'}});
 expect(await(await read(stop)).json()).toMatchObject({task:{revision:3}});
 expect((await resumed.workspaces.lookup(target.id))?.archived).not.toBe(true);
 expect((await read({...update,operationId:'after-stop',expectedRevision:3})).status).toBe(409);
},30000);

it('isolates brief references between secretaries and rejects stale contacts and source context resets',async()=>{
 const app=await start(undefined,undefined,true,true),source=await app.workspaces.createChatConversation(),second=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 const piHome=join(app.root,'pi-home');await mkdir(piHome,{recursive:true});await writeFile(join(piHome,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:1/v1',api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 const native=SessionManager.create(source.cwd,join(app.root,'sessions'),{id:source.id});native.appendMessage({role:'user',content:'Synthetic brief context',timestamp:Date.now()});
 for(const chat of [source,second]){await app.call({action:'select',id:chat.id,selected:true});await setupThroughChat(app,chat.id,target.id,false);}
 const request=async(chat:string,body:unknown)=>(app.call(body,'owner',(await app.host.mishuRuntime('owner',chat)).env.PI_COFFEE_MISHU_TOKEN,'/api/mishu/runtime'));
 const contact=(await(await request(source.id,{action:'directory'})).json()).configuredTargets[0];
 const input={action:'tasks',version:1,operation:'register',operationId:'owned',targetId:target.id,binding:contact.binding,purpose:'Same title',scope:'Synthetic',summary:'No evidence',nextStep:'Inspect'};
 const first=await(await request(source.id,input)).json();
 expect((await request(second.id,{action:'tasks',version:1,operation:'get',taskId:first.task.taskId})).status).toBe(409);
 const independent=await(await request(second.id,input)).json();expect(independent.task.taskId).not.toBe(first.task.taskId);
 expect((await app.call({action:'status',id:source.id},'other')).status).toBe(409);
 expect((await request(source.id,{...input,operationId:'invalid-target',targetId:second.id})).status).toBe(409);
 const nativeId=(await app.workspaces.lookup(source.id))!.nativeBinding?.id??source.id;
 const reset=await app.call({action:'clear_chat_context',id:source.id,operationId:randomUUID(),expectedNativeId:nativeId},'owner','host-test','/api/workspace');expect(reset.status,await reset.clone().text()).toBe(200);
 expect((await request(source.id,{action:'tasks',version:1,operation:'list'})).status).toBe(409);
 await setupThroughChat(app,source.id,target.id,false);
 expect(await(await request(source.id,{action:'tasks',version:1,operation:'list'})).json()).toMatchObject({tasks:[]});
 expect((await request(source.id,{action:'tasks',version:1,operation:'get',taskId:first.task.taskId})).status).toBe(409);
},30000);


it.each(['normal','race','commit-failure'])('observes direct native Pi work without replay (%s)',async(mode)=>{
 const racing=mode==='race';
 let calls=0,reply:()=>void=()=>{},registrationGate:(()=>Promise<void>)|undefined;
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;expect(raw).not.toContain('coffee-native-run');expect(raw).not.toContain('baselineId');calls++;
  reply=()=>{if(res.writableEnded)return;res.writeHead(200,{'content-type':'text/event-stream'});const frame={id:'observation-fixture',object:'chat.completion.chunk',created:1,model:'fixture'};res.end('data: '+JSON.stringify({...frame,choices:[{index:0,delta:{role:'assistant',content:'LATE_NATIVE_RESULT'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...frame,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
 });
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const app=await start(undefined,undefined,true,true,async()=>{const gate=registrationGate;registrationGate=undefined;await gate?.();}),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await mkdir(join(app.root,'pi-home'),{recursive:true});
 await writeFile(join(app.root,'pi-home','models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 await writeFile(join(app.root,'pi-home','settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 const req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime');
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];
 socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
 try{
 await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
 await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);
 socket.send(JSON.stringify({v:1,type:'prompt',requestId:'user-direct-work',text:'Synthetic existing work'}));
 await expect.poll(()=>calls,{timeout:10000}).toBe(1);
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0];
 expect(contact.observation).toMatchObject({supported:true,state:'running'});const runId=contact.observation.runId;expect(runId).toBeTruthy();
 const base={action:'tasks',version:1};
 const registered=await(await req({...base,operation:'register',operationId:'observe-brief',targetId:target.id,binding:contact.binding,purpose:'Track synthetic run',scope:'Only this run',summary:'Await result',nextStep:'Read reply'})).json();
 const watch={...base,operation:'observe',operationId:'observe-run',taskId:registered.task.taskId,expectedRevision:1,runId};
 const blockedWrite=join(app.workspaces.root,'.coffee','mishu','state.json.tmp');await mkdir(blockedWrite);
 expect((await req(watch)).status).toBe(409);await rm(blockedWrite,{recursive:true});
 expect((await(await req({...base,operation:'get',taskId:registered.task.taskId})).json()).task.obligation).toBeUndefined();
 if(racing)registrationGate=async()=>{reply();await expect.poll(()=>frames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);};
 const response=await req(watch);expect(response.status,await response.clone().text()).toBe(200);
 const admitted=await response.json();expect(admitted.task.obligation.runId).toBe(runId);if(!racing)expect(admitted.task.observation).toBe('watching');
 if(mode==='commit-failure')await mkdir(blockedWrite);
 socket.close();reply();
 const get={...base,operation:'get',taskId:registered.task.taskId};
 if(mode==='commit-failure'){
  await expect.poll(async()=>((await(await req({action:'status'})).json()).tracking.error),{timeout:10000}).toContain('persistence failed');
  await rm(blockedWrite,{recursive:true});await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
  const recovered=await start(app.root,undefined,true),recoveredToken=(await recovered.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
  const restored=await(await recovered.call(get,'owner',recoveredToken,'/api/mishu/runtime')).json();
  expect(restored.task).toMatchObject({observation:'reply-available',fact:{text:'LATE_NATIVE_RESULT'},acceptance:'pending'});expect(calls).toBe(1);return;
 }
 // Status exposes committed counters without performing a passive task audit.
 await expect.poll(async()=>((await(await req({action:'status'})).json()).tracking.replies),{timeout:10000}).toBe(1);
 await expect.poll(async()=>((await(await req(get)).json()).task.observation),{timeout:10000}).toBe('reply-available');
 const result=await(await req(get)).json();expect(result.task).toMatchObject({observation:'reply-available',obligation:{state:'reply-available'},fact:{text:'LATE_NATIVE_RESULT'},acceptance:'pending'});
 expect(await(await req(get)).json()).toEqual(result);expect(calls).toBe(1);
 const nextSocket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),nextFrames:any[]=[];
 nextSocket.on('message',raw=>nextFrames.push(JSON.parse(String(raw))));await once(nextSocket,'open');nextSocket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
 await expect.poll(()=>nextFrames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);
 nextSocket.send(JSON.stringify({v:1,type:'prompt',requestId:'unrelated-user-work',text:'Unrelated next work'}));await expect.poll(()=>calls,{timeout:10000}).toBe(2);reply();
 await expect.poll(()=>nextFrames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);nextSocket.close();
 expect(await(await req(get)).json()).toEqual(result);
 await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const resumed=await start(app.root,undefined,true),rt=(await resumed.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 expect(await(await resumed.call(get,'owner',rt,'/api/mishu/runtime')).json()).toEqual(result);expect(calls).toBe(2);
 }finally{socket.close();reply();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}
},30000);

it.each(['stop','disable','archive','remove'] as const)('revokes observation on %s without stopping or adopting target work',async(mode)=>{
 const app=await start(undefined,undefined,true),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation(),other=await app.workspaces.createChatConversation();
 const native=SessionManager.create(target.cwd,join(app.root,'sessions'),{id:target.id}),runId=randomUUID();
 native.appendCustomEntry('coffee-native-run',{version:1,runId,baselineId:native.getLeafId()});native.appendMessage({role:'user',content:'Synthetic ongoing work',timestamp:Date.now()});
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 const req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime'),base={action:'tasks',version:1};
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0];
 const brief=await(await req({...base,operation:'register',operationId:'revocable',targetId:target.id,binding:contact.binding,purpose:'Track',scope:'Exact run',summary:'No reply yet',nextStep:'Await'})).json();
 const observation=await(await req({...base,operation:'observe',operationId:'watch',taskId:brief.task.taskId,expectedRevision:1,runId})).json();
 expect(observation.task.obligation.runId).toBe(runId);
 if(mode==='stop')expect((await req({...base,operation:'stop',operationId:'stop',taskId:brief.task.taskId,expectedRevision:observation.task.revision})).status).toBe(200);
 if(mode==='disable')expect((await req({action:'disable'})).status).toBe(200);
 if(mode==='archive')expect((await app.call({action:'archive',id:target.id},'owner','host-test','/api/workspace')).status).toBe(200);
 if(mode==='remove')await setupThroughChat(app,source.id,other.id,false,true);
 native.appendMessage({role:'assistant',content:[{type:'text',text:'AFTER_REVOCATION'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});native.appendCustomEntry('coffee-native-settled',{version:1,runId});
 if(mode==='archive')expect((await app.call({action:'restore',id:target.id},'owner','host-test','/api/workspace')).status).toBe(200);
 if(mode==='disable'||mode==='remove')await setupThroughChat(app,source.id,target.id,false);
 const latest=await(await req({...base,operation:'get',taskId:brief.task.taskId})).json();
 expect(latest.task).toMatchObject({observation:'stopped',obligation:{state:'cancelled'},acceptance:'pending'});expect(latest.task.fact).toBeUndefined();expect(latest.task.notification).toBeUndefined();
 expect((await app.workspaces.lookup(target.id))?.archived).not.toBe(true);
},30000);

it('keeps truncated, missing-final-audit and next-user replies incomplete or uncertain',async()=>{
 const app=await start(undefined,undefined,true),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 const native=SessionManager.create(target.cwd,join(app.root,'sessions'),{id:target.id}),runId=randomUUID();
 native.appendCustomEntry('coffee-native-run',{version:1,runId,baselineId:native.getLeafId()});native.appendMessage({role:'user',content:'Synthetic unfinished work',timestamp:Date.now()});
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN,req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime'),base={action:'tasks',version:1};
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0];
 const brief=await(await req({...base,operation:'register',operationId:'incomplete',targetId:target.id,binding:contact.binding,purpose:'Track',scope:'Exact run',summary:'Pending',nextStep:'Await'})).json();
 await req({...base,operation:'observe',operationId:'watch',taskId:brief.task.taskId,expectedRevision:1,runId});
 const get={...base,operation:'get',taskId:brief.task.taskId};
 const append=(text:string,stopReason:'stop'|'length')=>native.appendMessage({role:'assistant',content:[{type:'text',text}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason,timestamp:Date.now()});
 append('Partial evidence','length');expect((await(await req(get)).json()).task).toMatchObject({observation:'uncertain',fact:{text:'Partial evidence'}});
 native.appendCustomEntry('coffee-native-settled',{version:1,runId});expect((await(await req(get)).json()).task).toMatchObject({observation:'incomplete',acceptance:'pending'});
 const stable=await(await req(get)).json();native.appendMessage({role:'user',content:'Unrelated later work',timestamp:Date.now()});append('UNRELATED_SUCCESS','stop');
 expect(await(await req(get)).json()).toEqual(stable);
 const nativeFile=native.getSessionFile()!;const original=await readFile(nativeFile,'utf8');await writeFile(nativeFile,original+'{"partial":');
 const unknown=await(await req(get)).json();expect(unknown.task).toMatchObject({observation:'uncertain',fact:{text:'Partial evidence'}});
 expect(await(await req(get)).json()).toEqual(unknown);
 await writeFile(nativeFile,original);
},30000);

it.each(['normal','lost-ack','queued-stop'] as const)('dispatch persists business responsibility and deduplicates changed IDs (%s)',async(mode)=>{
 let targetCalls=0,sourceCalls=0;let finishSource=()=>{},finishTarget=()=>{};
 const provider=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);const isTarget=JSON.stringify(body.messages).includes('DISPATCH_SYNTHETIC_WORK');
  const reply=(text:string)=>{if(res.writableEnded||res.destroyed)return;res.writeHead(200,{'content-type':'text/event-stream'});const frame={id:randomUUID(),object:'chat.completion.chunk',created:1,model:'fixture'};res.end('data: '+JSON.stringify({...frame,choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...frame,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
  if(isTarget){targetCalls++;finishTarget=()=>reply('DISPATCH_RESULT');}else{sourceCalls++;finishSource=()=>reply('Secretary done');}
 });await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const app=await start(undefined,undefined,true,true,undefined,mode==='lost-ack'),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await mkdir(join(app.root,'pi-home'),{recursive:true});await writeFile(join(app.root,'pi-home','models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));await writeFile(join(app.root,'pi-home','settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,true);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN,req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime');
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0],base={action:'tasks',version:1};
 const brief=await(await req({...base,operation:'register',operationId:'dispatch-brief',targetId:target.id,binding:contact.binding,purpose:'Run check',scope:'Synthetic isolated task',summary:'Requested',nextStep:'Deliver'})).json();
 const command={...base,operation:'dispatch',taskId:brief.task.taskId,expectedRevision:1,messageId:'first-model-id',text:'DISPATCH_SYNTHETIC_WORK',authorizationRef:'User explicitly requested the synthetic check'};
 expect((await req(command)).status).toBe(409);
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
 let targetSocket:WebSocket|undefined;const targetFrames:any[]=[];
 if(mode==='queued-stop'){
  targetSocket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});targetSocket.on('message',raw=>targetFrames.push(JSON.parse(String(raw))));await once(targetSocket,'open');targetSocket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));await expect.poll(()=>targetFrames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);targetSocket.send(JSON.stringify({v:1,type:'prompt',requestId:'direct-busy-target',text:'DISPATCH_SYNTHETIC_WORK already running'}));await expect.poll(()=>targetCalls,{timeout:10000}).toBe(1);
 }
 try{if(socket.readyState!==WebSocket.OPEN)await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:source.id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);socket.send(JSON.stringify({v:1,type:'prompt',requestId:'trusted-user-dispatch',text:'Please perform two independent isolated checks'}));await expect.poll(()=>sourceCalls,{timeout:10000}).toBe(1);
 const blockedWrite=join(app.workspaces.root,'.coffee','mishu','state.json.tmp');await mkdir(blockedWrite);expect((await req(command)).status).toBe(409);await rm(blockedWrite,{recursive:true});expect(targetCalls).toBe(mode==='queued-stop'?1:0);
 const accepted=await req(command);expect(accepted.status,await accepted.clone().text()).toBe(200);const result=await accepted.json();expect(result.assignment).toMatchObject({state:'accepted',taskId:brief.task.taskId});
 const duplicate=await req({...command,messageId:'model-changed-id'});expect(duplicate.status,await duplicate.clone().text()).toBe(200);expect((await duplicate.json()).assignment.id).toBe(result.assignment.id);
 await expect.poll(()=>targetCalls,{timeout:10000}).toBe(1);
 expect((await req({...command,messageId:'conflict',text:'different scope'})).status).toBe(409);expect(targetCalls).toBe(1);
 const stored=JSON.parse(await readFile(join(app.workspaces.root,'.coffee','mishu','state.json'),'utf8'));expect(stored.chats[source.id].assignments).toHaveLength(1);expect(stored.chats[source.id].taskJournal.tasks[0].obligation.runId).toBe(result.assignment.requestId);
 if(mode==='queued-stop'){
  await expect.poll(async()=>(await(await req({...base,operation:'get',taskId:brief.task.taskId})).json()).task.assignment.state).toBe('queued');
  const queued=(await(await req({...base,operation:'get',taskId:brief.task.taskId})).json()).task;
  expect((await req({...base,operation:'stop',operationId:'cancel-queued',taskId:queued.taskId,expectedRevision:queued.revision})).status).toBe(200);
  finishTarget();await expect.poll(()=>targetFrames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);
  const stopped=(await(await req({...base,operation:'get',taskId:brief.task.taskId})).json()).task;expect(stopped).toMatchObject({assignment:{state:'cancelled'},observation:'stopped'});expect(targetCalls).toBe(1);return;
 }
 finishTarget();await expect.poll(async()=>(await(await req({...base,operation:'get',taskId:brief.task.taskId})).json()).task.observation,{timeout:10000}).toBe('reply-available');
 const final=await(await req({...base,operation:'get',taskId:brief.task.taskId})).json();expect(final.task).toMatchObject({fact:{text:'DISPATCH_RESULT'},acceptance:'pending'});expect(final.task.assignment.id).toBe(result.assignment.id);
 let replayCommand:Record<string,unknown>=command,replayId=result.assignment.id,expectedCalls=1;
 if(mode==='normal'){
  const separate=await(await req({...base,operation:'register',operationId:'second-explicit-task',targetId:target.id,binding:contact.binding,purpose:'Second independent check',scope:'Synthetic isolated task',summary:'Requested',nextStep:'Deliver'})).json();
  const second=await req({...command,taskId:separate.task.taskId,messageId:'distinct-operation'});expect(second.status,await second.clone().text()).toBe(200);expect((await second.json()).assignment.id).not.toBe(result.assignment.id);
  await expect.poll(()=>targetCalls,{timeout:10000}).toBe(2);finishTarget();await expect.poll(async()=>(await(await req({...base,operation:'get',taskId:separate.task.taskId})).json()).task.observation,{timeout:10000}).toBe('reply-available');
 }
 finishSource();await expect.poll(()=>frames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);
 if(mode==='normal'){
  const offset=frames.length;socket.send(JSON.stringify({v:1,type:'prompt',requestId:'new-user-repeat',text:'Repeat the first isolated check once more'}));await expect.poll(()=>sourceCalls,{timeout:10000}).toBe(2);
  const current=(await(await req({...base,operation:'get',taskId:brief.task.taskId})).json()).task;
  replayCommand={...command,expectedRevision:current.revision,messageId:'legitimate-repeat',retryOf:result.assignment.id};
  const repeat=await req(replayCommand);expect(repeat.status,await repeat.clone().text()).toBe(200);const repeated=await repeat.json();expect(repeated.assignment.retryOf).toBe(result.assignment.id);replayId=repeated.assignment.id;expect(replayId).not.toBe(result.assignment.id);
  await expect.poll(()=>targetCalls,{timeout:10000}).toBe(3);finishTarget();await expect.poll(async()=>(await(await req({...base,operation:'get',taskId:brief.task.taskId})).json()).task.observation,{timeout:10000}).toBe('reply-available');finishSource();await expect.poll(()=>frames.slice(offset).some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);expectedCalls=3;
 }
 socket.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const restarted=await start(app.root,undefined,true),rt=(await restarted.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 const recovered=await restarted.call({...replayCommand,messageId:'after-restart'},'owner',rt,'/api/mishu/runtime');expect(recovered.status,await recovered.clone().text()).toBe(200);expect((await recovered.json()).assignment.id).toBe(replayId);expect(targetCalls).toBe(expectedCalls);
 }finally{socket.close();targetSocket?.close();finishSource();finishTarget();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}
},30000);

it.each(['normal','lost-ack','promise','tool-attempt','tool-only','revoked'] as const)('persists a native on-demand report identity without replay (%s)',async(mode)=>{
 let calls=0,foregroundCalls=0,taskId='',privatePath='',reply:()=>void=()=>{};const requests:any[]=[];
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;requests.push(JSON.parse(raw));calls++;const foreground=raw.includes('FOREGROUND_READ_REQUEST');if(foreground)foregroundCalls++;
  reply=()=>{
   if(res.writableEnded)return;
   const frame={id:'report-fixture',object:'chat.completion.chunk',created:1,model:'fixture'};
   const content=mode==='promise'?'我会稍后帮你汇报。':mode==='tool-only'?'':`进展：REPORT_RESULT 已收到。\n限制：仅合成测试，尚未用户验收。\n下一步：请查看证据。\n来源：Synthetic report`;
   const delta=foreground?(foregroundCalls===1?{role:'assistant',tool_calls:[{index:0,id:'allowed-read',type:'function',function:{name:'read',arguments:JSON.stringify({path:privatePath})}}]}:{role:'assistant',content:'FOREGROUND_RESTORED'}):(mode==='tool-attempt'||mode==='tool-only')&&calls===1?{role:'assistant',tool_calls:[...[['read',{path:privatePath}],['bash',{command:'touch '+privatePath+'.side-effect'}],['write',{path:privatePath,content:'MALICIOUS'}],['edit',{path:privatePath,edits:[{oldText:'SYNTHETIC_REPORT_FORBIDDEN_READ',newText:'MALICIOUS'}]}],['mishu',{action:'send',text:'MALICIOUS'}],['report_nested',{}]].map(([name,args],index)=>({index,id:'forbidden-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}}))]}:{role:'assistant',content};
   res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({...frame,choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...frame,choices:[{index:0,delta:{},finish_reason:foreground&&foregroundCalls===1||(mode==='tool-attempt'||mode==='tool-only')&&calls===1?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
  };
  if(calls>1)reply();
 });
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const fixtureRoot=await mkdtemp(join(tmpdir(),'coffee-report-')),extension=join(fixtureRoot,'active-tools.ts');
 privatePath=join(fixtureRoot,'private-marker.txt');await writeFile(privatePath,'SYNTHETIC_REPORT_FORBIDDEN_READ');
 await writeFile(extension,`import {registerChatTools} from ${JSON.stringify(resolve('node_modules/pi-coffee-harness/dist/harness/chat-tools.js'))};export default function(pi){registerChatTools(pi,['report_nested']);pi.registerTool({name:'report_nested',label:'Nested test',description:'Synthetic nested tool',parameters:{type:'object',properties:{}},async execute(id,args,signal,onUpdate,ctx){return ctx.executeTool('write',{path:${JSON.stringify(privatePath)},content:'NESTED_MALICIOUS'});}});pi.on('before_provider_request',()=>{pi.setActiveTools(pi.getAllTools().map(t=>t.name));});}`);
 const app=await start(fixtureRoot,undefined,true,true,undefined,false,[extension]),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 const native=SessionManager.create(target.cwd,join(app.root,'sessions'),{id:target.id}),runId=randomUUID();
 native.appendCustomEntry('coffee-native-run',{version:1,runId,baselineId:native.getLeafId()});native.appendMessage({role:'user',content:'Synthetic target work',timestamp:Date.now()});
 native.appendMessage({role:'assistant',content:[{type:'text',text:'REPORT_RESULT'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});native.appendCustomEntry('coffee-native-settled',{version:1,runId});
 await mkdir(join(app.root,'pi-home'),{recursive:true});await writeFile(join(app.root,'pi-home','models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 await writeFile(join(app.root,'pi-home','settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,true);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN,req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime');
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0],base={action:'tasks',version:1};
 const brief=await(await req({...base,operation:'register',operationId:'report-brief',targetId:target.id,binding:contact.binding,purpose:'Synthetic report',scope:'Only test',summary:'Result ready',nextStep:'Review'})).json();taskId=brief.task.taskId;
 await req({...base,operation:'observe',operationId:'report-watch',taskId,expectedRevision:1,runId});
 expect((await req({action:'report',operation:'prepare',taskId})).status).toBe(409);
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];
 socket.on('message',raw=>frames.push(JSON.parse(String(raw))));
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:source.id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);
  socket.send(JSON.stringify({v:1,type:'prompt',requestId:'report-user',text:'/mishu-report '+taskId}));
  await expect.poll(()=>calls,{timeout:10000}).toBe(1);
  expect(await(await req({action:'status'})).json()).toMatchObject({origin:'task-report'});
  for(const action of ['send','setup','disable','tasks','directory'])expect((await req({action})).status).toBe(409);
  socket.send(JSON.stringify({v:1,type:'prompt',requestId:'bad-steer',mode:'steer',text:'Do not mix me into report'}));
  await expect.poll(()=>frames.some(f=>f.type==='error'&&f.requestId==='bad-steer'),{timeout:10000}).toBe(true);
  const blockedWrite=join(app.workspaces.root,'.coffee','mishu','state.json.tmp');if(mode==='lost-ack')await mkdir(blockedWrite);
  if(mode==='revoked')expect((await app.call({action:'archive',id:target.id},'owner','host-test','/api/workspace')).status).toBe(200);
  reply();await expect.poll(()=>frames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);
  if(mode==='provider-error'){
   await expect.poll(async()=>{const state=JSON.parse(await readFile(join(app.workspaces.root,'.coffee','mishu','state.json'),'utf8'));return state.chats[source.id].taskJournal.tasks[0].reports?.[0]?.state;},{timeout:10000}).toBe('uncertain');
   for(let n=0;n<5;n++)await req({action:'status'});await new Promise(r=>setTimeout(r,250));expect(requests).toHaveLength(2);return;
  }
  if(mode==='lost-ack'){
   await expect.poll(async()=>((await(await req({action:'status'})).json()).tracking.error),{timeout:10000}).toContain('persistence failed');
   await rm(blockedWrite,{recursive:true});
  }
  if(mode==='normal'){
   expect(await(await req({action:'status'})).json()).toMatchObject({origin:'user-intent'});
   const from=frames.length;socket.send(JSON.stringify({v:1,type:'prompt',requestId:'foreground-user',text:'FOREGROUND_READ_REQUEST'}));
   await expect.poll(()=>frames.slice(from).some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);
   expect(JSON.stringify(requests.flatMap(r=>r.messages.filter((m:any)=>m.role==='tool')))).toContain('SYNTHETIC_REPORT_FORBIDDEN_READ');
  }
  if(mode==='revoked')expect((await app.call({action:'restore',id:target.id},'owner','host-test','/api/workspace')).status).toBe(200);
  socket.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
  if(mode==='lost-ack'){
   const stored=(await SessionManager.listAll(join(app.root,'sessions'))).find(s=>s.id===source.id)!;
   const rows=(await readFile(stored.path,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
   await writeFile(stored.path,rows.filter(row=>!(row.type==='custom'&&row.customType==='coffee-native-settled')).map(row=>JSON.stringify(row)).join('\n')+'\n');
  }
  const resumed=await start(app.root,undefined,true),rt=(await resumed.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
  const result=await(await resumed.call({...base,operation:'get',taskId},'owner',rt,'/api/mishu/runtime')).json();
  const report=result.task.reports[0];expect(report.state).toBe(mode==='revoked'?'cancelled':mode==='promise'||mode==='tool-only'?'uncertain':'committed');
  expect(result.task.acceptance).toBe('pending');
  if(mode!=='promise'&&mode!=='tool-only'&&mode!=='revoked'){
   expect(result.task.notification).toMatchObject({state:'committed',reportId:report.id});
   expect(report.outputs.length).toBeGreaterThan(0);
   const read=new RpcPiSessionFactory({sessionDir:join(app.root,'sessions')});
   const evidence=await read.readRunEvidence(source.id,report.processingId);expect(evidence.entries?.map(({id,revision})=>({id,revision}))).toEqual(report.outputs);
   const history=await read.readHistory(source.id);expect(history.history.entries.filter(e=>e.kind==='user')).toHaveLength(mode==='normal'?1:0);
  }
  expect(calls).toBe(mode==='normal'?3:mode==='tool-attempt'||mode==='tool-only'?2:1);
  if(mode!=='normal')expect(JSON.stringify(requests.flatMap(r=>r.messages.filter((m:any)=>m.role==='tool')))).not.toContain('SYNTHETIC_REPORT_FORBIDDEN_READ');
  expect(await readFile(privatePath,'utf8')).toBe('SYNTHETIC_REPORT_FORBIDDEN_READ');await expect(readFile(privatePath+'.side-effect','utf8')).rejects.toMatchObject({code:'ENOENT'});
  if(mode==='tool-attempt'){const results=requests.at(-1).messages.filter((m:any)=>m.role==='tool');expect(results).toHaveLength(6);for(const result of results)expect(JSON.stringify(result)).toContain('Host report-only run');}
 }finally{socket.close();reply();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}
},30000);


it('fences a competing Host owner and only admits a fresh owner after process death',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-owner-')),lockRoot=join(root,'work','.coffee','mishu');await mkdir(lockRoot,{recursive:true});
 const owner=spawn(process.execPath,['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]);db.exec('BEGIN EXCLUSIVE');console.log('locked');process.stdin.resume();",join(lockRoot,'writer.sqlite')],{stdio:['pipe','pipe','pipe']});
 await once(owner.stdout,'data');
 const app=await start(root),source=await app.workspaces.createChatConversation();
 try{
  expect((await app.call({action:'select',id:source.id,selected:true})).status).toBe(409);
  owner.kill('SIGKILL');await once(owner,'exit');
  // The stale failed owner cannot acquire a new generation or overwrite a successor.
  expect((await app.call({action:'select',id:source.id,selected:true})).status).toBe(409);
  await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
  const fresh=await start(root);expect((await fresh.call({action:'select',id:source.id,selected:true})).status).toBe(200);
 }finally{owner.kill('SIGKILL');}
},30000);


it('defaults event reminders off and rejects model-side reminder grants',async()=>{
 const app=await start(),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 expect(await(await app.call({action:'status',id:source.id})).json()).toMatchObject({notifications:{enabled:false,capacity:20,maxAttempts:1}});
 expect((await app.call({action:'notifications',enabled:true},'owner',token,'/api/mishu/runtime')).status).toBe(409);
});


it.each(['late','disabled','busy','revoked','restart-queued','restart-uncertain','lost-ack','provider-error'] as const)('automatically reports a late observed Pi reply through trusted queue (%s)',async(mode)=>{
 const requests:any[]=[];let finishTarget=()=>{},finishForeground=()=>{},finishReport=()=>{};
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw);requests.push(body);
  const send=(content:string)=>{if(res.writableEnded)return;const f={id:'auto',object:'chat.completion.chunk',created:1,model:'fixture'};res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({...f,choices:[{index:0,delta:{role:'assistant',content},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...f,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};
  if(raw.includes('自动测试目标'))finishTarget=()=>send('LATE_AUTOMATIC_FACT');
  else if(raw.includes('FOREGROUND_BUSY')&&!raw.includes('<task-facts>'))finishForeground=()=>send('FOREGROUND_DONE');
  else if(mode==='provider-error'){res.writeHead(404,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'synthetic model_not_found',code:'model_not_found'}}));}
  else {finishReport=()=>send('进展：LATE_AUTOMATIC_FACT 已完成。\n限制：只验证合成数据，未验收。\n下一步：请查看目标结果。\n来源：Late synthetic task');if(mode!=='lost-ack')finishReport();}
 });
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 const app=await start(undefined,undefined,true,true),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 await mkdir(join(app.root,'pi-home'),{recursive:true});await writeFile(join(app.root,'pi-home','models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as {port:number}).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));await writeFile(join(app.root,'pi-home','settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,true);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN,req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime');
 const sockets:WebSocket[]=[];
 async function open(id:string){const frames:any[]=[];const ws=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});sockets.push(ws);ws.on('message',raw=>{const f=JSON.parse(String(raw));frames.push(f);const e=f.event;if(e?.type==='extension_ui_request'&&e.method==='select'&&e.title.startsWith('MISHU：事件提醒'))ws.send(JSON.stringify({v:1,type:'ui_response',requestId:randomUUID(),id:e.id,value:'开启事件提醒'}));if(e?.type==='extension_ui_request'&&e.method==='confirm')ws.send(JSON.stringify({v:1,type:'ui_response',requestId:randomUUID(),id:e.id,confirmed:true}));});await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);return {ws,frames};}
 try{
  const src=await open(source.id),dst=await open(target.id);
  if(mode!=='disabled'){src.ws.send(JSON.stringify({v:1,type:'prompt',requestId:randomUUID(),text:'/mishu-notifications'}));await expect.poll(async()=> (await(await app.call({action:'status',id:source.id})).json()).notifications.enabled,{timeout:10000}).toBe(true);await expect.poll(()=>src.frames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);}
  dst.ws.send(JSON.stringify({v:1,type:'prompt',requestId:randomUUID(),text:'自动测试目标'}));await expect.poll(()=>requests.length,{timeout:10000}).toBe(1);
  const contact=(await(await req({action:'directory'})).json()).configuredTargets[0],base={action:'tasks',version:1};
  const brief=(await(await req({...base,operation:'register',operationId:'late',targetId:target.id,binding:contact.binding,purpose:'Late synthetic task',scope:'Only fixture',summary:'Follow up',nextStep:'Report'})).json()).task;
  const watched=(await(await req({...base,operation:'observe',operationId:'watch',taskId:brief.taskId,expectedRevision:brief.revision,runId:contact.observation.runId})).json()).task;
  if(mode==='busy'||mode==='revoked'||mode==='restart-queued'||mode==='restart-uncertain'){src.ws.send(JSON.stringify({v:1,type:'prompt',requestId:randomUUID(),text:'FOREGROUND_BUSY'}));await expect.poll(()=>requests.length,{timeout:10000}).toBe(2);}
  finishTarget();await expect.poll(async()=>{const state=JSON.parse(await readFile(join(app.workspaces.root,'.coffee','mishu','state.json'),'utf8'));return state.chats[source.id].taskJournal.tasks[0].observation;},{timeout:10000}).toBe('reply-available');
  if(mode==='disabled'){expect(requests).toHaveLength(1);const task=(await(await req({...base,operation:'get',taskId:brief.taskId})).json()).task;expect(task.fact.text).toContain('LATE_AUTOMATIC_FACT');expect(task.reports).toBeUndefined();return;}
  if(mode==='busy'||mode==='revoked'||mode==='restart-queued'||mode==='restart-uncertain'){
   await expect.poll(()=>src.frames.some(f=>f.type==='queue_state'&&f.items.some((q:any)=>q.readOnly&&q.text==='MISHU 汇报：Late synthetic task')),{timeout:10000}).toBe(true);expect(requests).toHaveLength(2);
   const row=src.frames.filter(f=>f.type==='queue_state').at(-1).items[0];expect(JSON.stringify(row)).not.toContain('processingId');expect(row.text).not.toContain('/mishu-report');
   if(mode==='revoked'){src.ws.send(JSON.stringify({v:1,type:'queue_action',requestId:'stop-notification',id:row.id,revision:row.revision,action:'cancel'}));await expect.poll(async()=>(await(await req({...base,operation:'get',taskId:brief.taskId})).json()).task.workState,{timeout:10000}).toBe('stopped');}
   if(mode==='restart-queued'||mode==='restart-uncertain'){
    for(const s of sockets)s.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
    if(mode==='restart-uncertain'){const file=join(app.workspaces.root,'.coffee','mishu','state.json'),state=JSON.parse(await readFile(file,'utf8'));state.chats[source.id].taskJournal.tasks[0].reports[0].deliveryAttempted=true;await writeFile(file,JSON.stringify(state));}
    const restarted=await start(app.root,undefined,true,true);await restarted.host.mishuRuntime('owner',source.id);
   }else finishForeground();
  }
  if(mode==='restart-uncertain'){const state=JSON.parse(await readFile(join(app.workspaces.root,'.coffee','mishu','state.json'),'utf8'));expect(state.chats[source.id].taskJournal.tasks[0].reports[0].state).toBe('uncertain');expect(requests).toHaveLength(2);return;}
  if(mode==='revoked'){await expect.poll(()=>src.frames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);expect(requests).toHaveLength(2);return;}
  if(mode==='provider-error'){
   await expect.poll(async()=>{const state=JSON.parse(await readFile(join(app.workspaces.root,'.coffee','mishu','state.json'),'utf8'));return state.chats[source.id].taskJournal.tasks[0].reports?.[0]?.state;},{timeout:10000}).toBe('uncertain');
   for(let n=0;n<5;n++)await req({action:'status'});await new Promise(r=>setTimeout(r,250));expect(requests).toHaveLength(2);return;
  }
  if(mode==='lost-ack'){
   await expect.poll(()=>requests.length,{timeout:10000}).toBe(2);
   const temp=join(app.workspaces.root,'.coffee','mishu','state.json.tmp');await mkdir(temp);finishReport();
   await expect.poll(async()=> (await(await req({action:'status'})).json()).tracking.error,{timeout:10000}).toContain('persistence failed');
   for(const s of sockets)s.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);await rm(temp,{recursive:true});
   const restarted=await start(app.root,undefined,true,true);await restarted.host.mishuRuntime('owner',source.id);
  }
  await expect.poll(async()=>{const state=JSON.parse(await readFile(join(app.workspaces.root,'.coffee','mishu','state.json'),'utf8'));return state.chats[source.id].taskJournal.tasks[0].reports?.[0]?.state;},{timeout:10000}).toBe('committed');
  expect(requests).toHaveLength(mode==='busy'||mode==='restart-queued'?3:2);expect(JSON.stringify(requests.at(-1))).not.toContain('"state":"reply-available"');
  if(mode!=='restart-queued')expect(src.frames.some(f=>f.event?.type==='message_end'&&JSON.stringify(f.event).includes('LATE_AUTOMATIC_FACT'))).toBe(true);
 }finally{for(const s of sockets)s.close();finishTarget();finishForeground();finishReport();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));}
},30000);

it.each(['source','target'] as const)('filters stale %s task bindings at public report chooser and exact prepare',async(kind)=>{
 const app=await start(undefined,undefined,true),source=await app.workspaces.createChatConversation(),target=await app.workspaces.createChatConversation();
 const native=SessionManager.create(target.cwd,join(app.root,'sessions'),{id:target.id}),runId=randomUUID();native.appendCustomEntry('coffee-native-run',{version:1,runId});native.appendMessage({role:'user',content:'Synthetic only',timestamp:Date.now()});native.appendMessage({role:'assistant',content:[{type:'text',text:'SYNTHETIC'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});native.appendCustomEntry('coffee-native-settled',{version:1,runId});
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN,req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime'),base={action:'tasks',version:1};const contact=(await(await req({action:'directory'})).json()).configuredTargets[0];
 const task=(await(await req({...base,operation:'register',operationId:'stale',targetId:target.id,binding:contact.binding,purpose:'Private stale task',scope:'Fixture',summary:'Known',nextStep:'Report'})).json()).task;await req({...base,operation:'observe',operationId:'observe',taskId:task.taskId,expectedRevision:1,runId});
 await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const file=join(app.workspaces.root,'.coffee','mishu','state.json'),state=JSON.parse(await readFile(file,'utf8'));state.chats[source.id].taskJournal.tasks[0][kind==='source'?'sourceBinding':'binding']='stale-generation';await writeFile(file,JSON.stringify(state));
 const resumed=await start(app.root,undefined,true),frames:any[]=[],ws=new WebSocket(`ws://127.0.0.1:${resumed.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});ws.on('message',raw=>frames.push(JSON.parse(String(raw))));
 try{await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',sessionId:source.id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);ws.send(JSON.stringify({v:1,type:'prompt',requestId:'stale-list',text:'/mishu-report'}));await expect.poll(()=>frames.some(f=>f.event?.message==='暂无可汇报的原生结果。'),{timeout:10000}).toBe(true);expect(frames.some(f=>f.event?.method==='select')).toBe(false);await expect.poll(()=>frames.some(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBe(true);ws.send(JSON.stringify({v:1,type:'prompt',requestId:'stale-exact',text:'/mishu-report '+task.taskId}));await expect.poll(()=>frames.some(f=>String(f.event?.message??'').startsWith('汇报未能开始')),{timeout:10000}).toBe(true);}finally{ws.close();}
});

it.each((['codex','claude','cursor','grok'] as const).flatMap(engine=>(['completed','interrupted','failed','exit','stale'] as const).map(outcome=>({engine,outcome}))))('tracks exact online $engine work ($outcome) and leaves restart gaps unknown',async({engine,outcome})=>{
 const app=await start(undefined,engine,false,false,undefined,false,[],engine==='codex',outcome),source=await app.workspaces.createChatConversation();
 const seed=join(app.root,'seed'),remote=join(app.root,'remote.git');await mkdir(seed);const git=promisify(execFile);
 const run=(args:string[])=>git('git',['-c','user.name=Test','-c','user.email=test@localhost',...args],{cwd:seed});
 await run(['init','-b','main']);await writeFile(join(seed,'note.txt'),'base');await run(['add','.']);await run(['commit','-m','fixture']);await run(['clone','--bare',seed,remote]);
 const project=await app.workspaces.registerProject('synthetic-project',remote),target=await app.workspaces.createConversation(project.id,undefined,undefined,engine);
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}}),frames:any[]=[];
 socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
 try{
 await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:10000}).toBe(true);
 socket.send(JSON.stringify({v:1,type:'prompt',requestId:'direct-target-user',text:engine==='codex'?'run synthetic read':'track approval'}));
 await expect.poll(()=>frames.some(f=>['extension_ui_request','native_request'].includes(f.event?.type)),{timeout:10000}).toBe(true);
 await app.call({action:'select',id:source.id,selected:true});await setupThroughChat(app,source.id,target.id,false);
 const token=(await app.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN,req=(body:unknown)=>app.call(body,'owner',token,'/api/mishu/runtime');
 const contact=(await(await req({action:'directory'})).json()).configuredTargets[0];
 expect(contact.observation).toMatchObject({supported:true,freshness:'current',state:'running',capabilities:{online:'supported',restartRecovery:'unknown',detachedWriters:'unknown'}});
 const base={action:'tasks',version:1},brief=(await(await req({...base,operation:'register',operationId:'brief',targetId:target.id,binding:contact.binding,purpose:'Track direct work',scope:'One invocation',summary:'Waiting',nextStep:'Report'})).json()).task;
 expect((await req({...base,operation:'observe',operationId:'wrong',taskId:brief.taskId,expectedRevision:1,runId:'unrelated-native-run'})).status).toBe(409);
 if(outcome==='stale'){
  // Inject a native binding replacement while the old adapter still exists.
  (await app.workspaces.lookup(target.id))!.nativeBinding={state:'bound',id:'replacement-native'};
  expect((await req({...base,operation:'observe',operationId:'stale-watch',taskId:brief.taskId,expectedRevision:1,runId:contact.observation.runId})).status).toBe(409);
  await setupThroughChat(app,source.id,target.id,false);
  const replaced=(await(await req({action:'directory'})).json()).configuredTargets[0];expect(replaced.observation).toMatchObject({freshness:'unknown',state:'uncertain'});return;
 }
 const watch=await req({...base,operation:'observe',operationId:'watch',taskId:brief.taskId,expectedRevision:1,runId:contact.observation.runId});expect(watch.status,await watch.clone().text()).toBe(200);expect((await watch.json()).task).toMatchObject({observation:'waiting',acceptance:'pending'});
 expect((await(await req({action:'status'})).json()).tracking.replies).toBe(0);
 const question=frames.find(f=>['extension_ui_request','native_request'].includes(f.event?.type)).event;
 socket.send(JSON.stringify({v:1,type:'ui_response',requestId:'user-target-answer',id:question.id,...(engine==='codex'?{confirmed:true}:{value:'allow'})}));
 const get={...base,operation:'get',taskId:brief.taskId};
 if(outcome!=='completed'){
  const expected=outcome==='exit'||(outcome==='failed'&&(engine==='cursor'||engine==='grok'))?'uncertain':'incomplete';
  await expect.poll(async()=>(await(await req(get)).json()).task.observation,{timeout:10000}).toBe(expected);
  const failed=(await(await req(get)).json()).task;expect(failed.acceptance).toBe('pending');expect(failed.obligation.runId).toBe(contact.observation.runId);
  expect((await(await req({action:'status'})).json()).tracking.replies).toBe(0);return;
 }
 await expect.poll(async()=>((await(await req({action:'status'})).json()).tracking.replies),{timeout:10000}).toBe(1);
 const result=(await(await req(get)).json()).task;
 expect(result).toMatchObject({observation:'reply-available',acceptance:'pending'});expect(result.fact.entries.length).toBeGreaterThan(0);
 expect(result.fact.entries[0].id.startsWith('host-live:')).toBe(engine==='cursor'||engine==='grok');
 const offset=frames.length;socket.send(JSON.stringify({v:1,type:'prompt',requestId:'unrelated-later',text:'Unrelated work'}));
 await expect.poll(()=>frames.slice(offset).some(f=>['agent_settled','run_completed'].includes(f.event?.type)),{timeout:10000}).toBe(true);
 expect((await(await req(get)).json()).task.fact).toEqual(result.fact);
 socket.close();await app.host.close();hosts.splice(hosts.indexOf(app.host),1);
 const recovered=await start(app.root,engine,false,false,undefined,false,[],engine==='codex'),newToken=(await recovered.host.mishuRuntime('owner',source.id)).env.PI_COFFEE_MISHU_TOKEN;
 const restored=(await(await recovered.call(get,'owner',newToken,'/api/mishu/runtime')).json()).task;
 expect(restored).toMatchObject({observation:'uncertain',fact:result.fact,acceptance:'pending'});
 }finally{socket.close();}
},30000);
