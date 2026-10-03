import './github-env-probe.mjs';
import {writeFileSync} from "node:fs";
if(process.env.RUNNER_ARGS_LOG)writeFileSync(process.env.RUNNER_ARGS_LOG,JSON.stringify(process.argv));
// Claude 2.1.280 native stream-json and session-file boundary fixture.
import {createInterface} from 'node:readline';import {mkdir,appendFile,readFile} from 'node:fs/promises';import {join} from 'node:path';
if(process.argv.includes('--version')){console.log('2.1.280 (Claude Code)');process.exit(0);}
if(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:!process.env.FIXTURE_AUTH_MISSING}));process.exit(0);}
if(!process.argv.includes('--permission-prompt-tool') || !process.argv.includes('stdio'))process.exit(2);
const args=process.argv;const resume=args.includes('--resume');const id=args[args.indexOf(resume?'--resume':'--session-id')+1];
const dir=join(process.env.CLAUDE_CONFIG_DIR,'projects',process.cwd().replace(/[^a-zA-Z0-9]/g,'-'));const path=join(dir,id+'.jsonl');await mkdir(dir,{recursive:true});
if(resume){try{await readFile(path);}catch{process.exit(1);}}
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);
 if(m.type==='control_response'){send({type:'assistant',uuid:'decision',message:{role:'assistant',content:[{type:'text',text:m.response.response.behavior==='deny'?'permission denied':'permission allowed'}]}});send({type:'result',is_error:false});return;}
 if(m.type==='control_request'){
  if(m.request.subtype==='interrupt')send({type:'result',is_error:true,subtype:'error_during_execution'});
  send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response:{session_state:'idle',models:[{value:'claude-test',resolvedModel:'claude-test'}]}}});return;
 }
 if(m.type==='user'){
  send({type:'system',subtype:'init',session_id:id});
  if(m.message.content[0].text==='hold')return;
  if(m.message.content[0].text==='background')send({type:'system',subtype:'background_tasks_changed',tasks:[{task_id:'child',task_type:'local_bash'}]});
  if(m.message.content[0].text==='finish background')send({type:'system',subtype:'background_tasks_changed',tasks:[]});
  if(m.message.content[0].text==='ask approval'){send({type:'control_request',request_id:'permission-1',request:{subtype:'can_use_tool',tool_name:'Read',input:{file_path:'/tmp/test'}}});return;}
  await appendFile(path,JSON.stringify({type:'user',uuid:'u1',sessionId:id,message:m.message})+'\n');
  const assistant={type:'assistant',uuid:'a1',sessionId:id,message:{role:'assistant',content:[{type:'text',text:'Claude native marker'}]}};
  await appendFile(path,JSON.stringify(assistant)+'\n');send({...assistant,session_id:id});send({type:'result',subtype:'success',session_id:id,is_error:false,result:'Claude native marker'});
 }
});
