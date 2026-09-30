import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcClient} from '@earendil-works/pi-coding-agent';
import {HANDOFF_REQUEST} from 'context-handoff/protocol';
import {expect,it} from 'vitest';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';

it('keeps original Serper search bounded and retrieves the full result through native response IDs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-native-web-')),agent=join(root,'agent');await mkdir(agent);const cwd=join(root,'workspace');await mkdir(cwd);
 const requests:any[]=[];let step=0;
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;const body=JSON.parse(raw);requests.push(body);let call:any;
  if(step===0)call={name:'web_enable',arguments:'{}'};
  if(step===1)call={name:'web_search',arguments:JSON.stringify({query:'fixture large search',provider:'serper',workflow:'none'})};
  if(step===2){const text=body.messages.at(-1).content;const match=/responseId\s+["']([^"']+)["']/.exec(text);call={name:'get_search_content',arguments:JSON.stringify({responseId:match?.[1],queryIndex:0,offset:0,limit:1000})};}
  step++;
  const delta=call?{role:'assistant',tool_calls:[{index:0,id:'web-'+step,type:'function',function:call}]}:{role:'assistant',content:'SEARCH_RETRIEVAL_OK'};
  res.writeHead(200,{'content-type':'text/event-stream'});for(const choice of [{index:0,delta,finish_reason:null},{index:0,delta:{},finish_reason:call?'tool_calls':'stop'}])res.write(`data: ${JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[choice]})}\n\n`);res.end('data: [DONE]\n\n');
 });await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${(provider.address() as any).port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048}]}}}));
 await writeFile(join(agent,'settings.json'),JSON.stringify({compaction:{enabled:false,keepRecentTokens:20,reserveTokens:1024},retry:{enabled:false}}));
 await writeFile(join(agent,'web-search.json'),JSON.stringify({serperApiKey:'synthetic',provider:'serper',toolActivation:'dynamic',maxInlineContentChars:6000}));
 const network=join(root,'network.mjs');await writeFile(network,`export default pi=>{const original=globalThis.fetch;globalThis.fetch=(url,opts)=>String(url)==='https://google.serper.dev/search'?Promise.resolve(new Response(JSON.stringify({organic:Array.from({length:20},(_,i)=>({title:'SOURCE_'+i,link:'https://example.test/'+i,snippet:'VALID_RESULT '.repeat(200)}))}),{status:200,headers:{'content-type':'application/json'}})):original(url,opts);pi.on('session_shutdown',()=>{globalThis.fetch=original;});}`);
 const c=new RpcClient({cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),cwd,provider:'fixture',model:'fixture',env:{PI_CODING_AGENT_DIR:agent,PI_OFFLINE:'1',PI_COFFEE_INITIAL_MODE:'work'},args:['--offline','--session-dir',join(root,'sessions'),...resolveHostPiExtensions({PI_COFFEE_SUBAGENTS:'off',PI_COFFEE_LSP:'off'}).flatMap(p=>['-e',p]),'-e',network]});
 const events:any[]=[];c.onEvent(e=>events.push(e));
 try{
  await c.start();await c.getState();await c.promptAndWait('Search and retrieve source details.',undefined,10000).catch(e=>{throw Error(e.message+' '+JSON.stringify({step,events}));});
  const search=events.find(e=>e.type==='tool_execution_end' && e.toolName==='web_search');
  expect(search?.isError,JSON.stringify(search)).toBe(false);expect(search.result.details.totalResults).toBe(5);
  const text=search.result.content.map((p:any)=>p.text??'').join('');expect(text.length).toBeLessThanOrEqual(8000);expect(text).toContain('responseId');
  const retrieval=events.find(e=>e.type==='tool_execution_end' && e.toolName==='get_search_content');
  expect(retrieval?.isError,JSON.stringify(retrieval)).toBe(false);expect(JSON.stringify(retrieval.result.content)).toContain('VALID_RESULT');
  expect(requests.at(-1).messages.some((m:any)=>m.role==='tool' && String(m.content).includes('VALID_RESULT'))).toBe(true);
  // Reaching synthesis proves completed searches do not leave false pending work.
  let compactError='';await c.compact(HANDOFF_REQUEST).catch(e=>{compactError=e.message;});
  expect(requests.some(r=>r.messages.some((m:any)=>String(m.content).startsWith('PI_HANDOFF_SYNTHESIS'))),JSON.stringify({compactError,custom:events.filter(e=>e.message?.role==='custom')})).toBe(true);
  expect(events.filter(e=>e.type==='extension_error')).toEqual([]);
 }finally{await c.stop();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);
