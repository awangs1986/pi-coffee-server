// Real Chromium + production Browser controller; synthetic sessions, no model calls.
// npm run build && node scripts/probe-sidebar-scroll.mjs
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root=resolve('dist/public');
const sessions=Array.from({length:60},(_,i)=>({id:`scroll-${i}`,name:`Conversation ${String(i).padStart(2,'0')}`,engine:'pi',workspaceKind:'chat',createdAt:new Date(Date.UTC(2026,9,5,0,0,60-i)).toISOString(),running:i===0}));
const json=(res,data)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://fixture');
    if(url.pathname==='/auth/me')return json(res,{auth:true,user:'synthetic-sidebar-scroll'});
    if(url.pathname==='/api/me')return json(res,null);
    if(url.pathname==='/api/engines')return json(res,{engines:[{id:'pi',available:true}]});
    if(url.pathname==='/api/workspace')return json(res,{projects:[],conversations:sessions,sidebar:{showGroups:url.searchParams.get('grouped')!=='false',groups:[{id:'synthetic-group',name:'Synthetic group'}],assignments:Object.fromEntries(sessions.map(s=>[s.id,'synthetic-group'])),collapsed:[]},capabilities:{chatWorkspaces:true}});
    if(url.pathname.startsWith('/api/conversations/')){res.statusCode=404;return json(res,{error:'Synthetic native-history-only conversation'});}
    if(url.pathname.startsWith('/api/'))return json(res,{});
    const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(path.includes('..')){res.writeHead(400);return res.end();}
    res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[extname(path)]||'application/octet-stream');
    res.end(await readFile(resolve(root,path)));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const evidence=[];
try{
  for(const grouped of [false,true]){
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({sessions,grouped})=>{
      const fetchOriginal=window.fetch.bind(window);
      window.fetch=(url,options)=>fetchOriginal(url==='/api/workspace'?url+'?grouped='+grouped:url,options);
      window.__sidebarSockets=[];
      class Socket{
        static OPEN=1;readyState=1;
        constructor(){window.__sidebarSockets.push(this);setTimeout(()=>{this.onopen?.();this.receive({type:'sessions',sessions});},0);}
        receive(frame){this.onmessage?.({data:JSON.stringify(frame)});}
        send(raw){const f=JSON.parse(raw);if(f.type==='open')setTimeout(()=>{this.receive({type:'opened',sessionId:f.sessionId,engine:'pi',state:{isStreaming:true},capabilities:{stop:true}});this.receive({type:'history',sessionId:f.sessionId,entries:[]});},0);}
        close(){this.readyState=3;}
      }
      window.WebSocket=Socket;
      window.__sidebarUpdate=()=>window.__sidebarSockets.at(-1).receive({type:'sessions',sessions:sessions.map((s,i)=>({...s,name:s.name+' update',updatedAt:new Date(Date.now()+i).toISOString()}))});
    },{sessions,grouped});
    await page.goto(`http://127.0.0.1:${server.address().port}/?syncProtocol=1`);
    await page.waitForSelector('#session-list [data-session-id="scroll-0"]');
    await page.locator('#session-list [data-session-id="scroll-0"] .session-main').click();
    await page.waitForTimeout(150);
    const read=()=>page.evaluate(()=>({outer:document.querySelector('.session-scroll').scrollTop,inner:document.querySelector('#session-list').scrollTop,focus:document.activeElement.closest('[data-session-id]')?.dataset.sessionId}));
    for(const selector of ['[data-session-id="scroll-0"] .session-main','[data-session-id="scroll-0"] .more',...(grouped?['.project-group-toggle']:[])]){
      await page.evaluate(selector=>{const target=document.querySelector('#session-list '+selector);target.focus();},selector);
      await page.evaluate(()=>{document.querySelector('.session-scroll').scrollTop=420;});
      const before=await read();
      await page.evaluate(()=>window.__sidebarUpdate());
      await page.waitForTimeout(80);
      assert.ok((await page.locator('#session-list [data-session-id="scroll-0"]').textContent()).includes('update'),'Fixture frame did not redraw the sidebar: '+JSON.stringify(await page.evaluate(()=>({url:location.href,sockets:window.__sidebarSockets.map(s=>({ready:s.readyState,handler:!!s.onmessage})),errors:document.querySelectorAll('.toast').length}))));
      const after=await read();evidence.push({grouped,selector,before,after});
      assert.ok(Math.abs(after.outer-before.outer)<=2,JSON.stringify(evidence.at(-1)));
      const focused=await page.evaluate(()=>({row:document.activeElement.matches('.session-item, .session-main'),more:document.activeElement.matches('.more'),group:document.activeElement.matches('.project-group-toggle')}));
      assert.ok(selector.includes('session-main')?focused.row:selector.includes('more')?focused.more:focused.group,'Sidebar focus lost: '+JSON.stringify(focused));
      await page.locator('.session-scroll').hover();await page.mouse.wheel(0,300);await page.waitForTimeout(100);
      const wheeled=await read();assert.ok(wheeled.outer>after.outer+100,'Wheel did not scroll sidebar');
      await page.evaluate(()=>{for(let i=0;i<4;i++)window.__sidebarUpdate();});await page.waitForTimeout(80);
      assert.ok(Math.abs((await read()).outer-wheeled.outer)<=2,'Busy updates undid wheel scroll');
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log(JSON.stringify({passed:true,evidence}));
}catch(error){console.log(JSON.stringify({passed:false,evidence}));throw error;}
finally{await browser.close();await new Promise(r=>server.close(r));}
