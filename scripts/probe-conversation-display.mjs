// Real Browser/Web/Host with synthetic native history; never contacts a model.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';
import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';
const evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/display-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-'));let browser;
const results=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 for(const protocol of [1,2]){
  const id='display-'+protocol;
  const records=[{kind:'user',id:'u',text:'Write a script'},{kind:'assistant',id:'a',text:'FINAL_RESULT\n```bash\necho delivered\n```'},...Array.from({length:60},(_,i)=>({kind:'tool',id:'t'+i,name:'bash',isError:i===0,args:{command:'INTERNAL_COMMAND'},result:'INTERNAL_OUTPUT '+('x'.repeat(9000))+' INTERNAL_OUTPUT'}))];
  const listeners=new Set();let starts=0,stops=0,aborts=0;
  const state={isStreaming:true};
  const session={getState:async()=>state,getHistory:async()=>({entries:records,leafId:'t59'}),onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},stop:async()=>{stops++;},abort:async()=>{aborts++;},prompt:async()=>{throw Error('No model turns permitted');},getModels:async()=>({models:[],thinkingLevels:[]}),getStats:async()=>({}),getCommands:async()=>[],backgroundState:async()=>({known:true,active:0})};
  const factory={create:async()=>{starts++;return session;},list:async()=>[],delete:async()=>false,capabilities:async()=>({stop:true,followUp:true}),readHistory:async()=>({history:{entries:records,leafId:'t59'},binding:'fixture',sourceGeneration:'1',sourceFreshness:'current',checkedAt:new Date().toISOString()})};
  const workspaces=new Workspaces(join(root,'workspace-'+protocol));await workspaces.createChatConversation(id,'pi');
  const host=new HostServer({host:'127.0.0.1',port:0,token:'synthetic',factory,workspaces,conversationIndexRoot:join(root,'index-'+protocol)});await host.start();
  const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'synthetic',defaultUser:'fixture'});await web.start();
  const page=await browser.newPage(),errors=[],frames=[];page.on('pageerror',error=>errors.push(error.message));page.on('websocket',socket=>socket.on('framereceived',frame=>frames.push(JSON.parse(String(frame.payload)))));
  try{
   const base=`http://127.0.0.1:${web.address().port}`;
   await page.goto(base+'/conversations/'+id+'?syncProtocol='+protocol);
   await page.locator('#thread').filter({hasText:'FINAL_RESULT'}).waitFor();
   assert.ok(await page.locator('#thread pre').count(),'Delivered scripts retain code blocks');
   assert.equal(await page.locator('#thread .tool').count(),0);
   assert.ok(!(await page.locator('#thread').textContent()).includes('工具执行失败；切换到详细模式查看。'));
   assert.equal(await page.locator('#agent-display-value').textContent(),'精简');
   assert.ok(!JSON.stringify(frames.filter(f=>f.type==='history'||f.type==='event')).includes('INTERNAL_OUTPUT'));
   await page.locator('#prompt').fill('PRESERVE DRAFT');
   const change=async(label)=>{await page.locator('#agent-menu-btn').click();await page.locator('#agent-display-row').click();if(label==='详细')await page.screenshot({path:join(evidence,`menu-${protocol}.png`)});await page.locator('#agent-display-pane button').filter({hasText:label}).click();};
   await page.screenshot({path:join(evidence,`compact-${protocol}.png`)});
   await change('详细');await page.locator('#thread .tool').first().waitFor({state:'attached'});
   assert.equal(await page.locator('#prompt').inputValue(),'PRESERVE DRAFT');
   assert.equal(starts,1);assert.equal(stops,0);assert.equal(aborts,0);
   await page.screenshot({path:join(evidence,`detailed-${protocol}.png`)});
   await page.reload();await page.locator('#thread .tool').first().waitFor({state:'attached'});assert.equal(await page.locator('#agent-display-value').textContent(),'详细');
   await change('精简');await page.waitForFunction(()=>!document.querySelector('#thread .tool')&&document.querySelector('#thread').textContent.includes('FINAL_RESULT'));
   assert.equal(stops,0);assert.equal(aborts,0);
   let compact,detailed;
   for(let i=0;i<30;i++){compact=await (await page.request.get(base+'/api/conversations/'+id+'/page?displayMode=compact')).text();if(JSON.parse(compact).sourceFreshness==='current')break;await new Promise(r=>setTimeout(r,50));}
   detailed=await (await page.request.get(base+'/api/conversations/'+id+'/page?displayMode=detailed')).text();
   assert.ok(compact.includes('FINAL_RESULT'));assert.ok(!compact.includes('INTERNAL_OUTPUT'));assert.ok(detailed.includes('INTERNAL_OUTPUT'));assert.ok(Buffer.byteLength(compact)<Buffer.byteLength(detailed)/10);
   assert.deepEqual(errors,[]);results.push({protocol,pass:true,compactPageBytes:Buffer.byteLength(compact),detailedPageBytes:Buffer.byteLength(detailed),nativeStarts:starts,noAbort:true,persisted:true});
  }finally{await page.close();await web.close();await host.close();}
 }
 await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,results},null,2));console.log(JSON.stringify({pass:true,results,evidence}));
}finally{await browser?.close();await rm(root,{recursive:true,force:true});}
