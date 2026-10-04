// Freshness acceptance: actual Browser/Web/Host with isolated native RPC fixtures.
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {homedir} from 'node:os';import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const repo=resolve('.'),evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/latest-switch-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),workspaces=new Workspaces(join(root,'projects'));
await workspaces.createChatConversation('a');await workspaces.createChatConversation('b');
let history=Array.from({length:30},(_,i)=>({kind:'assistant',id:'m'+i,text:'Message '+i+' '+ 'x'.repeat(7900)}));history.push({kind:'assistant',id:'latest-0',text:'LATEST_B_0'});
const factory=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:join(repo,'test/fixtures/fake-pi-rpc.mjs'),cwdForSession:async id=>(await workspaces.lookup(id)).cwd});
const native=new Map(),create=factory.create.bind(factory);factory.create=async options=>{const session=await create(options);native.set(options.sessionId,session);if(options.sessionId==='b')session.getHistory=async()=>({entries:history,leafId:history.at(-1).id});return session;};
factory.readHistory=async id=>({history:{entries:id==='b'?history:[],leafId:id==='b'?history.at(-1).id:null},binding:id,sourceGeneration:String(history.length),sourceFreshness:'current',checkedAt:new Date().toISOString()});
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',defaultUser:'fixture'});await web.start();const url=`http://127.0.0.1:${web.address().port}`;
let browser;const errors=[],opened=[];const assert=(ok,message)=>{if(!ok)throw Error(message);};
async function current(marker){for(let n=0;n<150;n++){const page=await (await fetch(url+'/api/conversations/b/page')).json();if(page.sourceFreshness==='current'&&page.entries.some(e=>e.text===marker))return;await new Promise(r=>setTimeout(r,20));}throw Error('Native display source did not verify');}
try{
 await current('LATEST_B_0');browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',({payload})=>{const f=JSON.parse(String(payload));if(f.type==='opened')opened.push({id:f.sessionId,protocol:f.syncProtocol});}));
 if(process.env.PROBE_BASELINE_VIEW){const body=await readFile(process.env.PROBE_BASELINE_VIEW,'utf8');await page.route('**/conversation-sync-view.js',route=>route.fulfill({contentType:'text/javascript',body}));}
 await page.goto(url);await page.locator('.login-coffee-skip').click();await page.locator('[data-session-id="b"]').click();await page.locator('#thread').filter({hasText:'LATEST_B_0'}).waitFor();
 // Simulate the scroll event caused by clearing/rebuilding/restoring the view,
 // deliberately without a wheel, touch, keyboard or scrollbar gesture.
 await page.evaluate(()=>{const scroller=document.querySelector('#scroller');scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll'));});await page.waitForTimeout(200);
 await page.locator('[data-session-id="a"]').click();await page.locator('#prompt').fill('hold: A remains busy');await page.locator('#send:not([disabled])').click();
 for(let n=0;n<50&&!((await native.get('a')?.getState())?.isStreaming);n++)await page.waitForTimeout(20);
 assert((await native.get('a').getState()).isStreaming,'A is not running');
 history=[...history,{kind:'assistant',id:'latest-1',text:'LATEST_B_1'}];await current('LATEST_B_1');
 await page.locator('[data-session-id="b"]').click();await page.locator('#thread').filter({hasText:'LATEST_B_1'}).waitFor();
 assert(!await page.locator('.new-message-indicator:not([hidden])').count(),'View entered older history without reader input');
 assert(opened.some(f=>f.id==='b'&&f.protocol===2),'V2 path was not exercised');assert((await native.get('a').getState()).isStreaming,'Switch stopped native A');assert(errors.length===0,JSON.stringify(errors));
 await page.screenshot({path:join(evidence,'latest-visible.png')});await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,latestNativeReplyVisible:true,programmaticScrollDidNotPage:true,busyAPreserved:true,opened,errors},null,2));console.log(JSON.stringify({pass:true,evidence}));
}catch(error){console.error(error);if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(evidence,'failure.png')});process.exitCode=1;}
finally{await browser?.close();await web.close();await host.close();await rm(root,{recursive:true,force:true});}
