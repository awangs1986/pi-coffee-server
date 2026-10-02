// Local synthetic browser probe. Run after npm run build, then open the printed URL.
// No Host/native engine, user transcripts or external account is used.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('public');
const fixture=String.raw`
const started=performance.now();
const output=document.createElement('pre');output.id='probe-result';output.style='position:fixed;top:8px;left:260px;right:8px;max-height:35vh;overflow:auto;z-index:99999;background:#fff;color:#111;border:2px solid #333;padding:12px;font:12px monospace';document.body.append(output);
const report=value=>{output.textContent=JSON.stringify(value,null,2);};
const paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const conversations=Array.from({length:5},(_,i)=>({id:'probe-'+i,name:'Probe '+i,engine:'pi',workspaceKind:'chat',createdAt:'2026-10-01T00:00:00Z'}));
const sockets=[];
class Socket {static OPEN=1;readyState=1;constructor(){sockets.push(this);queueMicrotask(()=>this.onopen?.());}send(){}close(){}receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}}
window.WebSocket=Socket;
window.fetch=async(url,init)=>{
 const body=init?.body?JSON.parse(init.body):{};
 let data={};
 if(url==='/auth/me')data={user:'probe-owner',auth:true};
 else if(url==='/api/engines')data={engines:[{id:'pi',available:true}]};
 else if(url==='/api/workspace')data=body.action==='files'?null:{projects:[],conversations,sidebar:{assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}};
 return {ok:true,status:200,json:async()=>data};
};
try {
 await import('/app.js');await pause(50);await paint();
 const choose=i=>[...document.querySelectorAll('#session-list [role=button]')].find(n=>n.textContent.includes('Probe '+i)).click();
 if(sessionStorage.getItem('probe-phase')==='reload'){
  const deadline=performance.now()+3000;
  while(!document.querySelector('#thread').textContent.includes('Conversation 4 message 1499')&&performance.now()<deadline)await pause(5);
  await paint();
  const reloadMs=performance.now()-started;
  const previous=JSON.parse(sessionStorage.getItem('probe-results'));
  previous.reload={readable:document.querySelector('#thread').textContent.includes('Conversation 4 message 1499'),milliseconds:Math.round(reloadMs*10)/10,sendDisabled:document.querySelector('#send').disabled};
  const cached=[];
  for(let i=0;i<5;i++){
   const t=performance.now();choose(i);
   while(!document.querySelector('#thread').textContent.includes('Conversation '+i+' message 1499')&&performance.now()-t<3000)await pause(5);
   await paint();cached.push({conversation:i,milliseconds:Math.round((performance.now()-t)*10)/10,readable:document.querySelector('#thread').textContent.includes('Conversation '+i+' message 1499')});
  }
  previous.diskSwitches=cached;
  sessionStorage.removeItem('probe-phase');report(previous);
 }else{
  report({stage:'Preparing five synthetic long transcripts',messagesEach:1500,textCharactersEach:3000000});
  sockets.at(-1).receive({type:'sessions',sessions:conversations});await pause(20);
  for(let i=0;i<5;i++){
   choose(i);await pause(20);
   sockets.at(-1).receive({type:'opened',sessionId:'probe-'+i,engine:'pi',state:{isStreaming:false}});
   sockets.at(-1).receive({type:'history',sessionId:'probe-'+i,entries:Array.from({length:1500},(_,j)=>({kind:j%2?'assistant':'user',text:'Conversation '+i+' message '+j+' '+('A realistic cached text line.\n').repeat(70)}))});
   await paint();await pause(100);
  }
  const times=[];let correct=true;
  for(let repeat=0;repeat<5;repeat++)for(let i=0;i<5;i++){
   const t=performance.now();choose(i);await paint();times.push(performance.now()-t);
   correct&&=document.querySelector('#thread').textContent.includes('Conversation '+i+' message 1499');
  }
  const sorted=[...times].sort((a,b)=>a-b);
  const result={fixture:'5 conversations × 1,500 messages × ~2,030 characters; synthetic; browser viewport and CPU unthrottled',historyResponsesDuringSwitches:0,warmSwitches:times.length,correct,medianMs:Math.round(sorted[Math.floor(sorted.length/2)]*10)/10,p95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]*10)/10,maxMs:Math.round(Math.max(...times)*10)/10,scrollable:document.querySelector('#scroller').scrollHeight>document.querySelector('#scroller').clientHeight,renderedMessages:document.querySelectorAll('#thread .msg').length};
  sessionStorage.setItem('probe-results',JSON.stringify(result));sessionStorage.setItem('probe-phase','reload');
  await pause(1500);location.reload();
 }
}catch(error){report({error:error.stack||String(error)});}
`;
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/probe.js'){res.setHeader('content-type','text/javascript');res.end(fixture);return;}
  const file=path==='/'?'index.html':path.slice(1);
  if(file.includes('..')){res.writeHead(400);res.end();return;}
  let body=await readFile(resolve(root,file));
  if(file==='index.html')body=body.toString().replace(/<script[^>]+src=["']\/?app\.js["'][^>]*><\/script>/,'<script type="module" src="/probe.js"></script>');
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}
});
server.listen(Number(process.env.PORT||8787),'127.0.0.1',()=>console.log('Synthetic conversation probe: http://localhost:'+server.address().port));
