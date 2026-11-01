import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {SPEECH_PROFILE} from '../packages/completion-speech/profile.js';

it('keeps the opted-in Pi profile in one stable provider instruction slot while native messages/tools/model stay unchanged',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-native-')),agent=join(root,'agent');await mkdir(agent);
 const requests:any[]=[];const provider=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'Synthetic reply'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
 await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));const port=(provider.address() as {port:number}).port;
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${port}/v1`,api:'openai-completions',apiKey:'fixture',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 const factory=new RpcPiSessionFactory({cwd:root,agentDir:agent,sessionDir:join(root,'sessions'),provider:'fixture',model:'fixture',args:['--offline','--no-extensions'],env:{PI_OFFLINE:'1',PI_COFFEE_INITIAL_MODE:'chat'}});
 let session:Awaited<ReturnType<typeof factory.create>>|undefined;let settled=0;
 try{
  session=await factory.create({sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});session.onEvent((event:any)=>{if(event.type==='agent_settled')settled++;});
  await expect(session.setTurnInstructions?.('unregistered custom instruction')).rejects.toThrow('Unsupported speech instruction profile');
  for(let turn=0;turn<3;turn++){await session.setTurnInstructions?.(turn===2?undefined:SPEECH_PROFILE);await session.prompt('request '+turn);await expect.poll(()=>settled,{timeout:10000}).toBe(turn+1);}
  expect(requests).toHaveLength(3);
  const system=(request:any)=>request.messages.filter((v:any)=>v.role==='system');
  expect(system(requests[0])).toHaveLength(1);expect(system(requests[1])).toEqual(system(requests[0]));expect(system(requests[0])[0].content).toBe(SPEECH_PROFILE);expect(system(requests[2])).toEqual([]);
  expect(requests.map(v=>v.model)).toEqual(['fixture','fixture','fixture']);expect(requests[1].tools).toEqual(requests[0].tools);
  const history=await session.getHistory();expect(history.entries.filter(v=>v.kind==='user').map((v:any)=>v.text)).toEqual(['request 0','request 1','request 2']);expect(JSON.stringify(history)).not.toContain('Completion brief');
 }finally{await session?.stop();provider.closeAllConnections();await new Promise<void>(r=>provider.close(()=>r()));await rm(root,{recursive:true,force:true});}
},30000);
