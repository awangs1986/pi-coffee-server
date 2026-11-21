import {execFile} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';

/** Have the installed CLI create the rollout and run its real SQL migrations.
 * Only a local synthetic Responses endpoint receives the fixture question. */
export async function createCodex170Source(home:string,sql:string,cwd:string){
 const runtime=process.env.PI_COFFEE_TEST_CODEX_01700_ROOT!;
 const endpoint=createServer((req,res)=>{
  req.resume();
  const response={id:'resp_local',object:'response',created_at:1,status:'in_progress',model:'fixture',output:[]};
  const item={id:'msg_local',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'fixture complete',annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream'});let sequence=0;
  const emit=(type:string,value:object)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,sequence_number:sequence++,...value})}\n\n`);
  emit('response.created',{response});
  emit('response.output_item.added',{output_index:0,item:{...item,content:[],status:'in_progress'}});
  emit('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:'fixture complete'});
  emit('response.output_item.done',{output_index:0,item});
  emit('response.completed',{response:{...response,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:2,total_tokens:3}}});res.end();
 });
 await new Promise<void>(r=>endpoint.listen(0,'127.0.0.1',r));
 try{
  const addr=endpoint.address();if(!addr||typeof addr==='string')throw Error('No local fixture port');
  await writeFile(join(home,'config.toml'),`sqlite_home=${JSON.stringify(sql)}
model="gpt-6.2-sol"
model_provider="fixture"
[model_providers.fixture]
name="Local fixture"
base_url="http://127.0.0.1:${addr.port}/v1"
wire_api="responses"
requires_openai_auth=false
[analytics]
enabled=false
[feedback]
enabled=false
`);
  const execution=promisify(execFile)(process.execPath,[join(runtime,'node_modules','.bin','codex'),'exec','--skip-git-repo-check','--sandbox','read-only','The ordinary question'],{cwd,env:{HOME:home,CODEX_HOME:home,CODEX_SQLITE_HOME:sql,PATH:process.env.PATH,LANG:'C.UTF-8'},timeout:30000});
  execution.child.stdin?.end();await execution;
  const dir=join(home,'sessions'),files=(await readdir(dir,{recursive:true})).filter(name=>name.endsWith('.jsonl'));
  if(files.length!==1)throw Error('Expected one real native rollout');
  const rollout=join(dir,files[0]!),row=JSON.parse((await readFile(rollout,'utf8')).split('\n')[0]!);
  if(row.type!=='session_meta'||row.payload.cli_version!=='0.170.0'||typeof row.payload.id!=='string')throw Error('Unexpected native fixture metadata');
  return {id:row.payload.id as string,rollout};
 }finally{await new Promise<void>(r=>endpoint.close(()=>r()));}
}
