// Real Chromium + real app.js + synthetic HTTP/WS. No native CLI or model call.
// Run after npm run build; set BROWSER_EXECUTABLE for an installed Chromium.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('public'),tasks=['a','b','c'].map(id=>({id,name:'Synthetic '+id,engine:'codex',workspaceKind:'project',createdAt:'2026-10-06T00:00:00Z'}));
const models=new Map([['a','gpt-6.1-sol'],['b','gpt-6-luna']]);
const frames=[];
let forkResponse=null,holdPong=false,connections=0;
let holdModels=false;
const reply=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const identity={auth:true,user:'synthetic-model-preview-user'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/auth/me'){reply(res,identity);return;}
  if(path==='/api/me'){reply(res,null);return;}
  if(path==='/api/engines'){reply(res,{engines:[{id:'codex',available:true}],forkModes:{codex:['native']}});return;}
  if(path==='/api/workspace'){let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};if(body.action==='fork'){forkResponse=res;server.emit('fixture-fork');return;}if(['files','changes'].includes(body.action)){reply(res,{state:'local',files:[]});return;}if(body.action==='grant'){res.writeHead(404);res.end('{}');return;}reply(res,{projects:[],conversations:tasks,sidebar:{assignments:{},collapsed:[]}});return;}
  if(path.startsWith('/api/')){res.writeHead(404);res.end('{}');return;}
  const file=path==='/'||path.startsWith('/conversations/')?'index.html':path.slice(1);
  if(!/^[\w.-]+$/.test(file)){res.writeHead(404);res.end();return;}
  try{const body=await readFile(join(root,file));res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
const wsServer=new WebSocketServer({server,path:'/ws'});
const modelFrame=id=>({v:1,type:'models',models:[{provider:'codex',id:models.get(id)}],current:{provider:'codex',id:models.get(id)},thinkingLevel:'medium',thinkingLevels:['medium']});
wsServer.on('connection',ws=>{connections++;ws.on('message',raw=>{
  const f=JSON.parse(String(raw));if(f.type==='ping'){if(!holdPong)ws.send(JSON.stringify({v:1,type:'pong',nonce:f.nonce}));server.emit('fixture-ping');}frames.push({type:f.type,sessionId:f.sessionId});
  if(f.type==='list_sessions')ws.send(JSON.stringify({v:1,type:'sessions',sessions:tasks}));
  if(f.type==='open'){
    ws.taskId=f.sessionId;
    ws.send(JSON.stringify({v:1,type:'opened',engine:'codex',sessionId:f.sessionId,capabilities:{models:true,tools:true,stop:true},state:{isStreaming:false}}));
    ws.send(JSON.stringify({v:1,type:'history',sessionId:f.sessionId,entries:[{kind:'user',text:'Synthetic history '+f.sessionId}]}));
  }
  if(f.type==='get_models'&&models.has(ws.taskId)&&!holdModels)ws.send(JSON.stringify({...modelFrame(ws.taskId),requestId:f.requestId}));
});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const evidence=process.env.EVIDENCE_DIR||join(tmpdir(),'coffee-connection-probe-'+Date.now());await mkdir(evidence,{recursive:true});
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
  const base='http://127.0.0.1:'+server.address().port;
  const expectModel=async id=>{try{await page.waitForFunction(expected=>document.querySelector('#agent-name')?.textContent===expected,id,{timeout:5000});}catch{throw Error(JSON.stringify({expected:id,actual:await page.locator('#agent-name').textContent(),path:new URL(page.url()).pathname,frames:frames.slice(-20),errors}));}};
  await page.clock.install();
  await page.goto(base);await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  await page.locator('#session-list [data-session-id="b"]').click();await expectModel('gpt-6-luna');
  holdModels=true;await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  await page.waitForFunction(()=>document.querySelector('#send')?.title==='发送');
  if(!await page.locator('#agent-model-row').isDisabled())throw Error('Cached model enabled a missing authoritative catalog');
  holdModels=false;
  for(const ws of wsServer.clients)if(ws.taskId==='a'&&ws.readyState===1)ws.send(JSON.stringify(modelFrame('a')));
  await page.locator('#session-list [data-session-id="a"] .more').click();
  await page.getByRole('button',{name:'Fork（分叉）',exact:true}).click();
  const fork=once(server,'fixture-fork');await page.locator('#fork-confirm').click();await fork;
  const count=connections;
  const ping=once(server,'fixture-ping');await page.clock.runFor(16000);await ping;
  await page.clock.runFor(10000);
  if(connections!==count)throw Error('Heartbeat interrupted a healthy Fork');
  if(!await page.locator('#send').isDisabled())throw Error('Fork operation lock was lost');
  forkResponse.writeHead(400,{'content-type':'application/json'});forkResponse.end(JSON.stringify({error:'synthetic rejected fork'}));forkResponse=null;
  await page.clock.runFor(100);await page.locator('#fork-cancel').click();
  await page.locator('#prompt').fill('Synthetic preserved draft');
  holdPong=true;await page.clock.runFor(15000);await page.clock.runFor(11000);
  await page.clock.runFor(2000);
  if(connections<=count)throw Error('Silent transport did not reconnect');
  if(await page.locator('#prompt').inputValue()!=='Synthetic preserved draft')throw Error('Reconnect lost draft');
  if(errors.length)throw Error(JSON.stringify(errors));
  const result={pass:true,transport:'synthetic HTTP/WS',browser:browser.version(),cachedCatalogLocked:true,forkSurvivesHeartbeat:true,silenceReconnects:true,draftPreserved:true,errors};
  await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence}));
}finally{
  await browser?.close();for(const ws of wsServer.clients)ws.terminate();await new Promise(resolve=>wsServer.close(resolve));
  forkResponse?.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
