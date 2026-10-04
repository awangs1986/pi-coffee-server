// Navigation acceptance: native startup is deliberately blocked while read-only history stays available.
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {homedir} from 'node:os';import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const repo=resolve('.'),evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/navigation-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),workspaces=new Workspaces(join(root,'projects'));
await workspaces.createChatConversation('a');await workspaces.createChatConversation('b');
let history=Array.from({length:30},(_,i)=>({kind:'assistant',id:'m'+i,text:'Message '+i+' '+ 'x'.repeat(7900)}));history.push({kind:'assistant',id:'latest-0',text:'LATEST_B_0'});
const factory=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:join(repo,'test/fixtures/fake-pi-rpc.mjs'),cwdForSession:async id=>(await workspaces.lookup(id)).cwd});
let unblockB,blockedB=false;const nativeGate=new Promise(resolve=>unblockB=resolve);
const native=new Map(),create=factory.create.bind(factory);factory.create=async options=>{if(options.sessionId==='b'){blockedB=true;await nativeGate;}const session=await create(options);native.set(options.sessionId,session);if(options.sessionId==='b')session.getHistory=async()=>({entries:history,leafId:history.at(-1).id});return session;};
factory.readHistory=async id=>({history:{entries:id==='b'?history:[],leafId:id==='b'?history.at(-1).id:null},binding:id,sourceGeneration:String(history.length),sourceFreshness:'current',checkedAt:new Date().toISOString()});
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',defaultUser:'fixture'});await web.start();const url=`http://127.0.0.1:${web.address().port}`;
let browser;const errors=[],opened=[];const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function current(marker){for(let n=0;n<150;n++){const page=await (await fetch(url+'/api/conversations/b/page')).json();if(page.sourceFreshness==='current'&&page.entries.some(e=>e.text===marker))return;await new Promise(r=>setTimeout(r,20));}throw Error('Native display source did not verify');}
try{
 await current('LATEST_B_0');browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',({payload})=>{const f=JSON.parse(String(payload));if(f.type==='opened')opened.push({id:f.sessionId,protocol:f.syncProtocol});}));
 await page.goto(url+'/conversations/a');await page.locator('.login-coffee-skip').click();
 await page.locator('#prompt').fill('hold: A remains busy');await page.locator('#send:not([disabled])').click();
 await page.waitForFunction(()=>document.querySelector('[data-session-id="a"]')?.classList.contains('running'));
 const clickAt=Date.now();await page.locator('[data-session-id="b"]').click();
 await page.locator('#thread').filter({hasText:'LATEST_B_0'}).waitFor();const readableMs=Date.now()-clickAt;
 assert(new URL(page.url()).pathname==='/conversations/b','B route missing');assert(blockedB,'Fixture failed to block native B');
 assert(!opened.some(f=>f.id==='b'),'B unexpectedly finished native startup');
 await page.locator('#prompt').fill('B unsent draft');assert(await page.locator('#send').isDisabled(),'Must not send before native readiness');
 history=[...history,{kind:'assistant',id:'latest-1',text:'LATEST_B_1'}];await current('LATEST_B_1');
 await page.locator('#thread').filter({hasText:'LATEST_B_1'}).waitFor();
 await page.locator('[data-session-id="a"]').click();await page.locator('#prompt').fill('A unsent draft');
 assert(new URL(page.url()).pathname==='/conversations/a','A route missing');
 unblockB();await page.waitForTimeout(150);
 assert(!await page.locator('#thread').innerText().then(t=>t.includes('LATEST_B_1')),'Late B response repainted A');
 await page.goBack();await page.locator('#thread').filter({hasText:'LATEST_B_1'}).waitFor();
 assert(await page.locator('#prompt').inputValue()==='B unsent draft','Back lost B draft');
 await page.goForward();await page.waitForFunction(()=>document.querySelector('#prompt').value==='A unsent draft');
 assert(new URL(page.url()).pathname==='/conversations/a','Forward route missing');
 assert((await native.get('a').getState()).isStreaming,'Switch stopped A');
 await page.goto(url+'/conversations/b');await page.locator('#thread').filter({hasText:'LATEST_B_1'}).waitFor();
 assert(new URL(page.url()).pathname==='/conversations/b','Deep link was replaced by remembered selection');
 await page.goto(url+'/conversations/missing');await page.locator('#conversation-sync-status').filter({hasText:'对话不存在或当前账号无权访问'}).waitFor();
 assert(new URL(page.url()).pathname==='/conversations/missing','Missing route silently substituted another task');assert(!native.has('missing'),'Missing route created a runtime');
 assert(errors.length===0,JSON.stringify(errors));
 console.log(JSON.stringify({readableMs,nativeBBlockedDuringRead:true,latestVisibleBeforeNativeOpen:true,draftsAndHistory:true}));
 await page.screenshot({path:join(evidence,'navigation.png')});await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,latestNativeReplyVisible:true,nativeBBlockedDuringRead:true,busyAPreserved:true,opened,errors},null,2));console.log(JSON.stringify({pass:true,evidence}));
}catch(error){console.error(error);if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(evidence,'failure.png')});process.exitCode=1;}
finally{unblockB();await browser?.close();await web.close();await host.close();await rm(root,{recursive:true,force:true});}
