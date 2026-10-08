// Real Chromium + real HTTP/WS, synthetic native boundaries; no model calls.
// npm run build && node scripts/probe-completion-icon.mjs
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('dist/public');
let runStatus='settled',grouped=true,completionId='completion-1';
const sessions=()=>['completed','untouched'].map((id,i)=>({id,name:`Synthetic ${id}`,engine:'pi',createdAt:`2026-10-06T00:00:0${i}Z`,updatedAt:'2026-10-06T01:00:00Z',messageCount:2,preview:'Synthetic fixture',running:id==='completed'&&runStatus==='running',...(id==='completed'?{runStatus,completionId}:{})}));
const json=(res,data)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/auth/me')return json(res,{auth:true,user:'synthetic-completion'});
  if(path==='/api/me')return json(res,null);
  if(path==='/api/engines')return json(res,{engines:[{id:'pi',available:true}]});
  if(path==='/api/workspace')return json(res,{projects:[],conversations:sessions().map(s=>({...s,workspaceKind:'chat'})),sidebar:{showGroups:grouped,assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}});
  if(path.startsWith('/api/conversations/')){res.statusCode=404;return json(res,{error:'Native fixture'});}
  if(path.startsWith('/api/'))return json(res,{});
  const file=path==='/'||path.startsWith('/conversations/')?'index.html':path.slice(1);
  if(file.includes('..')){res.writeHead(400);return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(resolve(root,file)));
 }catch{res.writeHead(404);res.end();}
});
const ws=new WebSocketServer({server});
ws.on('connection',socket=>{
 const send=frame=>socket.send(JSON.stringify({v:1,...frame}));
 send({type:'sessions',sessions:sessions()});
 socket.on('message',raw=>{
  const f=JSON.parse(raw);
  if(f.type==='list_sessions')send({type:'sessions',sessions:sessions()});
  if(f.type==='open'){
   send({type:'opened',sessionId:f.sessionId,engine:'pi',state:{isStreaming:false},capabilities:{}});
   send({type:'history',sessionId:f.sessionId,completionId,entries:[{kind:'assistant',id:'fixture',text:'Synthetic completed reply'}]});
  }
 });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const evidence=[];
try{
 for(grouped of [true,false]){
  runStatus='settled';completionId='completion-1';const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?syncProtocol=1`);
  const row=page.locator('[data-session-id="completed"]');await row.locator('.finished-coffee').waitFor();
  assert.equal(await page.locator('[data-session-id="untouched"] .finished-coffee').count(),0);
  await page.addInitScript(()=>Object.defineProperty(document,'visibilityState',{get:()=>window.fixtureVisibility||'visible'}));
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{get:()=>window.fixtureVisibility||'visible',configurable:true});window.fixtureVisibility='hidden';});
  await row.locator('.session-main').click();await page.locator('#thread').getByText('Synthetic completed reply').waitFor();
  assert.equal(await row.locator('.finished-coffee').count(),1,'A hidden tab must not acknowledge completion');
  await page.evaluate(()=>{window.fixtureVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>!document.querySelector('[data-session-id="completed"] .finished-coffee'));
  assert.equal(await row.locator('.finished-coffee').count(),0,'Reading the latest completed reply must clear the coffee indicator');
  await page.reload();await page.locator('#thread').getByText('Synthetic completed reply').waitFor();
  assert.equal(await row.locator('.finished-coffee').count(),0,'Read completion must stay hidden after reload');
  const order=await page.locator('#session-list [data-session-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sessionId));
  runStatus='running';for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'sessions',sessions:sessions()}));
  await row.locator('.sidebar-running-cat').waitFor();assert.equal(await row.locator('.finished-coffee').count(),0);
  // A later completion cannot be acknowledged against the previous reply.
  completionId='completion-2';runStatus='settled';for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'sessions',sessions:sessions()}));
  await row.locator('.finished-coffee').waitFor();
  for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'history',sessionId:'completed',completionId:'completion-1',entries:[{kind:'assistant',id:'fixture',text:'Synthetic completed reply'}]}));
  await page.waitForTimeout(100);assert.equal(await row.locator('.finished-coffee').count(),1,'Stale history must not read a new completion');
  for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'history',sessionId:'completed',completionId,entries:[{kind:'assistant',id:'fixture-2',text:'Synthetic next completed reply'}]}));
  await page.waitForFunction(()=>!document.querySelector('[data-session-id="completed"] .finished-coffee'));
  runStatus='interrupted';for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'sessions',sessions:sessions()}));
  await page.waitForFunction(()=>!document.querySelector('[data-session-id="completed"] .sidebar-running-cat'));
  assert.equal(await row.locator('.finished-coffee').count(),0);
  if(!grouped)assert.deepEqual(await page.locator('#session-list [data-session-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sessionId)),order);
  assert.deepEqual(errors,[]);evidence.push({grouped,readSurvivesReload:true,newCompletionUnread:true,staleHistoryRejected:true,hiddenTabUnread:true,untouchedNoCoffee:true,runningOverrides:true,interruptedNoCoffee:true,pageErrors:errors.length});
  await page.close();
 }
 const result={passed:true,evidence};
 if(process.env.EVIDENCE_DIR){await mkdir(process.env.EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.EVIDENCE_DIR,'completion-icon.json'),JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result));
}finally{await browser.close();for(const socket of ws.clients)socket.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));}
