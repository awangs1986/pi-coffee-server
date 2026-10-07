import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {expect,it} from 'vitest';
import {WebSocket} from 'ws';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it.each(['ordinary','reset-with-messages','reset-empty'] as const)(
 'preserves native Pi model and thinking on WS reopening of %s despite conflicting Host defaults',async kind=>{
  const root=await mkdtemp(join(tmpdir(),'coffee-pi-model-recovery-')),agent=join(root,'agent'),store=join(root,'sessions');
  let host:HostServer|undefined,socket:WebSocket|undefined;
  const requestedModels:unknown[]=[];
  const provider=createServer(async(req,res)=>{
   let raw='';for await(const chunk of req)raw+=chunk;
   requestedModels.push(JSON.parse(raw).model);
   res.writeHead(200,{'content-type':'text/event-stream'});
   res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'selected',choices:[{index:0,delta:{role:'assistant',content:'Synthetic continuation'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'selected',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
  try{
   await mkdir(agent);await mkdir(store);
   const address=provider.address();if(!address||typeof address==='string')throw new Error('Provider fixture did not start');
   await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',apiKey:'synthetic',models:['default','selected'].map(id=>({id,name:id,reasoning:true,input:['text'],contextWindow:128000,maxTokens:1024}))}}}));
   let workspaces=new Workspaces(join(root,'work'),{taskRoot:join(root,'tasks')});
   const task=await workspaces.createChatConversation();
   const nativeId=kind==='ordinary'?task.id:randomUUID();
   const saved=SessionManager.create(task.cwd,store,{id:nativeId});
   saved.appendModelChange('fixture','selected');saved.appendThinkingLevelChange('high');
   if(kind!=='reset-empty'){
    saved.appendMessage({role:'user',content:'Synthetic question',timestamp:Date.now()});
    saved.appendMessage({role:'assistant',content:[{type:'text',text:'Synthetic finished answer'}],api:'openai-completions',provider:'fixture',model:'selected',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
   }
   // Pi buffers a brand-new empty store; a reset binding already has a durable file.
   if(kind==='reset-empty')await writeFile(saved.getSessionFile()!,[saved.getHeader(),...saved.getEntries()].map(entry=>JSON.stringify(entry)).join('\n')+'\n');
   if(kind!=='ordinary')await workspaces.commitContextReset(task.id,{id:randomUUID(),expectedNativeId:task.id},nativeId);
   const start=async()=>{
    const pi=new RpcPiSessionFactory({agentDir:agent,cwd:task.cwd,sessionDir:store,provider:'fixture',model:'default',cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),args:['--offline','--no-extensions','--no-skills','--no-tools','--no-context-files'],cwdForSession:id=>workspaces.file(id,''),envForSession:id=>workspaces.runtimeEnvironment(id)});
    const factory=new NativeAgentFactory({pi,workspaces});
    host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
   };
   const open=async(id:string)=>{
    socket=new WebSocket(`ws://127.0.0.1:${host!.address().port}/host`,{headers:{authorization:'Bearer fixture'}});
    const frames:any[]=[];socket.on('message',raw=>frames.push(JSON.parse(String(raw))));await once(socket,'open');
    socket.send(JSON.stringify({v:1,type:'open',sessionId:id}));
    await expect.poll(()=>frames.some(f=>f.type==='history'||f.type==='error')).toBe(true);
    expect(frames.find(f=>f.type==='error')).toBeUndefined();
    socket.send(JSON.stringify({v:1,type:'get_models',requestId:'models'}));
    await expect.poll(()=>frames.find(f=>f.requestId==='models')).toBeTruthy();
    return frames.find(f=>f.requestId==='models');
   };
   await start();
   expect(await open(task.id)).toMatchObject({type:'models',current:{provider:'fixture',id:'selected'},thinkingLevel:'high'});
   socket!.close();await host!.close();
   workspaces=new Workspaces(join(root,'work'),{taskRoot:join(root,'tasks')});await start();
   expect(await open(task.id)).toMatchObject({type:'models',current:{provider:'fixture',id:'selected'},thinkingLevel:'high'});
   expect(requestedModels).toEqual([]); // Opening does not replay or generate a turn.
   socket!.send(JSON.stringify({v:1,type:'prompt',text:'Synthetic continuation',requestId:'continue'}));
   await expect.poll(async()=>{
    const history=await SessionManager.open(saved.getSessionFile()!).buildSessionContext();
    return history.messages.some(m=>m.role==='assistant'&&m.content.some(c=>c.type==='text'&&c.text==='Synthetic continuation'));
   }).toBe(true);
   expect(requestedModels).toEqual(['selected']); // The actual provider request, not the menu label.
   socket!.close();
   const fresh=await workspaces.createChatConversation();
   expect(await open(fresh.id)).toMatchObject({type:'models',current:{provider:'fixture',id:'default'}});
  }finally{socket?.close();await host?.close();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await rm(root,{recursive:true,force:true});}
 });
