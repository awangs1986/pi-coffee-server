import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { HostPiRuntime } from '../src/host/pi-runtime.js';
import { RpcPiSessionFactory } from '../src/host/pi-adapter.js';
import { HostServer } from '../src/host/server.js';
import { WebServer } from '../src/web/server.js';
import { HOST_ENVIRONMENT_INSTRUCTION } from '../src/host/session-instructions.js';

it('recovers a broken extension once before sending, retains native tools/history, and exposes degradation through Web', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coffee-pi-recovery-'));
  const agent = join(root, 'agent'); await mkdir(agent);
  const bad = join(root, 'broken.mjs'), attempts = join(root, 'attempts');
  await writeFile(bad, `import {appendFileSync} from 'node:fs';export default ()=>{appendFileSync(${JSON.stringify(attempts)},'start\\n');throw new Error('fixture-broken-extension');}`);
  const requests: any[] = [];
  const provider = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: ' + JSON.stringify({ id:'fixture', object:'chat.completion.chunk', created:1, model:'fixture', choices:[{index:0,delta:{role:'assistant',content:'EMERGENCY_REPLY_OK'},finish_reason:null}] }) + '\n\ndata: ' + JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]}) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(done => provider.listen(0, '127.0.0.1', done));
  const providerPort = (provider.address() as { port:number }).port;
  await writeFile(join(agent, 'models.json'), JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${providerPort}/v1`,api:'openai-completions',apiKey:'fixture',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
  const runtime = await HostPiRuntime.load({PI_COFFEE_EXTENSIONS:bad});
  const factory = new RpcPiSessionFactory({ runtime, cwd:root, agentDir:agent, sessionDir:join(root,'sessions'), provider:'fixture',model:'fixture',allowedModels:['fixture/fixture'],args:['--offline','--no-extensions'],env:{PI_OFFLINE:'1'} });
  const host = new HostServer({port:0,token:'fixture',factory,runtimeStatus:runtime.status});
  await host.start();
  const web = new WebServer({port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture'});await web.start();
  const url = `http://127.0.0.1:${web.address().port}`;
  const socket = new WebSocket(url.replace('http','ws')+'/ws');const frames:any[]=[];
  socket.on('message', data => frames.push(JSON.parse(String(data))));
  try {
    await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open'}));
    await expect.poll(()=>frames.find(f=>f.type==='opened') ?? frames.find(f=>f.type==='error'),{timeout:15000}).toMatchObject({type:'opened'});
    expect(runtime.status()).toEqual({mode:'emergency',reason:'extension_startup_failed'});
    expect(await readFile(attempts,'utf8')).toBe('start\n');
    expect(await (await fetch(url+'/api/runtime')).json()).toEqual(runtime.status());
    expect((await fetch(url+'/api/runtime',{method:'POST'})).status).toBe(405);
    socket.send(JSON.stringify({v:1,type:'set_model',requestId:'denied',provider:'fixture',id:'not-allowed'}));
    await expect.poll(()=>frames.find(f=>f.requestId==='denied')).toMatchObject({type:'error',message:expect.stringContaining('not allowed')});
    expect(requests).toHaveLength(0);
    socket.send(JSON.stringify({v:1,type:'prompt',requestId:'once',text:'Reply with the marker'}));
    await expect.poll(()=>frames.find(f=>f.event?.type==='agent_settled'),{timeout:10000}).toBeTruthy();
    expect(JSON.stringify(frames)).toContain('EMERGENCY_REPLY_OK');
    expect(requests).toHaveLength(1);
    expect(requests[0].tools.map((t:any)=>t.function.name)).toEqual(expect.arrayContaining(['read','bash','edit','write']));
    expect(requests[0].tools.map((t:any)=>t.function.name)).not.toContain('lsp');
    expect(JSON.stringify(requests[0].messages)).toContain(HOST_ENVIRONMENT_INSTRUCTION);
    expect(await factory.list()).toHaveLength(1);
    expect(runtime.recoverStartup(new Error('Failed to load extension again'))).toBe(false);
  } finally {
    socket.terminate();await web.close();await host.close();provider.closeAllConnections();await new Promise<void>(done=>provider.close(()=>done()));await rm(root,{recursive:true,force:true});
  }
},30000);

it('never treats model/auth errors as plugin failures and respects explicit emergency mode', async () => {
  const normal = await HostPiRuntime.load({PI_COFFEE_EXTENSIONS:'off'});
  for(const message of ['401 invalid API key','Model not found','Connection refused','Agent process exited (code=1 signal=null)'])expect(normal.recoverStartup(new Error(message))).toBe(false);
  expect(normal.status().mode).toBe('normal');
  const forced = await HostPiRuntime.load({PI_COFFEE_EMERGENCY:'1'});
  expect(forced.status()).toEqual({mode:'emergency',reason:'operator_requested'});
  expect(forced.extensions()).toEqual([]);
});

it('recovers concurrent model and command discovery without leaving one caller on the broken plugins', async () => {
  const root=await mkdtemp(join(tmpdir(),'coffee-concurrent-recovery-'));
  const bad=join(root,'broken.mjs');await writeFile(bad,"export default ()=>{throw new Error('fixture-broken-extension');}");
  const runtime=await HostPiRuntime.load({PI_COFFEE_EXTENSIONS:bad});
  const factory=new RpcPiSessionFactory({runtime,cwd:root,agentDir:root,sessionDir:join(root,'sessions'),args:['--offline','--no-extensions'],env:{PI_OFFLINE:'1'}});
  try {
    const results=await Promise.allSettled([factory.modelCatalog('pi'),factory.commandCatalog('pi')]);
    expect(results.map(r=>r.status)).toEqual(['fulfilled','fulfilled']);
  } finally {await rm(root,{recursive:true,force:true});}
},15000);
