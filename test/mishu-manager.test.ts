import {afterEach,describe,expect,it} from 'vitest';
import {mkdtemp,rm,writeFile,readFile,readdir,appendFile,stat,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseWatchConfig,RulesError,DEFAULT_WATCH_CONFIG,renderTemplate,inQuietHours,stuckThresholdMin} from '../src/host/mishu-rules.js';
import {WatchJournal} from '../src/host/mishu-journal.js';
import {MishuWatch,type Notice,type WatchTimers} from '../src/host/mishu-watch.js';
import {classifyQuick,quickReply,QuickConfirmations,type QuickRow} from '../src/host/mishu-quick.js';
import {GrantRegistry,GrantError} from '../src/host/mishu-grants.js';
import {ReceiptArchive,receiptsToRotate,assignmentsToRotate} from '../src/host/mishu-receipts.js';
import {InputQueue} from '../src/host/input-queue.js';

const roots:string[]=[];
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
const temp=async()=>{const r=await mkdtemp(join(tmpdir(),'mishu-manager-'));roots.push(r);return r;};

/** Deterministic clock + single manual timer. */
function clock(start=Date.parse('2026-10-09T02:00:00Z')){
 let now=start;const armed=new Map<number,{fn:()=>void;at:number}>();let seq=0;
 const timers:WatchTimers={set:(fn,ms)=>{const id=++seq;armed.set(id,{fn,at:now+ms});return id;},clear:h=>{armed.delete(h as number);}};
 return {now:()=>now,timers,armed,advance:async(ms:number,watch?:MishuWatch)=>{now+=ms;for(const [id,t] of [...armed])if(t.at<=now){armed.delete(id);t.fn();}if(watch)await watch.flush();}};
}

describe('rules.json',()=>{
 it('merges overrides by id, disables rules and rejects unknown keys',()=>{
  const config=parseWatchConfig({version:1,rules:[{id:'stuck',on:['run.stuck'],when:{noProgressMin:45},panel:{kind:'stuck',priority:2}},{id:'done',enabled:false},{id:'mine',on:['run.errored'],when:{engine:['codex']},notify:{channels:['web'],template:'{title} 挂了'}}]});
  expect(config.rules.find(r=>r.id==='stuck')!.when!.noProgressMin).toBe(45);
  expect(config.rules.find(r=>r.id==='done')!.enabled).toBe(false);
  expect(config.rules.find(r=>r.id==='mine')).toBeDefined();
  expect(stuckThresholdMin(config)).toBe(45);
  expect(()=>parseWatchConfig({version:1,rules:[{id:'x',on:['run.errored'],shell:'rm -rf /'}]})).toThrow(RulesError);
  expect(()=>parseWatchConfig({version:2})).toThrow(RulesError);
  expect(()=>parseWatchConfig({version:1,rules:[{id:'s',on:['run.stuck']}]})).toThrow(/noProgressMin/);
  expect(()=>parseWatchConfig({version:1,rules:[{id:'s',on:['run.stuck'],when:{noProgressMin:2}}]})).toThrow(RulesError);
  expect(()=>parseWatchConfig({version:1,rules:Array.from({length:51},(_,i)=>({id:'r'+i,on:['run.errored']}))})).toThrow(RulesError);
 });
 it('renders bounded templates without control characters',()=>{
  const text=renderTemplate('{title}：{error}',{title:'A\u0007'.repeat(100),error:'x'.repeat(500)});
  expect(text.length).toBeLessThanOrEqual(300);expect(text).not.toMatch(/[\u0000-\u001f]/);
  expect(renderTemplate('{unknown}{title}',{title:'t'})).toContain('t');
 });
 it('honours quiet hours across midnight',()=>{
  const config=parseWatchConfig({version:1,quietHours:{from:'23:00',to:'08:00',allow:['approval.opened']}});
  expect(inQuietHours(config,new Date(2026,9,9,23,30))).toBe(true);
  expect(inQuietHours(config,new Date(2026,9,9,12,0))).toBe(false);
  expect(inQuietHours(DEFAULT_WATCH_CONFIG,new Date())).toBe(false);
 });
});

