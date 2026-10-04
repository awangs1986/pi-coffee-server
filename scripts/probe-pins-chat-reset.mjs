// Actual Browser/Web/Host pinning and no-confirm Chat reset using isolated native Pi; no model request.
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {homedir} from 'node:os';import {execFileSync} from 'node:child_process';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {NativeAgentFactory} from '../dist/src/host/native/factory.js';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const repo=resolve('.'),evidence=process.env.EVIDENCE_DIR||join(homedir(),'.cache/pi-coffee/verify/pins-reset-'+Date.now());await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-')),source=join(root,'repo');await mkdir(source);
const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@localhost',...args],{cwd:source,stdio:'pipe'});
git('init','-b','main');await writeFile(join(source,'README.md'),'fixture');git('add','.');git('commit','-m','fixture');
const workspaces=new Workspaces(join(root,'registry')),project=await workspaces.registerProject('demo',source),task=await workspaces.createChatConversation('a');
const agent=join(root,'agent'),store=join(root,'sessions');await mkdir(agent);await mkdir(store);
await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:1/v1',api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:true,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));await writeFile(join(agent,'settings.json'),'{}');
const extension=join(root,'jobs.mjs');await writeFile(extension,`export default pi=>pi.registerCommand('coffee-workspace-jobs',{handler:async args=>pi.appendEntry('coffee-workspace-jobs',{nonce:args.trim(),known:true,active:0})});`);
const old=SessionManager.create(task.cwd,store,{id:task.id});old.appendModelChange('fixture','fixture');old.appendThinkingLevelChange('high');old.appendSessionInfo('Chat reset fixture');old.appendMessage({role:'user',content:'OLD_CHAT_TO_CLEAR',timestamp:Date.now()});old.appendMessage({role:'assistant',content:[{type:'text',text:'OLD_ANSWER_TO_CLEAR'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
await workspaces.moveSidebar(task.id,project.id);await writeFile(join(task.cwd,'keep.txt'),'retained');
const factory=new NativeAgentFactory({workspaces,pi:new RpcPiSessionFactory({agentDir:agent,cwd:task.cwd,sessionDir:store,provider:'fixture',model:'fixture',cliPath:join(repo,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),extensions:[extension],args:['--offline'],cwdForSession:id=>workspaces.file(id,''),envForSession:id=>workspaces.runtimeEnvironment(id)})});
const host=new HostServer({port:0,token:'fixture',factory,workspaces});await host.start();
const web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'fixture',defaultUser:'fixture'});await web.start();const url=`http://127.0.0.1:${web.address().port}`;
let browser;const assert=(ok,message)=>{if(!ok)throw Error(message);};const errors=[];
try{
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('.login-coffee-skip').click();await page.locator('[data-session-id="a"]').click();
 await page.locator('#thread').getByText('OLD_CHAT_TO_CLEAR',{exact:true}).waitFor();
 await page.locator('[data-session-id="a"] .more').click();await page.locator('[data-pin-conversation="a"]').click();
 await page.locator('[data-sidebar-pinned] [data-session-id="a"]').waitFor();assert(await page.locator('[data-sidebar-project] [data-session-id="a"]').count()===0,'Pinned row still grouped');
 await page.screenshot({path:join(evidence,'pinned.png')});
 await page.reload();await page.locator('[data-sidebar-pinned] [data-session-id="a"]').waitFor();await page.locator('[data-session-id="a"] .more').click();await page.locator('[data-pin-conversation="a"]').click();
 await page.locator('[data-sidebar-project] [data-session-id="a"]').waitFor();
 await page.locator('#stats').click();await page.locator('#sp-clear-context:not([disabled])').waitFor();
 await page.screenshot({path:join(evidence,'clear-control.png')});await page.locator('#sp-clear-context').click();
 await page.waitForFunction(()=>!document.querySelector('#thread')?.textContent.includes('OLD_CHAT_TO_CLEAR'));
 await page.locator('#agent-name').filter({hasText:'fixture'}).waitFor();
 assert(await page.locator('#modal').isVisible()===false,'Unexpected confirmation');
 const changed=(await (await fetch(url+'/api/workspace')).json()).conversations.find(c=>c.id==='a');assert(changed.contextReset&&changed.nativeBinding.id!=='a','Native binding did not change');assert(changed.cwd===task.cwd,'Directory changed');
 assert(await readFile(join(task.cwd,'keep.txt'),'utf8')==='retained','Attachment removed');
 await page.reload();await page.locator('#agent-name').filter({hasText:'fixture'}).waitFor();assert(!(await page.locator('#thread').textContent()).includes('OLD_CHAT_TO_CLEAR'),'Reload resurrected context');
 await page.screenshot({path:join(evidence,'cleared.png')});assert(errors.length===0,JSON.stringify(errors));
 await writeFile(join(evidence,'result.json'),JSON.stringify({pass:true,pinned:true,outsideGroups:true,pinSurvivesReload:true,unpinRestoresGroup:true,noConfirmation:true,emptyContext:true,reload:true,directoryPreserved:true,errors},null,2));console.log(JSON.stringify({pass:true,evidence}));
}catch(error){console.error(error);if(browser)await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(evidence,'failure.png')});process.exitCode=1;}
finally{await browser?.close();await web.close();await host.close();await rm(root,{recursive:true,force:true});}
