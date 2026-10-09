import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {WatchJournal,type JournalLimits,type WatchEvent} from './mishu-journal.js';
import {activeRules,DEFAULT_WATCH_CONFIG,inQuietHours,parseWatchConfig,renderTemplate,templateValue,type ConvState,type NoticeChannel,type PanelKind,type Rule,type WatchConfig,type WatchKind} from './mishu-rules.js';

/** Metadata the Host already has; never conversation content. */
export interface CatalogRow {id:string;title:string;engine:string;project:string;lastActivityAt?:number;running:boolean;queued:number;attention?:'waiting'|'finished'}
export interface ConvWatch {
 id:string;title:string;engine:string;project:string;state:ConvState;freshness:'live'|'stale';
 runStartedAt?:number;lastProgressAt?:number;lastCompletedAt?:number;lastActivityAt?:number;
 approvals:{requestId:string;method:string;title:string}[];queued:number;lastError?:string;
}
export interface PanelItem {key:string;kind:PanelKind;conv:string;title:string;text:string;link:string;priority:number;openedAt:number;ref?:string;escalate?:'report';snoozeUntil?:number;expiresAt?:number}
export interface Notice {id:string;at:string;conv:string;rule:string;text:string;link:string;channels:NoticeChannel[]}
export interface WatchStats {since:number;tier1Replies:number;tier1Notices:number;noticesSuppressed:number;wechatUndelivered:number;escalations:number;tier2Runs:number}
export interface WatchTimers {set(fn:()=>void,ms:number):unknown;clear(handle:unknown):void}
export interface WatchOptions {
 root:string;
 now?:()=>number;
 timers?:WatchTimers;
 journal?:Partial<JournalLimits>;
 /** Awaited once before the first event is applied (e.g. coordinator state load). */
 beforeStart?:()=>Promise<void>;
 /** Secretary Chats and other conversations that must never be watched. */
 isExcluded?:(id:string)=>boolean;
 /** True when any secretary configured this conversation as a contact (scope.watch="selected"). */
 isTarget?:(id:string)=>boolean;
 catalog?:()=>Promise<CatalogRow[]>;
 onPanel?:(panel:{items:PanelItem[];counts:Record<string,number>})=>void;
 onNotice?:(notice:Notice)=>void;
}
export const PANEL_LIMIT=50;
const DIALOGS=['select','confirm','input','editor'];
const NOT_PROGRESS=new Set(['sync_metadata','sync_pending','extension_ui_request','native_request','extension_ui_response','queue_state']);
const STATE_ORDER:Record<ConvState,number>={waiting:0,errored:1,stuck:2,running:3,unknown:4,idle:5};
type Raw=Record<string,any>;
const isRaw=(v:unknown):v is Raw=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
export const conversationLink=(id:string)=>`/conversations/${encodeURIComponent(id)}`;

/**
 * Tier-1 watchdog: deterministic, event-driven state of every conversation of
 * one user slot. It never starts a runtime, reads content or calls a model.
 * The only timer is one unref'd deadline (stuck detection and notice batches).
 */
