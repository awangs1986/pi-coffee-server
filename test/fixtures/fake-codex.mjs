import './github-env-probe.mjs';
// External native CLI fixture: speaks the documented App Server JSONL seam.
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
if(process.argv.includes('--version')) { console.log(process.env.FIXTURE_VERSION || 'codex-cli 0.154.0'); process.exit(0); }
if(process.argv.includes('login') && process.argv.includes('status')) {
 if(process.env.FIXTURE_AUTH_STATUS_ERROR)process.exit(2);
 if(process.env.FIXTURE_AUTH_MISSING || process.env.FIXTURE_NO_OPENAI_AUTH){console.error('Not logged in');process.exit(1);}
 console.error('Logged in using ChatGPT');process.exit(0);
}
const file=process.cwd()+'/.fake-native-thread.json';
let thread; let approvalTurn;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const emit=(method,params)=>send({method,params});
createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.id==='native-question' && m.result){emit('item/completed',{threadId:thread.id,item:{type:'agentMessage',id:'answer',text:m.result.answers.color.answers.join(',')}});approvalTurn.status='completed';emit('turn/completed',{threadId:thread.id,turn:approvalTurn});return;}
 if(m.id==='native-approval' && m.result){approvalTurn.status='completed';await writeFile(file,JSON.stringify(thread));emit('turn/completed',{threadId:thread.id,turn:approvalTurn});return;}
 const ok=result=>send({id:m.id,result});
 switch(m.method){
 case 'initialize':ok({userAgent:'fixture'});break;
 case 'account/read':if(process.env.FIXTURE_ACCOUNT_UNAVAILABLE)break;ok({account:process.env.FIXTURE_AUTH_MISSING || process.env.FIXTURE_NO_OPENAI_AUTH?null:{type:'chatgpt'},requiresOpenaiAuth:!process.env.FIXTURE_NO_OPENAI_AUTH});break;
 case 'model/list':ok({data:[{id:'fixture',model:'fixture',isDefault:true,supportedReasoningEfforts:[]}]});break;
 case 'thread/start':thread={id:'native-fixed',turns:[],status:{type:'idle'},model:'fixture'};await writeFile(file,JSON.stringify(thread));ok({thread});break;
 case 'thread/resume':try{thread=JSON.parse(await readFile(file,'utf8'));ok({thread});}catch{send({id:m.id,error:{code:-32000,message:'Native session missing'}});}break;
 case 'thread/read':if(thread.turns.length===0 && m.params.includeTurns){send({id:m.id,error:{code:-32000,message:'list_turns is not supported yet'}});}else ok({thread});break;
 case 'turn/interrupt':{const turn=thread.turns.at(-1);turn.status='interrupted';await writeFile(file,JSON.stringify(thread));ok({});emit('turn/completed',{threadId:thread.id,turn});break;}
 case 'turn/start':{
 const turn={id:'turn-'+thread.turns.length,status:'inProgress',items:[{type:'userMessage',id:'u'+thread.turns.length,content:m.params.input}]};thread.turns.push(turn);
 ok({turn});emit('turn/started',{threadId:thread.id,turn});
 if(m.params.input[0].text==='hold')break;
 if(m.params.input[0].text==='ask question'){approvalTurn=turn;send({id:'native-question',method:'item/tool/requestUserInput',params:{threadId:thread.id,turnId:turn.id,questions:[{id:'color',header:'Color',question:'Choose color',options:[{label:'blue',description:'Blue'}]}]}});break;}
 if(m.params.input[0].text==='tool'){const item={type:'commandExecution',id:'tool-1',command:'cat note.txt',status:'inProgress'};emit('item/started',{threadId:thread.id,item});item.status='completed';item.aggregatedOutput='file content';item.exitCode=0;turn.items.push(item);emit('item/completed',{threadId:thread.id,item});}
 if(m.params.input[0].text.startsWith('ask approval')){approvalTurn=turn;send({id:'native-approval',method:'item/commandExecution/requestApproval',params:{threadId:thread.id,turnId:turn.id,itemId:'cmd1',command:'cat probe.txt',cwd:process.cwd()}});if(m.params.input[0].text.endsWith('overflow'))for(let n=0;n<300;n++)emit('item/agentMessage/delta',{threadId:thread.id,itemId:'progress',delta:'.'});break;}
 setTimeout(async()=>{const item={type:'agentMessage',id:'a'+thread.turns.length,text:'native marker'};turn.items.push(item);emit('item/agentMessage/delta',{threadId:thread.id,turnId:turn.id,itemId:item.id,delta:item.text});emit('item/completed',{threadId:thread.id,turnId:turn.id,item});turn.status='completed';await writeFile(file,JSON.stringify(thread));emit('turn/completed',{threadId:thread.id,turn});},10);break;}
 default:send({id:m.id,error:{code:-32601,message:'unsupported'}});
 }
});
