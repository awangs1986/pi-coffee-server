// Real Browser/controller with synthetic HTTP/WS. No account or model call.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
import {once} from 'node:events';
const tasks=['a','b'].map(id=>({id,engine:'codex',workspaceKind:'chat',name:id,cwd:'/fixture/'+id,creationState:'ready',createdAt:new Date().toISOString()})),creates=[],prompts=[],errors=[],evidence=[],commands=[];let delayed;
const models=[{provider:'codex',id:'gpt-6.1-sol'},{provider:'codex',id:'gpt-6-luna'}];
const reply=(res,value)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));};
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path==='/auth/me')return reply(res,{auth:true,user:'synthetic-chat'});
 if(path==='/api/me')return reply(res,null);
 if(path==='/api/engines')return reply(res,{chatEngines:['pi','codex'],contextResetEngines:['pi','codex'],clearChatContext:true,engines:[{id:'pi',available:true},{id:'codex',available:true,modelCatalog:true}]});
 if(path==='/api/workspace'){
  let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};
  if(input.action==='conversation'){creates.push(input);const task={...input,cwd:'/synthetic/chats/'+input.id,branch:'',createdAt:new Date().toISOString(),creationState:'ready'};tasks.push(task);return reply(res,task);}
  if(input.action)return reply(res,{state:'local',files:[]});
  return reply(res,{projects:[],conversations:tasks,capabilities:{chatWorkspaces:true},sidebar:{showGroups:false,assignments:{},collapsed:[]}});
 }
 if(path==='/api/conversations/a/native-export'){res.writeHead(200,{'content-type':'text/markdown'});return res.end('# Full export\nOldest message\nLatest message');}
 if(path.startsWith('/api/'))return reply(res,{});
 const file=path==='/'?'index.html':path.slice(1);
 if(!/^[\w.-]+$/.test(file)){res.writeHead(404);return res.end();}
 try{const content=await readFile(join(resolve('public'),file));res.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'});res.end(content);}catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',socket=>{
 const send=frame=>socket.send(JSON.stringify({v:1,...frame}));
 const values=()=>({models,current:{provider:'codex',id:socket.model||'gpt-6.1-sol'},thinkingLevel:'medium',thinkingLevels:['medium'],context:{preset:'272k'}});
 socket.on('message',raw=>{
  const frame=JSON.parse(String(raw));
  if(frame.type==='list_sessions')send({type:'sessions',sessions:tasks});
  if(frame.type==='get_model_catalog')send({type:'model_catalog',requestId:frame.requestId,engine:'codex',...values()});
  if(frame.type==='open'){socket.task=frame.sessionId;send({type:'opened',engine:'codex',sessionId:frame.sessionId,state:{},capabilities:{models:true,stats:true,stop:true,followUp:true,rename:true}});send({type:'history',sessionId:frame.sessionId,entries:[]});}
  if(frame.type==='get_models')send({type:'models',requestId:frame.requestId,sessionId:socket.task,...values()});
  if(frame.type==='set_model'){socket.model=frame.id;send({type:'ack',operation:frame.type,requestId:frame.requestId});}
  if(frame.type==='set_thinking')send({type:'ack',operation:frame.type,requestId:frame.requestId});
  if(frame.type==='agent_command'){commands.push(frame);const answer=()=>send({type:'agent_command_result',requestId:frame.requestId,sessionId:socket.task,name:frame.name,text:JSON.stringify({goal:frame.args})});if(frame.args==='delayed')delayed=answer;else answer();}
  if(frame.type==='prompt'){prompts.push({model:socket.model,...frame});send({type:'ack',operation:'prompt',requestId:frame.requestId});server.emit('fixture-prompt');}
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(6000);
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-session-id="a"] .session-main').click();
 await page.locator('#prompt').fill('/goal Finish tests');await page.locator('#send').click();await page.locator('#native-command-result h2').filter({hasText:'Codex /goal'}).waitFor();
 if(commands.length!==1||prompts.length)throw Error('Goal became a prompt');await page.locator('#native-command-result button').click();
 await page.locator('#prompt').fill('/logout');await page.locator('#send').click();if(await page.locator('#prompt').inputValue()!=='/logout'||prompts.length)throw Error('Unsupported command lost draft or sent prompt');
 await page.locator('#prompt').fill('/export');const downloading=page.waitForEvent('download');await page.locator('#send').click();const download=await downloading;const exported=await readFile(await download.path(),'utf8');if(!exported.includes('Oldest message'))throw Error('Export was not downloaded');
 await page.locator('#prompt').fill('/goal delayed');await page.locator('#send').click();
 for(let i=0;i<50&&!delayed;i++)await page.waitForTimeout(10);if(!delayed)throw Error('Delayed request absent');
 await page.locator('#prompt').fill('/rename');await page.locator('#send').click();await page.locator('#modal-title').filter({hasText:'重命名'}).waitFor();delayed();await page.locator('#native-command-result').waitFor();
 if(!await page.locator('#modal-title').innerText().then(text=>text.includes('重命名')))throw Error('Command result replaced an existing dialog');await page.locator('#native-command-result button').click();await page.locator('#modal-cancel').click();delayed=undefined;
 await page.locator('#prompt').fill('/goal delayed');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#prompt').value==='/goal delayed');
 for(let i=0;i<50&&!delayed;i++)await page.waitForTimeout(10);if(!delayed)throw Error('Delayed request absent');
 await page.locator('[data-session-id="b"] .session-main').click();delayed();await page.waitForTimeout(100);if(await page.locator('#native-command-result').count())throw Error('Late native result painted another task');
 evidence.push({goalWithoutPrompt:true,unsupportedDraftRetained:true,exportDownload:true,lateResponseFenced:true,existingDialogPreserved:true});
 if(errors.length)throw Error(JSON.stringify(errors));
 const result={passed:true,evidence,errors};console.log(JSON.stringify(result));
 if(process.env.EVIDENCE_DIR){await mkdir(process.env.EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.EVIDENCE_DIR,'codex-commands.json'),JSON.stringify(result));}
}finally{await browser?.close();for(const socket of wss.clients)socket.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
