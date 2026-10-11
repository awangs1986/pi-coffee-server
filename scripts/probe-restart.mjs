// Actual production Browser shell, offline Agent; synthetic maintenance responses.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {WebServer} from '../dist/src/web/server.js';
const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:'ws://127.0.0.1:1/host',defaultUser:'fixture'});await web.start();
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage();let approve=false,posts=0,operation=null;const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',async dialog=>{assert.match(dialog.message(),/停止所有正在运行的 Agent/);approve?await dialog.accept():await dialog.dismiss();});
 await page.addInitScript(()=>{Object.defineProperty(crypto,'randomUUID',{value:undefined,configurable:true});window.agentInputs=[];const original=WebSocket.prototype.send;WebSocket.prototype.send=function(value){const frame=JSON.parse(value);if(['prompt','steer','follow_up'].includes(frame.type))window.agentInputs.push(frame);return original.call(this,value);};});
 await page.route('**/api/restart*',async route=>{
  if(route.request().method()==='POST'){posts++;const body=route.request().postDataJSON();assert.equal(body.confirmed,true);operation={id:body.id,phase:'scheduled'};await route.fulfill({status:202,json:{operation}});}
  else await route.fulfill({json:{available:true,busy:operation?.phase==='scheduled',operation}});
 });
 await page.goto('http://127.0.0.1:'+web.address().port+'/');
 await page.locator('#prompt').fill('/restart');assert.equal(await page.locator('#send').isEnabled(),true);
 await page.locator('#composer').evaluate(form=>form.requestSubmit());
 await page.waitForFunction(()=>!document.querySelector('#prompt').disabled);
 // Explicit cancellation must complete before the next attempted command.
 await page.waitForTimeout(100);assert.equal(posts,0);
 approve=true;
 await page.locator('#composer').evaluate(form=>form.requestSubmit());
 await page.waitForFunction(()=>sessionStorage.getItem('coffee-maintenance-restart'));
 for(let attempt=0;posts===0&&attempt<300;attempt++)await page.waitForTimeout(10);
 assert.equal(posts,1,'Confirmed command must submit maintenance');
 assert.deepEqual(await page.evaluate(()=>window.agentInputs),[],'Initial submission must not reach the Agent');
 await page.reload();operation={...operation,phase:'succeeded'};
 await page.waitForFunction(()=>sessionStorage.getItem('coffee-maintenance-restart')===null);
 assert.equal(posts,1,'Reload must not repeat the restart POST');assert.deepEqual(await page.evaluate(()=>window.agentInputs),[]);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({pass:true,offlineAgentCommand:true,explicitCancel:true,reloadResumesReceipt:true,noDuplicatePost:true,noAgentInput:true}));
}finally{await browser?.close();await web.close();}
