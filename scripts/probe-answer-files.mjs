import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {chromium} from 'playwright';
import {GiteaAuth} from '../dist/src/web/auth.js';
import {WebServer} from '../dist/src/web/server.js';
import {HostServer} from '../dist/src/host/server.js';
import {TransferServer} from '../dist/src/host/transfer.js';
import {Workspaces} from '../dist/src/host/workspaces.js';
import {AnswerDeliveries} from '../dist/src/host/answer-deliveries.js';

const root=await mkdtemp(join(tmpdir(),'coffee-answer-browser-'));
try {await probe(root);} finally {await rm(root,{recursive:true,force:true});}

async function probe(root) {
const evidenceDir=process.env.EVIDENCE_DIR, results={};
const id='answer-demo', otherId='another-demo';
const stores=new Map();
function storeFor(user){
  if(!stores.has(user))stores.set(user,new Workspaces(join(root,user,'registry'),{taskRoot:join(root,user,'tasks')}));
  return stores.get(user);
}
const store=storeFor('fixture');
const task=await store.createChatConversation(id);
const git=promisify(execFile), source=join(root,'work-source');
await mkdir(source);await git('git',['init','-b','main'],{cwd:source});
await writeFile(join(source,'work-note.md'),'# Work fixture');
await git('git',['add','work-note.md'],{cwd:source});
await git('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture'],{cwd:source});
const project=await store.registerProject('fixture-work',source);
await store.createConversation(project.id,'main',otherId);
await store.displaySidebar(false);
const artifacts=join(task.taskRoot,'artifacts');
const fileName='图 100%.svg', svg='<svg xmlns="http://www.w3.org/2000/svg" width="23" height="11"><rect width="23" height="11" fill="blue"/></svg>';
const html='<h1>Static fixture report</h1><a href="/fixture-must-not-load">Reference</a><img src="/fixture-must-not-load"><script>document.title="fixture-script-ran"</script>';
const markdown='# Notes\n\n![diagram](../'+encodeURIComponent(fileName)+')';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const zip=Buffer.from([0x50,0x4b,3,4,0xff,0]);
const old=Buffer.from('original legacy fixture'), large=Buffer.alloc(10*1024*1024+1,65);
const message=(key,text)=>({id:'row-'+key,kind:'assistant',sourceMessageKey:'pi-message:'+key,text});
const records=[...Array.from({length:48},(_,i)=>message(i+1,'Saved reply '+(i+1))),
  message(53,'[large binary](../artifacts/large.bin)'),message(49,'[encoded](../artifacts/'+encodeURIComponent(fileName)+'?view=1#figure) [absolute](<'+join(artifacts,fileName).replace('%','%25')+'>)'),
  message(50,'x'.repeat(8181)+' [long file](../artifacts/export.zip)\n'+'y'.repeat(9000)),
  message(54,'~~~svg\n<svg></svg>\n~~~'),message(55,'\uE200visualize\uE202{"path":"../artifacts/report.html"}\uE201'),
  message(51,'![inline](../artifacts/'+encodeURIComponent(fileName)+')'),
  message(52,'The requested files are ready.')];
