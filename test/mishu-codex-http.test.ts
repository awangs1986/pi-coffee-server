import {execFileSync} from 'node:child_process';
import {afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {randomUUID,createHash} from 'node:crypto';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function bench(){
 const root=await mkdtemp(join(tmpdir(),'mishu-codex-source-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));
 const workspaces=new Workspaces(join(root,'work')),other=new Workspaces(join(root,'other'));
 const cli=join(root,'codex');await writeFile(cli,`#!/bin/sh\nexec "${process.execPath}" "${resolve('test/fixtures/fake-codex-app-server.mjs')}" "$@"\n`,{mode:0o755});
 let host:HostServer;
 const home=join(root,'native'),pi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions'),cwdForSession:id=>workspaces.file(id,'')});
 const factory=new NativeAgentFactory({pi,workspaces,codex:{command:process.execPath,args:[resolve('test/fixtures/fake-codex.mjs')]},codexSessionFactory:(id,cwd,onBound)=>new CodexSessionFactory({cwd,cliPath:cli,codexHome:home,model:'gpt-6-luna',env:{FAKE_DEVELOPER_INSTRUCTIONS:'PRESERVE_NATIVE_USER_GUIDANCE'},mappingFile:join(root,'mapping',id+'.json'),mishuContext:async()=>{const task=await workspaces.lookupByCwd(cwd);return task?host.mishuSourceContext('owner',task.id):undefined;},onBound:async(_,nativeId)=>onBound(nativeId)})});
 host=new HostServer({port:0,token:'synthetic-host',requireUser:true,factory,workspaces,scopeForUser:user=>({factory,workspaces:user==='owner'?workspaces:other})});await host.start();cleanups.push(()=>host.close());
 const call=(body:unknown,user='owner',token='synthetic-host',path='/api/mishu')=>fetch(`http://127.0.0.1:${host.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer '+token,'x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});
 async function open(id:string){const frames:any[]=[],socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer synthetic-host','x-pi-coffee-user':'owner'}});cleanups.push(async()=>{socket.close();});socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));await expect.poll(()=>frames.find(f=>f.type==='opened'||f.type==='error'),{timeout:5000}).toMatchObject({type:'opened'});
  async function prompt(text:string,hold=false){const offset=frames.length,requestId=randomUUID();socket.send(JSON.stringify({v:1,type:'prompt',requestId,text}));await expect.poll(()=>frames.slice(offset).some(f=>f.type==='error'||f.event?.type===(hold?'tool_execution_end':'agent_settled')),{timeout:10000}).toBe(true);const current=frames.slice(offset);expect(current.filter(f=>f.type==='error')).toEqual([]);return current;}
  return {socket,frames,prompt};
 }
 return {root,home,workspaces,host,call,open};
}
it('enables the same Codex Luna thread, preserves native guidance, contacts a real target and rejects stale/source-forged tool grants',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex'),target=await b.workspaces.createChatConversation();
 let channel=await b.open(source.id);await channel.prompt('Materialize synthetic Codex conversation');
 const before=(await b.workspaces.lookup(source.id))!.nativeBinding!.id;
 expect((await b.call({action:'select',id:source.id,selected:true},'other')).status).toBe(409);
 const selected=await b.call({action:'select',id:source.id,selected:true});expect(selected.status,await selected.clone().text()).toBe(200);
 channel=await b.open(source.id);await channel.prompt('Who are you?');
 let guidance=JSON.parse(await readFile(join(b.home,'fake-guidance.json'),'utf8'));expect(guidance).toContain('你是 MISHU');expect(guidance).toContain('尚未启用');expect(guidance).toContain('PRESERVE_NATIVE_USER_GUIDANCE');
 const status=await (await b.call({action:'status',id:source.id})).json();expect(status).toMatchObject({selected:true,enabled:false,source:{coordination:'supported',reports:'unavailable',reportOutputRecovery:'unavailable'},notifications:{available:false,enabled:false}});
 const setup=await (await b.call({action:'setup_open',id:source.id})).json(),row=setup.conversations.find((r:any)=>r.id===target.id);
 expect((await b.call({action:'setup_confirm',id:source.id,ticket:setup.ticket,targets:[{id:row.id,binding:row.binding}],allowInstructions:false})).status).toBe(200);
 expect((await b.call({action:'setup_confirm',id:source.id,ticket:setup.ticket,targets:[row],allowInstructions:true})).status).toBe(409);
 const sent=await channel.prompt('mishu-call:'+JSON.stringify({action:'send',targetId:row.id,binding:row.binding,messageId:'synthetic-message',kind:'information-only',text:'Reply with TARGET_RECEIPT_OK'}));
 expect(sent.find(f=>f.event?.type==='tool_execution_end')?.event.isError).toBe(false);
 const inbox=await channel.prompt('mishu-call:'+JSON.stringify({action:'inbox'}));expect(JSON.stringify(inbox)).toContain('synthetic-message');
 guidance=JSON.parse(await readFile(join(b.home,'fake-guidance.json'),'utf8'));expect(guidance).toContain('协调已启用');expect(guidance.match(/你是 MISHU/g)).toHaveLength(1);expect(guidance).not.toContain('PI_COFFEE_MISHU_TOKEN');
 const persisted=JSON.parse(await readFile(join(b.home,'fake-threads.json'),'utf8'));expect(persisted[before].model).toBe('gpt-6-luna');expect((await b.workspaces.lookup(source.id))!.nativeBinding!.id).toBe(before);
 await channel.prompt('mishu-hold:'+JSON.stringify({action:'status'}),true);
 const config=JSON.parse(await readFile(join(b.home,'fake-context.json'),'utf8')),token=config.mcp_servers.coffee_mishu.env.PI_COFFEE_MISHU_TOKEN;
 const runtime=(input:unknown)=>b.call(input,'owner',token,'/api/mishu/runtime');
 expect((await runtime({action:'setup',targets:[row],allowInstructions:true})).status).toBe(409);
 expect((await runtime({action:'tasks',version:1,operation:'list',sourceRunId:'forged-user-run'})).status).toBe(409);
 expect((await runtime({action:'report',operation:'list'})).status).toBe(409);
 const offset=channel.frames.length;channel.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'source-steering',mode:'steer',text:'An active source cannot change its grant through steering'}));await expect.poll(()=>channel.frames.slice(offset).find(f=>f.type==='error'&&f.requestId==='source-steering')).toMatchObject({code:'operation_failed'});
 expect((await runtime({action:'status'})).status).toBe(200);
 let release!:()=>void,entered!:()=>void;const paused=new Promise<void>(resolve=>release=resolve),atTarget=new Promise<void>(resolve=>entered=resolve),lookup=b.workspaces.lookup.bind(b.workspaces);let armed=true;
 b.workspaces.lookup=async id=>{if(id===target.id&&armed){armed=false;entered();await paused;}return lookup(id);};
 const late=runtime({action:'send',messageId:'expired-admission',targetId:row.id,binding:row.binding,kind:'information-only',text:'Must not be admitted after expiration'});
 await atTarget;
 await writeFile(join(b.home,'allow-mishu-terminal'),'');await expect.poll(()=>channel.frames.filter(f=>f.event?.type==='agent_settled').length,{timeout:5000}).toBeGreaterThanOrEqual(4);
 await expect.poll(async()=>(await runtime({action:'status'})).status).toBe(401);release();expect((await late).status).toBe(409);
 expect((await b.call({action:'inspect',id:source.id,operation:'disable'})).status).toBe(200);
 await channel.prompt('Explain your current role after disable');guidance=JSON.parse(await readFile(join(b.home,'fake-guidance.json'),'utf8'));expect(guidance).toContain('尚未启用');expect(JSON.parse(await readFile(join(b.home,'fake-context.json'),'utf8')).mcp_servers.coffee_mishu.enabled).toBe(false);
 const disabledSend=await channel.prompt('mishu-call:'+JSON.stringify({action:'send',targetId:row.id,binding:row.binding,messageId:'disabled-message',kind:'information-only',text:'Denied'}));expect(disabledSend.find(f=>f.event?.type==='tool_execution_end')?.event.isError).toBe(true);
 expect((await b.call({action:'select',id:source.id,selected:false})).status).toBe(200);channel=await b.open(source.id);await channel.prompt('Normal Codex conversation');expect(JSON.parse(await readFile(join(b.home,'fake-guidance.json'),'utf8'))).not.toContain('MISHU');
},30000);
it('rejects unmaterialized Codex selection and native slash prompts rather than replacing a thread or asking the model to grant access',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex');const channel=await b.open(source.id);
 const denied=await b.call({action:'select',id:source.id,selected:true});expect(denied.status).toBe(409);expect((await denied.json()).error).toContain('原生记录');
 const offset=channel.frames.length;channel.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'direct-setup',text:'/mishu-setup'}));await expect.poll(()=>channel.frames.slice(offset).find(f=>f.type==='error')).toMatchObject({requestId:'direct-setup'});
 expect((await (await b.call({action:'status',id:source.id})).json()).enabled).toBe(false);
},15000);
it('registers and observes a Codex target run in the shared Host ledger while durable Codex dispatch stays unavailable',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex'),target=await b.workspaces.createChatConversation(undefined,'codex');
 let secretary=await b.open(source.id);await secretary.prompt('Save secretary native conversation');const targetChannel=await b.open(target.id);await targetChannel.prompt('Save target native run');
 expect((await b.call({action:'select',id:source.id,selected:true})).status).toBe(200);secretary=await b.open(source.id);
 const setup=await (await b.call({action:'setup_open',id:source.id})).json(),contact=setup.conversations.find((c:any)=>c.id===target.id);
 expect((await b.call({action:'setup_confirm',id:source.id,ticket:setup.ticket,targets:[contact],allowInstructions:true})).status).toBe(200);
 const ask=(input:unknown)=>secretary.prompt('mishu-call:'+JSON.stringify(input));
 function output(frames:any[]){const tool=frames.find(f=>f.event?.type==='tool_execution_end')?.event;expect(tool?.isError).toBe(false);const result=JSON.parse(tool.result.content[0].text);return JSON.parse(result.content[0].text);}
 const registered=output(await ask({action:'tasks',version:1,operation:'register',operationId:'codex-registration',targetId:target.id,binding:contact.binding,purpose:'Observe current Codex run',scope:'Read-only evidence',summary:'Current target task',nextStep:'Read native result'}));
 const current=output(await ask({action:'directory'})).configuredTargets.find((c:any)=>c.id===target.id);expect(current.observation.capabilities.restartRecovery).toBe('unknown');expect(current.observation.dispatchSupported).toBe(false);
 const dispatch=await ask({action:'tasks',version:1,operation:'dispatch',taskId:registered.task.taskId,expectedRevision:registered.task.revision,messageId:'unsupported-dispatch',text:'Do a synthetic authorized task',authorizationRef:'User explicitly asked'});expect(dispatch.find(f=>f.event?.type==='tool_execution_end')?.event.isError).toBe(true);
 const observed=output(await ask({action:'tasks',version:1,operation:'observe',operationId:'codex-observation',taskId:registered.task.taskId,expectedRevision:registered.task.revision,runId:current.observation.runId}));expect(observed.task.obligation.runId).toBe(current.observation.runId);expect(observed.task.observation).toBe('reply-available');
 const display=await (await b.call({action:'inspect',id:source.id,operation:'tasks'})).json();expect(display.tasks[0]).toMatchObject({taskId:registered.task.taskId,observation:'reply-available'});
 const snapshot=JSON.parse(await readFile(join(b.workspaces.root,'.coffee','mishu','state.json'),'utf8'));expect(snapshot.chats[source.id].taskJournal.tasks[0].taskId).toBe(registered.task.taskId);
 const stopped=output(await ask({action:'tasks',version:1,operation:'stop',operationId:'stop-codex-observation',taskId:registered.task.taskId,expectedRevision:display.tasks[0].revision}));expect(stopped.task.workState).toBe('stopped');
},20000);

it('restores original native identity after inventory failure between role application and a model turn',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex'),target=await b.workspaces.createChatConversation();
 let channel=await b.open(source.id);await channel.prompt('Save source before role installation');const native=(await b.workspaces.lookup(source.id))!.nativeBinding!.id!;
 expect((await b.call({action:'select',id:source.id,selected:true})).status).toBe(200);channel=await b.open(source.id);
 const setup=await (await b.call({action:'setup_open',id:source.id})).json(),contact=setup.conversations.find((c:any)=>c.id===target.id);expect((await b.call({action:'setup_confirm',id:source.id,ticket:setup.ticket,targets:[contact],allowInstructions:false})).status).toBe(200);
 await writeFile(join(b.home,'mishu-inventory-unavailable'),'');const offset=channel.frames.length;channel.socket.send(JSON.stringify({v:1,type:'prompt',requestId:'failed-inventory',text:'Inventory must fail before model starts'}));await expect.poll(()=>channel.frames.slice(offset).find(f=>f.type==='error')).toMatchObject({requestId:'failed-inventory'});
 const prefs=JSON.parse(await readFile(join(b.root,'mapping','codex-context',createHash('sha256').update(native).digest('hex')+'.json'),'utf8'));expect(prefs.mishuRole).toBe(true);
 expect((await b.call({action:'select',id:source.id,selected:false})).status).toBe(200);channel=await b.open(source.id);await channel.prompt('Explain your original native role');const guidance=JSON.parse(await readFile(join(b.home,'fake-guidance.json'),'utf8'));expect(guidance).toContain('NATIVE_BASE_ORIGINAL');expect(guidance).not.toContain('MISHU');expect((await b.workspaces.lookup(source.id))!.nativeBinding!.id).toBe(native);
},15000);

it('supports an existing Codex Work secretary through the same scoped setup without creating a Pi secretary',async()=>{
 const b=await bench(),seed=join(b.root,'seed');await mkdir(seed);const git=(args:string[])=>execFileSync('git',['-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@localhost',...args],{cwd:seed,stdio:'ignore'});
 git(['init','-b','main']);await writeFile(join(seed,'note.txt'),'Synthetic repository');git(['add','.']);git(['commit','-m','fixture']);const remote=join(b.root,'remote.git');git(['clone','--bare',seed,remote]);
 const project=await b.workspaces.registerProject('codex-secretary-fixture',remote),source=await b.workspaces.createConversation(project.id,undefined,undefined,'codex'),target=await b.workspaces.createChatConversation();let channel=await b.open(source.id);await channel.prompt('Native Codex Work seed');const native=(await b.workspaces.lookup(source.id))!.nativeBinding!.id;
 expect((await b.call({action:'select',id:source.id,selected:true})).status).toBe(200);channel=await b.open(source.id);const setup=await (await b.call({action:'setup_open',id:source.id})).json(),contact=setup.conversations.find((c:any)=>c.id===target.id);expect((await b.call({action:'setup_confirm',id:source.id,ticket:setup.ticket,targets:[contact],allowInstructions:false})).status).toBe(200);await channel.prompt('Who is your current application role?');
 expect(JSON.parse(await readFile(join(b.home,'fake-guidance.json'),'utf8'))).toContain('你是 MISHU');expect((await b.workspaces.lookup(source.id))!.nativeBinding!.id).toBe(native);expect((await b.workspaces.lookup(source.id))!.workspaceKind).toBe('project');expect((await (await b.call({action:'status',id:source.id})).json()).enabled).toBe(true);
},15000);
