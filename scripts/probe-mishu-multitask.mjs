// Synthetic multi-task automatic event Browser/Web/Host/native Pi acceptance. Optional MISHU_PLUGIN_ROOT is source-only evidence.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';import {createRequire} from 'node:module';
import {createServer} from 'node:http';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {once} from 'node:events';
import {chromium} from 'playwright';import {WebSocket} from 'ws';
import {SessionManager} from '@earendil-works/pi-coding-agent';

import {HostServer} from '../dist/src/host/server.js';import {WebServer} from '../dist/src/web/server.js';
import {Workspaces} from '../dist/src/host/workspaces.js';import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';import {NativeAgentFactory} from '../dist/src/host/native/factory.js';
const require=createRequire(import.meta.url),root=await mkdtemp(join(tmpdir(),'verify-mishu-')),store=join(root,'sessions'),agent=join(root,'agent');await mkdir(store);await mkdir(agent);
let host,web,browser,page;const errors=[],requests=[],apiRecords=[];let target,target2;const releaseTargets=[];let stage=0;let releaseTarget;let targetRequests=0;let reportRequests=0;let releaseSecretary;
let secondTask;
const model=createServer(async(req,res)=>{
 try{
 let raw='';for await(const c of req)raw+=c;const input=JSON.parse(raw);requests.push({toolNames:(input.tools??[]).map(t=>t.function?.name??t.name),stage});
 const tool=(name,args)=>({role:'assistant',tool_calls:[{index:0,id:'call-'+stage,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
 const userText=input.messages.filter(m=>m.role==='user').slice(-3).map(m=>m.content);
 if(JSON.stringify(userText).includes('Host 授权的只读汇报')){
  const second=JSON.stringify(input.messages.filter(m=>m.role==='user'&&!JSON.stringify(m).includes('【PI Coffee 插件状态】')).at(-1)).includes('Synthetic second brief');
  reportRequests++;res.writeHead(200,{'content-type':'text/event-stream'});const base={id:'report',object:'chat.completion.chunk',created:1,model:'fixture'};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'进展：'+(second?'SECOND_REPORT_BROWSER_OK':'REPORT_BROWSER_OK')+' 已收到 OBSERVATION_LATE_REPLY。\n限制：仅合成测试，尚未用户验收。\n下一步：请核对证据。\n来源：'+(second?'Synthetic second brief':'Synthetic build brief')},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');return;
 }
 if(JSON.stringify(userText).includes('DELAYED_OBSERVATION_WORK')){
  targetRequests++;const finish=()=>{if(res.writableEnded)return;res.writeHead(200,{'content-type':'text/event-stream'});const base={id:'target',object:'chat.completion.chunk',created:1,model:'fixture'};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'OBSERVATION_LATE_REPLY'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};releaseTargets.push(finish);releaseTarget=()=>releaseTargets.forEach(done=>done());return;
 }
 if(JSON.stringify(userText).includes('SECRETARY_STILL_AVAILABLE')){
  releaseSecretary=()=>{res.writeHead(200,{'content-type':'text/event-stream'});const base={id:'secretary',object:'chat.completion.chunk',created:1,model:'fixture'};res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'SECRETARY_CHAT_OK'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');};releaseSecretary();return;
 }
 const identity=JSON.stringify(input.messages.at(-1));if(!identity.includes('你是 MISHU')||!identity.includes('协调已启用'))throw Error('Current MISHU identity missing in actual Browser/Host/model flow');
 let delta,reason='stop';
 if(!input.tools?.some(t=>(t.function?.name??t.name)==='mishu'))throw Error('Enabled MISHU tool missing in actual model request');
 if(stage===0){delta=tool('mishu',{action:'directory'});stage++;reason='tool_calls';}
 else if(stage===1){const last=input.messages.filter(m=>m.role==='tool').at(-1);const body=JSON.parse(typeof last.content==='string'?last.content:last.content[0].text);const contact=body.configuredTargets.find(c=>c.id===target.id);delta=tool('mishu',{action:'tasks',operation:'register',operationId:'browser-brief',targetId:target.id,binding:contact.binding,purpose:'Synthetic build brief',scope:'Read-only fixture',summary:'Waiting for build evidence.',nextStep:'Inspect results'});stage++;reason='tool_calls';}
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
 const project=await workspaces.registerProject('mishu-verification',remote);target=await workspaces.createConversation(project.id,undefined,undefined,'pi');target2=await workspaces.createConversation(project.id,undefined,undefined,'pi');
 const pi=new RpcPiSessionFactory({agentDir:agent,sessionDir:store,provider:'fixture',model:'fixture',args:['--no-extensions','--offline'],extensions:[dirname(require.resolve('pi-coffee-harness/package.json'))],cwdForSession:id=>workspaces.file(id,''),extensionsForSession:async id=>{const runtime=await host.mishuRuntime('owner',id);return runtime.extensions.length&&process.env.MISHU_PLUGIN_ROOT?[resolve(process.env.MISHU_PLUGIN_ROOT)]:runtime.extensions;},envForSession:async id=>({...await workspaces.runtimeEnvironment(id),...(await host.mishuRuntime('owner',id)).env})});
 const factory=new NativeAgentFactory({workspaces,pi,grok:{command:process.execPath,args:[resolve('test/fixtures/fake-cursor.mjs')],env:{FIXTURE_GROK:'1',CLAUDE_CONFIG_DIR:join(root,'grok-home')}}});
 host=new HostServer({host:'127.0.0.1',port:0,token:'synthetic-host-only',requireUser:true,factory,workspaces,scopeForUser:()=>({factory,workspaces})});await host.start();
 const socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer synthetic-host-only','x-pi-coffee-user':'owner'}});const frames=[];socket.on('message',d=>frames.push(JSON.parse(String(d))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:target.id,nativeProtocol:1}));
 for(let n=0;n<200&&!frames.some(f=>f.type==='opened');n++)await new Promise(r=>setTimeout(r,20));if(!frames.some(f=>f.type==='opened'))throw Error('Target open failed');socket.send(JSON.stringify({v:1,type:'prompt',requestId:'direct-target-work',text:'DELAYED_OBSERVATION_WORK'}));for(let n=0;n<300&&!releaseTarget;n++)await new Promise(r=>setTimeout(r,20));if(!releaseTarget)throw Error('Target model did not begin');socket.close();
 const secondSocket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer synthetic-host-only','x-pi-coffee-user':'owner'}});const secondFrames=[];secondSocket.on('message',d=>secondFrames.push(JSON.parse(String(d))));await once(secondSocket,'open');secondSocket.send(JSON.stringify({v:1,type:'open',sessionId:target2.id,nativeProtocol:1}));
 for(let n=0;n<200&&!secondFrames.some(f=>f.type==='opened');n++)await new Promise(r=>setTimeout(r,20));if(!secondFrames.some(f=>f.type==='opened'))throw Error('Target open failed');secondSocket.send(JSON.stringify({v:1,type:'prompt',requestId:'direct-target-work-second',text:'DELAYED_OBSERVATION_WORK'}));for(let n=0;n<300&&targetRequests<2;n++)await new Promise(r=>setTimeout(r,20));if(targetRequests<2)throw Error('Target model did not begin');secondSocket.close();
 web=new WebServer({host:'127.0.0.1',port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'synthetic-host-only',defaultUser:'owner',allowUnauthenticated:true,publicDir:resolve('dist/public')});await web.start();
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1360,height:960}});page.on('pageerror',e=>errors.push(e.message));page.on('response',async response=>{if(response.url().endsWith('/api/mishu'))apiRecords.push({status:response.status(),body:await response.json().catch(()=>null)});});
 await page.goto(`http://127.0.0.1:${web.address().port}`);await page.locator(`[data-session-id="${source.id}"]`).click();
 await page.locator('#brand-menu-btn').click();await page.locator('#mishu-toggle:not([disabled])').waitFor();await page.screenshot({path:join(root,'01-menu.png')});const selectedResponse=page.waitForResponse(r=>r.url().endsWith('/api/mishu')&&r.request().postDataJSON()?.action==='select');await page.locator('#mishu-toggle').click();const selected=await selectedResponse;if(!selected.ok())throw Error('Selection failed '+JSON.stringify(await selected.json()));
 await page.locator('#prompt').fill('/mishu-setup');await page.locator('#send').click();
 await page.locator('#ui-options .ui-option').filter({hasText:target.id}).click();await page.locator('#ui-options .ui-option').filter({hasText:target2.id}).click();await page.screenshot({path:join(root,'02-target-selection.png')});await page.locator('#ui-options .ui-option').filter({hasText:'完成选择'}).click();
 await page.locator('#ui-options .ui-option').filter({hasText:'仅信息通知'}).click();await page.locator('#ui-options .ui-option').filter({hasText:'仅查看已选择的联系对象'}).click();await page.screenshot({path:join(root,'03-confirm-setup.png')});await page.locator('#ui-ok').click();
 await page.locator('#ui-modal').waitFor({state:'hidden'});
 await page.setViewportSize({width:390,height:700});
 await page.locator('#prompt').fill('/mishu-notifications');await page.locator('#send').click();
 await page.locator('#ui-options .ui-option').filter({hasText:'开启事件提醒'}).click();await page.screenshot({path:join(root,'reminders-mobile.png')});await page.locator('#ui-ok').click();await page.locator('#ui-modal').waitFor({state:'hidden'});
 await page.setViewportSize({width:1360,height:960});await page.locator('#prompt').fill('请记住选中的对话负责验证合成构建，仅记录简报。');await page.locator('#send').click();
 await page.getByText('BRIEF_BROWSER_OK：已记录，尚未开始观察。',{exact:false}).first().waitFor({timeout:30000});
 const env=(await host.mishuRuntime('owner',source.id)).env;
 const tasks=async()=>{const response=await fetch(env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify({action:'tasks',version:1,operation:'list'})});if(!response.ok)throw Error('Task read failed');return (await response.json()).tasks;};
 const initial=(await tasks())[0];if(!initial||initial.observation!=='not-started')throw Error('Incorrect admission');
 await page.locator('#prompt').fill('/mishu-tasks');await page.locator('#send').click();await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).click();
 await page.locator('#ui-options .ui-option').filter({hasText:'观察当前工作'}).click();await page.locator('#ui-options .ui-option').filter({hasText:'正在观察，等待回信'}).waitFor();
 if((await tasks())[0].observation!=='watching')throw Error('Observation not persisted');await page.screenshot({path:join(root,'watching.png')});await page.locator('#ui-cancel').click();await page.locator('#ui-modal').waitFor({state:'hidden'});
 const request=async body=>{const response=await fetch(env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;};
 const contact=(await request({action:'directory'})).configuredTargets.find(row=>row.id===target2.id);
 secondTask=(await request({action:'tasks',version:1,operation:'register',operationId:'second-browser-brief',targetId:contact.id,binding:contact.binding,purpose:'Synthetic second brief',scope:'Second independent synthetic target run',summary:'Waiting',nextStep:'Review separately'})).task;
 await request({action:'tasks',version:1,operation:'observe',operationId:'second-watch',taskId:secondTask.taskId,expectedRevision:1,runId:contact.observation.runId});
 await page.locator('#prompt').fill('SECRETARY_STILL_AVAILABLE');await page.locator('#send').click();
 await page.getByText('SECRETARY_CHAT_OK',{exact:false}).first().waitFor({timeout:30000});
 releaseTarget();
 // No user prompt or tasks read drives notification admission.
 await page.getByText('进展：REPORT_BROWSER_OK',{exact:false}).first().waitFor({timeout:30000});
 await page.getByText('进展：SECOND_REPORT_BROWSER_OK',{exact:false}).first().waitFor({timeout:30000});
 for(let n=0;n<200&&(await tasks())[0].reports?.[0]?.state!=='committed';n++)await new Promise(r=>setTimeout(r,30));
 const observed=(await tasks())[0];const report=observed.reports?.[0];if(report?.state!=='committed'||!report.outputs?.length)throw Error('Native report identity not committed');
 for(const width of [1360,390]){
  await page.setViewportSize({width,height:800});await page.reload();await page.getByText('进展：REPORT_BROWSER_OK',{exact:false}).first().waitFor({timeout:10000});
  if(await page.getByText('进展：REPORT_BROWSER_OK',{exact:false}).count()!==1||await page.getByText('进展：SECOND_REPORT_BROWSER_OK',{exact:false}).count()!==1)throw Error('Duplicate report rendered');
  await page.locator('.login-coffee').waitFor({state:'hidden'});await page.screenshot({path:join(root,'report-'+width+'.png')});
 }
 await page.locator('#prompt').fill('/mishu-report');await page.locator('#send').click();await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).click();
 await page.getByText('这一版结果已经汇报，请查看当前对话历史。',{exact:false}).first().waitFor({timeout:10000});
 await page.locator('#prompt').fill('/mishu-tasks');await page.locator('#send').click();await page.locator('#ui-options .ui-option').filter({hasText:'Synthetic build brief'}).click();await page.locator('#ui-options .ui-option').filter({hasText:'停止记录'}).click();await page.locator('#ui-options .ui-option').filter({hasText:'已停止记录'}).waitFor();await page.screenshot({path:join(root,'stop-mobile.png')});await page.locator('#ui-cancel').click();
 if((await tasks())[0].workState!=='stopped')throw Error('Mobile stop was not persisted');
 if(reportRequests!==2)throw Error('Report generation repeated');
 if(targetRequests!==2)throw Error('Observation replayed target execution');
 if(errors.length)throw Error('Browser/model errors: '+errors.join('; '));
 await writeFile(join(root,'evidence.json'),JSON.stringify({passed:true,sourceId:source.id,targetId:target.id,engine:'pi',targetRequests,lateReply:observed.fact.text,mainSecretaryAvailable:true,reportRequests,reportNativeOutputs:report.outputs,reportReconnectedOnce:true,multiTaskReports:2,separateTargetRuns:true,requests,viewports:[1360,390],observationWithoutPrompt:true,automaticReportWithoutPrompt:true,mobileEnableAndStop:true,browserErrors:errors,syntheticModels:true},null,2));console.log(JSON.stringify({passed:true,evidence:root}));
}catch(e){await writeFile(join(root,'failure.json'),JSON.stringify({error:e.message,errors,requests,apiRecords},null,2));await page?.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.log(JSON.stringify({passed:false,error:e.message,evidence:root}));process.exitCode=1;}
finally{releaseTarget?.();await browser?.close();await web?.close();await host?.close();model.closeAllConnections();await new Promise(r=>model.close(r));}
