import {randomInt} from 'node:crypto';
import {templateValue} from './mishu-rules.js';

/**
 * Tier-1 keyword responder. Pure classification and templating over Watch
 * state; channel adapters (Web secretary Chat today, WeChat later) supply the
 * text, a channel key and execute confirmed actions themselves.
 */
export interface QuickRow {id:string;title:string;engine:string;state:string;lastActivityAt?:number;queued:number;approvals:number;contactable:boolean;link:string}
export interface QuickPanelItem {text:string;link:string;priority:number}
export interface QuickSnapshot {rows:QuickRow[];panel:QuickPanelItem[];now:number}
export type QuickIntent =
 |{intent:'overview'}|{intent:'running'}|{intent:'todo'}|{intent:'help'}
 |{intent:'detail';n:number}|{intent:'stop';n?:number}|{intent:'cancel';n?:number}|{intent:'confirm';code:string};
export interface QuickAction {op:'stop'|'cancel';conv:string;title:string}
export type QuickResult =
 |{kind:'reply';text:string;list?:string[]}
 |{kind:'confirm';text:string;action:QuickAction}
 |{kind:'detail';conv:string;title:string;state:string}
 |{kind:'execute';code:string}
 |{kind:'escalate';reason:'no-match'|'too-long'|'disabled'};

