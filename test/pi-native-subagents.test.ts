import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {expect,it} from 'vitest';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';
import {buildHostChildEnv} from '../src/host/pi-adapter.js';

it('uses native subagents to run a matching Pi child and exposes active/settled work to Host',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-native-child-')),agent=join(root,'agent');await mkdir(agent);const cwd=join(root,'workspace');await mkdir(cwd);
 const requests:any[]=[];
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
  if(body.messages.some((m:any)=>JSON.stringify(m.content).includes('WAIT_CHILD'))) { return; }
  const executed=body.messages.some((m:any)=>m.role==='tool');
  const content=executed?'CHILD_OK':'CHILD_REQUEST';
  const delta=executed?{role:'assistant',content}:{role:'assistant',tool_calls:[{index:0,id:'child-version',type:'function',function:{name:'bash',arguments:JSON.stringify({command:`node -e 'console.log("ACTUAL_CHILD_PI="+require(process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT+"/package.json").version)'`})}}]};
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const choice of [{index:0,delta,finish_reason:null},{index:0,delta:{},finish_reason:executed?'stop':'tool_calls'}])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[choice]})}\n\n`);
  res.end('data: [DONE]\n\n');
 });await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as any).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048}]}}}));
 await writeFile(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false},retry:{enabled:false}}));
 const fixture=join(root,'driver.mjs');await writeFile(fixture,`import {randomUUID} from 'node:crypto';export default pi=>{
 pi.on('session_start',()=>{const r={version:1,name:'coffee-probe',definition:{description:'isolated fixture',systemPrompt:'Report the installed Pi version with bash.',model:'inherit',tools:['bash'],extensions:[]}};pi.events.emit('pi-subagents:runtime-agent-register:v1',r);if(!r.result?.ok)throw Error('agent registration failed');});
 pi.registerCommand('fixture-rpc',{handler:async(args)=>{const input=JSON.parse(args),requestId=randomUUID();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(Error('RPC timed out'));},15000);const off=pi.events.on('subagents:rpc:v1:reply:'+requestId,r=>{clearTimeout(timer);off();pi.appendEntry('fixture-rpc',r);resolve();});pi.events.emit('subagents:rpc:v1:request',{version:1,requestId,...input});});}});
 }`);
 const c=new RpcClient({cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),cwd,provider:'fixture',model:'fixture',env:{...buildHostChildEnv(),PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1'},args:['--offline','--session-dir',join(root,'sessions'),...resolveHostPiExtensions({PI_COFFEE_WEB:'off',PI_COFFEE_LSP:'off'}).flatMap(p=>['-e',p]),'-e',fixture]});
 const rpc=async(method:string,params={})=>{await c.prompt('/fixture-rpc '+JSON.stringify({method,params}));return (await c.getEntries()).entries.filter((e:any)=>e.type==='custom' && e.customType==='fixture-rpc').at(-1) as any;};
 try{
  await c.start();await c.getState();
  const launched=await rpc('spawn',{agent:'coffee-probe',task:'Report the exact installed runtime version.',async:true});
  expect(launched.data.success,JSON.stringify(launched.data)).toBe(true);
  await expect.poll(async()=>{const r=await rpc('status');return r.data?.data?.asyncSnapshot?.runs?.some((run:any)=>run.state==='complete');},{timeout:30000,interval:500}).toBe(true);
  expect(requests.flatMap(r=>r.messages).filter((m:any)=>m.role==='tool').map((m:any)=>m.content).join('\n')).toContain('ACTUAL_CHILD_PI=0.99.1');
  await c.prompt('/coffee-workspace-jobs 00000000-0000-4000-8000-000000000003');
  const jobs=(await c.getEntries()).entries.filter((e:any)=>e.type==='custom' && e.customType==='coffee-workspace-jobs').at(-1) as any;
  expect(jobs.data).toMatchObject({known:true,active:0});
  expect((await rpc('spawn',{agent:'coffee-probe',task:'WAIT_CHILD',async:true})).data.success).toBe(true);
  await expect.poll(async()=> (await rpc('status')).data.data.fleet.totalActive,{timeout:10000}).toBeGreaterThan(0);
  await c.prompt('/coffee-workspace-jobs 00000000-0000-4000-8000-000000000004');
  const busy=(await c.getEntries()).entries.filter((e:any)=>e.type==='custom' && e.customType==='coffee-workspace-jobs').at(-1) as any;
  expect(busy.data.known).toBe(true);expect(busy.data.active).toBeGreaterThan(0);
  const running=(await rpc('status')).data.data.asyncSnapshot.runs.find((run:any)=>!['complete','failed','stopped'].includes(run.state));
  expect(running).toBeTruthy();expect((await rpc('stop',{id:running.id})).data.success).toBe(true);
  await expect.poll(async()=> (await rpc('status')).data.data.fleet.totalActive,{timeout:10000}).toBe(0);
 }finally{await c.stop();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await rm(root,{recursive:true,force:true});}
},60000);
