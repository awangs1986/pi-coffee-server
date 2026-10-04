// Browser/Web/Host composer model labels and confirmed model changes, using isolated native RPC fixtures.
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {homedir} from 'node:os';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const repo=resolve('.'),evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/composer-model-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),source=join(root,'repo');await mkdir(source);
const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@localhost',...args],{cwd:source,stdio:'pipe'});
git('init','-b','main');await writeFile(join(source,'README.md'),'fixture');git('add','.');git('commit','-m','fixture');
const workspaces=new Workspaces(join(root,'registry')),project=await workspaces.registerProject('demo',source),task=await workspaces.createChatConversation('a');
const fixture=join(root,'fake.mjs');await writeFile(fixture,(await readFile(join(repo,'test/fixtures/fake-pi-rpc.mjs'),'utf8')).replace("import './github-env-probe.mjs';",'').replace('id: "fake-mini"','id: "meta/muse-spark-1.3-contributor"'));
const factory=new RpcPiSessionFactory({cwd:root,sessionDir:join(root,'sessions'),cliPath:fixture,cwdForSession:async id=>(await workspaces.lookup(id)).cwd});
let native;const create=factory.create.bind(factory);factory.create=async options=>(native=await create(options));
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',defaultUser:'fixture'});await web.start();const url=`http://127.0.0.1:${web.address().port}`;
let browser;const assert=(ok,message)=>{if(!ok)throw Error(message);};const errors=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.login-coffee-skip').click();
 await page.locator('[data-session-id="a"]').click();
 await page.waitForFunction(()=>document.querySelector('#agent-name')?.textContent==='meta/muse-sp');
 const button=page.locator('#agent-menu-btn');
 assert((await button.getAttribute('title')).includes('meta/muse-spark-1.3-contributor'),'Missing complete tooltip');
 assert(await button.locator('svg:visible').count()===0,'Icons visible');
 await page.screenshot({path:join(evidence,'long-model.png')});
 await button.click();await page.locator('#agent-model-row').click();await page.locator('#agent-model-pane button').filter({hasText:'fake-large'}).click();
 await page.waitForFunction(()=>document.querySelector('#agent-name')?.textContent==='fake-large');
 await page.screenshot({path:join(evidence,'short-model.png')});
 await page.locator('#new-task').click();await page.waitForFunction(()=>document.querySelector('#agent-name')?.textContent==='Pi');
 assert(await button.locator('svg:visible').count()===2,'Draft icons not restored');
 assert(errors.length===0,JSON.stringify(errors));
 await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,longModel:true,shortModel:true,noIcons:true,modelChange:true,draftRestored:true,errors},null,2));console.log(JSON.stringify({pass:true,evidence}));
}catch(error){console.error(error);if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(evidence,'failure.png')});process.exitCode=1;}
finally{await browser?.close();await web.close();await host.close();await rm(root,{recursive:true,force:true});}
