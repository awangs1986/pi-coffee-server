// Real Browser controller + native Pi-style setup requests, using synthetic transport.
// npm run build && node scripts/probe-extension-dialog.mjs
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const root=resolve('dist/public'),sessions=[{id:'secretary',name:'Secretary',engine:'pi',workspaceKind:'chat',createdAt:'2026-10-05T00:00:00Z'}];
const json=(res,data)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/auth/me')return json(res,{auth:true,user:'synthetic-dialog'});
  if(url.pathname==='/api/me')return json(res,null);
  if(url.pathname==='/api/engines')return json(res,{engines:[{id:'pi',available:true}]});
  if(url.pathname==='/api/workspace')return json(res,{projects:[],conversations:sessions,sidebar:{showGroups:false},capabilities:{chatWorkspaces:true}});
  if(url.pathname.startsWith('/api/conversations/')){res.statusCode=404;return json(res,{error:'Synthetic native-history-only conversation'});}
  if(url.pathname.startsWith('/api/'))return json(res,{});
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);if(file.includes('..')){res.statusCode=400;return res.end();}
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(resolve(root,file)));
}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const evidence=[];
try{
  for(const viewport of [{width:1280,height:720},{width:1280,height:480},{width:390,height:700},{width:680,height:320}]){
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({sessions})=>{
      let cursor=0,id=0;window.__dialogAnswers=[];
      class Socket{
        static OPEN=1;readyState=1;
        constructor(){window.__dialogSocket=this;setTimeout(()=>{this.onopen?.();this.receive({type:'sessions',sessions});this.receive({type:'opened',engine:'pi',sessionId:'secretary',state:{isStreaming:false},capabilities:{questions:true}});this.receive({type:'history',sessionId:'secretary',entries:[]});},0);}
        receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}
        request(method,title,extra={}){this.receive({type:'event',sessionId:'secretary',cursor:++cursor,event:{type:'extension_ui_request',id:'dialog-'+(++id),method,title,...extra}});}
        send(raw){const f=JSON.parse(raw);if(f.type!=='ui_response')return;window.__dialogAnswers.push(f);this.receive({type:'ack',operation:'ui_response',requestId:f.requestId});}
        close(){this.readyState=3;}
      }
      window.WebSocket=Socket;
      window.__showSetup=()=>window.__dialogSocket.request('select','MISHU：选择现有对话；再次选择可取消',{options:[...Array.from({length:200},(_,i)=>`○ [pi] Chat · Synthetic conversation ${i} (target-${i})`),'完成选择（20/20）','取消']});
      window.__showConfirmation=()=>window.__dialogSocket.request('confirm','开启当前 Chat 的 MISHU？',{message:Array.from({length:20},(_,i)=>`[codex] Synthetic project ${i} · A long conversation title for explicit selection (${i.toString().padStart(36,'0')})`).join('\n')+'\n\n允许授权执行：每次仍需用户明确授权\n只对当前 Chat 生效；取消不改变现有设置。'});
    },{sessions});
    await page.goto(`http://127.0.0.1:${server.address().port}/?syncProtocol=1`);await page.waitForSelector('#session-list [data-session-id="secretary"]');
    await page.evaluate(()=>window.__showSetup());await page.waitForSelector('#ui-modal:not(.hidden)');
    const rect=await page.locator('.ui-dialog').boundingBox();evidence.push({viewport,selection:rect});
    assert.ok(rect.y>=8&&rect.y+rect.height<=viewport.height-8,JSON.stringify(evidence.at(-1)));
    const cancel=await page.locator('#ui-cancel').boundingBox();assert.ok(cancel.y>=0&&cancel.y+cancel.height<=viewport.height,'Cancel is unreachable');
    const area=page.locator('#ui-options');await area.hover();await page.mouse.wheel(0,20000);await page.waitForTimeout(100);
    const done=page.locator('#ui-options .ui-option').filter({hasText:'完成选择（20/20）'});const box=await done.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=viewport.height,'Done selection is unreachable');
    assert.equal(await page.evaluate(()=>window.__dialogAnswers.length),0,'No default selection may submit');
    await done.click();await page.waitForSelector('#ui-modal',{state:'hidden'});assert.equal(await page.evaluate(()=>window.__dialogAnswers.at(-1).value),'完成选择（20/20）');
    await page.evaluate(()=>window.__showConfirmation());await page.waitForSelector('#ui-modal:not(.hidden)');
    const confirmation=await page.locator('.ui-dialog').boundingBox();assert.ok(confirmation.y>=8&&confirmation.y+confirmation.height<=viewport.height-8,'Confirmation overflow');
    await page.locator('#ui-text').hover();await page.mouse.wheel(0,20000);await page.waitForTimeout(100);
    const textScroll=await page.locator('#ui-text').evaluate(node=>({top:node.scrollTop,height:node.scrollHeight,visible:node.clientHeight}));
    assert.ok(textScroll.top>0&&textScroll.height-textScroll.visible-textScroll.top<=2,'Confirmation text is not scrollable');
    await page.locator('#ui-ok').click();await page.waitForSelector('#ui-modal',{state:'hidden'});assert.equal(await page.evaluate(()=>window.__dialogAnswers.at(-1).confirmed),true);
    await page.evaluate(()=>window.__showSetup());await page.waitForSelector('#ui-modal:not(.hidden)');await page.locator('#ui-cancel').click();await page.waitForSelector('#ui-modal',{state:'hidden'});assert.equal(await page.evaluate(()=>window.__dialogAnswers.at(-1).cancelled),true);
    await page.evaluate(()=>window.__showSetup());await page.waitForSelector('#ui-modal:not(.hidden)');await page.locator('#ui-cancel').focus();await page.keyboard.press('Escape');await page.waitForSelector('#ui-modal',{state:'hidden'});assert.equal(await page.evaluate(()=>window.__dialogAnswers.at(-1).cancelled),true);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(JSON.stringify({passed:true,evidence}));
}catch(error){console.log(JSON.stringify({passed:false,evidence}));throw error;}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
