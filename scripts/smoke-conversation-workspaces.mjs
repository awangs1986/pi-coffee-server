// Minimal deployed UI -> Gateway -> User VM probe. Synthetic tasks are archived and retained.
// Run with PI_COFFEE_SMOKE_WEB_URL, PI_COFFEE_GITEA_TEST_USER/PASSWORD and optional
// PI_COFFEE_SMOKE_PROJECT_ID, PLAYWRIGHT_EXECUTABLE_PATH. Never print credentials/cookies.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.PI_COFFEE_SMOKE_WEB_URL || 'http://webserver:3000';
const user=required('PI_COFFEE_GITEA_TEST_USER'),password=required('PI_COFFEE_GITEA_TEST_PASSWORD');
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(30_000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
async function chooseKind(label){await page.locator('#agent-menu-btn').click();await page.locator('#agent-kind-row').click();await page.locator('#agent-kind-pane').getByRole('menuitemradio',{name:new RegExp('^'+label)}).click();}
try{
 await page.goto(base+'/auth/login');
 if(new URL(page.url()).origin!==new URL(base).origin){
   const field=page.locator('input[name="user_name"], input[name="username"]');
   if(await field.isVisible()){await field.fill(user);await page.locator('input[name="password"]').fill(password);await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('input[name="password"]').press('Enter')]);}
   const authorize=page.locator('button[name="granted"][value="true"]');
   await authorize.waitFor({state:'visible',timeout:5000}).catch(()=>{});
   if(await authorize.isVisible())await authorize.click();
 }
 await page.waitForURL(url=>url.origin===new URL(base).origin && url.pathname==='/');
 await page.locator('#project-controls').waitFor({state:'visible'});
 await page.getByText('已连接',{exact:true}).first().waitFor({state:'visible'});
 await page.locator('#new-task').click();
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='已连接');
 await chooseKind('Chat');
 // There is no separate 创建任务 step: the first attachment (or message) creates the task directory.
 // A real PNG also exercises the inline image path: original bytes must survive in inbox.
 const original=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvLkAAAAASUVORK5CYII=','base64');
 const chatResponse=page.waitForResponse(r=>r.url().endsWith('/api/workspace') && r.request().postDataJSON()?.action==='conversation');
 const uploadResponse=page.waitForResponse(r=>r.url().includes('/upload?') && r.request().method()==='POST',{timeout:120_000});
 await page.locator('#file').setInputFiles({name:'workspace-smoke.png',mimeType:'image/png',buffer:original});
 const chat=await (await chatResponse).json();assert.equal(chat.workspaceKind,'chat');assert.equal(chat.creationState,'ready');
 await page.locator('#workspace-context').getByText(chat.cwd,{exact:true}).waitFor({state:'attached'});
 await page.waitForFunction(id=>localStorage.getItem('pi-coffee.active.v2')===id,chat.id);
 const upload=await uploadResponse;assert.equal(upload.status(),200);const saved=await upload.json();assert.match(saved.path,/^inbox\//);
 const grant=await api({action:'files',id:chat.id});
 const download=await page.request.get(grant.url+'/api/localsend/v2/workspace-download?'+new URLSearchParams({scope:grant.scope,token:grant.token,path:saved.path}));assert.equal(download.status(),200);assert.deepEqual(await download.body(),original);
 const before=chat.cwd;await page.reload();await page.locator('#workspace-context').getByText(before,{exact:true}).waitFor({state:'attached'});
 assert.equal((await api()).conversations.find(c=>c.id===chat.id).cwd,before);
 await api({action:'archive',id:chat.id});await api({action:'restore',id:chat.id});assert.equal((await api()).conversations.find(c=>c.id===chat.id).cwd,before);
 const state=await api();const project=state.projects.find(p=>p.id===process.env.PI_COFFEE_SMOKE_PROJECT_ID) || state.projects[0];
 assert.ok(project,'Register a disposable/test Gitea Project before the Work probe');
 await page.locator('#new-task').click();await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='已连接');
 await chooseKind('Work');await page.locator('#project-select').selectOption(project.id);await page.locator('#start-branch').fill(project.branch);
 const workResponse=page.waitForResponse(r=>r.url().endsWith('/api/workspace') && r.request().postDataJSON()?.action==='conversation',{timeout:120_000});
 await page.locator('#file').setInputFiles({name:'work-smoke.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic work probe\n')});const response=await workResponse;assert.equal(response.status(),200);const work=await response.json();assert.equal(work.workspaceKind,'project');assert.ok(work.startSha);assert.notEqual(work.cwd,chat.cwd);
 await page.locator('#workspace-context').getByText(work.cwd,{exact:true}).waitFor({state:'attached'});
 const sync=await api({action:'status',id:work.id});assert.equal(sync.state,'synced');assert.equal(sync.branch,work.branch);
 await page.reload();await page.locator('#workspace-context').getByText(work.cwd,{exact:true}).waitFor({state:'attached'});
 await page.locator('.workspace-branch').filter({hasText:work.branch}).waitFor();
 await page.locator('#sync-state[data-state="synced"]').waitFor({state:'visible'});
 await page.locator('#workspace-context button').click();
 if(process.env.PI_COFFEE_SMOKE_SCREENSHOT)await page.screenshot({path:process.env.PI_COFFEE_SMOKE_SCREENSHOT,fullPage:true});
 await api({action:'archive',id:chat.id});await api({action:'archive',id:work.id});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,chat:{id:chat.id,cwd:chat.cwd},work:{id:work.id,cwd:work.cwd,branch:work.branch,startSha:work.startSha},originalImageRoundtrip:true,reconnect:true,archiveRestore:true,uiErrors:errors,retained:'archived synthetic task directories and remote branch'},null,2));
}finally{await browser.close();}
async function api(body){return page.evaluate(async body=>{const response=await fetch('/api/workspace',body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Workspace request failed');return data;},body);}
function required(name){if(!process.env[name])throw new Error(name+' is required');return process.env[name];}
