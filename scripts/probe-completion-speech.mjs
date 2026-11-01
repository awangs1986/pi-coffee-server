// Real Chromium + authenticated Web/Host/transfer, synthetic native and speech.
// No production services, credentials, models or native CLI processes are used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';
import {WebServer} from '../dist/src/web/server.js';
import {GiteaAuth} from '../dist/src/web/auth.js';
import {Workspaces} from '../dist/src/host/workspaces.js';
import {TransferServer} from '../dist/src/host/transfer.js';

const evidence=process.env.EVIDENCE_DIR||join(tmpdir(),'verify-completion-speech-'+Date.now());
await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),scopes=new Map(),requests=[],errors=[],network=[],contractResponses=[],criteria=[];
const protocol=Number(process.env.SPEECH_SYNC_PROTOCOL||2);
let browser,host,web,oauth,transfer,base;
const downloadBytes=Buffer.from('Synthetic downloadable result.\n');
const fullAnswer=(text,enabled)=>`## 完整结果\n\n任务已完成：${text}\n\n\`\`\`bash\nprintf 'speech-fixture\\n'\n\`\`\`\n\n[下载结果](../attachments/result.txt)${enabled?'\n\n```coffee-speech\n'+JSON.stringify({profile_version:'0.1.0',summary:'文件已经生成，脚本可供复制，附件可以下载。这里只是合成验收结果，尚未执行真实项目测试。'})+'\n```':''}`;
const pass=(id,details)=>criteria.push({id,verdict:'PASS',details});
async function capture(page,name){await page.screenshot({path:join(evidence,name+'.png'),fullPage:true});}
function fakeSession(user,id,engine){
 const listeners=new Set(),entries=[];let streaming=false,instructions;
 return {engine,entries,getState:async()=>({isStreaming:streaming,model:{provider:'fixture',id:engine+'-fixture'},thinkingLevel:'medium'}),getHistory:async()=>({entries,leafId:entries.at(-1)?.id??null}),
  setTurnInstructions:async value=>{instructions=value;},onEvent:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  prompt:async text=>{requests.push({user,id,text,instructions,engine});streaming=true;for(const f of listeners)f({type:'agent_start'});const userEntry={kind:'user',id:'u'+entries.length,text};entries.push(userEntry);
   const answer=fullAnswer(text,Boolean(instructions));const entry={kind:'assistant',id:'a'+entries.length,text:answer};entries.push(entry);
   for(const f of listeners)f({type:'message_update',id:entry.id,assistantMessageEvent:{type:'text_delta',delta:answer}});
   for(const f of listeners)f({type:'message_end',id:entry.id,text:answer,message:{role:'assistant',content:[{type:'text',text:answer}]}});
   streaming=false;for(const f of listeners)f({type:'agent_settled'});
  },getModels:async()=>({models:[{provider:'fixture',id:engine+'-fixture'}],current:{provider:'fixture',id:engine+'-fixture'},thinkingLevel:'medium',thinkingLevels:['medium']}),getStats:async()=>({}),getCommands:async()=>[],getExtensions:async()=>[],backgroundState:async()=>({known:true,active:0}),stop:async()=>{},abort:async()=>{throw Error('Unexpected native abort');}};
}
async function setupScope(user){
 const workspaces=new Workspaces(join(root,user,'registry'),{taskRoot:join(root,user,'tasks'),chatRoot:join(root,user,'chats')}),native=new Map();
 for(const [id,engine] of [['shared-task','pi'],['codex-task','codex']]){const task=await workspaces.createChatConversation(id,engine);await writeFile(resolve(task.cwd,'../attachments/result.txt'),downloadBytes);}
 const factory={create:async({sessionId})=>{if(!native.has(sessionId)){const task=await workspaces.lookup(sessionId);native.set(sessionId,fakeSession(user,sessionId,task.engine));}return native.get(sessionId);},
  list:async()=>[],delete:async()=>false,capabilities:async()=>({stop:true,followUp:true,models:true}),
  readHistory:async id=>({history:{entries:native.get(id)?.entries??[],leafId:native.get(id)?.entries.at(-1)?.id??null},binding:id,sourceGeneration:String(native.get(id)?.entries.length??0),sourceFreshness:'current',checkedAt:new Date().toISOString()})};
 const scope={factory,workspaces,workdir:join(root,user)};scopes.set(user,scope);return scope;
}
async function login(context,user){
 const begin=await context.request.get(base+'/auth/login',{maxRedirects:0});assert.equal(begin.status(),302);
 const state=new URL(begin.headers().location).searchParams.get('state');const response=await context.request.get(base+'/auth/callback?code='+user+'&state='+state,{maxRedirects:0});assert.ok([302,303].includes(response.status()));
 assert.equal((await (await context.request.get(base+'/auth/me')).json()).user,user);
}
async function preparePage(context,protocol){
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('requestfailed',request=>network.push({url:new URL(request.url()).pathname,error:request.failure()?.errorText}));page.on('response',async response=>{if(response.url().endsWith('/api/completion-speech')&&response.request().postDataJSON()?.action!=='status')contractResponses.push({action:response.request().postDataJSON(),status:response.status(),body:await response.json().catch(()=>null)});});
 await page.addInitScript(()=>{
  let visibility='visible';Object.defineProperty(document,'visibilityState',{get:()=>visibility,configurable:true});window.fixtureVisibility=value=>{visibility=value;document.dispatchEvent(new Event('visibilitychange'));};
  window.fixtureSpeech={calls:[],active:null,cancels:0,fail:false};class Utterance{constructor(text){this.text=text;}}
  const synthesis=new EventTarget();synthesis.getVoices=()=>[{name:'Synthetic Chinese',voiceURI:'fixture-zh',lang:'zh-CN'},{name:'Synthetic English',voiceURI:'fixture-en',lang:'en-US'}];synthesis.speak=utterance=>{window.fixtureSpeech.calls.push({text:utterance.text,voice:utterance.voice?.voiceURI});window.fixtureSpeech.active=utterance;if(window.fixtureSpeech.fail)queueMicrotask(()=>utterance.onerror?.({error:'not-allowed'}));};synthesis.cancel=()=>{window.fixtureSpeech.cancels++;window.fixtureSpeech.active=null;};
  Object.defineProperty(window,'speechSynthesis',{value:synthesis,configurable:true});Object.defineProperty(window,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});window.fixtureFinishSpeech=()=>{const active=window.fixtureSpeech.active;window.fixtureSpeech.active=null;active?.onend?.();};
 });
 await page.goto(base+'/conversations/shared-task?syncProtocol='+protocol);await page.locator('[data-session-id="shared-task"] .session-main').waitFor();await page.locator('[data-session-id="shared-task"] .session-main').click();await page.locator('dialog.speech-settings').waitFor({state:'attached'});await page.locator('#prompt:not([disabled])').waitFor();return page;
}
async function status(page){return page.evaluate(async()=>{const r=await fetch('/api/completion-speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status'})});return r.json();});}
async function waitStatus(page,predicate){let value;for(let i=0;i<100;i++){value=await status(page);if(predicate(value))return value;await page.waitForTimeout(50);}throw Error('Speech status did not converge: '+JSON.stringify(value));}
async function menu(page){await page.locator('#brand-menu-btn').click();}
async function enable(page){await menu(page);await page.locator('#speech-master').click();await waitStatus(page,value=>value.enabled&&Boolean(value.browserId));await page.locator('#prompt').click();}
async function select(page,id){await page.locator(`[data-session-id="${id}"] .more`).click();await page.locator('.popitem').filter({hasText:/^完成播报$/}).click();await waitStatus(page,value=>value.selected?.[id]?.enabled);await page.locator('#prompt').click();}
async function send(page,text){await page.locator('#prompt').fill(text);await page.locator('#send:not([disabled])').click();}
async function wake(page){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
async function calls(page,count){await page.waitForFunction(n=>window.fixtureSpeech.calls.length>=n,count,{timeout:12000});}

try{
 await setupScope('alice');await setupScope('bob');
 oauth=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;res.setHeader('content-type','application/json');if(req.url==='/login/oauth/access_token'){const {code}=JSON.parse(raw);res.end(JSON.stringify({access_token:code,token_type:'bearer'}));}else if(req.url==='/api/v1/user'){const user=(req.headers.authorization??'').replace('token ','');res.end(JSON.stringify({id:user==='alice'?1:2,login:user}));}else{res.writeHead(404);res.end('{}');}});await new Promise(r=>oauth.listen(0,'127.0.0.1',r));
 // Transfer grants are scoped by Host per user; each task owns only fixture files.
 transfer=new TransferServer({host:'127.0.0.1',port:0,workdir:root});await transfer.start();
 host=new HostServer({host:'127.0.0.1',port:0,token:'synthetic-speech-probe',factory:scopes.get('alice').factory,requireUser:true,scopeForUser:user=>scopes.get(user),transfer});await host.start();
 web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'synthetic-speech-probe',auth:new GiteaAuth({giteaUrl:`http://127.0.0.1:${oauth.address().port}`,clientId:'fixture',clientSecret:'synthetic',cookieSecret:'synthetic-cookie',allowedUsers:['alice','bob']})});await web.start();base=`http://127.0.0.1:${web.address().port}`;
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1280,height:900},permissions:['clipboard-read','clipboard-write']});await login(context,'alice');const page=await preparePage(context,protocol);
 assert.equal((await status(page)).enabled,false);await enable(page);await select(page,'shared-task');await capture(page,'01-opt-in');
 const otherContext=await browser.newContext({viewport:{width:1280,height:900}});await login(otherContext,'bob');const bob=await preparePage(otherContext,protocol);assert.equal((await status(bob)).enabled,false);assert.deepEqual((await status(bob)).selected,{});pass('T1.scope','Real fake-OAuth cookies + same task ID retain isolated settings');
 await page.evaluate(()=>window.fixtureVisibility('hidden'));await send(page,'首轮合成结果');await page.locator('.speech-summary').last().waitFor();await wake(page);await calls(page,1);assert.match(await page.evaluate(()=>window.fixtureSpeech.calls[0].text),/文件已经生成/);
 assert.equal((await page.request.get(base+'/api/workspace').then(r=>r.json())).conversations.find(t=>t.id==='shared-task').readCompletionId,undefined);pass('T1.original-turn','One opted-in native prompt produced complete answer and brief; fake audio left unread receipt absent');
 await capture(page,'02-summary-unread');await page.evaluate(()=>window.fixtureFinishSpeech());await page.evaluate(()=>window.fixtureVisibility('visible'));await page.locator('[data-session-id="shared-task"] .finished-coffee').waitFor({state:'detached'});pass('T2.visible-read','Latest visible summary cleared cup; hidden summary/audio did not');
 await page.locator('.speech-full-information summary').click();await page.locator('.speech-full-information pre').waitFor();assert.match(await page.locator('.speech-full-information').innerText(),/printf/);
 const downloadLink=page.locator('.speech-full-information a').filter({hasText:'下载结果'});const [download]=await Promise.all([page.waitForEvent('download'),downloadLink.click()]);assert.deepEqual(await readFile(await download.path()),downloadBytes);
 const copy=page.locator('.speech-full-information .codeblock button').filter({hasText:/复制|Copy/}).first();await copy.click();assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/printf/);await capture(page,'03-expanded-code-download');pass('T2.full-answer','Expanded Markdown/code clipboard and real scoped transfer download preserve output bytes');
 await page.reload();await page.locator('.speech-full-information[open]').waitFor();assert.equal(await page.evaluate(()=>window.fixtureSpeech.calls.length),0);pass('T2.reload','Expansion persists and read completion not spoken on reload');
 await page.locator('.speech-replay').click();await calls(page,1);await page.evaluate(()=>window.fixtureFinishSpeech());pass('T4.replay','Explicit replay used stored brief without another model submission');
 const accountA2=await browser.newContext({viewport:{width:1280,height:900}});await login(accountA2,'alice');const second=await preparePage(accountA2,protocol);const oldBrowser=(await status(second)).browserId;await menu(second);await second.locator('#speech-browser').click();const adopted=await waitStatus(second,v=>v.browserId!==oldBrowser);assert.ok(adopted.browserId);await second.locator('#prompt').click();pass('T3.takeover','Second isolated browser explicitly acquired account playback ownership');
 await page.evaluate(()=>window.fixtureVisibility('hidden'));await second.evaluate(()=>window.fixtureVisibility('hidden'));await send(page,'第二轮合成结果');await second.waitForTimeout(300);await wake(second);await calls(second,1);await wake(page);assert.equal(await page.evaluate(()=>window.fixtureSpeech.calls.length),1);await second.evaluate(()=>window.fixtureFinishSpeech());pass('T3.ownership','Only designated second browser played newer completion');
 await second.reload();await second.waitForTimeout(300);await wake(second);assert.equal(await second.evaluate(()=>window.fixtureSpeech.calls.length),0);pass('T3.reconnect','Consumed delivery survived reload without replay');
 await second.evaluate(()=>window.fixtureVisibility('visible'));await second.locator('.speech-summary').last().waitFor();await second.locator('[data-session-id="shared-task"] .finished-coffee').waitFor({state:'detached'});
 await second.locator('[data-session-id="codex-task"] .session-main').click();await select(second,'codex-task');await second.evaluate(()=>window.fixtureVisibility('hidden'));await send(second,'Codex合成结果');await second.locator('.speech-summary').last().waitFor();await wake(second);await calls(second,1);await second.evaluate(()=>window.fixtureFinishSpeech());pass('T1.codex','Codex-selected task traversed original-turn opt-in, completion and browser summary/playback path');
 await menu(second);await second.locator('#speech-master').click();await waitStatus(second,v=>!v.enabled);await second.locator('#prompt').click();await send(second,'关闭后普通回复');await second.locator('#thread').getByText(/任务已完成：关闭后普通回复/).waitFor();assert.equal(requests.at(-1).instructions,undefined);assert.equal((await status(second)).selected['codex-task'].enabled,true);pass('T4.disable','Master off stopped future injection and retained task selection');
 await menu(second);await second.locator('#speech-settings').click();await second.getByLabel('系统声音',{exact:true}).selectOption('fixture-zh');await waitStatus(second,v=>v.voiceURI==='fixture-zh');await second.getByRole('button',{name:'试听',exact:true}).click();await calls(second,2);assert.equal(await second.evaluate(()=>window.fixtureSpeech.calls.at(-1).voice),'fixture-zh');await second.evaluate(()=>window.fixtureFinishSpeech());await second.getByRole('button',{name:'关闭',exact:true}).click();pass('T4.voice','System voice selection persisted and preview used Chinese synthetic voice without native submission');
 assert.equal((await status(bob)).enabled,false);assert.equal(await bob.locator('.speech-summary').count(),0);assert.equal(await bob.evaluate(()=>window.fixtureSpeech.calls.length),0);pass('T3.isolation','Other synthetic account with identical task ID never saw summary or playback');
 const active=requests.filter(r=>r.user==='alice'&&r.instructions);assert.equal(active.length,3);assert.equal(requests.length,4);assert.equal(active[1].instructions,active[0].instructions);assert.equal(active[2].instructions,active[0].instructions);assert.deepEqual(errors,[]);pass('T1.prefix','Three opted-in Pi/Codex requests reuse exact profile; only four explicit user sends, no summary turn');
 await capture(second,'04-disabled-normal-answer');
 const result={pass:true,protocol,criteria,limitations:[{verdict:'UNVERIFIABLE',criterion:'Actual audible Chinese voice quality and OS background/lock suspension',reason:'Synthetic browser speech proves wiring only; requires target device/system voice listening'},{verdict:'UNVERIFIABLE',criterion:'Provider cached-input metric reuse',reason:'No live provider requests; stable instruction equality is deterministic evidence only'}],nativeRequests:requests.map(({user,id,text,instructions,engine})=>({user,id,text,engine,profileBytes:instructions?.length??0})),pageErrors:errors,failedRequests:network,evidence};await writeFile(join(evidence,'http-contracts.json'),JSON.stringify(contractResponses,null,2)+'\n');await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({pass:true,protocol,criteria:criteria.length,pageErrors:errors,evidence}));
}catch(error){if(browser)for(const [i,page]of browser.contexts().flatMap(c=>c.pages()).entries())await capture(page,'failure-'+i).catch(()=>{});await writeFile(join(evidence,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,criteria,pageErrors:errors,failedRequests:network},null,2));throw error;}
finally{await browser?.close();await web?.close();await host?.close();await transfer?.close();if(oauth){oauth.closeAllConnections();await new Promise(r=>oauth.close(r));}await rm(root,{recursive:true,force:true});}
