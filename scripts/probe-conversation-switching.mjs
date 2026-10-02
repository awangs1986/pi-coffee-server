// Local synthetic browser probe. Run after npm run build, then open the printed URL.
// No Host/native engine, user transcripts or external account is used.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('public');
const fixture=String.raw`
const started=performance.now();
const transportFetch=window.fetch.bind(window),errors=[];let authVerifiedAt;
window.addEventListener('error',e=>errors.push(e.message));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const phaseKey='probe-v3-phase',resultKey='probe-v3-results',longTasks=[];
if(PerformanceObserver.supportedEntryTypes.includes('longtask'))new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
const output=document.createElement('pre');output.id='probe-result';output.style='position:fixed;top:8px;left:260px;right:8px;max-height:35vh;overflow:auto;z-index:99999;background:#fff;color:#111;border:2px solid #333;padding:12px;font:12px monospace';document.body.append(output);
const report=value=>{output.textContent=JSON.stringify({pass:value.pass,medianMs:value.medianMs,p95Ms:value.p95Ms,maxMs:value.maxMs,reload:value.reload,diskSwitches:value.diskSwitches,...value},null,2);};
const publish=async value=>{report(value);await transportFetch('/probe-result',{method:'POST',body:JSON.stringify(value,null,2)});};
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const conversations=Array.from({length:5},(_,i)=>({id:'probe-'+i,name:'Probe '+i,engine:'pi',workspaceKind:'chat',createdAt:'2026-10-01T00:00:00Z'}));
const sockets=[];
class Socket {static OPEN=1;readyState=1;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}send(){}close(){}receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}}
window.WebSocket=Socket;
window.fetch=async(url,init)=>{
 const body=init?.body?JSON.parse(init.body):{};
 let data={};
 if(url==='/auth/me'){await pause(300);authVerifiedAt=performance.now();data={user:'probe-owner',auth:true};}
 else if(url==='/api/me')data=null;
 else if(url==='/api/engines')data={engines:[{id:'pi',available:true}]};
 else if(url==='/api/workspace')data=body.action==='files'?null:{projects:[],conversations,sidebar:{assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}};
 return {ok:true,status:200,json:async()=>data};
};
try {
 await import('/app.js');
 const waitFor=async predicate=>{const deadline=performance.now()+5000;while(!predicate()){if(performance.now()>deadline)throw new Error('Probe readiness timed out');await pause(5);}};
 await waitFor(()=>document.querySelectorAll('#session-list [data-session-id]').length===5&&sockets.length);await paint();
 const choose=i=>{const row=document.querySelector('#session-list [data-session-id="probe-'+i+'"]');if(!row)throw new Error('Missing conversation '+i);row.click();};
 const readable=i=>document.querySelector('#thread').textContent.includes('Conversation '+i+' message 1499');
 const scroll=async()=>{const scroller=document.querySelector('#scroller'),before=scroller.scrollTop;scroller.scrollTop=before>10?before-10:before+10;await paint();return {overflow:scroller.scrollHeight>scroller.clientHeight,moved:scroller.scrollTop!==before};};
 const measure=async i=>{const t=performance.now();choose(i);await waitFor(()=>readable(i));await paint();const result=await scroll();return {conversation:i,milliseconds:Math.round((performance.now()-t)*10)/10,readable:readable(i),scrollable:result.overflow&&result.moved,sendDisabled:document.querySelector('#send').disabled};};
 if(sessionStorage.getItem(phaseKey)==='reload'){
  const deadline=performance.now()+3000;
  while(!document.querySelector('#thread').textContent.includes('Conversation 4 message 1499')&&performance.now()<deadline)await pause(5);
  await paint();
  const reloadMs=performance.now()-started;
  const previous=JSON.parse(sessionStorage.getItem(resultKey));
  previous.reload={authDelayMs:300,authVerifiedMs:Math.round(authVerifiedAt-started),afterAuthMs:Math.round(performance.now()-authVerifiedAt),readable:document.querySelector('#thread').textContent.includes('Conversation 4 message 1499'),milliseconds:Math.round(reloadMs*10)/10,sendDisabled:document.querySelector('#send').disabled};
  const cached=[];for(let i=0;i<5;i++)cached.push(await measure(i));
  previous.diskSwitches=cached;previous.errors=errors;
  previous.pass=previous.warmResults.every(r=>r.readable&&r.scrollable&&r.sendDisabled&&r.milliseconds<1000)&&previous.rapid.correct&&previous.background.correct&&cached.every(r=>r.readable&&r.scrollable&&r.sendDisabled&&r.milliseconds<1000)&&previous.reload.readable&&previous.reload.sendDisabled&&errors.length===0;
  sessionStorage.removeItem(phaseKey);await publish(previous);
 }else{
  report({stage:'Preparing five synthetic long transcripts',messagesEach:1500,textCharactersEach:3000000});
  sockets.at(-1).receive({type:'sessions',sessions:conversations});await pause(20);
  for(let i=0;i<5;i++){
   choose(i);await pause(350);
   sockets.at(-1).receive({type:'opened',sessionId:'probe-'+i,engine:'pi',state:{isStreaming:false}});
   sockets.at(-1).receive({type:'history',sessionId:'probe-'+i,entries:Array.from({length:1500},(_,j)=>({kind:j%2?'assistant':'user',text:'Conversation '+i+' message '+j+' '+('A realistic cached text line.\n').repeat(70)}))});
   await paint();await pause(100);if(!readable(i))throw new Error('Initial history not delivered for '+i);
  }
  const coldPreparedMs=Math.round(performance.now()-started);
  const warmResults=[],warmStarted=performance.now();
  for(let repeat=0;repeat<5;repeat++)for(let i=0;i<5;i++)warmResults.push(await measure(i));
  const warmEnded=performance.now();
  const rapidStart=performance.now();choose(0);choose(1);choose(0);await paint();const rapidScroll=await scroll();
  const rapid={milliseconds:Math.round(performance.now()-rapidStart),correct:readable(0)&&rapidScroll.moved&&document.querySelector('#send').disabled};
  const oldSocket=sockets.at(-1);choose(1);await paint();oldSocket.receive({type:'history',sessionId:'probe-0',entries:[{kind:'assistant',text:'STALE A MUST NOT REPLACE B'}]});await paint();
  const staleIgnored=readable(1)&&!document.querySelector('#thread').textContent.includes('STALE A');
  await pause(1200);const syncStart=performance.now();
  const currentSocket=sockets.at(-1);currentSocket.receive({type:'opened',sessionId:'probe-1',engine:'pi',state:{isStreaming:false}});
  currentSocket.receive({type:'history',sessionId:'probe-1',entries:Array.from({length:1500},(_,j)=>({kind:j%2?'assistant':'user',text:'Conversation 1 message '+j+' '+('A realistic cached text line.\n').repeat(70)})).concat({kind:'assistant',text:'BACKGROUND SYNC COMPLETE'})});await paint();
  const background={delayMs:1200,renderMs:Math.round(performance.now()-syncStart),correct:staleIgnored&&document.querySelector('#thread').textContent.includes('BACKGROUND SYNC COMPLETE')&&(await scroll()).moved};
  choose(4);await paint();
  const sorted=warmResults.map(r=>r.milliseconds).sort((a,b)=>a-b);
  const result={browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight},host:'synthetic transport; no Host/native engine',warmLongTasks:longTasks.filter(e=>e.start>=warmStarted&&e.start<=warmEnded),fixture:'5 conversations × 1,500 messages × ~2,030 characters; synthetic; browser viewport and CPU unthrottled',coldPreparationMs:coldPreparedMs,authDelayMs:300,historyResponsesDuringWarmSwitches:0,warmSwitches:warmResults.length,warmResults,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:Math.max(...sorted),rapid,background,renderedMessages:document.querySelectorAll('#thread .msg').length};
  await publish(result);sessionStorage.setItem(resultKey,JSON.stringify(result));sessionStorage.setItem(phaseKey,'reload');
  await pause(1500);location.reload();
 }
}catch(error){await publish({...JSON.parse(sessionStorage.getItem(resultKey)||'{}'),error:error.stack||String(error)});sessionStorage.removeItem(phaseKey);}
`;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/probe-result'&&req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw new Error('Result too large');}await writeFile('/tmp/pi-coffee-browser-probe.json',body);res.end('saved');return;}
  if(path==='/probe.js'){res.setHeader('content-type','text/javascript');res.end(fixture);return;}
  const file=path==='/'?'index.html':path.slice(1);
  if(file.includes('..')||file.startsWith('/')){res.writeHead(400);res.end();return;}
  let body=await readFile(resolve(root,file));
  if(file==='index.html')body=body.toString().replace(/<script[^>]+src=["']\/?app\.js["'][^>]*><\/script>/,'<script type="module" src="/probe.js"></script>');
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Synthetic conversation probe: http://localhost:'+server.address().port));
