// Actual native CLI, isolated Codex home, loopback provider; no paid model call.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexSessionFactory} from '../dist/src/host/codex-adapter.js';

for(const tool of ['request_user_input','request_user_input_async']){
 const root=await mkdtemp(join(tmpdir(),'coffee-question-probe-'));
 let calls=0,answered=false,earlyContinuation=false;
 const endpoint=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
  calls++;if(calls>1&&!answered)earlyContinuation=true;
  const response={id:'resp_fixture_'+calls,object:'response',created_at:1,status:'in_progress',model:body.model,output:[]};
  const question=tool.endsWith('_async')?{questions:[{title:'Choose a fixture color',options:['Blue','Red']}]}:
   {questions:[{id:'color',header:'Color',question:'Choose a fixture color',options:[{label:'Blue',description:'Blue fixture'},{label:'Red',description:'Red fixture'}]}]};
  const item=calls===1?{type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:tool,arguments:JSON.stringify(question)}:
   {type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text:'fixture complete',annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream'});let sequence=0;
  const emit=(type,payload)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,sequence_number:sequence++,...payload})}\n\n`);
  emit('response.created',{response});
  emit('response.output_item.added',{output_index:0,item:{...item,...(item.type==='function_call'?{arguments:''}:{content:[],status:'in_progress'})}});
  if(item.type==='function_call'){
   emit('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:item.arguments});
   emit('response.function_call_arguments.done',{item_id:item.id,output_index:0,arguments:item.arguments});
  }else emit('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:'fixture complete'});
  emit('response.output_item.done',{output_index:0,item});
  emit('response.completed',{response:{...response,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
 });
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
 const config={model:'gpt-6.1-sol',model_provider:'fixture','model_providers.fixture.name':'fixture',
  'model_providers.fixture.base_url':`http://127.0.0.1:${endpoint.address().port}/v1`,
  'model_providers.fixture.wire_api':'responses','model_providers.fixture.requires_openai_auth':false};
 const factory=new CodexSessionFactory({cwd:root,codexHome:join(root,'codex'),cliPath:process.argv[2]??'codex',sandbox:'read-only',approvalPolicy:'never',
  args:Object.entries(config).flatMap(([key,value])=>['-c',`${key}=${JSON.stringify(value)}`])});
 const waitFor=async predicate=>{
  for(let attempt=0;attempt<150;attempt++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.ok(predicate(),'Native question/continuation did not arrive');
 };
 try{
  await mkdir(join(root,'codex'));
  const session=await factory.create({sessionId:'question-fixture'}),events=[];
  session.onEvent(event=>events.push(event));await session.prompt('Synthetic explicit-choice fixture.');
  await waitFor(()=>events.some(event=>event.type==='native_request'));
  const question=events.find(event=>event.type==='native_request');assert.deepEqual(question.options,['Blue','Red']);
  await new Promise(resolve=>setTimeout(resolve,300));
  assert.equal(calls,1);assert.equal(earlyContinuation,false);assert.equal(events.some(event=>event.type==='agent_settled'),false);
  await assert.rejects(session.respondUi({id:question.id,value:'  '}),/Answer text is required/);
  answered=true;await session.respondUi({id:question.id,value:'Blue'});
  await waitFor(()=>events.some(event=>event.type==='agent_settled'));
  assert.equal(calls,2);assert.equal(earlyContinuation,false);
  console.log(JSON.stringify({tool,heldUntilExplicitAnswer:true,choices:question.options.length,verdict:'PASS'}));
 }finally{
  try{await factory.close();}
  finally{await new Promise(resolve=>endpoint.close(resolve));await rm(root,{recursive:true,force:true});}
 }
}
