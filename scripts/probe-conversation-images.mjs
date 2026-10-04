// Browser -> Web -> Host -> scoped transfer regression; no model or production data.
import {mkdtemp,mkdir,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';
import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';
import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
import {TransferServer} from '../dist/src/host/transfer.js';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const evidence=process.env.PI_COFFEE_VERIFY_DIR??join(homedir(),'.cache/pi-coffee/verify/images-'+Date.now());
await mkdir(evidence,{recursive:true});const root=await mkdtemp(join(evidence,'fixture-'));
const workspaces=new Workspaces(join(root,'registry'),{taskRoot:join(root,'projects')});const task=await workspaces.createChatConversation('image-task');
const bytes=await readFile(join(repo,'public/login-coffee-maid-chibi.webp'));
await writeFile(resolve(task.cwd,'../attachments/preview.webp'),bytes);
const transfer=new TransferServer({port:0,host:'127.0.0.1',advertiseHost:'127.0.0.1',workdir:root,workspaces});await transfer.start();
const factory=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:join(repo,'test/fixtures/fake-pi-rpc.mjs'),env:{FAKE_SETTLE_DELAY_MS:'1000'},cwdForSession:async id=>(await workspaces.lookup(id))?.cwd??root});
// Source-verification fixture enrolls the actual durable V2 path.
let verified=false;
if(process.env.PROBE_SYNC_V2==='1')factory.readHistory=async()=>{const sourceFreshness=verified?'unknown':'current';verified=true;return {history:{entries:[],leafId:null},binding:'fixture-native',sourceGeneration:'fixture-1',sourceFreshness,checkedAt:new Date().toISOString()};};
const host=new HostServer({port:0,token:'fixture',factory,workspaces,transfer});await host.start();
const web=new WebServer({port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',defaultUser:'fixture',allowUnauthenticated:true});await web.start();
const url=`http://127.0.0.1:${web.address().port}`;
if(process.env.PROBE_SYNC_V2==='1'){for(let i=0;i<100;i++){const state=await (await fetch(url+'/api/conversations/image-task/page')).json();if(state.lastSourceCheckAt)break;if(i===99)throw Error('V2 source verification failed');await new Promise(r=>setTimeout(r,20));}}
let browser;const errors=[];const assert=(v,m)=>{if(!v)throw Error(m);};
try{
 browser=await chromium.launch({headless:true,...(process.env.PI_COFFEE_BROWSER_EXECUTABLE?{executablePath:process.env.PI_COFFEE_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('websocket',ws=>ws.on('framereceived',({payload})=>{const f=JSON.parse(String(payload));if(['opened','history'].includes(f.type))console.log(JSON.stringify({type:f.type,syncProtocol:f.syncProtocol,streaming:f.state?.isStreaming}));}));
 if(process.env.PROBE_BASELINE_VIEW){const body=await readFile(process.env.PROBE_BASELINE_VIEW,'utf8');await page.route('**/conversation-sync-view.js',route=>route.fulfill({contentType:'text/javascript',body}));}
 await page.goto(url);await page.locator('.login-coffee-skip').click();await page.locator('[data-session-id="image-task"]').click();
 await page.locator('#prompt').fill('![Preview](../attachments/preview.webp)');await page.locator('#send:not([disabled])').click();
 const img=page.locator('.assistant img[data-workspace-path]'); // Reload may correctly fall back if the source becomes unknown.
 await img.waitFor();await page.waitForFunction(()=>{const i=document.querySelector('.assistant img');return i?.complete&&i.naturalWidth>0;});
 assert(await img.isVisible(),'Preview is not visible');
 const download=page.locator('.assistant .artifact-download');assert(await download.count()===1,'Download action missing');
 const [saved]=await Promise.all([page.waitForEvent('download'),download.click()]);
 assert((await readFile(await saved.path())).equals(bytes),'Downloaded image differs');
 await page.screenshot({path:join(evidence,'image.png')});
 await page.locator('#stop').waitFor({state:'hidden'}).catch(()=>{});
 await page.locator('#prompt').fill('hold: Keep running');await page.locator('#send:not([disabled])').click();
 await page.locator('.sidebar-running-cat').first().waitFor();
 await page.reload();await page.waitForTimeout(600);await img.waitFor();await page.waitForFunction(()=>document.querySelector('.assistant img')?.naturalWidth>0);
 const [afterReload]=await Promise.all([page.waitForEvent('download'),page.locator('.assistant .artifact-download').first().click()]);assert((await readFile(await afterReload.path())).equals(bytes),'Download after reload differs');
 await page.locator('.login-coffee-skip').click().catch(()=>{});
 await page.screenshot({path:join(evidence,'running-history-image.png')});
 await rename(resolve(task.cwd,'../attachments/preview.webp'),resolve(task.cwd,'../attachments/preview.saved.webp'));
 await page.reload();await page.getByText('图片无法显示：文件不可用、访问授权失效或连接中断。',{exact:true}).waitFor();
 const denied=await page.request.get(await page.locator('.assistant .artifact-download').first().getAttribute('href'));assert(denied.status()===403,'Unavailable file bypassed confinement');
 await page.screenshot({path:join(evidence,'unavailable-image.png')});
 assert(errors.length===0,JSON.stringify(errors));await writeFile(join(evidence,'result.json'),JSON.stringify({ok:true,inlinePreview:true,download:true,reload:true,unavailableFeedback:true,unavailableDownloadStatus:403,errors},null,2));console.log(evidence);
}catch(e){console.error(e);if(browser){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:join(evidence,'failure.png')});console.error((await page.locator('#thread').innerText().catch(()=>'' )).slice(-1200));}}process.exitCode=1;}
finally{await browser?.close();await web.close();await host.close();await transfer.close();await rm(root,{recursive:true,force:true});}