export class MishuWatch {
 readonly journal:WatchJournal;
 private config:WatchConfig=DEFAULT_WATCH_CONFIG;
 private configError?:string;
 private convs=new Map<string,ConvWatch&{stuckLevel:number;runError?:boolean}>();
 private items=new Map<string,PanelItem>();
 private cooldowns=new Map<string,number>();
 private batches=new Map<string,{rule:Rule;texts:string[];conv:string;link:string;flushAt:number}>();
 private budget={start:0,web:0,wechat:0};
 private tail:Promise<unknown>=Promise.resolve();
 private ready?:Promise<void>;
 private timer?:unknown;
 private timerAt=Infinity;
 private closed=false;
 private catalogAt=0;
 private panelDirty=false;
 private noticeSeq=0;
 readonly stats:WatchStats;
 private now:()=>number;
 private timers:WatchTimers;
 constructor(private options:WatchOptions){
  this.now=options.now??Date.now;
  this.timers=options.timers??{set:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref();return t;},clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
  this.journal=new WatchJournal(join(options.root,'journal'),options.journal,this.now);
  this.stats={since:this.now(),tier1Replies:0,tier1Notices:0,noticesSuppressed:0,wechatUndelivered:0,escalations:0,tier2Runs:0};
 }
 get rules(){return this.config;}
 get configProblem(){return this.configError;}
 start(){return this.ready??=(async()=>{
  await this.options.beforeStart?.().catch(()=>undefined);
  await mkdir(this.options.root,{recursive:true,mode:0o700});
  await this.reloadConfig();
  await this.journal.load();
  try{
   const saved=JSON.parse(await readFile(join(this.options.root,'panel.json'),'utf8')) as {version:number;items:PanelItem[]};
   if(saved.version===1&&Array.isArray(saved.items))for(const item of saved.items.slice(0,PANEL_LIMIT))if(typeof item?.key==='string')this.items.set(item.key,item);
  }catch{/* No saved panel: rebuilt from live state below. */}
  await this.refreshCatalog(true);
  for(const c of this.convs.values())if(c.state==='running'){c.lastProgressAt??=this.now();}
  this.schedule();
 })();}
 /** Re-read rules.json. Invalid user rules fall back to defaults and open a config_invalid panel item. */
 async reloadConfig(){
  let raw:string|undefined;
  try{raw=await readFile(join(this.options.root,'..','rules.json'),'utf8');}catch{raw=undefined;}
  this.configError=undefined;this.config=DEFAULT_WATCH_CONFIG;
  if(raw!==undefined){
   try{this.config=parseWatchConfig(JSON.parse(raw));}
   catch(error){this.configError=templateValue(error instanceof Error?error.message:'invalid rules.json',200);}
  }
  const key='config_invalid::';
  if(this.configError)this.open({key,kind:'config_invalid',conv:'',title:'rules.json',text:'规则文件无效，已使用默认规则：'+this.configError,link:'',priority:2,openedAt:this.now()});
  else this.closeItem(key);
 }
 private watched(id:string){
  if(this.options.isExcluded?.(id))return false;
  if(this.config.scope.exclude.includes(id))return false;
  if(this.config.scope.watch==='selected'&&!this.options.isTarget?.(id))return false;
  return true;
 }
 private conv(id:string){
  let c=this.convs.get(id);
  if(!c){c={id,title:id,engine:'unknown',project:'',state:'idle',freshness:'live',approvals:[],queued:0,stuckLevel:0};this.convs.set(id,c);}
  return c;
 }
 async refreshCatalog(force=false){
  if(!this.options.catalog||(!force&&this.now()-this.catalogAt<5000))return;
  this.catalogAt=this.now();
  let rows:CatalogRow[];try{rows=await this.options.catalog();}catch{return;}
  const seen=new Set<string>();
  for(const row of rows){
   seen.add(row.id);
   const known=this.convs.has(row.id),c=this.conv(row.id);
   c.title=row.title||row.id;c.engine=row.engine;c.project=row.project;c.lastActivityAt=row.lastActivityAt??c.lastActivityAt;c.queued=row.queued;
   if(!known){
    c.freshness=row.running||row.attention?'live':'stale';
    c.state=row.attention==='waiting'?'waiting':row.running?'running':'idle';
    if(c.state==='running')c.lastProgressAt=this.now();
   }
  }
  for(const id of [...this.convs.keys()])if(!seen.has(id)&&this.convs.get(id)!.state==='idle')this.convs.delete(id);
 }
 /** Raw native/Host event for one conversation. Never throws into the caller. */
 event(id:string,raw:unknown){
  if(this.closed||!isRaw(raw)||typeof raw.type!=='string')return;
  const work=this.tail.then(async()=>{await this.start();if(this.watched(id))await this.apply(id,raw);});
  this.tail=work.catch(()=>undefined);
 }
 /** Live session decoration changed (queue depth / attention). */
 session(id:string,info:{queued:number;running:boolean;attention?:'waiting'|'finished'}){
  if(this.closed)return;
  const work=this.tail.then(async()=>{
   await this.start();if(!this.watched(id))return;
   const c=this.conv(id),before=c.queued;c.queued=info.queued;c.freshness='live';
   const thresholds=activeRules(this.config).filter(r=>r.on.includes('queue.depth')).map(r=>r.when?.queuedAtLeast??1);
   const min=thresholds.length?Math.min(...thresholds):Infinity;
   if((before>=min)!==(info.queued>=min)){
    if(info.queued<min)this.closeWhere(item=>item.kind==='backlog'&&item.conv===id);
    await this.emit(c,'queue.depth',{queued:info.queued});
   }
  });
  this.tail=work.catch(()=>undefined);
 }
 /** Facts produced by the MISHU task audit (already bounded). */
 taskFact(conv:string,kind:'task.truncated'|'task.settled'|'tracking.error',data:{taskId:string;purpose:string;error?:string}){
  if(this.closed)return;
  const work=this.tail.then(async()=>{await this.start();const c=this.conv(conv);await this.emit(c,kind,{taskId:data.taskId,purpose:templateValue(data.purpose,80),...(data.error?{error:templateValue(data.error,200)}:{})},data.taskId);});
  this.tail=work.catch(()=>undefined);
 }
 private async apply(id:string,e:Raw){
  const c=this.conv(id),type=e.type as string,now=this.now();
  c.freshness='live';
  if(!NOT_PROGRESS.has(type)){c.lastProgressAt=now;c.lastActivityAt=now;if(c.state==='stuck'){c.state='running';this.closeWhere(i=>i.kind==='stuck'&&i.conv===id);}}
  if(type==='agent_start'||type==='run_started'){
   if(c.state==='running'||c.state==='stuck')return this.schedule();
   if(!c.title||c.title===id)await this.refreshCatalog(true);
   c.state='running';c.runStartedAt=now;c.stuckLevel=0;c.runError=false;c.lastError=undefined;
   this.closeWhere(i=>i.conv===id&&['error','stuck','completed','approval'].includes(i.kind));
   await this.emit(c,'run.started',{});
  }else if(type==='message_end'&&isRaw(e.message)&&e.message.role==='assistant'&&['error','aborted'].includes(String(e.message.stopReason))){
   if(c.runError)return;
   c.runError=true;c.lastError=templateValue(e.message.errorMessage??(e.message.stopReason==='aborted'?'已中止':'模型或工具错误'),300);c.state='errored';
   await this.emit(c,'run.errored',{error:c.lastError});
  }else if(type==='agent_settled'||type==='run_completed'){
   const active=['running','stuck','waiting'].includes(c.state)||c.runError;
   const status=String(e.status??'');
   await this.closeApprovals(c);
   if(type==='run_completed'&&status==='interrupted'){c.state='errored';c.lastError='运行中断';await this.emit(c,'run.interrupted',{});}
   else if(type==='run_completed'&&status==='failed'&&!c.runError){c.state='errored';c.lastError=templateValue(e.error??'运行失败',300);c.runError=true;await this.emit(c,'run.errored',{error:c.lastError});}
   else if(active&&!c.runError){c.state='idle';c.lastCompletedAt=now;this.closeWhere(i=>i.kind==='stuck'&&i.conv===id);await this.emit(c,'run.completed',{});}
   else if(!c.runError&&c.state!=='errored')c.state='idle';
  }else if(type==='agent_interrupted'||type==='run_interrupted'){
   await this.closeApprovals(c);
   c.state='errored';c.lastError='运行中断';await this.emit(c,'run.interrupted',{});
  }else if((type==='extension_ui_request'||type==='native_request')&&typeof e.id==='string'&&DIALOGS.includes(String(e.method))){
   if(c.approvals.some(a=>a.requestId===e.id))return;
   const approval={requestId:String(e.id).slice(0,200),method:String(e.method),title:templateValue(e.title??e.message??'需要确认',120)};
   c.approvals=[...c.approvals,approval].slice(-5);c.state='waiting';
   await this.emit(c,'approval.opened',{requestId:approval.requestId,method:approval.method,approvalTitle:approval.title},approval.requestId);
  }else if(type==='sync_pending'&&Array.isArray(e.requests)){
   const remaining=new Set(e.requests.map((r:Raw)=>String(r?.id)));
   for(const approval of c.approvals.filter(a=>!remaining.has(a.requestId))){
    c.approvals=c.approvals.filter(a=>a!==approval);this.closeItem(`approval:${id}:${approval.requestId}`);
    await this.emit(c,'approval.closed',{requestId:approval.requestId},approval.requestId);
   }
   if(!c.approvals.length&&c.state==='waiting')c.state='running';
  }
  this.schedule();
 }
 private async closeApprovals(c:ConvWatch){
  for(const approval of c.approvals){this.closeItem(`approval:${c.id}:${approval.requestId}`);await this.emit(c,'approval.closed',{requestId:approval.requestId},approval.requestId);}
  c.approvals=[];
 }
 private async emit(c:ConvWatch,kind:WatchKind,data:WatchEvent['data'],ref?:string){
  await this.journal.append({conv:c.id,kind,data});
  for(const rule of activeRules(this.config)){
   if(!rule.on.includes(kind)||!this.matches(rule,c,kind,data))continue;
   const fields={title:c.title,approvalTitle:data.approvalTitle,error:data.error??c.lastError,minutes:data.minutes,link:conversationLink(c.id),count:1,state:c.state};
   if(rule.panel){
    const key=`${rule.panel.kind}:${c.id}:${ref??''}`;
    const text=rule.notify?renderTemplate(rule.notify.template,{...fields,link:''}):this.describe(kind,c,data);
    this.open({key,kind:rule.panel.kind,conv:c.id,title:templateValue(c.title,60),text,link:conversationLink(c.id),priority:rule.panel.priority,openedAt:this.now(),...(ref?{ref}:{}),...(rule.escalate?{escalate:rule.escalate.mode}:{}),...(rule.panel.autoExpireMin?{expiresAt:this.now()+rule.panel.autoExpireMin*60000}:{})});
   }
   if(rule.notify)this.notify(rule,c,kind,fields,ref);
  }
 }
 private describe(kind:WatchKind,c:ConvWatch,data:WatchEvent['data']):string{
  const title=templateValue(c.title,60);
  switch(kind){
   case 'task.truncated':return `${title}：任务「${data.purpose}」的回信已截断，请打开原生对话核对`;
   case 'task.settled':return `${title}：派工「${data.purpose}」已结束，等待你验收（可用 /mishu-report 整理）`;
   case 'tracking.error':return `${title}：跟进异常 ${data.error??''}`;
   case 'queue.depth':return `${title}：队列积压 ${data.queued} 条`;
   case 'run.errored':return `${title} 出错：${data.error??''}`;
   case 'approval.opened':return `${title} 等你确认：${data.approvalTitle??''}`;
   default:return `${title}：${kind}`;
  }
 }
 private matches(rule:Rule,c:ConvWatch,kind:WatchKind,data:WatchEvent['data']){
  const w=rule.when;if(!w)return true;
  if(w.state&&!w.state.includes(c.state))return false;
  if(w.engine&&!w.engine.includes(c.engine))return false;
  if(w.conv&&!w.conv.includes(c.id))return false;
  if(w.queuedAtLeast!==undefined&&c.queued<w.queuedAtLeast)return false;
  if(kind==='run.stuck'&&w.noProgressMin!==undefined&&data.minutes!==w.noProgressMin)return false;
  return true;
 }
 private notify(rule:Rule,c:ConvWatch,kind:WatchKind,fields:Record<string,unknown>,ref?:string){
  const n=rule.notify!;
  if(inQuietHours(this.config,new Date(this.now()))&&!this.config.quietHours!.allow.includes(kind)){this.stats.noticesSuppressed++;return;}
  const key=`${rule.id}:${c.id}:${ref??''}`,last=this.cooldowns.get(key);
  if(n.cooldownMin&&last!==undefined&&this.now()-last<n.cooldownMin*60000){this.stats.noticesSuppressed++;return;}
  this.cooldowns.set(key,this.now());
  if(this.cooldowns.size>2000)this.cooldowns.delete(this.cooldowns.keys().next().value!);
  const text=renderTemplate(n.template,fields);
  if(n.batchSec){
   const batch=this.batches.get(rule.id);
   if(batch){batch.texts.push(text);return;}
   this.batches.set(rule.id,{rule,texts:[text],conv:c.id,link:conversationLink(c.id),flushAt:this.now()+n.batchSec*1000});
   this.schedule();return;
  }
  this.deliver(rule,c.id,text,conversationLink(c.id));
 }
 private deliver(rule:Rule,conv:string,text:string,link:string){
  const now=this.now();
  if(now-this.budget.start>=3600000)this.budget={start:now,web:0,wechat:0};
  const channels=rule.notify!.channels.filter(channel=>{
   const limit=channel==='web'?this.config.limits.webPerHour:this.config.limits.wechatPerHour;
   if(this.budget[channel]>=limit){this.stats.noticesSuppressed++;return false;}
   this.budget[channel]++;return true;
  });
  if(!channels.length)return;
  // WeChat has no Host transport yet; count it so the gap is visible in status.
  if(channels.includes('wechat'))this.stats.wechatUndelivered++;
  if(!channels.includes('web'))return;
  this.stats.tier1Notices++;
  const notice:Notice={id:`notice-${now}-${++this.noticeSeq}`,at:new Date(now).toISOString(),conv,rule:rule.id,text,link,channels};
  try{this.options.onNotice?.(notice);}catch{/* Delivery adapters never break the watchdog. */}
 }
 private open(item:PanelItem){
  const prior=this.items.get(item.key);
  this.items.set(item.key,prior?{...item,openedAt:prior.openedAt}:item);
  if(this.items.size>PANEL_LIMIT){
   const victim=[...this.items.values()].sort((a,b)=>b.priority-a.priority||a.openedAt-b.openedAt)[0];
   this.items.delete(victim.key);
  }
  this.panelChanged();
 }
 private closeItem(key:string){if(this.items.delete(key))this.panelChanged();}
 private closeWhere(test:(item:PanelItem)=>boolean){let removed=false;for(const item of [...this.items.values()])if(test(item)){this.items.delete(item.key);removed=true;}if(removed)this.panelChanged();}
 private panelChanged(){
  if(this.panelDirty)return;this.panelDirty=true;
  queueMicrotask(()=>{
   this.panelDirty=false;
   const work=this.tail.then(async()=>{
    const file=join(this.options.root,'panel.json'),temp=file+'.tmp';
    await mkdir(this.options.root,{recursive:true,mode:0o700});
    await writeFile(temp,JSON.stringify({version:1,items:[...this.items.values()]}),{mode:0o600});await rename(temp,file);
   });
   this.tail=work.catch(()=>undefined);
   try{this.options.onPanel?.(this.panel());}catch{/* Adapter failure is not watch failure. */}
  });
 }
 /** Open, non-snoozed, non-expired items, most urgent first. */
 panel(){
  const now=this.now();
  const items=[...this.items.values()].filter(i=>(i.snoozeUntil??0)<=now&&(i.expiresAt??Infinity)>now).sort((a,b)=>a.priority-b.priority||b.openedAt-a.openedAt);
  const counts:Record<string,number>={};for(const item of items)counts[item.kind]=(counts[item.kind]??0)+1;
  return {items,counts};
 }
 ack(key:string){const ok=this.items.has(key);this.closeItem(key);return ok;}
 snooze(key:string,minutes:number){const item=this.items.get(key);if(!item)return false;item.snoozeUntil=this.now()+Math.max(1,Math.min(1440,Math.floor(minutes)))*60000;this.panelChanged();return true;}
 /** Current state of watched conversations; refreshes titles at most every 5s. */
 async snapshot():Promise<ConvWatch[]>{
  await this.start();await this.tail;await this.refreshCatalog();
  return [...this.convs.values()].filter(c=>this.watched(c.id)).map(({stuckLevel:_s,runError:_r,...c})=>({...c,approvals:[...c.approvals]})).sort((a,b)=>STATE_ORDER[a.state]-STATE_ORDER[b.state]||(b.lastActivityAt??0)-(a.lastActivityAt??0));
 }
 private stuckThresholds(){
  return [...new Set(activeRules(this.config).filter(r=>r.on.includes('run.stuck')).map(r=>r.when!.noProgressMin!))].sort((a,b)=>a-b);
 }
 private schedule(){
  if(this.closed)return;
  const thresholds=this.stuckThresholds();let at=Infinity;
  for(const c of this.convs.values())if((c.state==='running'||c.state==='stuck')&&c.lastProgressAt!==undefined&&c.stuckLevel<thresholds.length)at=Math.min(at,c.lastProgressAt+thresholds[c.stuckLevel]*60000);
  for(const batch of this.batches.values())at=Math.min(at,batch.flushAt);
  if(at===this.timerAt)return;
  if(this.timer!==undefined)this.timers.clear(this.timer);
  this.timer=undefined;this.timerAt=at;
  if(at===Infinity)return;
  this.timer=this.timers.set(()=>{this.timer=undefined;this.timerAt=Infinity;void this.tick();},Math.max(1,at-this.now()));
 }
 /** Number of armed timers (0 or 1). Exposed for tests. */
 get armedTimers(){return this.timer===undefined?0:1;}
 /** Deadline work: stuck crossings and notice batches. Safe to call any time. */
 tick(){
  const work=this.tail.then(async()=>{
   const now=this.now(),thresholds=this.stuckThresholds();
   for(const c of this.convs.values()){
    while((c.state==='running'||c.state==='stuck')&&c.lastProgressAt!==undefined&&c.stuckLevel<thresholds.length&&now-c.lastProgressAt>=thresholds[c.stuckLevel]*60000){
     const minutes=thresholds[c.stuckLevel++];c.state='stuck';
     await this.emit(c,'run.stuck',{minutes});
    }
   }
   for(const [id,batch] of [...this.batches]){
    if(batch.flushAt>now)continue;this.batches.delete(id);
    const text=batch.texts.length===1?batch.texts[0]:templateValue(`${batch.texts.length} 条更新：`+batch.texts.slice(0,5).join('；')+(batch.texts.length>5?`；另有 ${batch.texts.length-5} 条`:''),300);
    this.deliver(batch.rule,batch.texts.length===1?batch.conv:'',text,batch.texts.length===1?batch.link:'');
   }
   this.schedule();
  });
  this.tail=work.catch(()=>undefined);
  return work;
 }
 /** Bounded text digest of events after a cursor plus current counts. */
 async digest(after:number,limits={chars:1500,lines:20}){
  await this.start();await this.tail;
  const pages:WatchEvent[]=[];let cursor=after,gap=false;
  for(let i=0;i<5;i++){const page=await this.journal.read(cursor,100);gap||=page.gap;pages.push(...page.events);if(page.events.length<100)break;cursor=page.next;}
  const head=this.journal.head;
  const snapshot=[...this.convs.values()].filter(c=>this.watched(c.id));
  const count=(s:ConvState)=>snapshot.filter(c=>c.state===s).length;
  const lines=[`运行中 ${count('running')} · 等你 ${count('waiting')} · 出错 ${count('errored')} · 卡住 ${count('stuck')}`];
  if(gap)lines.push('（事件日志已轮转，部分早期事件不可见）');
  const byConv=new Map<string,Map<string,number>>(),errors=new Map<string,string>();
  for(const event of pages){
   if(['approval.closed','queue.depth'].includes(event.kind))continue;
   const m=byConv.get(event.conv)??new Map<string,number>();m.set(event.kind,(m.get(event.kind)??0)+1);byConv.set(event.conv,m);
   if(event.kind==='run.errored'&&typeof event.data.error==='string')errors.set(event.conv,event.data.error);
  }
  const label:Record<string,string>={'run.started':'开始','run.completed':'完成','run.errored':'出错','run.interrupted':'中断','run.stuck':'卡住','approval.opened':'待确认','task.truncated':'回信截断','task.settled':'派工结束待验收','tracking.error':'跟进异常'};
  let omitted=0;
  for(const [conv,kinds] of byConv){
   const c=this.convs.get(conv);
   const parts=[...kinds].map(([k,n])=>`${label[k]??k}${n>1?'×'+n:''}`).join('，');
   const line=`• ${templateValue(c?.title??conv,40)}（${c?.engine??'?'}）：${parts}${errors.has(conv)?`（${templateValue(errors.get(conv),60)}）`:''}`;
   if(lines.length>=limits.lines-1||lines.join('\n').length+line.length>limits.chars-40){omitted++;continue;}
   lines.push(line);
  }
  if(omitted)lines.push(`另有 ${omitted} 个对话的事件已省略，可用 mishu events 查看`);
  return {text:lines.join('\n').slice(0,limits.chars),head,gap,events:pages.length};
 }
 renderPanel(limits={chars:1200,lines:15}){
  const {items}=this.panel();if(!items.length)return '暂无待办';
  const lines:string[]=[];
  for(const item of items){const line=`[${item.priority}] ${item.text}`;if(lines.length>=limits.lines-1||lines.join('\n').length+line.length>limits.chars-30){lines.push(`另有 ${items.length-lines.length} 项，用 /mishu-todo 查看`);break;}lines.push(line);}
  return lines.join('\n').slice(0,limits.chars);
 }
 noteQuickReply(){this.rollStats();this.stats.tier1Replies++;}
 noteEscalation(){this.rollStats();this.stats.escalations++;}
 noteTier2Run(){this.rollStats();this.stats.tier2Runs++;}
 private rollStats(){if(this.now()-this.stats.since>=3600000)Object.assign(this.stats,{since:this.now(),tier1Replies:0,tier1Notices:0,noticesSuppressed:0,wechatUndelivered:0,escalations:0,tier2Runs:0});}
 async flush(){await this.start();await this.tail;await this.journal.flush();await this.tail;}
 async close(){this.closed=true;if(this.timer!==undefined)this.timers.clear(this.timer);this.timer=undefined;await this.tail;await this.journal.flush();}
}
