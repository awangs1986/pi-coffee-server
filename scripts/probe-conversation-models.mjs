// Real Chromium + real app.js + synthetic HTTP/WS. No native CLI or model call.
// Run after npm run build; set BROWSER_EXECUTABLE for an installed Chromium.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('public'),tasks=['a','b','c'].map(id=>({id,name:'Synthetic '+id,engine:'codex',workspaceKind:'project',createdAt:'2026-10-06T00:00:00Z'}));
const models=new Map([['a','gpt-6.1-sol'],['b','gpt-6-luna']]);
const heldAuth=new Set(),heldWorkspace=new Set(),mutations=[],frames=[];
let holdAuth=false,holdWorkspace=false,holdModels=false;
const reply=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const identity={auth:true,user:'synthetic-model-preview-user'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/auth/me'){if(holdAuth){heldAuth.add(res);return;}reply(res,identity);return;}
  if(path==='/api/me'){reply(res,null);return;}
  if(path==='/api/engines'){reply(res,{engines:[{id:'codex',available:true}]});return;}
  if(path==='/api/workspace'){let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};if(['files','changes'].includes(body.action)){reply(res,{state:'local',files:[]});return;}if(body.action==='grant'){res.writeHead(404);res.end('{}');return;}if(holdWorkspace){heldWorkspace.add(res);return;}reply(res,{projects:[],conversations:tasks,sidebar:{assignments:{},collapsed:[]}});return;}
  if(path.startsWith('/api/')){res.writeHead(404);res.end('{}');return;}
  const file=path==='/'||path.startsWith('/conversations/')?'index.html':path.slice(1);
  if(!/^[\w.-]+$/.test(file)){res.writeHead(404);res.end();return;}
  try{const body=await readFile(join(root,file));res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
const wsServer=new WebSocketServer({server,path:'/ws'});
const modelFrame=id=>({v:1,type:'models',models:[{provider:'codex',id:models.get(id)}],current:{provider:'codex',id:models.get(id)},thinkingLevel:'medium',thinkingLevels:['medium']});
wsServer.on('connection',ws=>ws.on('message',raw=>{
  const f=JSON.parse(String(raw));frames.push({type:f.type,sessionId:f.sessionId});if(f.type.startsWith('set_'))mutations.push(f.type);
  if(f.type==='list_sessions')ws.send(JSON.stringify({v:1,type:'sessions',sessions:tasks}));
  if(f.type==='open'){
    ws.taskId=f.sessionId;
    ws.send(JSON.stringify({v:1,type:'opened',engine:'codex',sessionId:f.sessionId,capabilities:{models:true,tools:true,stop:true},state:{isStreaming:false}}));
    ws.send(JSON.stringify({v:1,type:'history',sessionId:f.sessionId,entries:[{kind:'user',text:'Synthetic history '+f.sessionId}]}));
  }
  if(f.type==='get_models'&&models.has(ws.taskId)&&!holdModels)ws.send(JSON.stringify(modelFrame(ws.taskId)));
}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const evidence=process.env.EVIDENCE_DIR||join(tmpdir(),'coffee-model-preview-probe-'+Date.now());await mkdir(evidence,{recursive:true});
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
  const base='http://127.0.0.1:'+server.address().port;
  const expectModel=async id=>{try{await page.waitForFunction(expected=>document.querySelector('#agent-name')?.textContent===expected,id,{timeout:5000});}catch{throw Error(JSON.stringify({expected:id,actual:await page.locator('#agent-name').textContent(),path:new URL(page.url()).pathname,frames:frames.slice(-20),errors}));}};
  await page.goto(base);await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  await page.locator('#session-list [data-session-id="b"]').click();await expectModel('gpt-6-luna');
  holdAuth=true;holdModels=true;
  const immediate=await page.evaluate(()=>{document.querySelector('#session-list [data-session-id="a"]').click();return {model:document.querySelector('#agent-name').textContent,path:location.pathname};});
  if(immediate.model!=='gpt-6.1-sol')throw Error('Previous conversation model leaked during blocked authentication: '+JSON.stringify(immediate));
  await page.waitForTimeout(50);holdAuth=false;for(const res of heldAuth)reply(res,identity);heldAuth.clear();
  await expectModel('gpt-6.1-sol');
  await page.screenshot({path:join(evidence,'cached-model.png')});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{clearInterval(timer);reject(Error('Native fixture open did not arrive'));},5000);const timer=setInterval(()=>{if([...wsServer.clients].some(ws=>ws.taskId==='a'&&ws.readyState===1)){clearTimeout(timeout);clearInterval(timer);resolve();}},10);});
  models.set('a','gpt-6.1-new');for(const ws of wsServer.clients)if(ws.taskId==='a'&&ws.readyState===1)ws.send(JSON.stringify(modelFrame('a')));
  await expectModel('gpt-6.1-new');
  holdWorkspace=true;await page.reload();await expectModel('gpt-6.1-new');
  if(mutations.length||errors.length)throw Error(JSON.stringify({mutations,errors}));
  const result={pass:true,transport:'synthetic HTTP/WS',browser:browser.version(),immediate,corrected:'gpt-6.1-new',reloadWhileWorkspaceBlocked:true,settingMutations:mutations,errors};
  await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence}));
}finally{
  await browser?.close();for(const ws of wsServer.clients)ws.terminate();await new Promise(resolve=>wsServer.close(resolve));
  for(const res of [...heldAuth,...heldWorkspace])res.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
