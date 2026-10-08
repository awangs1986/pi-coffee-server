import './github-env-probe.mjs';
import {createInterface} from 'node:readline';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
if(process.argv.includes('--version')){console.log(process.env.FIXTURE_GROK?'grok 1.0.46':'2026.10.01-e373342');process.exit(0);}
if(process.argv.includes('status')){console.log(JSON.stringify({isAuthenticated:!process.env.FIXTURE_AUTH_MISSING}));process.exit(0);}
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
let id,rows=[],turn,permission;const root=process.env.CLAUDE_CONFIG_DIR;
const update=u=>send({method:'session/update',params:{sessionId:id,update:u}});
const config={models:{currentModelId:'cursor-test',availableModels:[{modelId:'cursor-test',name:'Test'},{modelId:'cursor-other',name:'Other'}]}};
async function finish(text){const u={sessionUpdate:'agent_message_chunk',content:{type:'text',text}};rows.push(u);update(u);await writeFile(join(root,id+'.json'),JSON.stringify(rows));send({id:turn,result:{stopReason:process.env.TRACKING_END_STATUS==='interrupted'?'cancelled':process.env.TRACKING_END_STATUS==='failed'?'error':'end_turn'}});turn=null;}
createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);if(m.jsonrpc!=='2.0')process.exit(2);
 if(!m.method){if(m.id===permission){permission=null;if(process.env.TRACKING_END_STATUS==='exit')process.exit(0);await finish(JSON.stringify(m.result));}return;}
 if(m.method==='initialize'){send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:!process.env.FIXTURE_GROK}},authMethods:[{id:process.env.FIXTURE_GROK?(process.env.FIXTURE_AUTH_MISSING?'grok.com':'cached_token'):'cursor_login'}]}});return;}
 if(m.method==='authenticate'){if(process.env.FIXTURE_GROK&&(m.params.methodId!=='cached_token'||m.params._meta?.headless!==true))process.exit(3);send({id:m.id,result:{}});return;}
 if(m.method==='session/new'){id=randomUUID();await mkdir(root,{recursive:true});await writeFile(join(root,id+'.json'),'[]');send({id:m.id,result:{sessionId:id,...config}});return;}
 if(m.method==='session/load'){id=m.params.sessionId;try{rows=JSON.parse(await readFile(join(root,id+'.json'),'utf8'));for(const r of rows)update(r);send({id:m.id,result:config});}catch{send({id:m.id,error:{code:-32000,message:'Missing native session'}});}return;}
 if(m.method==='session/set_model'&&process.env.FIXTURE_GROK_MODEL_ERROR){send({id:m.id,error:{code:-32000,message:'Rejected credential '+['xai','synthetic','test','only'].join('-')}});return;}
 if(m.method==='session/set_model'){send({id:m.id,result:{}});return;}
 if(m.method==='session/cancel'){if(turn){send({id:turn,result:{stopReason:'cancelled'}});turn=null;}return;}
 if(m.method==='session/prompt'){
  turn=m.id;const text=m.params.prompt[0].text;const user={sessionUpdate:'user_message_chunk',content:{type:'text',text}};rows.push(user);update(user);
  if(text==='hold')return;
  if(text==='track approval')update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'PARTIAL_NOT_DONE'}});
  if(['ask approval','track approval'].includes(text)){permission='permission-1';send({id:permission,method:'session/request_permission',params:{sessionId:id,toolCall:{toolCallId:'tool-1',title:'Read'},options:[{optionId:'allow',kind:'allow_once',name:'Allow'},{optionId:'deny',kind:'reject_once',name:'Deny'}]}});return;}
  if(text==='ask question'){permission='question-1';send({id:permission,method:'cursor/ask_question',params:{toolCallId:'tool-2',questions:[{id:'q1',prompt:'Which?',options:[{id:'a',label:'First'},{id:'b',label:'Second'}]}]}});return;}
  update({sessionUpdate:'tool_call',toolCallId:'read-1',title:'Read',status:'in_progress',rawInput:{path:'note.txt'}});
  update({sessionUpdate:'tool_call_update',toolCallId:'read-1',status:'completed',rawOutput:'base'});
  await finish('Cursor native marker');return;
 }
 send({id:m.id,error:{code:-32601,message:'Unsupported method'}});
});
