// Real Chromium + Browser/Web/Host; synthetic native adapters, no account/model call.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';
import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';
const evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/question-replay-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),results=[];
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 for(const engine of ['pi','codex']){
  const sessions=new Map();
  const transcript=Array.from({length:28},(_,i)=>({kind:'assistant',text:'Context line '+i}));
  const factory={list:async()=>[],delete:async()=>false,capabilities:async()=>({questions:true,stop:true}),create:async({sessionId})=>{
   const listeners=new Set(),answers=[];
   const session={id:sessionId,answers,state:{isStreaming:false},emit(event){for(const listener of listeners)listener(event);},onEvent(listener){listeners.add(listener);return()=>listeners.delete(listener);},getState:async()=>session.state,getHistory:async()=>({entries:answers.length?[...transcript,{kind:'assistant',text:'ACCEPTED_ANSWER_HISTORY'}]:transcript,leafId:null}),respondUi:async(answer)=>{answers.push(answer);},abort:async()=>{session.state.isStreaming=false;session.emit({type:'agent_settled'});},stop:async()=>{},prompt:async()=>{throw Error('Probe must not call a model');}};
   sessions.set(sessionId,session);return session;
  }};
  const workspaces=new Workspaces(join(root,engine));await workspaces.createChatConversation('question-'+engine,engine);
  const host=new HostServer({host:'127.0.0.1',port:0,token:'synthetic',factory,workspaces});await host.start();
  const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:'ws://127.0.0.1:'+host.address().port+'/host',hostToken:'synthetic',defaultUser:'fixture'});await web.start();
  const page=await browser.newPage(engine==='codex'?{viewport:{width:390,height:844}}:{}),errors=[],responses=[];let navigations=0;
  page.on('websocket',socket=>socket.on('framesent',({payload})=>{const frame=JSON.parse(String(payload));if(frame.type==='ui_response')responses.push(frame);}));
  page.on('pageerror',error=>errors.push(error.message));page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await page.addInitScript(()=>{
   const Original=window.WebSocket;
   window.WebSocket=class extends Original{constructor(...args){super(...args);window.probeSocket=this;this.addEventListener('message',event=>{const f=JSON.parse(event.data);if(f.requestId==='ordered-probe-barrier')window.probeBarrier=true;});}};
  });
  try{
   await page.goto('http://127.0.0.1:'+web.address().port+'/conversations/question-'+engine+'?syncProtocol=1');
   await page.waitForFunction(()=>document.querySelector('#send')?.title==='发送');
   const session=sessions.get('question-'+engine);assert.ok(session);
   session.state.isStreaming=true;session.emit({type:'agent_start'});
   const question=id=>({type:engine==='pi'?'extension_ui_request':'native_request',method:engine==='pi'?'select':'input',id,title:'Choose synthetic color',options:['Blue','Red'],required:true});
   session.emit(question('first-question'));
   await page.locator('#ui-modal:not(.hidden)').waitFor();
   const beforeAnswer=navigations;
   const dialog=page.locator('#ui-modal');
   const scroller=page.locator('#scroller');
   if(engine==='codex')await page.locator('#ui-options button').filter({hasText:'Blue'}).click();
   const box=await dialog.getByRole('dialog').boundingBox();
   assert.ok(box);
   await dialog.getByRole('button',{name:'最小化'}).click({timeout:2000});
   await dialog.waitFor({state:'hidden'});
   const reopen=page.getByRole('button',{name:'继续回答',exact:true});
   await reopen.waitFor();
   assert.equal(responses.length,0,'Minimizing sent a response');
   assert.equal(session.state.isStreaming,true);
   const scrollBefore=await scroller.evaluate(node=>{node.scrollTop=node.scrollHeight;return node.scrollTop;});
   assert.ok(scrollBefore>0);
   await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
   await page.mouse.wheel(0,-350);
   await page.waitForFunction(previous=>document.querySelector('#scroller').scrollTop<previous,scrollBefore);
   await reopen.click();
   await dialog.waitFor();
   await reopen.waitFor({state:'hidden'});
   assert.equal(responses.length,0,'Reopening sent a response');
   if(engine==='codex')assert.equal(await page.locator('#ui-input').inputValue(),'Blue');
   else await page.locator('#ui-options button').filter({hasText:'Blue'}).click();
   if(engine==='codex')await page.locator('#ui-ok').click();
   await page.locator('#ui-modal').waitFor({state:'hidden'});
   assert.equal(session.answers.length,1);assert.equal(navigations,beforeAnswer,'Answer click navigated the page');
   assert.equal(session.state.isStreaming,true,'Accepting answer completed the held run');
   await page.reload();await page.locator('#thread').filter({hasText:'ACCEPTED_ANSWER_HISTORY'}).waitFor();
   await page.evaluate(()=>{window.probeSocket.send(JSON.stringify({v:1,type:'ui_response',requestId:'ordered-probe-barrier',id:'no-such-question',cancelled:true}));});
   await page.waitForFunction(()=>window.probeBarrier===true);
   assert.ok(await page.locator('#ui-modal').evaluate(node=>node.classList.contains('hidden')),'Reload redisplayed an already accepted question');
   assert.equal(session.answers.length,1,'Reload automatically resubmitted an answer');
   session.emit(question('new-unanswered-question'));await page.locator('#ui-modal:not(.hidden)').waitFor();
   await page.locator('#ui-options button').filter({hasText:'Red'}).click();if(engine==='codex')await page.locator('#ui-ok').click();await page.locator('#ui-modal').waitFor({state:'hidden'});
   assert.equal(session.answers.length,2);
   session.emit(question('question-before-settle'));await dialog.waitFor();
   await dialog.getByRole('button',{name:'最小化'}).click();
   await reopen.waitFor();
   const beforeSettle=responses.length;
   await session.abort();
   await reopen.waitFor({state:'hidden'});
   assert.equal(responses.length,beforeSettle,'Settling a minimized question sent a response');
   assert.deepEqual(errors,[]);
   results.push({engine,minimizedQuestionLeavesHistoryScrollable:true,restoreRetainsDraft:true,settledQuestionRemovesRestore:true,answerDidNotNavigate:true,reloadDidNotReask:true,newQuestionStillWorks:true,noAutomaticResubmission:true});
  }finally{await page.close();await web.close();await host.close();}
 }
 await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,results},null,2));console.log(JSON.stringify({pass:true,results,evidence}));
}finally{await browser?.close();await rm(root,{recursive:true,force:true});}
