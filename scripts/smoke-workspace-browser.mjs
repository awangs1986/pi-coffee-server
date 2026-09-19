import { chromium } from 'playwright';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Workspaces} from '../dist/src/host/workspaces.js';
import {HostServer} from '../dist/src/host/server.js';
import {TransferServer} from '../dist/src/host/transfer.js';
import {WebServer} from '../dist/src/web/server.js';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
const root=await mkdtemp(join(tmpdir(),'coffee-browser-'));const workspaces=new Workspaces(join(root,'projects'));const p=await workspaces.createProject('coffee-lab');
await exec('git',['branch','topic'],{cwd:p.path}); // a second Gitea-style branch for the bottom-bar selector
const history=new Map();
const factory={list:async()=>[...history.keys()].map(id=>({id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messageCount:2,preview:'检查工作区'})),delete:async id=>history.delete(id),create:async({sessionId:id})=>{
 const cwd=await workspaces.cwd(id);await writeFile(join(cwd,'example.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><rect width="360" height="180" fill="#f3eadc"/><text x="30" y="100" font-size="26">Workspace preview</text></svg>');await writeFile(join(cwd,'README.md'),'# Workspace\n\nA source file preview.');
 let current={provider:'test-only',id:'browser-fixture'};
 const listeners=new Set();let streaming=false;const emit=e=>{for(const l of listeners)l(e);};
 return {backgroundState:async()=>({known:true,active:0}),getHistory:async()=>({entries:history.get(id)??[],leafId:null}),getState:async()=>({isStreaming:streaming,messageCount:history.has(id)?2:0}),getModels:async()=>({models:[{provider:'test-only',id:'browser-fixture',source:'native'},{provider:'test-relay',id:'relay-fixture',source:'relay'}],current,thinkingLevels:['off'],thinkingLevel:'off'}),getCommands:async()=>[],getExtensions:async()=>[],getStats:async()=>({tokens:{total:0},cost:0}),rename:async()=>{},setModel:async(provider,id)=>{current={provider,id};},setThinkingLevel:async()=>{},compact:async()=>{},respondUi:async()=>{},steer:async()=>{},followUp:async()=>{},abort:async()=>{},stop:async()=>{},onEvent:cb=>{listeners.add(cb);return()=>listeners.delete(cb);},prompt:async(text)=>{
 streaming=true;emit({type:'agent_start'});emit({type:'message_start',message:{role:'user',content:[{type:'text',text}]}});emit({type:'message_end',message:{role:'user',content:[{type:'text',text}]}});
 const reply='浏览器测试数据：已检查当前工作区。\n\n![工作区产物](example.svg)\n\n[README.md](README.md)';emit({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:reply}});emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:reply}]}});history.set(id,[{kind:'user',id:'u',text},{kind:'assistant',id:'a',text:reply}]);streaming=false;emit({type:'agent_settled'});
 }};
}};
const transfer=new TransferServer({host:'127.0.0.1',port:0,advertiseHost:'127.0.0.1',workdir:root,workspaces,allowUnscoped:false});await transfer.start();
const host=new HostServer({port:0,token:'browser-fixture-token',factory,workspaces,transfer});await host.start();
const web=new WebServer({port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'browser-fixture-token',publicDir:fileURLToPath(new URL('../dist/public',import.meta.url))});await web.start();
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--use-gl=angle','--use-angle=swiftshader'],headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${web.address().port}`);await page.locator('#project-controls').waitFor({state:'visible'});
 // SPEC §1.1: the file tree is a real third column by default on wide screens, and the branch selector lives in the bottom bar.
 await page.locator('#workspace-panel').waitFor({state:'visible'});
 await page.selectOption('#project-select',p.id);await page.click('#new-task');
 await page.waitForFunction(()=>{const b=document.querySelector('#branch');return b && !b.disabled && [...b.options].some(o=>o.value==='topic') && [...b.options].some(o=>o.value==='main');});
 if(await page.$eval('#branch',b=>b.value)!=='main')throw new Error('Default starting branch should be the project branch');
 // The conversation does not exist yet: choosing the model source creates it (from the selected branch) so the source applies to the first turn.
 await page.selectOption('#branch','topic');
 await page.waitForFunction(()=>!document.querySelector('#model-source').disabled);
 await page.selectOption('#model-source','relay');await page.waitForFunction(()=>document.querySelector('#model').value==='test-relay/relay-fixture');
 await page.selectOption('#model-source','native');await page.waitForFunction(()=>document.querySelector('#model').value==='test-only/browser-fixture');
 await page.waitForFunction(()=>/^coffee\//.test(document.querySelector('#branch').value));
 const first=(await workspaces.list()).conversations[0];if(first.startBranch!=='topic')throw new Error('Conversation should start from the selected branch, got '+first.startBranch);
 await page.fill('#prompt','检查工作区');await page.keyboard.press('Enter');
 await page.getByText('浏览器测试数据：已检查当前工作区。').waitFor({timeout:12000});
 if(!await page.locator('#workspace-panel').isVisible())throw new Error('Workspace column should stay visible');
 await page.getByRole('button',{name:'example.svg',exact:true}).click();
 await page.waitForFunction(()=>{const img=document.querySelector('#artifact-preview img');return img?.complete && img.naturalWidth>0;});
 if(process.env.PI_COFFEE_BROWSER_SCREENSHOT)await page.screenshot({path:process.env.PI_COFFEE_BROWSER_SCREENSHOT,fullPage:true});
 await page.getByRole('button',{name:'README.md',exact:true}).click();await page.locator('#artifact-preview h1').waitFor();
 // Collapse and re-open the column from the top bar; the preference is remembered per browser.
 await page.click('#files-close');await page.locator('#workspace-panel').waitFor({state:'hidden'});
 await page.click('#files-toggle');await page.locator('#workspace-panel').waitFor({state:'visible'});
 // Changing the branch of an open conversation never switches its worktree: it offers a new conversation from that branch.
 await page.selectOption('#branch','main');await page.locator('#modal-ok').waitFor({state:'visible'});await page.click('#modal-cancel');
 if(!/^coffee\//.test(await page.$eval('#branch',b=>b.value)))throw new Error('Cancelling must keep the current worktree branch selected');
 await page.selectOption('#branch','main');await page.locator('#modal-ok').waitFor({state:'visible'});await page.click('#modal-ok');
 await page.locator('#hero').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('#branch').value==='main' && document.querySelector('#status').textContent==='已连接');
 await page.fill('#prompt','第二个对话');await page.keyboard.press('Enter');
 await page.getByText('浏览器测试数据：已检查当前工作区。').waitFor({timeout:12000});
 const all=(await workspaces.list()).conversations;if(all.length!==2 || all[1].startBranch!=='main')throw new Error('Second conversation should start from main: '+JSON.stringify(all.map(c=>c.startBranch)));
 await page.locator('.session-item').first().hover();await page.locator('.session-item .more').first().click();await page.getByRole('button',{name:'归档',exact:true}).last().click();
 await page.click('#show-archive');await page.locator('.session-item').first().hover();await page.locator('.session-item .more').first().click();
 await page.getByRole('button',{name:'永久删除…',exact:true}).waitFor();
 await page.getByRole('button',{name:'恢复对话',exact:true}).click();await page.click('#show-active');await page.locator('.session-item').first().waitFor();
 await page.setViewportSize({width:390,height:844});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth)){console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).slice(0,25)));throw new Error('Mobile horizontal overflow');}
 console.log(JSON.stringify({errors,workspaceCount:(await workspaces.list()).conversations.length,startBranches:(await workspaces.list()).conversations.map(c=>c.startBranch),preview:'SVG rendered and Markdown heading rendered',layout:'three columns by default, branch selector in the bottom bar'},null,2));
 if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();await web.close();await host.close();await transfer.close();await rm(root,{recursive:true,force:true});}