describe('watch journal',()=>{
 it('rotates segments, prunes by count, reports gaps and survives a torn tail',async()=>{
  const root=await temp();let now=1_000_000;
  const journal=new WatchJournal(root,{segmentEvents:3,maxEvents:7,ringSize:4,pageLimit:5},()=>now);
  for(let i=0;i<12;i++){now+=1000;await journal.append({conv:'c'+(i%2),kind:'run.started',data:{i}});}
  expect(journal.head).toBe(12);
  const files=(await readdir(root)).sort();
  expect(files.length).toBeLessThanOrEqual(3);
  expect(journal.firstSeq).toBeGreaterThan(1);
  const old=await journal.read(0,5);expect(old.gap).toBe(true);expect(old.events[0].seq).toBe(journal.firstSeq);expect(old.events.length).toBeLessThanOrEqual(5);
  const page=await journal.read(old.next,100);expect(page.gap).toBe(false);expect(page.events.every(e=>e.seq>old.next)).toBe(true);
  const tail=await journal.read(12);expect(tail).toMatchObject({events:[],next:12,gap:false,head:12});
  // Torn final line after a crash is ignored; sequence numbers keep increasing.
  await appendFile(join(root,files.at(-1)!),'{"seq":13,"at":"x","conv":"c');
  const reopened=new WatchJournal(root,{segmentEvents:3,maxEvents:7,ringSize:4,pageLimit:5},()=>now);
  await reopened.load();expect(reopened.head).toBe(12);
  expect((await reopened.read(0,5)).events.every(e=>typeof e.conv==='string')).toBe(true);
 });
 it('prunes by retention and keeps file mode private',async()=>{
  const root=await temp();let now=0;
  const journal=new WatchJournal(root,{segmentEvents:2,retentionMs:10_000},()=>now);
  for(let i=0;i<6;i++){now+=6000;await journal.append({conv:'c',kind:'run.completed',data:{}});}
  expect(journal.firstSeq).toBeGreaterThan(1);
  const file=(await readdir(root))[0];expect((await stat(join(root,file))).mode&0o777).toBe(0o600);
 });
});

