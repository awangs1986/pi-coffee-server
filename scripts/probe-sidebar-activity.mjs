// Real Chromium + real HTTP/WS, synthetic native boundaries; no model calls.
// npm run build && node scripts/probe-sidebar-activity.mjs
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('dist/public');
let grouped=true,telemetry=false;
const day=new Date();day.setHours(12,0,0,0);
const at=(days,minutes=0)=>new Date(day.getTime()-days*86400000+minutes*60000).toISOString();
const tasks=[
 {id:'old-task',name:'Old task, new conversation',engine:'pi',workspaceKind:'chat',createdAt:at(3),lastActivityAt:at(0,-60)},
 {id:'new-task',name:'Newer task, older conversation',engine:'pi',workspaceKind:'chat',createdAt:at(2),lastActivityAt:at(1)},
 {id:'pin',name:'Pinned task',engine:'pi',workspaceKind:'chat',createdAt:at(5)},
];
const sessions=()=>tasks.map(({lastActivityAt,...s})=>({...s,updatedAt:telemetry?at(0,60):s.createdAt,messageCount:2,running:telemetry&&s.id==='new-task'}));
const json=(res,data)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://fixture').pathname;
  if(path==='/auth/me')return json(res,{auth:true,user:'synthetic-completion'});
  if(path==='/api/me')return json(res,null);
  if(path==='/api/engines')return json(res,{engines:[{id:'pi',available:true}]});
  if(path==='/api/workspace')return json(res,{projects:[],conversations:tasks,sidebar:{showGroups:grouped,groups:[{id:'project-group',name:'Synthetic project'}],assignments:{'old-task':'project-group','new-task':'project-group'},collapsed:[],pinned:['pin']},capabilities:{chatWorkspaces:true}});
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
   send({type:'history',sessionId:f.sessionId,entries:[{kind:'assistant',id:'fixture',text:'Synthetic sidebar reply'}]});
  }
 });
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const evidence=[];
try{
 for(grouped of [true,false]){
  telemetry=false;tasks[0].lastActivityAt=at(0,-60);tasks[1].lastActivityAt=at(1);
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?syncProtocol=1`);
  const old=page.locator('[data-session-id="old-task"]');await old.waitFor();
  const ids=()=>page.locator('#session-list [data-session-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sessionId));
  assert.deepEqual(await ids(),['pin','old-task','new-task']);
  if(!grouped)assert.equal(await old.evaluate(n=>n.previousElementSibling.textContent),'今天');
  await old.locator('.session-main').click();await page.locator('#thread').getByText('Synthetic sidebar reply').waitFor();
  await page.reload();await old.waitFor();assert.deepEqual(await ids(),['pin','old-task','new-task']);
  telemetry=true;for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'sessions',sessions:sessions()}));
  await page.locator('[data-session-id="new-task"] .sidebar-running-cat').waitFor();
  assert.deepEqual(await ids(),['pin','old-task','new-task'],'Streaming telemetry reordered durable activity');
  tasks[1].lastActivityAt=at(0,2);
  for(const socket of ws.clients)socket.send(JSON.stringify({v:1,type:'sessions',sessions:sessions()}));
  await page.waitForFunction(()=>[...document.querySelectorAll('#session-list [data-session-id]')].map(n=>n.dataset.sessionId).join(',')==='pin,new-task,old-task');
  if(!grouped)assert.equal(await page.locator('[data-session-id="new-task"]').evaluate(n=>n.previousElementSibling.textContent),'今天');
  assert.deepEqual(errors,[]);evidence.push({grouped,recentOrder:true,todayBucket:!grouped,reload:true,telemetryStable:true,newConversationMoves:true,pinsRetained:true,pageErrors:0});
  await page.close();
 }
 const result={passed:true,evidence};
 if(process.env.EVIDENCE_DIR){await mkdir(process.env.EVIDENCE_DIR,{recursive:true});await writeFile(resolve(process.env.EVIDENCE_DIR,'sidebar-activity.json'),JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify(result));
}finally{await browser.close();for(const socket of ws.clients)socket.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));}
