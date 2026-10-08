// Synthetic real Browser/Web/Host/native Pi acceptance. Optional MISHU_PLUGIN_ROOT is source-only evidence.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';import {createRequire} from 'node:module';
import {createServer} from 'node:http';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {once} from 'node:events';
import {chromium} from 'playwright';import {WebSocket} from 'ws';
import {SessionManager} from '@earendil-works/pi-coding-agent';

import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';import {NativeAgentFactory} from '../dist/src/host/native/factory.js';
const require=createRequire(import.meta.url),root=await mkdtemp(join(tmpdir(),'verify-mishu-')),store=join(root,'sessions'),agent=join(root,'agent');await mkdir(store);await mkdir(agent);
let host,web,browser,page;const errors=[],requests=[],apiRecords=[];let target;let stage=0;
const model=createServer(async(req,res)=>{
 try{
 let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);requests.push({toolNames:(input.tools??[]).map(t=>t.function?.name??t.name),stage});
 const tool=(name,args)=>({role:'assistant',tool_calls:[{index:0,id:'call-'+stage,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 const identity=JSON.stringify(input.messages.at(-1));if(!identity.includes('你是 MISHU')||!identity.includes('协调已启用'))throw Error('Current MISHU identity missing in actual Browser/Host/model flow');
 let delta,reason='stop';
 if(!input.tools?.some(t=>(t.function?.name??t.name)==='mishu'))throw Error('Enabled MISHU tool missing in actual model request');
 if(stage===0){delta=tool('mishu',{action:'directory'});stage++;reason='tool_calls';}
 else if(stage===1){const last=input.messages.filter(m=>m.role==='tool').at(-1);const body=JSON.parse(typeof last.content==='string'?last.content:last.content[0].text);const contact=body.configuredTargets.find(c=>c.id===target.id);delta=tool('mishu',{action:'tasks',operation:'register',operationId:'browser-brief',targetId:target.id,binding:contact.binding,purpose:'Synthetic build brief',scope:'Read-only fixture',summary:'Waiting for build evidence. '+ 'Synthetic evidence '.repeat(190),nextStep:'Inspect results'});stage++;reason='tool_calls';}
 else {const last=input.messages.filter(m=>m.role==='tool').at(-1);const body=JSON.parse(typeof last.content==='string'?last.content:last.content[0].text);if(!body.task?.taskId)throw Error('No persisted brief receipt');delta={role:'assistant',content:'BRIEF_BROWSER_OK：已记录，尚未开始观察。'};}
 res.writeHead(200,{'content-type':'text/event-stream'});const base={id:'synthetic',object:'chat.completion.chunk',created:1,model:'fixture'};
 res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:reason}]})+'\n\ndata: [DONE]\n\n');
 }catch(e){errors.push('model: '+e.message);res.writeHead(500);res.end('synthetic fixture failed');}
});await new Promise(r=>model.listen(0,'127.0.0.1',r));
try{
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${model.address().port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 await writeFile(join(agent,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 const workspaces=new Workspaces(join(root,'projects'));
 const source=await workspaces.createChatConversation();
 const seed=SessionManager.create(source.cwd,store,{id:source.id});seed.appendSessionInfo('MISHU 验收 Chat');seed.appendMessage({role:'user',content:'这是独立的合成验收对话。',timestamp:Date.now()});
 const git=promisify(execFile),seedRepo=join(root,'seed'),remote=join(root,'fixture.git');await mkdir(seedRepo);const run=args=>git('git',['-c','user.name=Fixture','-c','user.email=fixture@localhost',...args],{cwd:seedRepo});await run(['init','-b','main']);await writeFile(join(seedRepo,'note.txt'),'base');await run(['add','.']);await run(['commit','-m','fixture']);await run(['clone','--bare',seedRepo,remote]);
 const project=await workspaces.registerProject('mishu-verification',remote);target=await workspaces.createConversation(project.id,undefined,undefined,'grok');
 const pi=new RpcPiSessionFactory({agentDir:agent,sessionDir:store,provider:'fixture',model:'fixture',args:['--no-extensions','--offline'],extensions:[dirname(require.resolve('pi-coffee-harness/package.json'))],cwdForSession:id=>workspaces.file(id,''),extensionsForSession:async id=>{const runtime=await host.mishuRuntime('owner',id);return runtime.extensions.length&&process.env.MISHU_PLUGIN_ROOT?[resolve(process.env.MISHU_PLUGIN_ROOT)]:runtime.extensions;},envForSession:async id=>({...await workspaces.runtimeEnvironment(id),...(await host.mishuRuntime('owner',id)).env})});
 const factory=new NativeAgentFactory({workspaces,pi,grok:{command:process.execPath,args:[resolve('test/fixtures/fake-cursor.mjs')],env:{FIXTURE_GROK:'1',CLAUDE_CONFIG_DIR:join(root,'grok-home')}}});
 host=new HostServer({host:'127.0.0.1',port:0,token:'synthetic-host-only',requireUser:true,factory,workspaces,scopeForUser:()=>({factory,workspaces})});await host.start();
 const socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer synthetic-host-only','x-pi-coffee-user':'owner'}});const frames=[];socket.on('message',d=>frames.push(JSON.parse(String(d))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
 for(let n=0;n<200&&!frames.some(f=>f.type==='opened');n++)await new Promise(r=>setTimeout(r,20));if(!frames.some(f=>f.type==='opened'))throw Error('Target open failed');socket.close();
 web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'synthetic-host-only',defaultUser:'owner',allowUnauthenticated:true,publicDir:resolve('dist/public')});await web.start();
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1360,height:960}});page.on('pageerror',e=>errors.push(e.message));page.on('response',async response=>{if(response.url().endsWith('/api/mishu'))apiRecords.push({status:response.status(),body:await response.json().catch(()=>null)});});
 await page.goto(`http://127.0.0.1:${web.address().port}`);await page.locator(`[data-session-id="${source.id}"]`).click();
 await page.locator('#brand-menu-btn').click();await page.locator('#mishu-toggle:not([disabled])').waitFor();await page.screenshot({path:join(root,'01-menu.png')});const selectedResponse=page.waitForResponse(r=>r.url().endsWith('/api/mishu')&&r.request().postDataJSON()?.action==='select');await page.locator('#mishu-toggle').click();const selected=await selectedResponse;if(!selected.ok())throw Error('Selection failed '+JSON.stringify(await selected.json()));
 await page.locator('#prompt').fill('/mishu-setup');await page.locator('#send').click();
 await page.locator('#ui-options .ui-option').filter({hasText:target.id}).click();await page.screenshot({path:join(root,'02-target-selection.png')});await page.locator('#ui-options .ui-option').filter({hasText:'完成选择'}).click();
 await page.locator('#ui-options .ui-option').filter({hasText:'仅信息通知'}).click();await page.screenshot({path:join(root,'03-confirm-setup.png')});await page.locator('#ui-ok').click();
 await page.locator('#ui-modal').waitFor({state:'hidden'});await page.locator('#prompt').fill('请记住选中的对话负责验证合成构建，仅记录简报。');await page.locator('#send').click();
 await page.getByText('BRIEF_BROWSER_OK：已记录，尚未开始观察。',{exact:false}).first().waitFor({timeout:30000});
 const env=(await host.mishuRuntime('owner',source.id)).env;
 const tasks=async()=>{const response=await fetch(env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify({action:'tasks',version:1,operation:'list'})});if(!response.ok)throw Error('Task read failed');return (await response.json()).tasks;};
 const initial=(await tasks())[0];if(!initial||initial.observation!=='not-started')throw Error('Incorrect admission');
 for(const viewport of [{width:1360,height:960},{width:390,height:700}]){
  await page.setViewportSize(viewport);await page.locator('#prompt').fill('/mishu-tasks');await page.locator('#send').click();
  await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).click();
  await page.locator('#ui-title').filter({hasText:'用户验收'}).waitFor();
  await page.screenshot({path:join(root,'brief-details-'+viewport.width+'.png')});
  await page.locator('#ui-options .ui-option').filter({hasText:'纠正摘要'}).click();await page.locator('#ui-input').fill('Corrected '+viewport.width+' evidence'.repeat(400));await page.locator('#ui-ok').click();
  await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).waitFor();
  const stored=(await tasks())[0];if(stored.summary!=='Corrected '+viewport.width+' evidence'.repeat(400))throw Error('Correction not persisted');
  await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).click();await page.locator('#ui-options .ui-option').filter({hasText:'纠正范围'}).click();await page.locator('#ui-input').fill('Cancelled edit');await page.locator('#ui-cancel').click();
  await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).waitFor();if((await tasks())[0].scope!=='Read-only fixture')throw Error('Cancelled edit was saved');
  const bounds=await page.locator('.ui-dialog').boundingBox();if(bounds.y<0||bounds.y+bounds.height>viewport.height)throw Error('Task browser outside viewport');
  await page.screenshot({path:join(root,'brief-'+viewport.width+'.png')});await page.locator('#ui-cancel').click();await page.locator('#ui-modal').waitFor({state:'hidden'});
 }
 await page.setViewportSize({width:1360,height:960});await page.reload();await page.locator(`[data-session-id="${source.id}"]`).click();await page.locator('#prompt').fill('/mishu-tasks');await page.locator('#send').click();await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).click();await page.locator('#ui-options .ui-option').filter({hasText:'停止记录'}).click();
 await page.locator('#ui-options .ui-option').filter({hasText:'已停止记录'}).waitFor();if((await tasks())[0].workState!=='stopped')throw Error('Stop not persisted');await page.locator('#ui-cancel').click();
 if(errors.length)throw Error('Browser/model errors: '+errors.join('; '));
 await writeFile(join(root,'evidence.json'),JSON.stringify({passed:true,sourceId:source.id,targetId:target.id,engine:'grok',requests,viewports:[1360,390],cancelPreserved:true,stopPreservedTarget:true,browserErrors:errors,syntheticModels:true},null,2));console.log(JSON.stringify({passed:true,evidence:root}));
}catch(e){await writeFile(join(root,'failure.json'),JSON.stringify({error:e.message,errors,requests,apiRecords},null,2));await page?.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.log(JSON.stringify({passed:false,error:e.message,evidence:root}));process.exitCode=1;}
finally{await browser?.close();await web?.close();await host?.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
