// Actual Browser/Web/Host group lifecycle with isolated files and fake native RPC.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {homedir} from 'node:os';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const repo=resolve('.'),evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/groups-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),source=join(root,'repo');await mkdir(source);
const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@localhost',...args],{cwd:source,stdio:'pipe'});
git('init','-b','main');await writeFile(join(source,'README.md'),'fixture');git('add','.');git('commit','-m','fixture');
const workspaces=new Workspaces(join(root,'registry')),project=await workspaces.registerProject('demo',source),task=await workspaces.createChatConversation('a');
const factory=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:join(repo,'test/fixtures/fake-pi-rpc.mjs'),cwdForSession:async id=>(await workspaces.lookup(id)).cwd});
let native;const create=factory.create.bind(factory);factory.create=async options=>(native=await create(options));
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',defaultUser:'fixture'});await web.start();const url=`http://127.0.0.1:${web.address().port}`;
let browser;const assert=(ok,message)=>{if(!ok)throw Error(message);};const errors=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.login-coffee-skip').click();await page.locator('[data-session-id="a"]').click();await page.locator('#prompt').fill('hold: Keep running during group changes');await page.locator('#send:not([disabled])').click();
 await page.waitForFunction(()=>document.querySelector('[data-session-id="a"]')?.classList.contains('running'));await page.locator('#prompt').fill('Keep this unsent draft');
 const createGroup=async name=>{await page.locator('#brand-menu-btn').click();await page.locator('#create-sidebar-group').click();await page.locator('#modal-input').fill(name);await page.locator('#modal-ok').click();await page.locator('.project-group-name').filter({hasText:name}).waitFor();return page.locator('.project-group').filter({has:page.locator('.project-group-name').filter({hasText:name})});};
 const custom=await createGroup('资料');const id=await custom.getAttribute('data-sidebar-project');
 assert(await page.locator('#prompt').inputValue()==='Keep this unsent draft','Creation lost draft');
 await page.locator('[data-session-id="a"]').dragTo(custom.locator('.project-group-header'));
 await custom.locator('[data-session-id="a"]').waitFor();await custom.locator('.project-group-more').click();
 assert(await page.locator('[data-delete-sidebar-group]').isDisabled(),'Occupied group delete was enabled');
 await page.locator('#prompt').click();await custom.locator('.session-item .more').click();await page.locator('[aria-label="移至侧栏分组"]').selectOption('');
 await page.locator('[data-sidebar-ungrouped] [data-session-id="a"]').waitFor();await custom.locator('.project-group-more').click();await page.locator('[data-delete-sidebar-group]').click();await page.locator(`[data-sidebar-project="${id}"]`).waitFor({state:'detached'});
 const automatic=page.locator(`[data-sidebar-project="${project.id}"]`);await automatic.locator('.project-group-more').click();await page.locator('[data-delete-sidebar-group]').click();await automatic.waitFor({state:'detached'});
 await createGroup('保留空组');await page.reload();await page.locator('.project-group-name').filter({hasText:'保留空组'}).waitFor();assert(!await automatic.count(),'Deleted project group reappeared');
 const data=await (await fetch(url+'/api/workspace')).json();assert(data.projects.some(p=>p.id===project.id),'Project registration deleted');assert(data.conversations.find(c=>c.id==='a').cwd===task.cwd,'Task directory changed');assert((await native.getState()).isStreaming,'Grouping stopped native task');assert(errors.length===0,JSON.stringify(errors));
 await page.screenshot({path:join(evidence,'groups.png')});await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,create:true,drag:true,occupiedDeleteBlocked:true,emptyDelete:true,projectRetained:true,reload:true,nativeStillRunning:true,errors},null,2));console.log(JSON.stringify({pass:true,evidence}));
}catch(error){console.error(error);if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(evidence,'failure.png')});process.exitCode=1;}
finally{await browser?.close();await web.close();await host.close();await rm(root,{recursive:true,force:true});}