describe('watchdog',()=>{
 async function watchOf(extra:Partial<ConstructorParameters<typeof MishuWatch>[0]>={},rules?:unknown){
  const root=join(await temp(),'watch');const c=clock();const notices:Notice[]=[];
  if(rules){await mkdir(join(root,'..'),{recursive:true});await writeFile(join(root,'..','rules.json'),JSON.stringify(rules));}
  const watch=new MishuWatch({root,now:c.now,timers:c.timers,onNotice:n=>notices.push(n),catalog:async()=>[{id:'conv-a',title:'修复登录',engine:'codex',project:'web',running:false,queued:0},{id:'sec',title:'秘书',engine:'pi',project:'Chat',running:false,queued:0}],isExcluded:id=>id==='sec',...extra});
  await watch.start();return {watch,c,notices,root};
 }
 it('opens and closes panel items from approval, error and completion events',async()=>{
  const {watch,notices}=await watchOf();
  watch.event('conv-a',{type:'agent_start'});
  watch.event('conv-a',{type:'extension_ui_request',id:'q1',method:'confirm',title:'允许运行 npm test？'});
  await watch.flush();
  expect(watch.panel().items).toEqual([expect.objectContaining({kind:'approval',conv:'conv-a',ref:'q1',priority:1})]);
  expect(notices.at(-1)!.text).toContain('修复登录');expect(notices.at(-1)!.link).toBe('/conversations/conv-a');
  watch.event('conv-a',{type:'sync_pending',requests:[]});await watch.flush();
  expect(watch.panel().items.filter(i=>i.kind==='approval')).toHaveLength(0);
  watch.event('conv-a',{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'rate limit'}});
  watch.event('conv-a',{type:'agent_settled'});await watch.flush();
  expect(watch.panel().items).toEqual([expect.objectContaining({kind:'error'})]);
  expect((await watch.snapshot()).find(s=>s.id==='conv-a')).toMatchObject({state:'errored',lastError:'rate limit'});
  watch.event('conv-a',{type:'agent_start'});await watch.flush();
  expect(watch.panel().items.filter(i=>i.kind==='error')).toHaveLength(0);
  // Excluded secretary conversations are never watched.
  watch.event('sec',{type:'agent_start'});await watch.flush();
  expect((await watch.snapshot()).some(s=>s.id==='sec')).toBe(false);
  const journal=await watch.journal.read(0,100);expect(journal.events.some(e=>e.conv==='sec')).toBe(false);
  await watch.close();
 });
 it('detects stuck runs with a single timer and multiple thresholds, then recovers on progress',async()=>{
  const {watch,c,notices}=await watchOf({},{version:1,rules:[{id:'stuck',on:['run.stuck'],when:{noProgressMin:20},panel:{kind:'stuck',priority:2},notify:{channels:['web'],template:'{title} {minutes} 分钟无进展'}},{id:'stuck-long',on:['run.stuck'],when:{noProgressMin:60},panel:{kind:'stuck',priority:1},notify:{channels:['web'],template:'{title} 已 {minutes} 分钟'}}]});
  watch.event('conv-a',{type:'agent_start'});
  watch.event('conv-b',{type:'agent_start'});await watch.flush();
  expect(watch.armedTimers).toBe(1);expect(c.armed.size).toBe(1);
  await c.advance(19*60000,watch);expect(notices.filter(n=>n.rule.startsWith('stuck'))).toHaveLength(0);
  watch.event('conv-b',{type:'message_update'});await watch.flush();
  await c.advance(60000,watch);await watch.flush();
  expect(notices.filter(n=>n.rule==='stuck').map(n=>n.conv)).toEqual(['conv-a']);
  expect(c.armed.size).toBe(1);
  expect((await watch.snapshot()).find(s=>s.id==='conv-a')!.state).toBe('stuck');
  await c.advance(40*60000,watch);await watch.flush();
  expect(notices.filter(n=>n.rule==='stuck-long').map(n=>n.conv)).toContain('conv-a');
  watch.event('conv-a',{type:'message_update'});await watch.flush();
  expect((await watch.snapshot()).find(s=>s.id==='conv-a')!.state).toBe('running');
  expect(watch.panel().items.some(i=>i.kind==='stuck'&&i.conv==='conv-a')).toBe(false);
  watch.event('conv-a',{type:'agent_settled'});watch.event('conv-b',{type:'agent_settled'});await watch.flush();
  expect(c.armed.size).toBe(1); // only the completion batch deadline remains
  await c.advance(61000,watch);await watch.flush();expect(c.armed.size).toBe(0);expect(watch.armedTimers).toBe(0);
  await watch.close();
 });
 it('applies cooldown, batching, hourly budget and records WeChat as undelivered',async()=>{
  const {watch,c,notices}=await watchOf({},{version:1,limits:{webPerHour:2,wechatPerHour:1},rules:[{id:'error',on:['run.errored'],notify:{channels:['web','wechat'],template:'{title} 出错',cooldownMin:10}}]});
  for(let i=0;i<3;i++){watch.event('conv-a',{type:'agent_start'});watch.event('conv-a',{type:'message_end',message:{role:'assistant',stopReason:'error'}});watch.event('conv-a',{type:'agent_settled'});await watch.flush();}
  expect(notices.filter(n=>n.rule==='error')).toHaveLength(1);
  expect(watch.stats.noticesSuppressed).toBeGreaterThanOrEqual(2);
  expect(watch.stats.wechatUndelivered).toBe(1);
  await c.advance(11*60000,watch);
  watch.event('conv-a',{type:'agent_start'});watch.event('conv-a',{type:'message_end',message:{role:'assistant',stopReason:'error'}});await watch.flush();
  expect(notices.filter(n=>n.rule==='error')).toHaveLength(2);
  await watch.close();
 });
 it('falls back to defaults and opens a config item for an invalid rules.json',async()=>{
  const {watch}=await watchOf({},{version:1,rules:[{id:'bad',on:['nope']}]});
  expect(watch.configProblem).toBeTruthy();
  expect(watch.panel().items.some(i=>i.kind==='config_invalid')).toBe(true);
  expect(watch.rules.rules.length).toBe(DEFAULT_WATCH_CONFIG.rules.length);
  await watch.close();
 });
 it('produces a bounded digest from a cursor, persists the panel and supports ack/snooze',async()=>{
  const {watch,c,root}=await watchOf();
  for(let i=0;i<40;i++){watch.event('conv-'+i,{type:'agent_start'});watch.event('conv-'+i,{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'boom '+'x'.repeat(400)}});}
  await watch.flush();
  const digest=await watch.digest(0);
  expect(digest.text.length).toBeLessThanOrEqual(1500);expect(digest.text.split('\n').length).toBeLessThanOrEqual(20);
  expect(digest.text).toContain('已省略');expect(digest.head).toBe(watch.journal.head);
  const later=await watch.digest(digest.head);expect(later.events).toBe(0);
  expect(watch.renderPanel().length).toBeLessThanOrEqual(1200);
  const key=watch.panel().items[0].key;
  expect(watch.snooze(key,30)).toBe(true);expect(watch.panel().items.some(i=>i.key===key)).toBe(false);
  await c.advance(31*60000,watch);expect(watch.panel().items.some(i=>i.key===key)).toBe(true);
  expect(watch.ack(key)).toBe(true);await watch.flush();
  const saved=JSON.parse(await readFile(join(root,'panel.json'),'utf8'));expect(saved.items.some((i:any)=>i.key===key)).toBe(false);
  expect(saved.items.length).toBeLessThanOrEqual(50);
  await watch.close();
 });
 it('raises and clears backlog on queue depth crossings',async()=>{
  const {watch}=await watchOf();
  watch.session('conv-a',{queued:2,running:true});await watch.flush();expect(watch.panel().items.some(i=>i.kind==='backlog')).toBe(false);
  watch.session('conv-a',{queued:3,running:true});await watch.flush();expect(watch.panel().items.some(i=>i.kind==='backlog')).toBe(true);
  watch.session('conv-a',{queued:0,running:false});await watch.flush();expect(watch.panel().items.some(i=>i.kind==='backlog')).toBe(false);
  await watch.close();
 });
});

