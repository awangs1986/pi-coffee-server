import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
const roots:string[]=[],hosts:HostServer[]=[];
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
async function start(root?:string,engine?:'codex'|'claude'|'cursor'|'grok',nativePi=false){
 root??=await mkdtemp(join(tmpdir(),'coffee-mishu-'));roots.push(root);
 const workspaces=new Workspaces(join(root,'work'));
 let host:HostServer;
 const fixturePi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions'),cwdForSession:id=>workspaces.file(id,'')});
 const realPi=new RpcPiSessionFactory({agentDir:join(root,'pi-home'),sessionDir:join(root,'sessions'),args:['--no-extensions','--offline'],cwdForSession:id=>workspaces.file(id,''),extensionsForSession:async id=>(await host.mishuRuntime('owner',id)).extensions,envForSession:async id=>(await host.mishuRuntime('owner',id)).env});
 const pi={create:async(options:{sessionId:string})=>(nativePi||(await host.mishuRuntime('owner',options.sessionId)).extensions.length?realPi:fixturePi).create(options),list:()=>realPi.list(),readHistory:(id:string)=>realPi.readHistory(id),delete:(id:string)=>realPi.delete(id)};
 const command=engine?{command:process.execPath,args:[resolve('test/fixtures/fake-'+(engine==='grok'?'cursor':engine)+'.mjs')],env:{CLAUDE_CONFIG_DIR:join(root,'native'),...(engine==='grok'?{FIXTURE_GROK:'1'}:{})}}:undefined;
 const factory=engine?new NativeAgentFactory({pi,workspaces,[engine]:command}):pi;
 const other=new Workspaces(join(root,'other'));
 host=new HostServer({port:0,token:'host-test',requireUser:true,factory,workspaces,scopeForUser:user=>({factory,workspaces:user==='owner'?workspaces:other})});hosts.push(host);await host.start();
 const call=(body:unknown,user='owner',token='host-test',path='/api/mishu')=>fetch(`http://127.0.0.1:${host.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer '+token,'x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});
 return {root,workspaces,host,call};
}

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

async function setupThroughChat(app:Awaited<ReturnType<typeof start>>,sourceId:string,targetId:string,allow:boolean){
 const socket=new WebSocket(`ws://127.0.0.1:${app.host.address().port}/host`,{headers:{authorization:'Bearer host-test','x-pi-coffee-user':'owner'}});
 const frames:any[]=[];let chosen=false;
 socket.on('message',raw=>{const f=JSON.parse(String(raw));frames.push(f);const e=f.event;if(e?.type!=='extension_ui_request')return;
  if(e.method==='select'){
   const value=e.title.includes('消息权限')?e.options[allow?1:0]:chosen?e.options.find((v:string)=>v.startsWith('完成选择')):e.options.find((v:string)=>v.includes(targetId));
   if(!e.title.includes('消息权限'))chosen=true;
   socket.send(JSON.stringify({v:1,type:'ui_response',requestId:'answer-'+e.id,id:e.id,value}));
  }else if(e.method==='confirm')socket.send(JSON.stringify({v:1,type:'ui_response',requestId:'answer-'+e.id,id:e.id,confirmed:true}));
 });
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:sourceId,nativeProtocol:1}));
  await expect.poll(()=>frames.some(f=>f.type==='opened'||f.type==='error'),{timeout:10000}).toBe(true);
  expect(frames.find(f=>f.type==='opened'||f.type==='error')).toMatchObject({type:'opened'});
  socket.send(JSON.stringify({v:1,type:'prompt',requestId:'explicit-setup-'+randomUUID(),text:'/mishu-setup'}));
  await expect.poll(async()=>{const value=await (await app.call({action:'status',id:sourceId})).json();return value.enabled?true:frames.filter(f=>f.type==='error'||f.event?.method==='notify');},{timeout:10000}).toBe(true);
 }finally{socket.close();}
}

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
