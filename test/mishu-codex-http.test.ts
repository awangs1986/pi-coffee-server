import {afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {randomUUID,createHash} from 'node:crypto';
import {MishuCoordinator} from '../src/host/mishu.js';
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
 async function open(id:string){const frames:any[]=[],socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer synthetic-host','x-pi-coffee-user':'owner'}});cleanups.push(async()=>{socket.close();});socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));await expect.poll(()=>frames.some(f=>f.type==='opened'||f.type==='error'),{timeout:4000}).toBe(true);expect(frames.find(f=>f.type==='opened'||f.type==='error')).toEqual(expect.objectContaining({type:'opened'}));
  async function prompt(text:string,hold=false){const offset=frames.length,requestId=randomUUID();socket.send(JSON.stringify({v:1,type:'prompt',requestId,text}));await expect.poll(()=>frames.slice(offset).some(f=>f.type==='error'||f.event?.type===(hold?'tool_execution_end':'agent_settled')),{timeout:10000}).toBe(true);const current=frames.slice(offset);expect(current.filter(f=>f.type==='error')).toEqual([]);return current;}
  return {socket,frames,prompt};
 }
 return {root,home,workspaces,host,call,open};
}

it('rejects Codex as secretary without creating a native thread; Pi remains eligible',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex');
 const before=(await b.workspaces.lookup(source.id))!.nativeBinding;
 for(const action of ['select','setup_open','status']){
  const r=await b.call({action,id:source.id,selected:true});expect(r.status).toBe(409);expect((await r.json()).error).toMatch(/Pi Chat/);
 }
 expect(await b.host.mishuSourceContext('owner',source.id)).toBeUndefined();
 expect((await b.workspaces.lookup(source.id))!.nativeBinding).toEqual(before);
 await expect(readFile(join(b.home,'fake-threads.json'))).rejects.toMatchObject({code:'ENOENT'});
 const pi=await b.workspaces.createChatConversation();expect((await b.call({action:'select',id:pi.id,selected:true})).status).toBe(200);
});

it('keeps ordinary Codex messaging and its model after secretary selection is rejected',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex'),channel=await b.open(source.id);await channel.prompt('Native seed');
 const id=(await b.workspaces.lookup(source.id))!.nativeBinding!.id;
 expect((await b.call({action:'select',id:source.id,selected:true})).status).toBe(409);
 await channel.prompt('Ordinary next turn');expect((await b.workspaces.lookup(source.id))!.nativeBinding!.id).toBe(id);
});

it('retires persisted non-Pi secretary grants while retaining audit contacts and Pi selection',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-retirement-'));cleanups.push(()=>rm(root,{recursive:true,force:true}));
 const ws=new Workspaces(join(root,'work')),codex=await ws.createChatConversation(undefined,'codex'),pi=await ws.createChatConversation();
 const store=join(root,'state');await mkdir(store);const file=join(store,'state.json');
 const config={selected:true,enabled:true,allowInstructions:true,notifications:true,sourceBinding:'old-binding',targets:[],messages:[]};
 const original=JSON.stringify({version:2,chats:{[codex.id]:config,[pi.id]:{...config,enabled:false,notifications:false}}});await writeFile(file,original);
 const coordinator=new MishuCoordinator(store,ws,new Set());cleanups.push(()=>coordinator.close());
 await coordinator.recoveryReady();await expect(coordinator.status(codex.id)).rejects.toThrow('Pi Chat');
 const saved=JSON.parse(await readFile(file,'utf8'));
 expect(saved.chats[codex.id]).toMatchObject({selected:false,enabled:false,allowInstructions:false,notifications:false,notificationGeneration:1,targets:[],messages:[]});
 expect(saved.chats[pi.id].selected).toBe(true);
 expect(await readFile(join(store,'state.before-pi-only.'+createHash('sha256').update(original).digest('hex')+'.json'),'utf8')).toBe(original);
});

it('resumes a legacy Codex secretary as ordinary Codex with its model, binding and native guidance preserved',async()=>{
 const b=await bench(),source=await b.workspaces.createChatConversation(undefined,'codex');
 // Simulate a durable pre-upgrade native thread and saved adapter preference.
 await mkdir(b.home,{recursive:true});const nativeId=randomUUID(),task=(await b.workspaces.lookup(source.id))!;
 await b.workspaces.setNativeBinding(source.id,{state:'bound',id:nativeId});
 const rollout=join(b.home,'rollouts',nativeId+'.jsonl');await mkdir(join(b.home,'rollouts'));
 await writeFile(rollout,JSON.stringify({type:'session_meta',payload:{id:nativeId,cwd:task.cwd,base_instructions:{text:'NATIVE_BASE_ORIGINAL\n\n<pi_coffee_mishu_role>\nOLD_ROLE'}}})+'\n');
 await writeFile(join(b.home,'fake-threads.json'),JSON.stringify({[nativeId]:{id:nativeId,cwd:task.cwd,createdAt:1,updatedAt:1,turns:[{id:'old-turn',status:'completed',items:[{id:'old-user',type:'userMessage',content:[{type:'text',text:'old message'}]}]}],model:'preserved-model',effort:'medium'}}));
 const preferences=join(b.root,'mapping','codex-context');await mkdir(preferences,{recursive:true});
 await writeFile(join(preferences,createHash('sha256').update(nativeId).digest('hex')+'.json'),JSON.stringify({mishuRole:true,preset:'272k',model:'preserved-model',reasoningEffort:'medium'}));
 const channel=await b.open(source.id);
 expect(JSON.parse(await readFile(join(b.home,'fake-context.json'),'utf8')).mcp_servers.coffee_mishu.enabled).toBe(false);
 const thread=JSON.parse(await readFile(join(b.home,'fake-threads.json'),'utf8'))[nativeId];
 expect(thread.model).toBe('preserved-model');expect(thread.baseInstructions).toBe('NATIVE_BASE_ORIGINAL');
 await channel.prompt('Ordinary resumed message');expect((await b.workspaces.lookup(source.id))!.nativeBinding!.id).toBe(nativeId);
});
