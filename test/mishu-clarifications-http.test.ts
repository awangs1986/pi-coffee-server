import {afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
const roots:string[]=[],hosts:HostServer[]=[];
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'mishu-questions-'));roots.push(root);const workspaces=new Workspaces(join(root,'work'));
 const source=await workspaces.createChatConversation(),a=await workspaces.createChatConversation(),b=await workspaces.createChatConversation();
 let host:HostServer;
 async function start(){const pi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions')});host=new HostServer({port:0,token:'fixture',requireUser:true,factory:pi,workspaces,scopeForUser:user=>({factory:pi,workspaces:user==='owner'?workspaces:new Workspaces(join(root,'other'))})});hosts.push(host);await host.start();}
 await start();
 const browser=(body:unknown,user='owner')=>fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify({id:source.id,...body as object})});
 const selected=await browser({action:'select',selected:true});expect(await selected.json()).toMatchObject({selected:true});let env=(await host.mishuRuntime('owner',source.id)).env;
 const runtime=async(body:unknown)=>fetch(env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});
 const directory=await (await runtime({action:'directory'})).json(),targets=directory.conversations.filter((t:any)=>[a.id,b.id].includes(t.id)).map(({id,binding,title,engine}:any)=>({id,binding,title,engine}));
 await host.close();hosts.splice(hosts.indexOf(host),1);
 const file=join(root,'work','.coffee','mishu','state.json'),state=JSON.parse(await readFile(file,'utf8'));Object.assign(state.chats[source.id],{enabled:true,targets,allowInstructions:false});await writeFile(file,JSON.stringify(state));await start();env=(await host.mishuRuntime('owner',source.id)).env;
 return {root,source,a,b,browser,runtime,restart:async()=>{await host.close();hosts.splice(hosts.indexOf(host),1);await start();env=(await host.mishuRuntime('owner',source.id)).env;}};
}
it('persists an ordinary question without blocking unrelated work, and binds one real user answer across retries and restart',async()=>{
 const f=await fixture();const input={action:'clarifications',version:1,operation:'create',operationId:'question-a',kind:'ordinary',question:'A 采用哪一种格式？',options:['短摘要','详细报告']};
 const created=await f.runtime(input);expect(created.status).toBe(200);const {question}=await created.json();expect(question).toMatchObject({state:'pending',revision:1});
 expect((await (await f.runtime({action:'clarifications',version:1,operation:'list'})).json()).questions).toHaveLength(1);
 expect((await f.runtime({...input,operationId:'question-b',question:'B 的交付时间？'})).status).toBe(200);
 await f.restart();const listed=await (await f.browser({action:'clarifications',version:1,operation:'list'})).json();expect(listed.questions.map((q:any)=>q.question)).toContain('A 采用哪一种格式？');
 const answer={action:'clarifications',version:1,operation:'answer',questionId:question.questionId,expectedRevision:1,operationId:'answer-a',answer:'短摘要'};
 expect((await f.runtime(answer)).status).toBe(409);
 const response=await f.browser(answer);expect(response.status).toBe(200);const answered=await response.json();expect(answered.question).toMatchObject({state:'answered',answer:{text:'短摘要',channel:'browser'}});expect(answered.question.answer.eventId).toMatch(/^mishu-answer-/);
 expect((await (await f.browser(answer)).json()).question.answer.eventId).toBe(answered.question.answer.eventId);
 expect((await f.browser({...answer,operationId:'answer-conflict',answer:'详细报告'})).status).toBe(409);
 expect((await f.browser({...answer,operationId:'foreign'},'other')).status).toBe(409);
 const remaining=await (await f.browser({action:'clarifications',version:1,operation:'list'})).json();expect(remaining.questions.filter((q:any)=>q.state==='pending')).toHaveLength(1);
});
it('rejects expiry, stale revision, native approvals and post-revocation answers',async()=>{
 const f=await fixture(),create=(data:object)=>f.runtime({action:'clarifications',version:1,operation:'create',operationId:'question-a',kind:'ordinary',question:'选格式',...data});
 expect((await create({kind:'native-approval'})).status).toBe(409);
 const response=await create({expiresAt:new Date(Date.now()+1000).toISOString()});expect(response.status).toBe(200);const {question}=await response.json();
 const answer={action:'clarifications',version:1,operation:'answer',operationId:'answer',questionId:question.questionId,expectedRevision:2,answer:'简短'};expect((await f.browser(answer)).status).toBe(409);
 await new Promise(r=>setTimeout(r,1050));expect((await f.browser({...answer,expectedRevision:1})).status).toBe(409);
 await f.browser({action:'select',selected:false});expect((await f.browser({...answer,expectedRevision:1})).status).toBe(409);
});
it('joins each existing task with its own contact, unanswered decisions and original reply destination without inferring success',async()=>{
 const f=await fixture(),directory=await (await f.runtime({action:'directory'})).json();
 async function register(targetId:string,operationId:string,purpose:string){const binding=directory.conversations.find((t:any)=>t.id===targetId).binding;const r=await f.runtime({action:'tasks',version:1,operation:'register',operationId,targetId,binding,purpose,scope:'仅询问当前进展，不执行',summary:'等待联系',nextStep:'等待负责人回信'});expect(r.status).toBe(200);return (await r.json()).task;}
 const a=await register(f.a.id,'brief-a','A 的验证'),b=await register(f.b.id,'brief-b','B 的验证');
 await f.runtime({action:'clarifications',version:1,operation:'create',operationId:'q-a',kind:'ordinary',taskId:a.taskId,question:'A 用哪种格式？'});
 const result=await f.browser({action:'collaboration',version:1,operation:'list'});expect(result.status).toBe(200);const rows=(await result.json()).items;
 expect(rows.find((r:any)=>r.taskId===a.taskId)).toMatchObject({purpose:'A 的验证',state:'waiting-user',target:{id:f.a.id},destination:{sourceId:f.source.id,taskId:a.taskId},contacted:false,read:'unknown',acceptance:'pending'});
 expect(rows.find((r:any)=>r.taskId===b.taskId)).toMatchObject({state:'recorded',contacted:false,execution:'not-started',report:'not-reported'});
 expect((await f.browser({action:'collaboration',version:1,operation:'list',destination:'other-secretary'})).status).toBe(409);
 expect((await f.browser({action:'collaboration',version:1,operation:'list'},'other')).status).toBe(409);
 const wrong=await f.runtime({action:'send',targetId:f.b.id,binding:directory.conversations.find((t:any)=>t.id===f.b.id).binding,taskId:a.taskId,messageId:'wrong-related-message',kind:'information-only',text:'只问进度'});expect(wrong.status).toBe(409);
 const contact=await f.runtime({action:'send',targetId:f.b.id,binding:directory.conversations.find((t:any)=>t.id===f.b.id).binding,taskId:b.taskId,messageId:'b-progress',kind:'information-only',text:'只问进度，不修改任何内容'});expect(contact.status).toBe(200);
 const contacted=await (await f.runtime({action:'collaboration',version:1,operation:'get',taskId:b.taskId})).json();expect(contacted).not.toHaveProperty('error');expect(contacted.item).toMatchObject({contacted:true,destination:{sourceId:f.source.id},relatedMessages:[{messageId:'b-progress'}]});
});
