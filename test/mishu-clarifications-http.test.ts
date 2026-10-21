import {afterEach,it,expect} from 'vitest';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
const roots:string[]=[],hosts:HostServer[]=[];
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(fixedReply?:string){
 const root=await mkdtemp(join(tmpdir(),'mishu-questions-'));roots.push(root);const workspaces=new Workspaces(join(root,'work'));
 const source=await workspaces.createChatConversation(),a=await workspaces.createChatConversation(),b=await workspaces.createChatConversation();
 let host:HostServer;
 async function start(){const pi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions'),...(fixedReply?{env:{FAKE_PI_FIXED_REPLY:fixedReply}}:{})});host=new HostServer({port:0,token:'fixture',requireUser:true,factory:pi,workspaces,scopeForUser:user=>({factory:pi,workspaces:user==='owner'?workspaces:new Workspaces(join(root,'other'))})});hosts.push(host);await host.start();}
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
it('only a direct user can authorize a bounded information followup plan; unchanged facts stay quiet and stop preserves target work',async()=>{
 const f=await fixture(),directory=await (await f.runtime({action:'directory'})).json(),target=directory.conversations.find((t:any)=>t.id===f.a.id);
 const r=await f.runtime({action:'tasks',version:1,operation:'register',operationId:'plan-task',targetId:f.a.id,binding:target.binding,purpose:'确认验证结果',scope:'只联系，不执行',summary:'等待回信',nextStep:'核实缺项'});const task=(await r.json()).task;
 const input={action:'followups',version:1,operation:'create',operationId:'plan-a',taskIds:[task.taskId],text:'请只补充尚未说明的验证结果；无需执行新工作。',maxTotal:2,maxPerTarget:2,trigger:'new-reply',stopCondition:'budget-user-or-access'};
 expect((await f.runtime(input)).status).toBe(409);
 const planResponse=await f.browser(input);expect(planResponse.status).toBe(200);const {plan}=await planResponse.json();expect(plan).toMatchObject({state:'active',used:0,maxTotal:2,authorization:{channel:'browser'}});
 expect((await (await f.browser(input)).json()).plan.planId).toBe(plan.planId);
 const polls=await Promise.all(Array.from({length:4},()=>f.browser({action:'followups',version:1,operation:'list'})));expect((await polls[0].json()).plans[0].used).toBe(0);
 expect((await f.runtime({action:'send',taskId:task.taskId,targetId:f.a.id,binding:target.binding,messageId:'initial-progress',kind:'information-only',text:'只回答一次验证状态。'})).status).toBe(200);
 await expect.poll(async()=>{const list=await (await f.browser({action:'followups',version:1,operation:'list'})).json();return list.plans?.[0]?.used;},{timeout:10000}).toBe(2);
 const end=await (await f.browser({action:'followups',version:1,operation:'list'})).json();expect(end.plans[0]).toMatchObject({state:'exhausted',used:2});expect(new Set(end.plans[0].attempts.map((a:any)=>a.messageId)).size).toBe(2);
 await f.restart();expect((await (await f.browser({action:'followups',version:1,operation:'list'})).json()).plans[0].used).toBe(2);
 const stop=await f.browser({action:'followups',version:1,operation:'stop',operationId:'stop-plan',planId:plan.planId,expectedRevision:end.plans[0].revision});expect(stop.status).toBe(200);expect((await stop.json()).plan.state).toBe('stopped');
 expect((await (await f.runtime({action:'tasks',version:1,operation:'get',taskId:task.taskId})).json()).task.workState).toBe('recorded');
});
it('serializes racing answers and makes a source authorization generation obsolete after deselection',async()=>{
 const f=await fixture(),created=await (await f.runtime({action:'clarifications',version:1,operation:'create',operationId:'race-question',kind:'ordinary',question:'采用 A 还是 B？'})).json();const q=created.question;
 const answer=(text:string,operationId:string)=>({action:'clarifications',version:1,operation:'answer',questionId:q.questionId,expectedRevision:q.revision,answer:text,operationId});
 const results=await Promise.all([f.browser(answer('A','race-a')),f.browser(answer('B','race-b'))]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 const winner=await results.find(r=>r.status===200)!.json();expect((await (await f.browser(answer(winner.question.answer.text,'same-answer-new-request'))).json()).question.answer.eventId).toBe(winner.question.answer.eventId);
 await f.restart();expect((await f.browser({action:'select',selected:false})).status).toBe(200);expect((await f.runtime({action:'clarifications',version:1,operation:'list'})).status).toBe(401);
});
it('does not spend another contact when a new native message contains the same facts',async()=>{
 const f=await fixture('SYNTHETIC_NO_NEW_FINDINGS'),directory=await (await f.runtime({action:'directory'})).json(),target=directory.conversations.find((t:any)=>t.id===f.a.id);
 const task=(await (await f.runtime({action:'tasks',version:1,operation:'register',operationId:'same-facts-task',targetId:f.a.id,binding:target.binding,purpose:'核实结果',scope:'仅信息联系',summary:'等待',nextStep:'确认缺项'})).json()).task;
 expect((await f.browser({action:'followups',version:1,operation:'create',operationId:'same-facts-plan',taskIds:[task.taskId],text:'请仅补充新发现',maxTotal:3,maxPerTarget:3,trigger:'new-reply',stopCondition:'budget-user-or-access'})).status).toBe(200);
 await f.runtime({action:'send',taskId:task.taskId,targetId:f.a.id,binding:target.binding,messageId:'initial-same',kind:'information-only',text:'查询当前进度'});
 await expect.poll(async()=>{const messages=(await (await f.runtime({action:'inbox'})).json()).messages;return messages.filter((m:any)=>m.messageId.startsWith('followup-')&&m.state==='settled').length;},{timeout:10000}).toBe(1);
 const statuses=await Promise.all(Array.from({length:5},()=>f.browser({action:'followups',version:1,operation:'list'})));for(const status of statuses)expect((await status.json()).plans[0]).toMatchObject({state:'active',used:1});
 await f.restart();expect((await (await f.browser({action:'followups',version:1,operation:'list'})).json()).plans[0].used).toBe(1);
});
it('invalidates an explicit followup plan when its authorized task scope changes, without contacting the target',async()=>{
 const f=await fixture(),directory=await (await f.runtime({action:'directory'})).json(),target=directory.conversations.find((t:any)=>t.id===f.a.id);
 const task=(await (await f.runtime({action:'tasks',version:1,operation:'register',operationId:'scoped-task',targetId:f.a.id,binding:target.binding,purpose:'询问结果',scope:'只问测试，不改代码',summary:'等待',nextStep:'核实'})).json()).task;
 const create={action:'followups',version:1,operation:'create',operationId:'scoped-plan',taskIds:[task.taskId],text:'只问新的测试证据',maxTotal:2,maxPerTarget:2,trigger:'new-reply',stopCondition:'budget-user-or-access'};
 expect((await f.browser(create)).status).toBe(200);
 expect((await f.runtime({action:'tasks',version:1,operation:'update',operationId:'scope-correction',taskId:task.taskId,expectedRevision:task.revision,scope:'现在改为另一项工作'})).status).toBe(200);
 await expect.poll(async()=>((await (await f.browser({action:'followups',version:1,operation:'list'})).json()).plans?.[0]?.state)).toBe('invalidated');
 expect((await (await f.runtime({action:'inbox'})).json()).messages).toHaveLength(0);
});