describe('quick replies',()=>{
 const rows:QuickRow[]=[
  {id:'a',title:'修复登录',engine:'codex',state:'running',queued:2,approvals:0,contactable:true,link:'/conversations/a',lastActivityAt:0},
  {id:'b',title:'写周报',engine:'pi',state:'waiting',queued:0,approvals:1,contactable:false,link:'/conversations/b',lastActivityAt:0},
  {id:'c',title:'空闲任务',engine:'claude',state:'idle',queued:0,approvals:0,contactable:true,link:'/conversations/c',lastActivityAt:0},
 ];
 const snap={rows,panel:[{text:'写周报 等你确认',link:'/conversations/b',priority:1}],now:60000};
 it('classifies only exact short keywords',()=>{
  expect(classifyQuick('进度')).toEqual({intent:'overview'});
  expect(classifyQuick('  请看下进度吧？ ')).toEqual({intent:'overview'});
  expect(classifyQuick('哪些在跑')).toEqual({intent:'running'});
  expect(classifyQuick('等我处理')).toEqual({intent:'todo'});
  expect(classifyQuick('看看2')).toEqual({intent:'detail',n:2});
  expect(classifyQuick('停 1')).toEqual({intent:'stop',n:1});
  expect(classifyQuick('取消')).toEqual({intent:'cancel'});
  expect(classifyQuick('确认 ab2c')).toEqual({intent:'confirm',code:'AB2C'});
  expect(classifyQuick('进度怎么这么慢，帮我分析原因')).toBe('too-long');
  expect(classifyQuick('进度条')).toBeUndefined();
  expect(classifyQuick('停止所有并删除')).toBeUndefined();
  expect(classifyQuick('/mishu')).toBeUndefined();
 });
 it('escalates anything that is not an exact match or when disabled',()=>{
  expect(quickReply('帮我把登录修了',snap,{maxLength:12,enabled:true})).toEqual({kind:'escalate',reason:'no-match'});
  expect(quickReply('进度',snap,{maxLength:12,enabled:false})).toEqual({kind:'escalate',reason:'disabled'});
 });
 it('lists, numbers and requires a 2-step confirmation for stop/cancel',()=>{
  const overview=quickReply('进度',snap,{maxLength:12,enabled:true});
  expect(overview.kind).toBe('reply');if(overview.kind!=='reply')return;
  expect(overview.list).toEqual(['a','b','c']);expect(overview.text).toContain('1. 修复登录');
  const lastList={ids:overview.list!,at:60000};
  expect(quickReply('停',snap,{maxLength:12,enabled:true,lastList})).toMatchObject({kind:'reply',text:expect.stringContaining('未执行')});
  expect(quickReply('停 1',snap,{maxLength:12,enabled:true,lastList})).toEqual({kind:'confirm',text:'',action:{op:'stop',conv:'a',title:'修复登录'}});
  expect(quickReply('停 2',snap,{maxLength:12,enabled:true,lastList})).toMatchObject({kind:'reply',text:expect.stringContaining('不在秘书联系对象内')});
  expect(quickReply('停 3',snap,{maxLength:12,enabled:true,lastList})).toMatchObject({kind:'reply',text:expect.stringContaining('没有需要停止')});
  expect(quickReply('取消 1',snap,{maxLength:12,enabled:true,lastList})).toMatchObject({kind:'confirm',action:{op:'cancel',conv:'a'}});
  expect(quickReply('停 9',snap,{maxLength:12,enabled:true,lastList})).toMatchObject({kind:'reply',text:expect.stringContaining('没有编号 9')});
  expect(quickReply('停 1',{...snap,now:60000+11*60000},{maxLength:12,enabled:true,lastList})).toMatchObject({kind:'reply',text:expect.stringContaining('已过期')});
  expect(quickReply('看看 2',snap,{maxLength:12,enabled:true,lastList})).toEqual({kind:'detail',conv:'b',title:'写周报',state:'waiting'});
  expect(quickReply('等我处理',snap,{maxLength:12,enabled:true})).toMatchObject({kind:'reply',text:expect.stringContaining('写周报')});
  expect(quickReply('确认 ABCD',snap,{maxLength:12,enabled:true})).toEqual({kind:'execute',code:'ABCD'});
 });
 it('confirmation codes are one-time, channel-bound, expiring and lock out after failures',()=>{
  let now=0;const codes=new QuickConfirmations(120000,()=>now);
  const action={op:'stop' as const,conv:'a',title:'修复登录'};
  const code=codes.issue('web:sec',action);expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  expect(codes.consume('web:other',code)).toBeUndefined();
  expect(codes.consume('web:sec',code.toLowerCase())).toEqual(action);
  expect(codes.consume('web:sec',code)).toBeUndefined();
  const expiring=codes.issue('web:sec',action);now+=121000;expect(codes.consume('web:sec',expiring)).toBeUndefined();
  const locked=codes.issue('web:sec',action);
  for(let i=0;i<5;i++)codes.consume('web:sec','ZZZZ'===locked?'YYYY':'ZZZZ');
  expect(codes.consume('web:sec',locked)).toBeUndefined();
 });
});

