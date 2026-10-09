// Real Chromium + real app.js + synthetic HTTP/WS. No native CLI or model call.
// Run after npm run build; set BROWSER_EXECUTABLE for an installed Chromium.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {WebSocketServer} from 'ws';
import {chromium} from 'playwright';
const root=resolve('public'),tasks=['a','b','c'].map(id=>({id,name:'Synthetic '+id,engine:'codex',workspaceKind:'project',createdAt:'2026-10-06T00:00:00Z'}));
const models=new Map([['a','gpt-6.1-sol'],['b','gpt-6-luna']]);
const heldAuth=new Set(),heldWorkspace=new Set(),mutations=[],frames=[],prepareCalls=[],uploadCalls=[],promptCalls=[],heldUploads=[];
const preparedUploads=new Map();let holdUploads=false;
let holdAuth=false,holdWorkspace=false,holdModels=false;
const reply=(res,data)=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const identity={auth:true,user:'synthetic-model-preview-user'};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/auth/me'){if(holdAuth){heldAuth.add(res);return;}reply(res,identity);return;}
  if(path==='/api/me'){reply(res,null);return;}
  if(path==='/api/engines'){reply(res,{engines:[{id:'codex',available:true}]});return;}
  if(path==='/api/workspace'){let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};if(body.action==='files'){reply(res,{url:'http://127.0.0.1:'+server.address().port,sessionId:body.id,scope:'synthetic-'+body.id,token:'fixture',maxFileBytes:256*1024*1024});return;}if(body.action==='changes'){reply(res,{state:'local',files:[]});return;}if(body.action==='grant'){res.writeHead(404);res.end('{}');return;}if(holdWorkspace){heldWorkspace.add(res);return;}reply(res,{projects:[],conversations:tasks,sidebar:{assignments:{},collapsed:[]}});return;}
  if(path==='/api/localsend/v2/prepare-upload'){
    let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw),scope=new URL(req.url,'http://fixture').searchParams.get('scope');
    const id='upload-'+prepareCalls.length;prepareCalls.push({scope,names:Object.values(body.files).map(f=>f.fileName)});preparedUploads.set(id,{scope,files:body.files});
    reply(res,{sessionId:id,files:Object.fromEntries(Object.keys(body.files).map(k=>[k,'fixture-upload']))});return;
  }
  if(path==='/api/localsend/v2/upload'){
    const url=new URL(req.url,'http://fixture'),prepared=preparedUploads.get(url.searchParams.get('sessionId')),file=prepared.files[url.searchParams.get('fileId')];let bytes=0;for await(const chunk of req)bytes+=chunk.length;
    uploadCalls.push({scope:prepared.scope,name:file.fileName,bytes});const body={path:'../attachments/'+file.fileName};
    if(holdUploads){heldUploads.push({res,body});server.emit('fixture-upload');return;}reply(res,body);return;
  }
  if(path.startsWith('/api/')){res.writeHead(404);res.end('{}');return;}
  const file=path==='/'||path.startsWith('/conversations/')?'index.html':path.slice(1);
  if(!/^[\w.-]+$/.test(file)){res.writeHead(404);res.end();return;}
  try{const body=await readFile(join(root,file));res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
const wsServer=new WebSocketServer({server,path:'/ws'});
const modelFrame=id=>({v:1,type:'models',models:[{provider:'codex',id:models.get(id)}],current:{provider:'codex',id:models.get(id)},thinkingLevel:'medium',thinkingLevels:['medium']});
wsServer.on('connection',ws=>{ws.user=identity.user;ws.on('message',raw=>{
  const f=JSON.parse(String(raw));frames.push({type:f.type,sessionId:f.sessionId});if(f.type.startsWith('set_'))mutations.push(f.type);
  if(f.type==='list_sessions')ws.send(JSON.stringify({v:1,type:'sessions',sessions:tasks}));
  if(f.type==='open'){
    ws.taskId=f.sessionId;
    ws.send(JSON.stringify({v:1,type:'opened',engine:'codex',sessionId:f.sessionId,capabilities:{models:true,tools:true,stop:true,images:true},state:{isStreaming:false}}));
    ws.send(JSON.stringify({v:1,type:'history',sessionId:f.sessionId,entries:[{kind:'user',text:'Synthetic history '+f.sessionId}]}));
  }
  if(f.type==='ping')ws.send(JSON.stringify({v:1,type:'pong',nonce:f.nonce}));
  if(f.type==='prompt'){promptCalls.push({user:ws.user,taskId:ws.taskId,text:f.text,imageCount:f.images?.length||0});ws.send(JSON.stringify({v:1,type:'ack',operation:'prompt',requestId:f.requestId}));server.emit('fixture-prompt');}
  if(f.type==='get_models'&&models.has(ws.taskId)&&!holdModels)ws.send(JSON.stringify({...modelFrame(ws.taskId),requestId:f.requestId}));
});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const evidence=process.env.EVIDENCE_DIR||join(tmpdir(),'coffee-attachment-draft-probe-'+Date.now());await mkdir(evidence,{recursive:true});
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
  const base='http://127.0.0.1:'+server.address().port;
  const expectModel=async id=>{try{await page.waitForFunction(expected=>document.querySelector('#agent-name')?.textContent===expected,id,{timeout:5000});}catch{throw Error(JSON.stringify({expected:id,actual:await page.locator('#agent-name').textContent(),path:new URL(page.url()).pathname,frames:frames.slice(-20),errors}));}};
  await page.addInitScript(()=>{
    const read=FileReader.prototype.readAsDataURL;window.fixtureReads=[];
    const NativeSocket=window.WebSocket;window.fixtureHistories=[];
    window.WebSocket=class extends NativeSocket{constructor(...args){super(...args);this.addEventListener('message',event=>{const frame=JSON.parse(event.data);if(frame.type==='history')window.fixtureHistories.push({user:document.querySelector('#user-name')?.textContent,id:frame.sessionId});});}};
    FileReader.prototype.readAsDataURL=function(file){if(file.name==='late.png')window.fixtureReads.push(()=>read.call(this,file));else read.call(this,file);};
    window.releaseFixtureReads=()=>{for(const read of window.fixtureReads.splice(0))read();};
  });
  await page.goto(base);await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  await page.locator('#prompt').fill('Synthetic draft A');
  await page.locator('#file').setInputFiles({name:'draft-a.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic attachment A')});
  await page.locator('#attachments .upload-name').filter({hasText:'draft-a.txt'}).waitFor();
  const beforeSend=frames.filter(f=>['prompt','steer','follow_up'].includes(f.type)).length;
  const switched=await page.evaluate(()=>{document.querySelector('#session-list [data-session-id="b"]').click();return {names:[...document.querySelectorAll('#attachments .upload-name')].map(n=>n.textContent),hidden:document.querySelector('#attachments').classList.contains('hidden')};});
  await expectModel('gpt-6-luna');
  await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  const restored=await page.evaluate(()=>({text:document.querySelector('#prompt').value,names:[...document.querySelectorAll('#attachments .upload-name')].map(n=>n.textContent),hidden:document.querySelector('#attachments').classList.contains('hidden')}));
  const result={pass:!switched.names.length&&restored.names.includes('draft-a.txt')&&restored.text==='Synthetic draft A'&&beforeSend===0,switched,restored,beforeSend,errors};
  await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  if(!result.pass)throw Error('Unsent attachment crossed conversations or disappeared on return');
  const clearRail=async()=>{while(await page.locator('#attachments .attachment-remove').count())await page.locator('#attachments .attachment-remove').first().click();};
  await clearRail();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  await page.locator('#file').setInputFiles({name:'late.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>window.fixtureReads?.length===1);
  await page.locator('#session-list [data-session-id="b"]').click();await expectModel('gpt-6-luna');
  await page.locator('#file').setInputFiles({name:'b.txt',mimeType:'text/plain',buffer:Buffer.from('B only')});
  await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  if(!await page.locator('#send').isDisabled())throw Error('Send unlocked before restored image decoding finished');
  await page.evaluate(()=>window.releaseFixtureReads());
  await page.locator('#attachments .attachment img').waitFor();
  if(await page.locator('#attachments .attachment img').count()!==1||await page.locator('#attachments .upload-name').count()!==0)throw Error('Late restored image decoded twice or lost its original');
  await page.locator('#session-list [data-session-id="b"]').click();await expectModel('gpt-6-luna');
  if(await page.locator('#attachments .attachment img').count()!==0||await page.locator('#attachments .upload-name').textContent()!=='b.txt')throw Error('Image callback changed another conversation');
  if(prepareCalls.length||uploadCalls.length||promptCalls.length)throw Error('Unsent drafts caused a transfer or model prompt');
  await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');await clearRail();await page.evaluate(()=>window.releaseFixtureReads());
  await page.locator('#file').setInputFiles({name:'pending.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic cancelled upload')});
  await page.locator('#prompt').fill('Synthetic upload A');holdUploads=true;
  const upload=once(server,'fixture-upload',{signal:AbortSignal.timeout(5000)});await page.locator('#send').click();await upload;
  await page.locator('#session-list [data-session-id="b"]').click();await expectModel('gpt-6-luna');
  if(await page.locator('#attachments .upload-name').textContent()!=='b.txt')throw Error('Pending upload contaminated B');
  for(const item of heldUploads.splice(0))item.res.end(JSON.stringify(item.body));holdUploads=false;
  await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  if(await page.locator('#attachments .upload-name').textContent()!=='pending.txt'||await page.locator('#prompt').inputValue()!=='Synthetic upload A')throw Error('Abandoned upload did not restore its original draft');
  if(promptCalls.length!==0||uploadCalls.length!==1)throw Error('Returning replayed the abandoned send automatically');
  const received=once(server,'fixture-prompt',{signal:AbortSignal.timeout(5000)});await page.locator('#send').click();await received;
  if(promptCalls.length!==1||promptCalls[0].taskId!=='a'||uploadCalls.some(c=>c.scope!=='synthetic-a'))throw Error('Explicit send reached the wrong task or scope');
  await page.locator('#session-list [data-session-id="b"]').click();await expectModel('gpt-6-luna');await page.locator('#session-list [data-session-id="a"]').click();await expectModel('gpt-6.1-sol');
  if(await page.locator('#attachments .attachment-remove').count()!==0)throw Error('Accepted attachment reappeared in draft');
  const previousPrompts=promptCalls.length;
  await page.locator('#file').setInputFiles({name:'identity.png',mimeType:'image/png',buffer:png});
  await page.locator('#attachments .attachment img').waitFor();await page.locator('#prompt').fill('Synthetic account-private upload');holdUploads=true;
  const accountUpload=once(server,'fixture-upload',{signal:AbortSignal.timeout(5000)});await page.locator('#send').click();await accountUpload;
  identity.user='synthetic-next-account';
  await page.evaluate(()=>{localStorage.setItem('pi-coffee.active.v2:synthetic-next-account','b');window.dispatchEvent(new StorageEvent('storage',{key:'pi-coffee.preview-clear.v1',newValue:'cache:synthetic-account-change'}));});
  await page.waitForFunction(()=>window.fixtureHistories?.some(h=>h.user==='synthetic-next-account'&&h.id==='a'));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  if(promptCalls.length!==previousPrompts)throw Error('Pending attachment Send leaked into a different authenticated account');
  if(await page.locator('#attachments .attachment-remove').count()||await page.locator('#prompt').inputValue())throw Error('Old account retained composer draft');
  const acceptance={pass:true,immediateSwitch:true,returnRestore:true,lateImageDecode:true,otherDraftPreserved:true,noPreSendSideEffects:true,abandonedUploadRestored:true,noAutomaticReplay:true,explicitSendOwned:true,sentDraftCleared:true,accountChangeDropsPendingSend:true,errors};
  if(errors.length)throw Error(JSON.stringify(errors));console.log(JSON.stringify(acceptance));await writeFile(join(evidence,'acceptance.json'),JSON.stringify(acceptance,null,2));
}finally{
  await browser?.close();for(const ws of wsServer.clients)ws.terminate();await new Promise(resolve=>wsServer.close(resolve));
  for(const item of heldUploads)item.res.destroy();for(const res of [...heldAuth,...heldWorkspace])res.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
