// Isolated real-main startup acceptance. Models and stores are synthetic.
// MISHU_PLUGIN_ROOT uses a private runtime dependency link: source-candidate proof only.
import {mkdtemp,mkdir,readFile,writeFile,cp,readdir,symlink,stat,truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';import {createServer} from 'node:http';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';
import {Workspaces} from '../dist/src/host/workspaces.js';
const require=createRequire(import.meta.url),root=await mkdtemp(join(tmpdir(),'mishu-startup-'));
const work=join(root,'work'),projects=join(root,'configured-projects'),sessions=join(root,'sessions'),agent=join(root,'agent'),runtime=join(root,'runtime');
const failures=[],reportScopes=[],targetCalls=[],pendingTargets=new Map(),pendingForeground=new Map(),sockets=[];let child,childLog='',base;
const wait=async(fn,label,timeout=20000)=>{const until=Date.now()+timeout;do{const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,30));}while(Date.now()<until);throw Error(label);};
const send=(res,text)=>{if(res.writableEnded||res.destroyed)return;const f={id:randomUUID(),object:'chat.completion.chunk',created:1,model:'fixture'};res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({...f,choices:[{index:0,delta:typeof text==='string'?{role:'assistant',content:text}:text,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({...f,choices:[{index:0,delta:{},finish_reason:typeof text==='string'?'stop':'tool_calls'}]})+'\n\ndata: [DONE]\n\n');};
const provider=createServer(async(req,res)=>{try{
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),all=JSON.stringify(body.messages);
 const scope=/STARTUP_(default|alice|paused)/.exec(all)?.[1];if(!scope)throw Error('Unknown synthetic scope');
 if(all.includes('<task-facts>')){reportScopes.push(scope);send(res,'进展：STARTUP_'+scope+' 已完成。\n限制：合成验收，尚未用户验收。\n下一步：查看目标结果。\n来源：STARTUP_'+scope);return;}
 const userText=m=>typeof m.content==='string'?m.content:Array.isArray(m.content)?m.content.filter(p=>p.type==='text').map(p=>p.text).join('\n'):'';
 // Match the synthetic actor's message, never marker names echoed in untrusted watch data.
 const latest=body.messages.filter(m=>m.role==='user'&&/^(?:DIRECT_TARGET_|FOREGROUND_BUSY_|TRACK_STARTUP_)/.test(userText(m))).at(-1);if(JSON.stringify(latest).includes('DIRECT_TARGET_')){targetCalls.push(scope);pendingTargets.set(scope,()=>send(res,'STARTUP_'+scope+' completed'));return;}
 if(JSON.stringify(latest).includes('FOREGROUND_BUSY_')){pendingForeground.set(scope,()=>send(res,'Done'));return;}
 const last=body.messages.filter(m=>m.role==='tool').at(-1),data=last?JSON.parse(typeof last.content==='string'?last.content:last.content[0].text):undefined;
 let args;if(!data)args={action:'directory'};
 else if(data.configuredTargets){const target=data.configuredTargets[0];args={action:'tasks',operation:'register',operationId:'brief-'+scope,targetId:target.id,binding:target.binding,purpose:'STARTUP_'+scope,scope:'Synthetic startup',summary:'Follow target',nextStep:'Report'};}
 else if(data.task?.observation==='not-started'){
  // Source knows the exact native run from the preceding directory result.
  const directory=body.messages.filter(m=>m.role==='tool').map(m=>{try{return JSON.parse(typeof m.content==='string'?m.content:m.content[0].text);}catch{return {};}}).find(v=>v.configuredTargets);
  args={action:'tasks',operation:'observe',operationId:'observe-'+scope,taskId:data.task.taskId,expectedRevision:data.task.revision,runId:directory.configuredTargets[0].observation.runId};
 }else if(data.task?.observation==='watching'){send(res,'TRACKING_'+scope);return;}else throw Error('Unexpected synthetic tool result');
 send(res,{role:'assistant',tool_calls:[{index:0,id:randomUUID(),type:'function',function:{name:'mishu',arguments:JSON.stringify(args)}}]});
 }catch(error){failures.push(error.message);res.writeHead(500);res.end('Fixture failed');}});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
const scoped=[];
const exists=async file=>{try{await stat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function launch(){
 childLog='';child=spawn(process.execPath,[join(runtime,'src','main.js'),'host'],{cwd:runtime,env:{PATH:process.env.PATH,HOME:root,NODE_NO_WARNINGS:'1',PI_COFFEE_WORKDIR:work,PI_COFFEE_PROJECT_ROOT:projects,PI_COFFEE_CHAT_ROOT:join(root,'configured-chats'),PI_COFFEE_SESSION_DIR:sessions,PI_COFFEE_AGENT_DIR:agent,PI_COFFEE_PROVIDER:'fixture',PI_COFFEE_MODEL:'fixture',PI_COFFEE_EXTENSIONS:dirname(require.resolve('pi-coffee-harness/package.json')),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_TOKEN:'synthetic-startup',PI_COFFEE_TRANSFER_BIND:'off',PI_COFFEE_TMP_ROOT:join(root,'tmp')}});
 child.stdout.on('data',d=>childLog+=d);child.stderr.on('data',d=>childLog+=d);
 await wait(()=>{if(child.exitCode!==null)throw Error('Main exited: '+childLog);const port=/Host ws:\/\/127.0.0.1:(\d+)/.exec(childLog)?.[1];if(port){base='http://127.0.0.1:'+port;return true;}},'Main did not listen');
}
async function stop(){for(const s of sockets.splice(0))s.close();if(child&&child.exitCode===null){const current=child,exited=once(current,'exit');let timer;current.kill('SIGTERM');try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>{current.kill('SIGKILL');reject(Error('Candidate did not stop'));},15000);timer.unref();})]);}finally{clearTimeout(timer);}}}
async function open(scope,id){const frames=[];let setupTarget;
 const ws=new WebSocket(base.replace('http','ws')+'/host',{headers:{authorization:'Bearer synthetic-startup',...(scope?{'x-pi-coffee-user':scope}:{})}});sockets.push(ws);
 ws.on('message',raw=>{const f=JSON.parse(String(raw));frames.push(f);const e=f.event;if(e?.type!=='extension_ui_request')return;
 if(e.method==='select'){let value;if(e.title.startsWith('MISHU：事件提醒'))value='开启事件提醒';else if(e.title.includes('查看范围'))value=e.options[0];else if(e.title.includes('消息权限'))value=e.options[0];else {const target=e.options.find(x=>x.includes(setupTarget));value=target?.startsWith('✓')?e.options.find(x=>x.startsWith('完成选择')):target;}ws.send(JSON.stringify({v:1,type:'ui_response',requestId:randomUUID(),id:e.id,value}));}
 if(e.method==='confirm')ws.send(JSON.stringify({v:1,type:'ui_response',requestId:randomUUID(),id:e.id,confirmed:true}));
 });await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',sessionId:id,nativeProtocol:1}));await wait(()=>frames.some(f=>f.type==='opened'),'Native open failed');
 return {frames,ws,setup:async target=>{setupTarget=target;return prompt('/mishu-setup');},prompt};
 async function prompt(text,settle=true){const offset=frames.length,requestId=randomUUID();ws.send(JSON.stringify({v:1,type:'prompt',requestId,text}));if(settle)await wait(()=>frames.slice(offset).some(f=>f.event?.type==='agent_settled'),'Native prompt did not settle: '+text);}
}
try{
 await mkdir(work,{recursive:true});await mkdir(agent);await cp(resolve('dist'),runtime,{recursive:true});await mkdir(join(runtime,'node_modules'));
 // Keep dependencies immutable; a private tree allows testing an unpinned candidate.
 const dependencyRoot=resolve('node_modules');for(const name of await readdir(dependencyRoot))if(name!=='.bin'&&name!=='pi-coffee-mishu')await symlink(join(dependencyRoot,name),join(runtime,'node_modules',name));
 await symlink(process.env.MISHU_PLUGIN_ROOT?resolve(process.env.MISHU_PLUGIN_ROOT):dirname(require.resolve('pi-coffee-mishu/package.json')),join(runtime,'node_modules','pi-coffee-mishu'));
 await writeFile(join(runtime,'package.json'),' {"type":"module"}');
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'Fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));
 await writeFile(join(agent,'settings.json'),JSON.stringify({retry:{enabled:false},compaction:{enabled:false}}));
 for(const user of [undefined,'alice','paused']){const scope=user??'default',workspaces=new Workspaces(user?join(work,user,'projects'):projects,{chatRoot:user?join(work,user,'chats'):join(root,'configured-chats'),ownerId:user});const source=await workspaces.createChatConversation(),target=await workspaces.createChatConversation();scoped.push({user,scope,source,target,workspaces});}
 await launch();
 for(const entry of scoped){const {user,scope,source,target}=entry;const selected=await fetch(base+'/api/mishu',{method:'POST',headers:{authorization:'Bearer synthetic-startup','content-type':'application/json',...(user?{'x-pi-coffee-user':user}:{})},body:JSON.stringify({action:'select',id:source.id,selected:true})});if(!selected.ok)throw Error('Menu selection failed');
  const src=await open(user,source.id);await src.setup(target.id);await src.prompt('/mishu-notifications');const dst=await open(user,target.id);await dst.prompt('DIRECT_TARGET_STARTUP_'+scope,false);await wait(()=>pendingTargets.has(scope),'Target did not run');
  await src.prompt('TRACK_STARTUP_'+scope);await wait(()=>src.frames.some(f=>(JSON.stringify(f.event)??'').includes('TRACKING_'+scope)),'Tracking was not admitted');
  if(scope==='paused'){await src.prompt('/mishu-disable');pendingTargets.get(scope)();await wait(()=>dst.frames.some(f=>f.event?.type==='agent_settled'),'Disabled target did not finish');continue;}
  await src.prompt('FOREGROUND_BUSY_STARTUP_'+scope,false);await wait(()=>pendingForeground.has(scope),'Source not busy');pendingTargets.get(scope)();
  await wait(()=>src.frames.some(f=>f.type==='queue_state'&&f.items.some(i=>i.readOnly)),'Automatic report was not queued');
 }
 await stop();
 const corruptRoot=join(work,'broken','projects','.coffee','mishu');await mkdir(corruptRoot,{recursive:true});await writeFile(join(corruptRoot,'state.json'),'{synthetic truncated');
 const beforeTargets=targetCalls.length;await launch();
 // Critical gate: no HTTP, WS, status call or mishuRuntime invocation after restart.
 await wait(()=>reportScopes.length===2,'Startup did not automatically recover both authorized scopes',20000);await new Promise(r=>setTimeout(r,1200));
 if(reportScopes.sort().join(',')!=='alice,default')throw Error('Wrong or duplicate scope report');if(targetCalls.length!==beforeTargets)throw Error('Target replayed');if(failures.length)throw Error(failures.join('; '));
 const corruptPreserved=await readFile(join(corruptRoot,'state.json'),'utf8')==='{synthetic truncated';if(!corruptPreserved)throw Error('Corrupt state overwritten');
 await stop();
 for(const entry of scoped){const state=JSON.parse(await readFile(join(entry.workspaces.root,'.coffee','mishu','state.json'),'utf8')),config=state.chats[entry.source.id],record=config.taskJournal.tasks[0].reports?.[0];if(entry.scope==='paused'){if(config.enabled||config.notifications||record)throw Error('Disabled scope recovered a report');continue;}if(record?.state!=='committed'||!record.outputs?.length)throw Error('Automatic native report not committed');}
 // Discovery is bounded and rejects noncanonical/symlink paths before creating
 // a scope. Empty fixtures need no native CLI; future formats remain untouched.
 const excluded=[];
 async function store(path,raw='{"version":1,"chats":{}}'){await mkdir(path,{recursive:true});await writeFile(join(path,'state.json'),raw);return path;}
 excluded.push(await store(join(work,'Bad User','projects','.coffee','mishu')));
 excluded.push(await store(join(work,'Upper','projects','.coffee','mishu')));
 const external=await store(join(root,'external','projects','.coffee','mishu'));excluded.push(external);await symlink(join(root,'external'),join(work,'linked'));
 const linkedCoffee=join(work,'linked-coffee','projects');await mkdir(linkedCoffee,{recursive:true});await symlink(join(root,'external','projects','.coffee'),join(linkedCoffee,'.coffee'));
 const linkedState=join(work,'linked-state','projects','.coffee','mishu');await mkdir(linkedState,{recursive:true});await symlink(join(external,'state.json'),join(linkedState,'state.json'));excluded.push(linkedState);
 const oversized=await store(join(work,'oversized','projects','.coffee','mishu'));await truncate(join(oversized,'state.json'),512*1024*1024+1);excluded.push(oversized);
 for(let i=0;i<260;i++)await store(join(work,'z-future-'+String(i).padStart(3,'0'),'projects','.coffee','mishu'),'{"version":999,"chats":{}}');
 // Recovery initializes up to 256 isolated scopes serially; retain every limit
 // assertion while allowing this disk-bound phase within the outer 90s probe.
 await launch();await wait(()=>childLog.includes('scope capacity reached'),'Scope discovery limit was not enforced',60000);
 if(!childLog.includes('store capacity exceeded'))throw Error('Oversized state not diagnosed');
 if(reportScopes.length!==2||targetCalls.length!==3)throw Error('Subsequent discovery replayed native work');
 const recoveryFailures=(childLog.match(/MISHU saved-scope recovery unavailable/g)??[]).length;if(recoveryFailures>256)throw Error('Too many scopes recovered');
 for(const path of excluded)if(await exists(join(path,'writer.sqlite')))throw Error('Excluded path initialized');
 for(let i=0;i<260;i++){const text=await readFile(join(work,'z-future-'+String(i).padStart(3,'0'),'projects','.coffee','mishu','state.json'),'utf8');if(text!=='{"version":999,"chats":{}}')throw Error('Unsupported state rewritten');}
 await stop();
 const evidence={passed:true,noReconnect:true,targetReplays:0,scopes:2,disabledWakes:0,corruptPreserved,pathSafety:true,boundedDiscovery:true,recoveryFailures,syntheticModels:true,sourceOverride:Boolean(process.env.MISHU_PLUGIN_ROOT)};await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,evidence:root}));
}catch(error){await writeFile(join(root,'failure.json'),JSON.stringify({error:error.message,failures,reportScopes,targetCalls,childLog},null,2));console.log(JSON.stringify({passed:false,error:error.message,evidence:root}));process.exitCode=1;}
finally{await stop().catch(()=>{});for(const finish of pendingTargets.values())finish();for(const finish of pendingForeground.values())finish();provider.closeAllConnections();await new Promise(r=>provider.close(r));}
