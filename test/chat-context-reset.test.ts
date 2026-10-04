import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';import {createServer} from 'node:http';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';import {NativeAgentFactory} from '../src/host/native/factory.js';import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
it('clears Pi Chat native context without replay, preserves settings/files, and resumes the empty binding after restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-chat-reset-')),agent=join(root,'agent'),store=join(root,'sessions');await mkdir(agent);await mkdir(store);
 const requests:any[]=[];const model=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'FRESH_REPLY'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));
 let host:HostServer|undefined;const sessions:any[]=[];
 try{
  await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(model.address() as any).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:true,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));await writeFile(join(agent,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
  const extension=join(root,'jobs.mjs');await writeFile(extension,`export default pi=>pi.registerCommand('coffee-workspace-jobs',{handler:async args=>{pi.appendEntry('coffee-workspace-jobs',{nonce:args.trim(),known:true,active:0});}});`);
  let ws=new Workspaces(join(root,'work'),{taskRoot:join(root,'tasks')});const task=await ws.createChatConversation();await writeFile(join(task.cwd,'keep.txt'),'attachment remains');
  const old=SessionManager.create(task.cwd,store,{id:task.id});old.appendModelChange('fixture','fixture');old.appendThinkingLevelChange('high');old.appendSessionInfo('Keep my title');old.appendMessage({role:'user',content:'OLD_CONTEXT_SECRET_MARKER',timestamp:Date.now()});old.appendMessage({role:'assistant',content:[{type:'text',text:'Old answer'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
  const before=await readFile(old.getSessionFile()!,'utf8');
  const make=()=>new NativeAgentFactory({workspaces:ws,pi:new RpcPiSessionFactory({agentDir:agent,cwd:task.cwd,sessionDir:store,provider:'fixture',model:'fixture',cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),extensions:[extension],args:['--offline'],cwdForSession:id=>ws.file(id,''),envForSession:id=>ws.runtimeEnvironment(id)})});
  let factory=make();host=new HostServer({port:0,token:'fixture',requireUser:true,factory,workspaces:ws,scopeForUser:user=>({factory,workspaces:user==='owner'?ws:new Workspaces(join(root,'other-user'))})});await host.start();
  const call=async(body:any,token='fixture',user='owner')=>fetch(`http://127.0.0.1:${host!.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer '+token,'x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});
  const body={action:'clear_chat_context',id:task.id,operationId:randomUUID(),expectedNativeId:task.id};
  expect((await call(body,'wrong')).status).toBe(401);
  expect((await call(body,'fixture','other')).status).toBe(409);
  expect((await call({...body,operationId:'invalid'})).status).toBe(409);
  const mutable=(await ws.lookup(task.id))!;mutable.workspaceKind='project';expect((await call(body)).status).toBe(409);mutable.workspaceKind='chat';
  mutable.engine='codex';expect((await call(body)).status).toBe(409);mutable.engine='pi';
  await ws.archive(task.id,true);expect((await call(body)).status).toBe(409);await ws.archive(task.id,false);

  const response=await call(body);expect(response.status,await response.clone().text()).toBe(200);
  const reset=await ws.lookup(task.id);expect(reset?.nativeBinding?.id).not.toBe(task.id);expect(reset?.retainedNativeIds).toContain(task.id);expect(reset?.cwd).toBe(task.cwd);expect(requests).toHaveLength(0);
  expect((await call(body)).status).toBe(200);expect((await ws.lookup(task.id))?.nativeBinding?.id).toBe(reset!.nativeBinding!.id);
  expect((await call({...body,operationId:randomUUID()})).status).toBe(409);
  expect((await readFile(old.getSessionFile()!,'utf8')).startsWith(before)).toBe(true);expect(await readFile(join(task.cwd,'keep.txt'),'utf8')).toBe('attachment remains');
  await host.close();ws=new Workspaces(join(root,'work'),{taskRoot:join(root,'tasks')});factory=make();
  const resumed=await factory.create({sessionId:task.id});sessions.push(resumed);expect((await resumed.getHistory()).entries.filter(e=>['user','assistant','tool'].includes(e.kind))).toEqual([]);
  expect(await resumed.getModels()).toMatchObject({current:{provider:'fixture',id:'fixture'},thinkingLevel:'high'});
  const listed=await factory.list();expect(listed.filter(s=>s.id===task.id)).toHaveLength(1);expect(listed.some(s=>s.id===reset!.nativeBinding!.id)).toBe(false);expect(listed.find(s=>s.id===task.id)?.name).toBe('Keep my title');
  await resumed.prompt('NEW_CONTEXT_ONLY');await expect.poll(async()=>(await resumed.getHistory()).entries.some(e=>e.kind==='assistant'&&e.text==='FRESH_REPLY'),{timeout:10000}).toBe(true);
  expect(JSON.stringify(requests)).toContain('NEW_CONTEXT_ONLY');expect(JSON.stringify(requests)).not.toContain('OLD_CONTEXT_SECRET_MARKER');
 }finally{for(const s of sessions)await s.stop();await host?.close();model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},30000);
