// Real Browser/controller with synthetic HTTP/WS. No account or model call.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve,extname} from 'node:path';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
import {once} from 'node:events';
const tasks=[],creates=[],prompts=[],errors=[],evidence=[];
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
  if(frame.type==='open'){socket.task=frame.sessionId;send({type:'opened',engine:'codex',sessionId:frame.sessionId,state:{},capabilities:{models:true,stats:true,stop:true,followUp:true}});send({type:'history',sessionId:frame.sessionId,entries:[]});}
  if(frame.type==='get_models')send({type:'models',requestId:frame.requestId,sessionId:socket.task,...values()});
  if(frame.type==='set_model'){socket.model=frame.id;send({type:'ack',operation:frame.type,requestId:frame.requestId});}
  if(frame.type==='set_thinking')send({type:'ack',operation:frame.type,requestId:frame.requestId});
  if(frame.type==='prompt'){prompts.push({model:socket.model,...frame});send({type:'ack',operation:'prompt',requestId:frame.requestId});server.emit('fixture-prompt');}
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:800}});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#agent-menu-btn').click();await page.locator('#agent-engine-row').click();await page.locator('#agent-engine-pane button').filter({hasText:'Codex'}).click();
  await page.locator('#agent-menu-btn').click();await page.locator('#agent-model-row').click();await page.locator('#agent-model-pane button').filter({hasText:'gpt-6-luna'}).click();
  const before=prompts.length,received=once(server,'fixture-prompt',{signal:AbortSignal.timeout(5000)});await page.locator('#prompt').fill('Synthetic Codex Chat '+width);await page.locator('#send').click();await received;
  await page.waitForFunction(()=>document.querySelector('#agent-name')?.textContent==='gpt-6-luna');
  const prompt=prompts.at(-1),create=creates.at(-1);
  if(prompts.length!==before+1||prompt?.model!=='gpt-6-luna'||create?.engine!=='codex'||create?.workspaceKind!=='chat'||create?.projectId)throw Error('Repository-free Luna draft was not submitted once: '+JSON.stringify({create,prompt}));
  if(!await page.locator('#sp-chat-actions').isVisible()&&await page.locator('#sp-chat-actions').evaluate(node=>node.classList.contains('hidden')))throw Error('Codex Chat clear action missing');
  evidence.push({width,engine:create.engine,workspaceKind:create.workspaceKind,model:prompt.model,noProject:true,promptCount:1});await page.close();
 }
 if(errors.length)throw Error(JSON.stringify(errors));
 const result={passed:true,evidence,errors};console.log(JSON.stringify(result));
 if(process.env.EVIDENCE_DIR){await mkdir(process.env.EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.EVIDENCE_DIR,'codex-chat.json'),JSON.stringify(result));}
}finally{await browser?.close();for(const socket of wss.clients)socket.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
