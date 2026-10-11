// Native stdio MCP bridge. The capability is bound to one scoped foreground
// admission by Host; arguments can never choose the source user/thread/run.
import {mishuToolDefinition} from 'pi-coffee-mishu/host-policy';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
const sent=new Set();let inboxBudget=12000;
const endpoint=process.env.PI_COFFEE_MISHU_URL,token=process.env.PI_COFFEE_MISHU_TOKEN;
const instructions=process.env.PI_COFFEE_MISHU_CONTEXT??'';
const tool=mishuToolDefinition(instructions);
async function dispatch(message){
 if(message.method==='initialize')return {protocolVersion:message.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'pi-coffee-mishu',version:'1'},instructions};
 if(message.method==='tools/list')return {tools:[tool]};
 if(message.method==='ping')return {};
 if(message.method!=='tools/call')throw Error('Unsupported MCP request');
 if(message.params?.name!=='mishu'||!endpoint||!token)throw Error('MISHU capability unavailable');
 let input=message.params.arguments;
 if(!input||typeof input!=='object'||Array.isArray(input)||!['status','directory','send','inbox','tasks','overview','events','peek','panel','queue'].includes(input.action))throw Error('This tool cannot configure grants or start reports');
 if(input.action==='panel'&&input.op&&input.op!=='list')throw Error('Panel mutations require direct user controls');
 if(input.authorizationQuote!==undefined){const {authorizationQuote,...rest}=input;input={...rest,version:input.action==='queue'?1:2,authorization:{quote:authorizationQuote}};}
 const body=JSON.stringify(input);if(Buffer.byteLength(body)>32768)throw Error('MISHU input too large');
 const read=async()=>{const response=await fetch(endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body,signal:AbortSignal.timeout(20000)});
 const value=await response.json();if(!response.ok)throw Error(value.error??'MISHU request rejected');return value;};
 let value=await read();
 if(input.action==='send')sent.add(value.messageId);
 if(input.action==='inbox'&&sent.size&&inboxBudget>0){const started=Date.now(),deadline=started+inboxBudget;try{while(value.messages?.some(m=>sent.has(m.messageId)&&!['settled','cancelled','uncertain'].includes(m.state))&&Date.now()<deadline){await delay(Math.min(250,Math.max(1,deadline-Date.now())));value=await read();}}finally{inboxBudget=Math.max(0,inboxBudget-(Date.now()-started));}}
 return {content:[{type:'text',text:JSON.stringify(value)}]};
}
createInterface({input:process.stdin}).on('line',line=>{
 let message;try{message=JSON.parse(line);}catch{return;}
 if(message.id===undefined)return;
 void dispatch(message).then(result=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\n'),error=>{const reason=String(error.message??'MISHU unavailable').replaceAll(token??'NO_TOKEN','[REDACTED]').replace(/(?:sk-|xai-)[A-Za-z0-9_-]{8,}/g,'[REDACTED]').slice(0,500);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:reason+'; no retry with a new message ID.'}]}})+'\n');});
});