const POLITE=/^(?:老板|麻烦|请|帮我|帮忙|给我|我想|想)?(?:看下|看一下|看看|查下|查一下|说下|说一下)?/u;
const TRAILING=/(?:吧|呢|啊|呀|哈|嘛|了吗|吗)+$/u;
const PUNCT=/[\s,，。.!！?？、~～:：;；"“”'‘’()（）【】[\]<>《》]+/gu;
const WORDS:Record<'overview'|'running'|'todo'|'help',string[]>={
 overview:['进度','状态','进展','情况','汇总','怎么样了','怎样了','现在怎么样','现在情况','全部进度','总体进度'],
 running:['哪些在跑','在跑什么','谁在跑','运行中','正在跑什么','哪些在运行'],
 todo:['等我处理','待办','要我做什么','我要处理什么','需要我处理什么','有什么要我处理','等我确认'],
 help:['帮助','help','快捷指令','指令'],
};
/** Exact-match classification after trimming politeness and punctuation. */
export function classifyQuick(text:string,maxLength=12):QuickIntent|'too-long'|undefined{
 const raw=text.normalize('NFKC').trim();
 if(!raw||raw.startsWith('/'))return undefined;
 let core=raw.replace(PUNCT,'').toLowerCase();
 const code=/^确认([a-z0-9]{4})$/.exec(core);if(code)return {intent:'confirm',code:code[1].toUpperCase()};
 const numbered=(value:string):QuickIntent|undefined=>{
  let m=/^(?:看看|详情|查看|看)(\d{1,2})(?:号)?$/.exec(value);if(m)return {intent:'detail',n:Number(m[1])};
  m=/^(?:停|停止|停下|暂停)(\d{1,2})?(?:号)?$/.exec(value);if(m)return {intent:'stop',...(m[1]?{n:Number(m[1])}:{})};
  m=/^取消(\d{1,2})?(?:号)?$/.exec(value);if(m)return {intent:'cancel',...(m[1]?{n:Number(m[1])}:{})};
  return undefined;
 };
 const direct=numbered(core.replace(TRAILING,''));if(direct)return direct;
 core=core.replace(POLITE,'').replace(TRAILING,'');
 if(!core)return undefined;
 if(core.length>maxLength)return 'too-long';
 for(const [intent,words] of Object.entries(WORDS))if(words.includes(core))return {intent} as QuickIntent;
 return numbered(core);
}
const STATE:Record<string,string>={running:'运行中',waiting:'等你确认',errored:'出错',stuck:'卡住',idle:'空闲',unknown:'未知'};
const ago=(now:number,at?:number)=>at===undefined?'时间未知':now-at<60000?'刚刚':now-at<3600000?`${Math.floor((now-at)/60000)} 分钟前`:now-at<86400000?`${Math.floor((now-at)/3600000)} 小时前`:`${Math.floor((now-at)/86400000)} 天前`;
function listing(rows:QuickRow[],now:number,max=8){
 const shown=rows.slice(0,max);
 const lines=shown.map((r,i)=>`${i+1}. ${templateValue(r.title,40)}（${r.engine}）— ${STATE[r.state]??r.state}${r.approvals?` · 待确认 ${r.approvals}`:''}${r.queued?` · 排队 ${r.queued}`:''} — ${ago(now,r.lastActivityAt)}`);
 if(rows.length>max)lines.push(`另有 ${rows.length-max} 个，未列出`);
 return {lines,ids:shown.map(r=>r.id)};
}
/**
 * Decide a quick reply. `lastList` maps the numbers of the previous list reply
 * on this channel (valid 10 minutes) to conversation IDs.
 */
export function quickReply(text:string,snap:QuickSnapshot,ctx:{maxLength:number;enabled:boolean;lastList?:{ids:string[];at:number}}):QuickResult{
 if(!ctx.enabled)return {kind:'escalate',reason:'disabled'};
 const intent=classifyQuick(text,ctx.maxLength);
 if(intent==='too-long')return {kind:'escalate',reason:'too-long'};
 if(!intent)return {kind:'escalate',reason:'no-match'};
 const now=snap.now,rows=snap.rows;
 const count=(s:string)=>rows.filter(r=>r.state===s).length;
 const pick=(n:number|undefined)=>{
  if(n===undefined)return undefined;
  if(!ctx.lastList||now-ctx.lastList.at>10*60000)return 'expired' as const;
  const id=ctx.lastList.ids[n-1];return id?rows.find(r=>r.id===id)??('missing' as const):('missing' as const);
 };
 switch(intent.intent){
  case 'help':return {kind:'reply',text:'快捷指令（不唤醒模型）：进度 / 哪些在跑 / 等我处理 / 看看 N / 停 N / 取消 N。其他问题我会交给秘书处理。'};
  case 'overview':{
   if(!rows.length)return {kind:'reply',text:'当前没有可查看的对话。',list:[]};
   const {lines,ids}=listing(rows,now);
   return {kind:'reply',text:[`运行中 ${count('running')} · 等你 ${count('waiting')} · 出错 ${count('errored')} · 卡住 ${count('stuck')}`,...lines,'回复“看看 N”查看摘录，“停 N”停止运行。'].join('\n'),list:ids};
  }
  case 'running':{
   const active=rows.filter(r=>['running','stuck','waiting'].includes(r.state));
   if(!active.length)return {kind:'reply',text:'现在没有正在运行的对话。',list:[]};
   const {lines,ids}=listing(active,now);return {kind:'reply',text:[`正在运行 ${active.length} 个：`,...lines].join('\n'),list:ids};
  }
  case 'todo':{
   const items=snap.panel.filter(i=>i.priority<=2);
   if(!items.length)return {kind:'reply',text:'目前没有需要你处理的事项。'};
   const lines=items.slice(0,8).map((i,n)=>`${n+1}. ${templateValue(i.text,100)}${i.link?' '+i.link:''}`);
   if(items.length>8)lines.push(`另有 ${items.length-8} 项，用 /mishu-todo 查看`);
   return {kind:'reply',text:['需要你处理：',...lines].join('\n')};
  }
  case 'detail':case 'stop':case 'cancel':{
   const row=pick(intent.n);
   if(intent.n===undefined){
    const candidates=rows.filter(r=>intent.intent==='stop'?['running','stuck','waiting'].includes(r.state):r.queued>0);
    if(!candidates.length)return {kind:'reply',text:intent.intent==='stop'?'没有正在运行的对话可停止。':'没有排队中的指令可取消。',list:[]};
    const {lines,ids}=listing(candidates,now);
    return {kind:'reply',text:[`请指定编号（未执行任何操作）：`,...lines,`回复“${intent.intent==='stop'?'停':'取消'} N”。`].join('\n'),list:ids};
   }
   if(row==='expired')return {kind:'reply',text:'编号已过期，请先回复“进度”或“哪些在跑”获取最新列表。未执行任何操作。'};
   if(row==='missing'||!row)return {kind:'reply',text:`没有编号 ${intent.n}。请先回复“进度”查看列表。未执行任何操作。`};
   if(intent.intent==='detail')return {kind:'detail',conv:row.id,title:row.title,state:row.state};
   if(intent.intent==='stop'&&!['running','stuck','waiting'].includes(row.state))return {kind:'reply',text:`《${templateValue(row.title,40)}》当前${STATE[row.state]??row.state}，没有需要停止的运行。`};
   if(intent.intent==='cancel'&&!row.queued)return {kind:'reply',text:`《${templateValue(row.title,40)}》没有排队中的指令。`};
   if(!row.contactable)return {kind:'reply',text:`《${templateValue(row.title,40)}》不在秘书联系对象内，不能代为${intent.intent==='stop'?'停止':'取消'}。请打开该对话手动处理：${row.link}`};
   return {kind:'confirm',text:'',action:{op:intent.intent,conv:row.id,title:row.title}};
  }
  case 'confirm':return {kind:'execute',code:intent.code};
 }
}

const ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** One-time, channel-bound, expiring confirmation codes for stop/cancel. */
export class QuickConfirmations {
 private codes=new Map<string,{code:string;action:QuickAction;expiresAt:number}[]>();
 private failures=new Map<string,number>();
 private lists=new Map<string,{ids:string[];at:number}>();
 constructor(private ttlMs=120000,private now:()=>number=Date.now){}
 issue(channel:string,action:QuickAction):string{
  const now=this.now();
  const live=(this.codes.get(channel)??[]).filter(c=>c.expiresAt>now&&!(c.action.op===action.op&&c.action.conv===action.conv)).slice(-4);
  let code='';do{code=Array.from({length:4},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');}while(live.some(c=>c.code===code));
  live.push({code,action,expiresAt:now+this.ttlMs});this.codes.set(channel,live);return code;
 }
 /** Returns the action once; wrong, expired or reused codes return undefined. Five failures drop all codes. */
 consume(channel:string,code:string):QuickAction|undefined{
  const now=this.now(),live=(this.codes.get(channel)??[]).filter(c=>c.expiresAt>now);
  const found=live.find(c=>c.code===code.toUpperCase());
  if(!found){const n=(this.failures.get(channel)??0)+1;this.failures.set(channel,n);if(n>=5){this.codes.delete(channel);this.failures.delete(channel);}else this.codes.set(channel,live);return undefined;}
  this.codes.set(channel,live.filter(c=>c!==found));this.failures.delete(channel);return found.action;
 }
 rememberList(channel:string,ids:string[]){this.lists.set(channel,{ids,at:this.now()});if(this.lists.size>200)this.lists.delete(this.lists.keys().next().value!);}
 list(channel:string){return this.lists.get(channel);}
}