const listeners=new Set();
const currentState={isStreaming:false,messageCount:records.length};
const resumeOutput=Promise.withResolvers(),finishOutput=Promise.withResolvers();
let streamingStarted=false;
function history(key){const entries=key===otherId?[message(880,'The other conversation\n\n[work file](work-note.md)')]:records;return {entries,leafId:entries.at(-1).id};}
const factory={
  list:async()=>[], delete:async()=>false, readHistory:async key=>({history:history(key),binding:key,sourceGeneration:'fixture-'+history(key).entries.length,sourceFreshness:'current',checkedAt:new Date().toISOString()}),
  capabilities:async()=>({stop:true,followUp:true}),
  create:async({sessionId})=>({getState:async()=>currentState,getHistory:async()=>history(sessionId),getStats:async()=>({}),getModels:async()=>({models:[]}),
    getCommands:async()=>[],backgroundState:async()=>({known:true,active:0}),onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    stop:async()=>{},abort:async()=>{},prompt:async prompt=>{
      assert.equal(sessionId,id);assert.equal(prompt,'Create the synthetic live receipt');
      const emit=event=>{for(const fn of listeners)fn(event);};
      currentState.isStreaming=true;emit({type:'agent_start'});
      streamingStarted=true;await resumeOutput.promise;
      for(let i=0;i<20;i++){
        emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'part'+i+' '}});
        await new Promise(r=>setTimeout(r,25));
      }
      await finishOutput.promise;await writeFile(join(artifacts,'live.zip'),'LIVE RECEIPT');
      const answer=message(99,'Live receipt completed');records.push(answer);
      emit({type:'message_end',message:{role:'assistant',timestamp:99,content:[{type:'text',text:answer.text}]}});
      currentState.isStreaming=false;currentState.messageCount=records.length;emit({type:'agent_settled'});
    }}),
};
const transfer=new TransferServer({port:0,host:'127.0.0.1',advertiseHost:'127.0.0.1',workdir:root});
let host,web,browser,page;
async function startHost(port=0){
  host=new HostServer({host:'127.0.0.1',port,token:'fixture-only',requireUser:true,factory,transfer,scopeForUser:user=>({factory,workspaces:storeFor(user),workdir:root})});
  await host.start();return '127.0.0.1:'+host.address().port;
}
async function login(context,base,user){
  const start=await context.request.get(base+'/auth/login',{maxRedirects:0});
  assert.equal(start.status(),302);const state=new URL(start.headers().location).searchParams.get('state');
  const callback=await context.request.get(base+'/auth/callback?'+new URLSearchParams({code:user,state}),{maxRedirects:0});
  assert.equal(callback.status(),303);assert.equal((await context.request.get(base+'/auth/me')).status(),200);
}
async function download(link,file,expected){
  await link.waitFor();
  const [out]=await Promise.all([page.waitForEvent('download',{timeout:6500}),link.click({timeout:3500})]);
  assert.equal(out.suggestedFilename(),file);assert.deepEqual(await readFile(await out.path()),Buffer.from(expected));
}
async function waitForPageIndex(context,base){
  for(let n=0;n<50;n++){
    const response=await context.request.get(base+'/api/conversations/'+id+'/page');
    if(response.ok()&&(await response.json()).sourceFreshness==='current')return;
    await new Promise(r=>setTimeout(r,80));
  }
  throw Error('Synthetic index did not converge');
}
try {
  await writeFile(join(artifacts,'large.bin'),large);await writeFile(join(artifacts,'legacy.zip'),old);const info=await stat(join(artifacts,'legacy.zip'));
  const fingerprint=[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
  const legacy=records.slice(0,40).map(r=>({binding:JSON.stringify(['pi',id,null]),key:r.sourceMessageKey,files:[{path:'../artifacts/legacy.zip',fingerprint}]}));
  await writeFile(join(task.taskRoot,'history','answer-deliveries.json'),JSON.stringify(legacy));
  await transfer.start();const address=await startHost();
  const activePort=host.address().port;
  const firstRead=await fetch('http://'+address+'/api/conversations/'+id+'/deliveries?key=pi-message%3A1',{headers:{authorization:'Bearer fixture-only','x-pi-coffee-user':'fixture'}});
  assert.equal((await firstRead.json()).deliveries[0].files[0].available,true);
  const tracked=new AnswerDeliveries(store,()=>{});await tracked.begin(id,'observed');tracked.observe(id,{type:'agent_start'});
  await mkdir(join(artifacts,'docs'));await writeFile(join(artifacts,'docs','notes.md'),markdown);
  await writeFile(join(artifacts,fileName),svg);await writeFile(join(artifacts,'report.html'),html);await writeFile(join(artifacts,'export.zip'),zip);
  await writeFile(join(artifacts,'pixel.png'),png);
  tracked.observe(id,{type:'message_end',message:{role:'assistant',timestamp:52,content:[{type:'text',text:records.at(-1).text}]}});
  assert.equal(await tracked.observe(id,{type:'agent_settled'}),true);
  await host.close();await startHost(activePort);
  const auth=new GiteaAuth({giteaUrl:'http://fixture-forge.invalid',clientId:'fixture',clientSecret:'fixture',allowedUsers:['fixture','visitor'],cookieSecret:'synthetic-only',
    fetch:async(url,options)=>{
      if(String(url).endsWith('/login/oauth/access_token'))return Response.json({access_token:JSON.parse(options.body).code,token_type:'bearer'});
      const token=new Headers(options?.headers).get('authorization')?.split(' ').at(-1);
      return Response.json({id:token==='visitor'?2:1,login:token});
    }});
  const webOptions={host:'127.0.0.1',port:0,hostToken:'fixture-only',hostUrl:'ws://'+address+'/host',auth,defaultUser:'fixture'};
  web=new WebServer(webOptions);await web.start();
  const base='http://127.0.0.1:'+web.address().port;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({acceptDownloads:true});
  assert.equal((await context.request.get(base+'/api/conversations/'+id+'/deliveries')).status(),401);
  await login(context,base,'fixture');await waitForPageIndex(context,base);
  const visitor=await browser.newContext();await login(visitor,base,'visitor');
  assert.equal((await visitor.request.get(base+'/api/conversations/'+id+'/deliveries?key=pi-message%3A1')).status(),404);
  await visitor.close();results.accountScope=true;
  page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let forbiddenRequests=0,deniedImage=false,deniedHead=false,metadataReads=0,protocol,holdMetadata=false;
  const seenTokens=new Set();let historyFrames=0,listFrames=0,lastMode;
  page.on('response',async response=>{
    const request=response.request();
    if(request.method()==='POST' && new URL(request.url()).pathname==='/api/workspace' && request.postDataJSON()?.action==='files'){
      const grant=await response.json().catch(()=>null);if(grant?.token)seenTokens.add(grant.token);
    }
  });
  page.on('request',req=>{if(req.url().includes('/fixture-must-not-load'))forbiddenRequests++;});
  page.on('websocket',socket=>socket.on('framereceived',({payload})=>{const frame=JSON.parse(String(payload));if(frame.type==='history'){protocol=frame.syncProtocol||1;lastMode=frame.displayMode;historyFrames++;}if(frame.type==='sessions')listFrames++;}));
  await page.route('**/api/conversations/*/deliveries?**',route=>{metadataReads++;return (holdMetadata||metadataReads===1)?route.fulfill({status:503,body:'temporary'}):route.continue();});
  await page.route('**/api/localsend/v2/preview?**',route=>{
    if(!deniedImage&&route.request().resourceType()==='image'){deniedImage=true;return route.fulfill({status:401,headers:{'access-control-allow-origin':'*'},body:'retry'});}
    if(deniedImage&&!deniedHead&&route.request().method()==='HEAD'){deniedHead=true;return route.fulfill({status:401,headers:{'access-control-allow-origin':'*'}});}
    return route.continue();
  });
  const route=base+'/conversations/'+id;
  await page.goto(route);
  const last=page.locator('[data-delivery-key="pi-message:52"]');
  await last.locator('.answer-deliveries summary').click();
  await download(last.getByRole('link',{name:'下载 export.zip',exact:true}),'export.zip',zip);
  results.temporaryLookup=metadataReads>=2;assert.equal(results.temporaryLookup,true);
  const inline=page.locator('[data-delivery-key="pi-message:51"] img');
  await page.waitForFunction(()=>{const n=document.querySelector('[data-delivery-key="pi-message:51"] img');return n?.naturalWidth===23&&!n.hidden;});
  assert.equal(deniedImage&&deniedHead,true);assert.equal(seenTokens.size,1);assert.equal(await inline.count(),1);results.inlineImageRecovery=true;
  await download(page.getByRole('link',{name:'encoded',exact:true}),fileName,svg);
  await download(page.getByRole('link',{name:'absolute',exact:true}),fileName,svg);
  await download(page.getByRole('link',{name:'long file',exact:true}),'export.zip',zip);results.pathAndTextBudget=true;
  const largeLink=page.getByRole('link',{name:'large binary',exact:true});
  await download(largeLink,'large.bin',large);
  const previewUrl=new URL(await largeLink.getAttribute('href'));previewUrl.pathname=previewUrl.pathname.replace('workspace-download','preview');
  assert.equal((await context.request.get(previewUrl.href)).status(),413);results.oversizeDownload=true;
  const example=page.locator('[data-delivery-key="pi-message:54"]');assert.equal(await example.locator('pre code').textContent(),'<svg></svg>');assert.equal(await example.locator('img,svg,button[data-preview-path]').count(),0);
  const detail=page.locator('#workspace-detail');
  await last.getByRole('button',{name:'预览 pixel.png',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#workspace-detail .file-preview-content img')?.naturalWidth===1);
  await download(detail.getByRole('link',{name:'下载原件'}),'pixel.png',png);results.pngOriginal=true;
  await last.getByRole('button',{name:'预览 '+fileName,exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#workspace-detail .file-preview-content img')?.naturalWidth===23);
  await last.getByRole('button',{name:'预览 notes.md',exact:true}).click();
  await detail.getByRole('heading',{name:'Notes'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#workspace-detail .markdown img')?.naturalWidth===23);
  await download(detail.getByRole('link',{name:'下载原件'}),'notes.md',markdown);
  const visualization=page.locator('[data-delivery-key="pi-message:55"]');
  assert.equal(await visualization.locator('iframe').count(),0);
  await download(visualization.getByRole('link',{name:/下载 HTML/}),'report.html',html);
  await visualization.getByRole('button',{name:'预览 report.html',exact:true}).click();
  await detail.frameLocator('iframe').getByRole('heading',{name:'Static fixture report'}).waitFor();
  results.nativeVisualization=true;
  await last.getByRole('button',{name:'预览 report.html',exact:true}).click();
  const frame=detail.frameLocator('iframe');await frame.getByRole('heading',{name:'Static fixture report'}).waitFor();
  assert.equal(await frame.locator('script,[href],img[src],form').count(),0);
  assert.equal(await detail.locator('iframe').getAttribute('sandbox'),'');assert.equal(forbiddenRequests,0);
  await download(detail.getByRole('link',{name:'下载原件'}),'report.html',html);
  if(evidenceDir){await mkdir(evidenceDir,{recursive:true});await page.screenshot({path:join(evidenceDir,'static-report.png')});}
  results.formatPreviews=true;
  await page.locator('#files-close').click();
  for(const mode of ['compact','detailed']){
    const pref=await context.request.post(base+'/api/workspace',{headers:{origin:base},data:{action:'conversation_display',mode}});assert.equal(pref.status(),200);
    for(const sync of [2,1]){
      protocol=null;lastMode=null;await page.goto(route+(sync===1?'?syncProtocol=1':''));
      await waitUntil(()=>protocol===sync && lastMode===mode,'Selected history protocol and display mode');
      const older=sync===2?page.locator('.history-page-trigger'):page.locator('details.history-older summary');
      await older.click();await download(page.locator('[data-delivery-key="pi-message:1"] .answer-delivery'),'legacy.zip',old);
      assert.equal(protocol,sync);results[mode+'-v'+sync]=true;
    }
  }
  await page.locator('#session-list [data-session-id="'+otherId+'"]').first().click();
  await page.getByText('The other conversation',{exact:true}).waitFor();await download(page.getByRole('link',{name:'work file',exact:true}),'work-note.md','# Work fixture');assert.equal(await page.locator('#thread .answer-delivery').count(),0);
  await page.locator('#session-list [data-session-id="'+id+'"]').first().click();
  await last.locator('.answer-deliveries summary').click();await download(last.getByRole('link',{name:'下载 export.zip',exact:true}),'export.zip',zip);
  results.switchAwayAndBack=true;
  holdMetadata=true;await page.goto(route+'?syncProtocol=1');
  const retry=page.locator('.answer-files-status button');
  await retry.waitFor();holdMetadata=false;await retry.click();await last.locator('.answer-deliveries summary').click();
  await download(last.getByRole('link',{name:'下载 export.zip',exact:true}),'export.zip',zip);results.manualRetry=true;
  const checkpoint=await last.locator('.answer-deliveries').elementHandle();
  await page.evaluate(()=>{
    const original=document.querySelectorAll.bind(document);globalThis.probeFileScans=0;
    document.querySelectorAll=function(selector){if(selector==='[data-workspace-path]')globalThis.probeFileScans++;return original(selector);};
  });
  await page.locator('#prompt').fill('Create the synthetic live receipt');await page.locator('#prompt').press('Enter');
  await waitUntil(()=>streamingStarted,'Synthetic turn began');
  const reading=await checkpoint.evaluate(n=>{
    const scroller=document.querySelector('#scroller');scroller.scrollTop=Math.max(0,scroller.scrollHeight-scroller.clientHeight-400);
    const link=n.querySelector('a');link.focus({preventScroll:true});return scroller.scrollTop;
  });
  resumeOutput.resolve();
  await page.waitForFunction(()=>document.querySelector('#thread')?.textContent.includes('part19'));
  assert.equal(await checkpoint.evaluate(n=>document.activeElement===n.querySelector('a')),true);
  assert.ok(Math.abs(await page.locator('#scroller').evaluate(n=>n.scrollTop)-reading)<4,'Reading position must survive streaming');
  results.streamingReadingPosition=true;
  finishOutput.resolve();
  await download(page.locator('[data-delivery-key="pi-message:99"]').getByRole('link',{name:'下载 live.zip',exact:true}),'live.zip','LIVE RECEIPT');
  assert.equal(await checkpoint.evaluate(n=>n.isConnected&&n.open),true);
  assert.equal(await page.evaluate(()=>globalThis.probeFileScans),0);results.liveCompletionAndStableTail=true;
  await page.reload();await last.locator('.answer-deliveries summary').click();
  await download(last.getByRole('link',{name:'下载 export.zip',exact:true}),'export.zip',zip);
  await page.waitForTimeout(550);
  const stable=listFrames;
  for(const action of ['files','status']){
    const response=await context.request.post(base+'/api/workspace',{headers:{origin:base},data:{action,id}});assert.equal(response.status(),200);
  }
  await page.waitForTimeout(550);assert.equal(listFrames,stable,'Workspace reads must settle without a sessions invalidation');
  assert.equal((await context.request.post(base+'/api/workspace',{headers:{origin:base},data:{action:'sidebar_pin',id,pinned:true}})).status(),200);
  for(let i=0;i<40&&listFrames===stable;i++)await page.waitForTimeout(100);
  assert.ok(listFrames>stable);results.idleReadsAndChanges=true;
  const beforeReconnect=historyFrames,webPort=web.address().port;
  await web.close();web=new WebServer({...webOptions,port:webPort});await web.start();
  for(let i=0;i<100&&historyFrames===beforeReconnect;i++)await page.waitForTimeout(100);
  assert.ok(historyFrames>beforeReconnect,'Browser reattached without reload');
  const summary=last.locator('.answer-deliveries summary');await summary.waitFor();
  if(!await summary.evaluate(el=>el.parentElement.open))await summary.click();
  await download(last.getByRole('link',{name:'下载 export.zip',exact:true}),'export.zip',zip);results.reconnect=true;
  const href=await last.getByRole('link',{name:'下载 export.zip',exact:true}).getAttribute('href');
  await writeFile(join(artifacts,'export.zip'),'replacement');assert.equal((await context.request.get(href)).status(),409);
  assert.deepEqual(errors,[]);results.versionGuard=true;
  await last.getByRole('button',{name:'预览 report.html',exact:true}).click();
  await detail.frameLocator('iframe').getByRole('heading',{name:'Static fixture report'}).waitFor();
  const logoutGate=Promise.withResolvers();
  await page.route('**/auth/logout',async route=>{await logoutGate.promise;await route.continue();});
  const logoutComplete=page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/logout');
  try {
    page.once('dialog',dialog=>dialog.accept());
    await Promise.all([page.waitForRequest(r=>new URL(r.url()).pathname==='/auth/logout'),page.locator('#user-btn').click()]);
    assert.equal(await detail.locator('iframe,a[data-delivery-path]').count(),0,'Logout immediately releases the open preview and its download grant');
  } finally {logoutGate.resolve();await logoutComplete;}
  assert.equal((await context.request.get(base+'/api/conversations/'+id+'/deliveries')).status(),401);results.logout=true;
  if(evidenceDir)await writeFile(join(evidenceDir,'answer-files.json'),JSON.stringify(results,null,2)+'\n');
  console.log('ANSWER_FILES '+JSON.stringify(results));
} catch(error){
  console.error('Last passed observations',JSON.stringify(results));
  if(page)console.error('Synthetic shell state',await page.evaluate(()=>({path:location.pathname,mode:location.search,
    rows:document.querySelectorAll('#thread .msg').length,indexed:Boolean(document.querySelector('.synced-transcript')),
    legacy:Boolean(document.querySelector('details.history-older')),connection:document.querySelector('#conn-banner.hidden')?'ready':document.querySelector('#conn-banner')?.textContent?.slice(0,100)})).catch(()=>null));
  throw error;
} finally {resumeOutput.resolve();finishOutput.resolve();await browser?.close();await web?.close();await host?.close();await transfer.close();}
}

async function waitUntil(check,label){
  for(let attempt=0;attempt<150;attempt++){
    if(check())return;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error(label);
}
