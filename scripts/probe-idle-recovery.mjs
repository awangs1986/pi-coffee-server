// Real Chromium idle/wake recovery at the actual app-controller/HTTP/WS seam.
// Browser timer throttling is injected; no native CLI, production data or model call.
// Run after npm run build; set BROWSER_EXECUTABLE for an installed Chromium.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('public'),tasks=['a','b','c'].map(id=>({id,name:'Synthetic '+id,engine:'codex',workspaceKind:'project',createdAt:'2026-10-06T00:00:00Z'}));
let latest='INITIAL_REPLY';
const models=new Map([['a','gpt-6.1-sol'],['b','gpt-6-luna']]);
const frames=[];
let connections=0;
const reply=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const identity={auth:true,user:'synthetic-model-preview-user'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/auth/me'){reply(res,identity);return;}
  if(path==='/api/me'){reply(res,null);return;}
  if(path==='/api/engines'){reply(res,{engines:[{id:'codex',available:true}]});return;}
  if(path==='/api/workspace'){let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};if(['files','changes'].includes(body.action)){reply(res,{state:'local',files:[]});return;}if(body.action==='grant'){res.writeHead(404);res.end('{}');return;}reply(res,{projects:[],conversations:tasks,sidebar:{assignments:{},collapsed:[]}});return;}
  if(path.startsWith('/api/')){res.writeHead(404);res.end('{}');return;}
  const file=path==='/'||path.startsWith('/conversations/')?'index.html':path.slice(1);
  if(!/^[\w.-]+$/.test(file)){res.writeHead(404);res.end();return;}
  try{const body=await readFile(join(root,file));res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
const wsServer=new WebSocketServer({server,path:'/ws'});
const modelFrame=id=>({v:1,type:'models',models:[{provider:'codex',id:models.get(id)}],current:{provider:'codex',id:models.get(id)},thinkingLevel:'medium',thinkingLevels:['medium']});
wsServer.on('connection',ws=>{connections++;ws.on('message',raw=>{
  const f=JSON.parse(String(raw));if(f.type==='ping'){ws.send(JSON.stringify({v:1,type:'pong',nonce:f.nonce}));}frames.push({type:f.type,sessionId:f.sessionId});
  if(f.type==='list_sessions')ws.send(JSON.stringify({v:1,type:'sessions',sessions:tasks}));
  if(f.type==='open'){
    ws.taskId=f.sessionId;
    ws.send(JSON.stringify({v:1,type:'opened',engine:'codex',sessionId:f.sessionId,capabilities:{models:true,tools:true,stop:true},state:{isStreaming:false}}));
    ws.send(JSON.stringify({v:1,type:'history',sessionId:f.sessionId,entries:[{kind:'user',text:'Synthetic history '+f.sessionId},{kind:'assistant',text:latest}]}));
  }
  if(f.type==='get_models'&&models.has(ws.taskId))ws.send(JSON.stringify({...modelFrame(ws.taskId),requestId:f.requestId}));
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
  // Foreground but unfocused (e.g. a second monitor). Healthy idle must
  // continue delivering replies without a navigation gesture.
  await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  for(let tick=0;tick<12;tick++){await page.clock.runFor(15000);await new Promise(resolve=>setTimeout(resolve,30));}
  for(const ws of wsServer.clients)if(ws.taskId==='b'&&ws.readyState===1)ws.send(JSON.stringify({v:1,type:'event',sessionId:'b',event:{type:'message_completed',id:'idle-reply',text:'IDLE_LIVE_REPLY'}}));
  await new Promise(resolve=>setTimeout(resolve,50));await page.clock.runFor(32);
  try{await page.locator('#thread').filter({hasText:'IDLE_LIVE_REPLY'}).waitFor({timeout:2000});}catch{throw Error(JSON.stringify({phase:'unfocused',connections,clients:[...wsServer.clients].map(ws=>({task:ws.taskId,state:ws.readyState})),frames:frames.slice(-30),dom:await page.locator('#thread').textContent(),errors}));}
  // Emulate delayed timer admission after background/sleep throttling. Network
  // close events may be delivered before an already scheduled retry can run.
  // Returning focus must restore the selected task without clicking its row.
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now())));
  latest='REPLY_WHILE_AWAY';
  const beforeWake=connections;
  for(const ws of wsServer.clients)ws.close();
  await page.locator('#conn-banner:not(.hidden)').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await new Promise(resolve=>setTimeout(resolve,80));await page.clock.runFor(32);
  try { await page.waitForFunction(()=>document.querySelector('#thread')?.textContent.includes('REPLY_WHILE_AWAY'),null,{timeout:2000}); }
  catch {
    // A click is a diagnostic control, not a required part of recovery.
    await page.locator('#session-list [data-session-id="a"]').click();await page.locator('#session-list [data-session-id="b"]').click();
    await new Promise(resolve=>setTimeout(resolve,80));await page.clock.runFor(32);
    await page.waitForFunction(()=>document.querySelector('#thread')?.textContent.includes('REPLY_WHILE_AWAY'));
    throw Error('Idle recovery failed: focus did not restore the selected reply; clicking the conversation did. '+JSON.stringify({beforeWake,connections,frames:frames.slice(-12)}));
  }
  if(connections<=beforeWake)throw Error('Wake did not reopen the disconnected subscription');
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('resume'));});
  await new Promise(resolve=>setTimeout(resolve,80));await page.clock.runFor(32);
  if(connections!==beforeWake+1)throw Error('Wake events replaced a healthy subscription');
  // Suspend the first identity response, as can happen during a network handover.
  // The second request succeeds; the abandoned response must not create another socket.
  let heldIdentity=null,identityAttempts=0;
  await page.route('**/auth/me',route=>{
    identityAttempts++;
    if(identityAttempts===1){heldIdentity=route;return;}
    return route.continue();
  });
  latest='REPLY_AFTER_IDENTITY_TIMEOUT';
  await page.locator('#prompt').fill('Preserved background draft');
  for(const ws of wsServer.clients)ws.close();
  await page.locator('#conn-banner:not(.hidden)').waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  for(let attempt=0;attempt<100&&!heldIdentity;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  if(!heldIdentity)throw Error('Identity timeout fixture did not intercept a request');
  await page.clock.runFor(10000);
  await page.clock.runFor(4000);
  for(let attempt=0;attempt<30;attempt++){await new Promise(resolve=>setTimeout(resolve,30));await page.clock.runFor(32);if(await page.locator("#thread").textContent().then(text=>text.includes("REPLY_AFTER_IDENTITY_TIMEOUT")))break;}
  await page.waitForFunction(()=>document.querySelector('#thread')?.textContent.includes('REPLY_AFTER_IDENTITY_TIMEOUT'),null,{timeout:2000});
  const recoveredConnections=connections;
  await heldIdentity.fulfill({status:200,contentType:'application/json',body:JSON.stringify(identity)}).catch(()=>{});
  await new Promise(resolve=>setTimeout(resolve,50));await page.clock.runFor(32);
  if(connections!==recoveredConnections)throw Error('Obsolete identity response replaced recovered socket');
  if(await page.locator('#prompt').inputValue()!=='Preserved background draft')throw Error('Recovery lost unsent draft');
  if(errors.length)throw Error(JSON.stringify(errors));
  const result={pass:true,transport:'synthetic HTTP/WS with throttled Browser timers',browser:browser.version(),unfocusedIdleUpdates:true,focusRestoresLatestWithoutClick:true,wakeKeepsHealthySubscription:true,identityTimeoutRestoresLatest:true,lateIdentityIgnored:true,errors};
  await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence}));
}finally{
  await browser?.close();for(const ws of wsServer.clients)ws.terminate();await new Promise(resolve=>wsServer.close(resolve));
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
