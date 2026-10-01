import {it,expect} from 'vitest';
const environment='You are running on a Linux server and the user interacts with you through a Web interface; before bulk deletion, overwriting data without a backup, interrupting services, or changing system security settings, explain the impact and obtain user consent, without asking again for actions the user has already explicitly authorized.';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hostSessionInstructions} from '../src/host/session-instructions.js';
import {RunnerManager} from '../src/host/runners.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {ClaudeSession} from '../src/host/native/claude.js';
it('adds one external pointer only to configured native sessions, preserving Codex instructions across rebind/resume',async()=>{
 const root=await mkdtemp(join(tmpdir(),'runner-native-')),log=join(root,'args.json'),manager=new RunnerManager(join(root,'runners'));
 const instructions=async()=>hostSessionInstructions(await manager.instruction());
 const pi=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),env:{RUNNER_ARGS_LOG:log},instructions});
 const codex=new CodexSessionFactory({cwd:root,codexHome:join(root,'codex'),cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],instructions,env:{RUNNER_ARGS_LOG:log,FAKE_DEVELOPER_INSTRUCTIONS:'Keep native guidance.'}});
 try{
  let session=await pi.create({sessionId:randomUUID()});await session.stop();expect(JSON.parse(await readFile(log,'utf8'))).toContain(environment);
  const saved:any=await manager.handle({action:'save',runner:{name:'runner',host:'localhost',port:22,username:'test',platform:'windows',workdir:''}});
  const pointer=await instructions();expect(pointer.split(environment)).toHaveLength(2);session=await pi.create({sessionId:randomUUID()});await session.stop();const args=JSON.parse(await readFile(log,'utf8'));expect(args.filter((a:string)=>a===pointer)).toHaveLength(1);expect(args[args.indexOf('--append-system-prompt')+1]).toBe(pointer);
  const native=await codex.create({sessionId:'runner-test'});expect(JSON.parse(await readFile(log,'utf8')).developerInstructions).toBe('Keep native guidance.\n'+pointer);
  await native.setContextPreset!('model');expect(JSON.parse(await readFile(log,'utf8')).developerInstructions).toBe('Keep native guidance.\n'+pointer);await native.stop();
  const claude=new ClaudeSession({command:process.execPath,args:[resolve('test/fixtures/fake-claude.mjs')],env:{CLAUDE_CONFIG_DIR:join(root,'claude'),RUNNER_ARGS_LOG:log}},root,{state:'prepared',requestedId:randomUUID()},async()=>{},[],pointer);
  await claude.start();await claude.stop();expect(JSON.parse(await readFile(log,'utf8'))).toContain(pointer);
  await manager.handle({action:'delete',id:saved.runner.id});
  const resumed=await codex.create({sessionId:'runner-test'});expect(JSON.parse(await readFile(log,'utf8')).developerInstructions).toBe('Keep native guidance.\n'+environment);await resumed.stop();
 }finally{await codex.close();await rm(root,{recursive:true,force:true});}
});
it('retains the pointer through the real Pi Work Harness and preserves Chat without execution instructions',async()=>{
 const {createServer}=await import('node:http');const {mkdir,writeFile}=await import('node:fs/promises');const {resolveHostPiExtensions}=await import('../src/host/pi-extensions.js');
 const root=await mkdtemp(join(tmpdir(),'runner-pi-payload-')),agent=join(root,'agent');await mkdir(agent);
 const requests:any[]=[];
 const provider=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});for(const choice of [{index:0,delta:{role:'assistant',content:'OK'},finish_reason:null},{index:0,delta:{},finish_reason:'stop'}])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[choice]})}\n\n`);res.end('data: [DONE]\n\n');});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as any).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048}]}}}));
 await writeFile(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false},retry:{enabled:false}}));
 const pointer=`For remote execution or testing, read the runner configuration at ${join(root,'runners.json')}.`;
 try{
  for(const mode of ['work','chat']){
   const factory=new RpcPiSessionFactory({cwd:root,agentDir:agent,provider:'fixture',model:'fixture',sessionDir:join(root,mode+'-sessions'),args:['--offline','--no-skills','--no-extensions'],extensions:resolveHostPiExtensions({PI_COFFEE_SUBAGENTS:'off',PI_COFFEE_WEB:'off',PI_COFFEE_LSP:'off',PI_COFFEE_HANDOFF:'off'}),instructions:async()=>pointer,env:{PI_OFFLINE:'1',PI_COFFEE_INITIAL_MODE:mode}});
   const sessionId=randomUUID();const session=await factory.create({sessionId});
   try{for(let turn=0;turn<2;turn++){await session.prompt('Reply OK.');await expect.poll(()=>requests.length,{timeout:10000}).toBe((mode==='work'?0:3)+turn+1);await expect.poll(async()=> (await session.getState()).isStreaming,{timeout:10000}).toBe(false);}}
   finally{await session.stop();}
   const resumed=await factory.create({sessionId});try{await resumed.prompt('Reply again.');await expect.poll(()=>requests.length,{timeout:10000}).toBe(mode==='work'?3:6);await expect.poll(async()=>(await resumed.getState()).isStreaming,{timeout:10000}).toBe(false);}finally{await resumed.stop();}
  }
  for(const request of requests){const system=request.messages.filter((m:any)=>['system','developer'].includes(m.role)).map((m:any)=>m.content).join('\n');expect(system.split(environment)).toHaveLength(2);}
  expect(requests[0].messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content).join('\n')).toContain(pointer);
  for(const request of requests.slice(3)){expect(JSON.stringify(request)).not.toContain(pointer);expect(request.messages.filter((m:any)=>['system','developer'].includes(m.role))).toEqual([{role:'system',content:environment}]);expect(request.tools.map((t:any)=>t.function.name).sort()).toEqual(['bash','edit','read','write']);}
 }finally{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);
