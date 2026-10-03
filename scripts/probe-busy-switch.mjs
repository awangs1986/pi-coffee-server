// Real browser + Web/Host, deterministic native RPC; never touches production tasks.
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {homedir} from 'node:os';
import {performance} from 'node:perf_hooks';import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/busy-switch-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-'));const repo=resolve('.');
const workspaces=new Workspaces(join(root,'projects'));await workspaces.createChatConversation('busy');await workspaces.createChatConversation('other');
const factory=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:join(repo,'test/fixtures/fake-pi-rpc.mjs'),cwdForSession:async id=>(await workspaces.lookup(id)).cwd});
const nativeSessions=new Map(),create=factory.create.bind(factory);factory.create=async options=>{const session=await create(options);nativeSessions.set(options.sessionId,session);return session;};
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
const web=new WebServer({port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',allowUnauthenticated:true,defaultUser:'fixture'});await web.start();const url=`http://127.0.0.1:${web.address().port}`;
let browser;const errors=[],commands=[],times=[];const assert=(ok,message)=>{if(!ok)throw Error(message);};
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 page.on('websocket',ws=>ws.on('framesent',({payload})=>{commands.push(JSON.parse(String(payload)).type);}));
 if(process.env.PROBE_BASELINE_SIDEBAR){const body=await readFile(process.env.PROBE_BASELINE_SIDEBAR,'utf8');await page.route('**/sidebar-interaction.js',route=>route.fulfill({contentType:'text/javascript',body}));}
 await page.goto(url);await page.locator('.login-coffee-skip').click();
 await page.locator('[data-session-id="other"]').click();await page.locator('#prompt').fill('B cached reply');await page.locator('#send:not([disabled])').click();await page.locator('.assistant').filter({hasText:'echo: B cached reply'}).waitFor();
 await page.locator('[data-session-id="busy"]').click();await page.locator('#prompt').fill('hold: Keep A running');await page.locator('#send:not([disabled])').click();await page.locator('[data-session-id="busy"] .sidebar-running-cat').waitFor();
 for(let i=0;i<5;i++){
  await page.waitForTimeout(250);
  const row=page.locator('[data-session-id="other"]');await row.waitFor();let box;
  for(let attempt=0;attempt<20&&!box;attempt++){box=await row.boundingBox();if(!box)await page.waitForTimeout(16);}
  assert(box,'Other conversation is not visible');
  await page.mouse.move(box.x+40,box.y+box.height/2);await page.mouse.down();const handle=await row.elementHandle();
  const response=await fetch(url+'/api/workspace',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({action:'sidebar_display',showGroups:i%2===0})});assert(response.ok,'Sidebar update failed');
  await page.waitForTimeout(250);assert(await handle.evaluate(node=>node.isConnected),'Busy update detached clicked row before pointerup');
  const start=performance.now();await page.mouse.up();await page.locator('[data-session-id="other"].active').waitFor();await page.locator('#thread').filter({hasText:'B cached reply'}).waitFor();times.push(performance.now()-start);
  assert((await nativeSessions.get('busy').getState()).isStreaming,'Switch stopped native A');
  if(i<4)await page.locator('[data-session-id="busy"]').click();
 }
 assert(Math.max(...times)<500,'Warm conversation switch exceeded 500 ms');assert(!commands.includes('abort'),'Switch sent abort');assert(errors.length===0,JSON.stringify(errors));
 await page.screenshot({path:join(evidence,'busy-switch.png')});await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,firstGestureSwitches:5,switchMs:times,busyTaskPreserved:true,abortSent:false,pageErrors:errors},null,2));console.log(JSON.stringify({pass:true,switchMs:times,evidence}));
}catch(error){console.error(error);if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(evidence,'failure.png')});process.exitCode=1;}
finally{await browser?.close();await web.close();await host.close();await rm(root,{recursive:true,force:true});}
