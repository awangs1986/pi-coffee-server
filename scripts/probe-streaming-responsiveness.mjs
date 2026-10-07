// Real browser app/HTTP/WS liveness with bounded dense historical replies.
// Synthetic data and streaming only; no native account or model call.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('dist/public');
if(!process.argv[2]){
 for(const scenario of ['dense','word']){const code=await new Promise(resolve=>{const child=spawn(process.execPath,[process.argv[1],scenario],{stdio:'inherit',env:process.env});child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});if(code)process.exit(code);}
 process.exit(0);
}
const mode=process.argv[2];if(!['dense','word'].includes(mode))throw Error('Choose dense or word');
let seq=0,activeSocket,base;
const task={id:'stream-fixture',name:'Stream fixture',engine:'pi',workspaceKind:'chat',creationState:'ready',archived:false,createdAt:'2026-10-07T00:00:00Z',updatedAt:'2026-10-07T00:00:00Z',messageCount:mode==='dense'?8:1,running:false};
const json=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
const files=[{path:'report.docx',available:true}];
const text=mode==='dense'?'X'.repeat(8000):'Download `report.docx` and plain report.docx.';
const entries=Array.from({length:mode==='dense'?8:1},(_,i)=>({id:'history-'+i,kind:'assistant',text}));
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://fixture').pathname;
 if(path==='/auth/me')return json(res,{auth:true,user:'synthetic-stream'});
 if(path==='/api/me')return json(res,null);
 if(path==='/api/engines')return json(res,{engines:[{id:'pi',available:true}]});
 if(path==='/api/workspace'){
  let input='';for await(const c of req)input+=c;const body=input?JSON.parse(input):{};
  if(body.action==='files')return json(res,{url:base,scope:task.id,token:'synthetic-grant'});
  if(body.action)return json(res,{state:'local',files:[]});
  return json(res,{projects:[],conversations:[task],sidebar:{showGroups:false,assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}});
 }
 if(path.endsWith('/artifacts'))return json(res,{artifacts:files});
 if(path.includes('missing.png')||path.endsWith('/preview')){res.statusCode=404;return res.end();}
 if(path.startsWith('/api/conversations/')){res.statusCode=404;return json(res,{error:'Native fixture'});}
 if(path.startsWith('/api/'))return json(res,{});
 const file=path==='/'||path.startsWith('/conversations/')?'index.html':path.slice(1);if(file.includes('..'))throw Error('invalid path');
 res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[extname(file)]||'application/octet-stream');res.end(await readFile(resolve(root,file)));
}catch{res.writeHead(404);res.end();}});
const ws=new WebSocketServer({server});
const send=(socket,frame)=>socket.send(JSON.stringify({v:1,...frame}));
ws.on('connection',socket=>{send(socket,{type:'sessions',sessions:[task]});socket.on('message',raw=>{const f=JSON.parse(raw);if(f.type==='list_sessions')send(socket,{type:'sessions',sessions:[task]});if(f.type==='open'){activeSocket=socket;send(socket,{type:'opened',sessionId:task.id,engine:'pi',state:{isStreaming:false,messageCount:entries.length},capabilities:{followUp:true,steer:true}});send(socket,{type:'history',sessionId:task.id,entries,leafId:entries.at(-1).id});}});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
let timer;const gaps=[];const bounded=p=>Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser event loop unresponsive')),2000);})]).finally(()=>clearTimeout(timer));
try{
 await page.addInitScript(()=>{window.__ticks=0;window.__longTasks=[];setInterval(()=>window.__ticks++,20);new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});});
 await page.goto(base+'/?syncProtocol=1',{waitUntil:'domcontentloaded',timeout:7000});await page.locator('[data-session-id="stream-fixture"] .session-main').click({timeout:5000});
 await new Promise(r=>setTimeout(r,1000));const before=await bounded(page.evaluate(()=>({ticks:window.__ticks,words:document.querySelectorAll('.generated-document-download').length})));
 const streamStarted=Date.now();const event=data=>send(activeSocket,{type:'event',sessionId:task.id,cursor:++seq,event:data});event({type:'agent_start'});
 
 for(let i=0;i<40;i++){
  event({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'Synthetic streaming response '+i+'. '}});
  await new Promise(r=>setTimeout(r,25));
  if(i%5===0){const began=Date.now();await bounded(page.evaluate(()=>window.__ticks));gaps.push(Date.now()-began);}
 }
 await page.locator('#prompt').fill('Synthetic draft',{timeout:1500});await new Promise(r=>setTimeout(r,100));const elapsedMs=Date.now()-streamStarted;const metrics=await bounded(page.evaluate(()=>({ticks:window.__ticks,longTasks:window.__longTasks.slice(-20),nodes:document.querySelectorAll('#thread *').length,streamSeen:document.querySelector('#thread').textContent.includes('Synthetic streaming response 39')})));
 const timerAdvance=metrics.ticks-before.ticks;const pass=timerAdvance>=elapsedMs/80&&Math.max(...gaps)<500&&metrics.streamSeen&&errors.length===0&&(mode!=='word'||before.words===2);console.log(JSON.stringify({mode,pass,before,elapsedMs,timerAdvance,roundTripMs:gaps,metrics,errors}));if(process.env.EVIDENCE_DIR){await mkdir(process.env.EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.EVIDENCE_DIR,'streaming-'+mode+'.json'),JSON.stringify({pass,mode,elapsedMs,timerAdvance,roundTripMs:gaps,metrics,errors})+'\n');}if(!pass)process.exitCode=1;
}catch(e){console.log(JSON.stringify({mode,pass:false,error:e.message,roundTripMs:gaps,errors}));process.exitCode=1;}
finally{await browser.close();for(const s of ws.clients)s.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));}
