// Run after npm run build. Uses isolated fixtures, never production credentials.
// Usage: node scripts/probe-conversation-fork.mjs /path/on/disk/evidence
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {chromium} from 'playwright';
import {HostServer} from '../dist/src/host/server.js';
import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';
import {NativeAgentFactory} from '../dist/src/host/native/factory.js';
import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
const evidence=resolve(process.argv[2]??'.cache/fork-browser');await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'fixture-'));let host,web,browser;const errors=[];const results=[];
try{
 const ws=new Workspaces(join(root,'projects'),{taskRoot:join(root,'tasks')});const source=await ws.createChatConversation();const store=join(root,'sessions');await mkdir(store);
 const original=SessionManager.create(source.cwd,store,{id:source.id});original.appendMessage({role:'user',content:'Fork browser fixture: keep the pending choice.',timestamp:Date.now()});original.appendMessage({role:'assistant',content:[{type:'text',text:'Waiting for the user; no project work.'}],api:'openai-completions',provider:'fake',model:'fake-mini',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 await writeFile(join(await ws.inboxDirectory(source.id),'fixture.txt'),'retained attachment');const before=await readFile(original.getSessionFile(),'utf8');
 const pi=new RpcPiSessionFactory({cwd:source.cwd,sessionDir:store,cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),env:{FAKE_HANDOFF:'success',FIXTURE_FORK_RPC_LOG:join(root,'rpc.jsonl')},envForSession:id=>ws.runtimeEnvironment(id),cwdForSession:id=>ws.file(id,'')});
 const factory=new NativeAgentFactory({pi,workspaces:ws});host=new HostServer({port:0,token:'fixture',factory,workspaces:ws});await host.start();web=new WebServer({host:'127.0.0.1',port:0,hostUrl:'ws://127.0.0.1:'+host.address().port+'/host',hostToken:'fixture',publicDir:resolve('dist/public')});await web.start();
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',error=>errors.push(error.message));
 const base='http://127.0.0.1:'+web.address().port;await page.goto(base);const row=page.locator('[data-session-id="'+source.id+'"]');await row.waitFor();
 for(const mode of ['native','handoff']){
  await row.hover();await row.locator('.more').click();await page.getByRole('button',{name:'Fork（分叉）',exact:true}).click();await page.locator('#fork-dialog').waitFor({state:'visible'});
  await page.locator('input[name="fork-mode"][value="'+mode+'"]').check();if(mode==='handoff'&&!await page.locator('#fork-warning').isVisible())throw Error('Handoff consent warning missing');
  const count=(await ws.list()).conversations.length;await page.screenshot({path:join(evidence,mode+'-dialog.png')});
  // Cancel must not create anything; reopen and explicitly confirm afterward.
  await page.locator('#fork-cancel').click();if((await ws.list()).conversations.length!==count)throw Error('Cancel created a task');
  await row.hover();await row.locator('.more').click();await page.getByRole('button',{name:'Fork（分叉）',exact:true}).click();await page.locator('input[name="fork-mode"][value="'+mode+'"]').check();
  const accepted=page.waitForResponse(response=>response.url().endsWith('/api/workspace')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='fork');await page.locator('#fork-confirm').click();const response=await accepted;if(response.status()!==202)throw Error('Fork admission: '+response.status()+' '+await response.text());
  await page.locator('#fork-dialog').waitFor({state:'hidden',timeout:20000});const tasks=(await ws.list()).conversations;const child=tasks.find(task=>task.fork?.mode===mode);if(child?.fork?.status!=='completed')throw Error('Fork did not complete');
  await page.locator('[data-session-id="'+child.id+'"].active').waitFor();await page.screenshot({path:join(evidence,mode+'-completed.png')});
  if(await readFile(join(await ws.inboxDirectory(child.id),'fixture.txt'),'utf8')!=='retained attachment')throw Error('Missing attachment');if(await readFile(original.getSessionFile(),'utf8')!==before)throw Error('Source changed');
  results.push({mode,cancelWithoutCreation:true,admission:response.status(),completed:true,openedChild:true,attachmentCopied:true,sourceUnchanged:true});
 }
 if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));await writeFile(join(evidence,'result.json'),JSON.stringify({results,pageErrors:errors,provider:'native Pi SessionManager and deterministic RPC fixture; no real model turn'},null,2));console.log('PASS: native + Handoff dialog, cancel, confirm, child selection, source/attachment checks; no browser errors');
}finally{await browser?.close();await web?.close();await host?.close();await rm(root,{recursive:true,force:true,maxRetries:5});}