describe('host authorization grants',()=>{
 it('issues HMAC-bound grants, verifies quotes and blocks replay across runs',async()=>{
  const root=await temp();let now=0;const keyFile=join(root,'grant.key');
  const grants=new GrantRegistry(keyFile,()=>now);
  const grant=await grants.issue('sec','req-1','请帮我  让 codex 跑一下全部测试，然后告诉我结果');
  expect(grant.grantId).toMatch(/^grant-[0-9a-f]{32}$/);
  expect((await stat(keyFile)).mode&0o777).toBe(0o600);
  expect(grants.use('sec','req-1','让 codex 跑一下全部测试','dispatch:1')).toMatchObject({grantId:grant.grantId,quote:'让 codex 跑一下全部测试'});
  // Whitespace/width differences are normalized; paraphrases are not.
  expect(()=>grants.use('sec','req-1','让codex跑全部测试','dispatch:2')).toThrow(GrantError);
  expect(()=>grants.use('sec','req-1','','dispatch:2')).toThrow(GrantError);
  expect(()=>grants.use('sec','req-1','x'.repeat(201),'dispatch:2')).toThrow(GrantError);
  // Same action key is idempotent; the cap counts distinct actions.
  grants.use('sec','req-1','跑一下全部测试','dispatch:1');
  grants.use('sec','req-1','跑一下全部测试','dispatch:2');grants.use('sec','req-1','跑一下全部测试','dispatch:3');
  expect(()=>grants.use('sec','req-1','跑一下全部测试','dispatch:4')).toThrow(/次数已用完/);
  // Other chats, other/no runs and ended runs have no authority.
  expect(()=>grants.use('other','req-1','跑一下全部测试','x')).toThrow(GrantError);
  expect(()=>grants.use('sec','req-2','跑一下全部测试','x')).toThrow(GrantError);
  expect(()=>grants.use('sec',undefined,'跑一下全部测试','x')).toThrow(GrantError);
  grants.expire('sec','req-1');expect(()=>grants.use('sec','req-1','跑一下全部测试','dispatch:1')).toThrow(GrantError);
  // Steer extends the current request; TTL bounds stale runs.
  await grants.issue('sec','req-3','先看看日志');grants.steer('sec','req-3','然后重启服务');
  expect(grants.use('sec','req-3','然后重启服务','send:1').quote).toBe('然后重启服务');
  now+=7*3600*1000;expect(()=>grants.use('sec','req-3','然后重启服务','send:2')).toThrow(GrantError);
  // The key survives restarts: the same input yields the same grant id.
  const again=new GrantRegistry(keyFile,()=>now);expect((await again.issue('sec','req-1','请帮我  让 codex 跑一下全部测试，然后告诉我结果')).grantId).toBe(grant.grantId);
  grants.revokeChat('sec');expect(grants.current('sec','req-3')).toBeUndefined();
 });
 it('legacy mode still requires a current grant',async()=>{
  const grants=new GrantRegistry(join(await temp(),'k'));
  expect(()=>grants.use('sec','r',undefined,'k')).toThrow(GrantError);
  await grants.issue('sec','r','do it');expect(grants.use('sec','r',undefined,'k').quote).toBeUndefined();
 });
});

