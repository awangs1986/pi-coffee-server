// Synthetic loopback Browser/WS probe. No real accounts, agents or task files.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../public/',import.meta.url));
const tasks=['a','b'].map(id=>({id:'fixture-'+id,name:'Fixture '+id.toUpperCase(),engine:'pi',workspaceKind:'chat',creationState:'ready',cwd:'/fixture/chats/'+id,createdAt:'2026-10-03T00:00:00Z'}));
const workspace={vmId:'fixture',projects:[],conversations:tasks,sidebar:{assignments:{},collapsed:[]},capabilities:{chatWorkspaces:true}};
const prompts=[];
const model={provider:'fixture',id:'fixture-model',thinkingLevels:['low','medium','high']};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')||path==='/auth/me'){
   let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;
   if(body?.action==='conversation'){const task={...tasks[0],id:body.id,name:'New fixture task'};tasks.push(task);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(task));return;}
   const value=path==='/auth/me'?{auth:false}:path==='/api/me'?null:path==='/api/engines'?{engines:[{id:'pi',name:'Pi',available:true,modelCatalog:true}]}:body?.action==='files'?{url:origin,scope:'scoped-'+body.id,sessionId:body.id,token:'fixture',files:[]}:body?.action==='status'?{state:'local'}:body?.action==='changes'?{files:[],checks:[]}:workspace;
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));return;
  }
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root)){res.writeHead(403);res.end();return;}
  const content=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream'});res.end(content);
 }catch{res.writeHead(404);res.end();}
});
const wss=new WebSocketServer({server});
wss.on('connection',ws=>{let effort='low';ws.on('message',raw=>{
 const f=JSON.parse(String(raw));const emit=data=>ws.send(JSON.stringify(data));
 if(f.type==='list_sessions')emit({type:'sessions',sessions:tasks});
 if(f.type==='open'){emit({type:'opened',sessionId:f.sessionId,engine:'pi',state:{}});emit({type:'history',sessionId:f.sessionId,entries:[{kind:'user',text:'Synthetic acceptance fixture'},{kind:'assistant',text:'Ready for a browser continuity check.'}]});}
 if(f.type==='get_commands')emit({type:'commands',commands:[{name:'work',description:'Work fixture'}]});
 if(f.type==='get_model_catalog')emit({type:'model_catalog',engine:'pi',requestId:f.requestId,models:[model],current:model,thinkingLevels:model.thinkingLevels,thinkingLevel:'low'});
 if(f.type==='get_models')emit({type:'models',models:[model],current:model,thinkingLevels:model.thinkingLevels,thinkingLevel:effort});
 if(f.type==='set_model')emit({type:'ack',operation:'set_model',requestId:f.requestId});
 if(f.type==='set_thinking'){effort=f.level;emit({type:'ack',operation:'set_thinking',requestId:f.requestId});}
 if(f.type==='prompt')prompts.push({text:f.text,effort});
});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#agent-thinking-value').textContent==='med');
 await page.locator('#agent-menu-btn').click();await page.locator('#agent-thinking-row').click();await page.locator('#agent-thinking-pane button').filter({hasText:'high'}).click();
 await page.locator('#prompt').fill('Draft thinking fixture');await page.locator('#send').click();
 await page.waitForFunction(()=>document.querySelector('#prompt').value==='');
 for(let i=0;i<100&&!prompts.length;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(prompts,[{text:'Draft thinking fixture',effort:'high'}]);
 console.log('PASS draft med default and chosen high applied before first prompt');
 await page.locator('[data-session-id="fixture-a"]').click();await page.waitForFunction(()=>!document.querySelector('#prompt').disabled && document.querySelector('#thread').textContent.includes('Ready'));
 await page.locator('#prompt').fill('Draft for A');await page.locator('[data-session-id="fixture-b"]').click();await page.waitForFunction(()=>document.querySelector('#title').textContent==='Fixture B');assert.equal(await page.locator('#prompt').inputValue(),'');
 await page.locator('#prompt').fill('Draft for B');await page.locator('[data-session-id="fixture-a"]').click();assert.equal(await page.locator('#prompt').inputValue(),'Draft for A');
 await page.locator('#title').click();await page.locator('#modal-input').fill('Composing title');await page.locator('#modal-input').dispatchEvent('keydown',{key:'Enter',isComposing:true});assert.equal(await page.locator('#modal').isVisible(),true);
 await page.keyboard.press('Control+k');assert.equal(await page.locator('#title').textContent(),'Fixture A');await page.locator('#modal-ok').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'modal-input');await page.locator('#modal-cancel').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'title');
 console.log('PASS task-local drafts, IME confirmation, modal focus and background shortcut');
 for(const [width,height] of [[1440,900],[1024,768],[650,650],[390,600],[390,480]]){
  await page.setViewportSize({width,height});await page.locator('#prompt').fill('A long synthetic draft\n'.repeat(40));
  await page.evaluate(()=>{document.querySelector('#app').classList.add('side-collapsed');document.querySelector('#app').classList.remove('side-open');});
  const geometry=await page.evaluate(()=>{const composer=document.querySelector('#composer-card').getBoundingClientRect(),prompt=document.querySelector('#prompt').getBoundingClientRect(),send=document.querySelector('#send').getBoundingClientRect();return {width:composer.width,promptTop:prompt.top,sendBottom:send.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert(geometry.width>100 && geometry.promptTop>=0 && geometry.sendBottom<=height && !geometry.overflow,JSON.stringify({width,height,geometry}));
 }
 console.log('PASS five long-draft/collapsed-sidebar viewport geometries');
 if(process.env.PI_COFFEE_SMOKE_OUTPUT_DIR){await mkdir(process.env.PI_COFFEE_SMOKE_OUTPUT_DIR,{recursive:true});await page.screenshot({path:resolve(process.env.PI_COFFEE_SMOKE_OUTPUT_DIR,'frontend-continuity.png'),fullPage:true});}
 assert.deepEqual(errors,[]);console.log('PASS no page script errors');
}finally{await browser.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));}
