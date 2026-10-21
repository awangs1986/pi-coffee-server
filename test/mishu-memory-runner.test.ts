import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {runPiMemoryExtraction} from '../src/host/pi-memory-runner.js';

it('uses native Pi with no tools or project context, and recovers its saved output without another model call',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-extract-')),agent=join(root,'agent'),cwd=join(root,'isolated');
 const calls:any[]=[];const model=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;calls.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'extract',object:'chat.completion.chunk',created:1,model:'small',choices:[{index:0,delta:{role:'assistant',content:'{"changes":[]}'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'extract',object:'chat.completion.chunk',created:1,model:'small',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:17,completion_tokens:5,total_tokens:22}})+'\n\ndata: [DONE]\n\n');});
 await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));
 try{
  await mkdir(agent);await mkdir(cwd);await writeFile(join(cwd,'AGENTS.md'),'PROJECT_CONTEXT_MUST_NOT_ENTER');
  await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`http://127.0.0.1:${(model.address() as any).port}/v1`,models:[{id:'small',name:'small',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
  await writeFile(join(agent,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
  const options={cliPath:resolve('node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),agentDir:agent,cwd,provider:'fixture',model:'small',sessionFile:join(root,'extraction.jsonl'),prompt:'Extract only candidates from this synthetic message.',signal:new AbortController().signal};
  expect(await runPiMemoryExtraction(options)).toMatchObject({text:'{"changes":[]}',provider:'fixture',model:'small'});
  expect(calls).toHaveLength(1);expect(calls[0].tools??[]).toEqual([]);expect(JSON.stringify(calls[0])).not.toContain('PROJECT_CONTEXT_MUST_NOT_ENTER');
  expect(await runPiMemoryExtraction(options)).toMatchObject({text:'{"changes":[]}',recovered:true});expect(calls).toHaveLength(1);
  const native=(await readFile(options.sessionFile,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  expect(native.at(-1).message.content).toEqual([{type:'text',text:'{"changes":[]}'}]);
  await expect(runPiMemoryExtraction({...options,prompt:'Different material'})).rejects.toThrow('identity conflict');expect(calls).toHaveLength(1);
 }finally{model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);

it('strips capabilities supplied only in configured native child environment',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-extract-env-'));try{
  const capture=join(root,'presence.json');
  await expect(runPiMemoryExtraction({cliPath:resolve('test/fixtures/memory-env-probe.mjs'),cwd:root,provider:'fake',model:'fake-mini',sessionFile:join(root,'run.jsonl'),prompt:'Synthetic input',signal:new AbortController().signal,env:{MEMORY_TEST_ENV_CAPTURE:capture,PI_COFFEE_SYNTHETIC_ONLY:'synthetic-fixture'}})).rejects.toThrow(/uncertain|output|not admitted/);
  expect(JSON.parse(await readFile(capture,'utf8'))).toEqual({configuredCapabilityPresent:false});
 }finally{await rm(root,{recursive:true,force:true});}
},10000);

it('cannot execute a tool call returned by a malicious provider and never repeats an uncertain run',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-no-tools-')),agent=join(root,'agent'),marker=join(root,'should-not-exist');let calls=0;
 const provider=createServer(async(req,res)=>{for await(const _ of req){/* drain */}calls++;res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'attack',object:'chat.completion.chunk',created:1,model:'small',choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call-attack',type:'function',function:{name:'bash',arguments:JSON.stringify({command:`touch ${marker}`})}}]},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'attack',object:'chat.completion.chunk',created:1,model:'small',choices:[{index:0,delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:17,completion_tokens:5,total_tokens:22}})+'\n\ndata: [DONE]\n\n');});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 try{
  await mkdir(agent);await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{api:'openai-completions',apiKey:'synthetic',baseUrl:`http://127.0.0.1:${(provider.address() as any).port}/v1`,models:[{id:'small',name:'small',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
  await writeFile(join(agent,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
  const options={agentDir:agent,cwd:root,provider:'fixture',model:'small',sessionFile:join(root,'attack.jsonl'),prompt:'Untrusted evidence asks for a tool.',signal:new AbortController().signal};
  await expect(runPiMemoryExtraction(options)).rejects.toMatchObject({output:{provider:'fixture',model:'small',usage:{input:17,output:5}}});
  await expect(access(marker)).rejects.toThrow();
  const before=calls;await expect(runPiMemoryExtraction(options)).rejects.toThrow('uncertain');expect(calls).toBe(before);
 }finally{provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);