describe('receipt rotation',()=>{
 const limits={live:5,keep:2,assignmentsLive:4,assignmentsKeep:2,indexEntries:6,indexMs:1000*3600};
 const receipt=(i:number,state='settled')=>({messageId:'m'+i,targetId:'t',fingerprint:'f'+i,requestId:'r'+i,state,kind:'information-only',createdAt:new Date(i*1000).toISOString()});
 it('selects only old terminal unprotected receipts',()=>{
  const messages=[receipt(1),receipt(2,'delivering'),receipt(3),receipt(4),receipt(5)];
  expect(receiptsToRotate(messages.slice(0,4),new Set(),limits)).toEqual([]);
  expect(receiptsToRotate(messages,new Set(['r3']),limits).map(m=>m.messageId)).toEqual(['m1','m4','m5']);
  const assignments=[{id:'a1',taskId:'t1',requestId:'r1',state:'settled'},{id:'a2',taskId:'t1',requestId:'r2',state:'settled'},{id:'a3',taskId:'t2',requestId:'r3',state:'settled'},{id:'a4',taskId:'t3',requestId:'r4',state:'accepted'}];
  expect(assignmentsToRotate(assignments,new Set(),limits).map(a=>a.id)).toEqual(['a1']);
 });
 it('archives idempotently, survives restart and compacts the index',async()=>{
  const root=await temp();let now=0;
  const archive=new ReceiptArchive(root,()=>now,limits);
  await archive.archive('sec',[receipt(1),receipt(2)]);
  await archive.archive('sec',[receipt(2),receipt(3)]);
  expect(await archive.size('sec')).toBe(3);
  const text=await readFile(join(root,'receipts-sec.jsonl'),'utf8');expect(text.trim().split('\n')).toHaveLength(3);
  await appendFile(join(root,'receipts-sec.jsonl'),'{"messageId":"torn');
  const reopened=new ReceiptArchive(root,()=>now,limits);expect((await reopened.lookup('sec','m2'))?.fingerprint).toBe('f2');
  expect(await reopened.lookup('sec','m9')).toBeUndefined();
  for(let i=4;i<10;i++)await reopened.archive('sec',[receipt(i)]);
  expect(await reopened.size('sec')).toBe(6);expect(await reopened.lookup('sec','m1')).toBeUndefined();
  now+=2*3600*1000;await reopened.archive('sec',[receipt(20)]);expect(await reopened.size('sec')).toBe(1);
 });
});

describe('queue move',()=>{
 it('moves a pending row to the front or back but never moves internal rows',async()=>{
  const queue=new InputQueue({busy:()=>true,validate:async()=>{},deliver:async()=>{},changed:()=>{}});
  for(const t of ['u1','u2','u3'])await queue.add(t);
  const row=(t:string)=>queue.items.find(i=>i.text===t)!;
  await queue.change({id:row('u3').id,revision:row('u3').revision,action:'move',to:'front'});
  expect(queue.items.map(i=>i.text)).toEqual(['u3','u1','u2']);
  await queue.change({id:row('u3').id,revision:row('u3').revision,action:'move',to:'back'});
  expect(queue.items.map(i=>i.text)).toEqual(['u1','u2','u3']);
  await expect(queue.change({id:row('u1').id,revision:row('u1').revision+5,action:'move',to:'back'})).rejects.toThrow();
 });
});
