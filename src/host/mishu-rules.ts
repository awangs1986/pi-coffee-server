/**
 * Tier-1 MISHU watch rules. Rules are declarative data: fixed matchers, fixed
 * actions and whitelisted template fields. Nothing here evaluates expressions,
 * calls a model or reads conversation content.
 */
export const WATCH_KINDS=['run.started','run.completed','run.errored','run.interrupted','run.stuck','approval.opened','approval.closed','queue.depth','task.truncated','task.settled','tracking.error'] as const;
export type WatchKind=typeof WATCH_KINDS[number];
export const PANEL_KINDS=['approval','error','stuck','completed','truncated','backlog','verify','tracking_error','config_invalid'] as const;
export type PanelKind=typeof PANEL_KINDS[number];
export const CONV_STATES=['idle','running','waiting','errored','stuck','unknown'] as const;
export type ConvState=typeof CONV_STATES[number];
export const NOTICE_CHANNELS=['web','wechat'] as const;
export type NoticeChannel=typeof NOTICE_CHANNELS[number];
export const TEMPLATE_FIELDS=['title','approvalTitle','error','minutes','link','count','state'] as const;

export interface RuleWhen {state?:ConvState[];engine?:string[];noProgressMin?:number;queuedAtLeast?:number;conv?:string[]}
export interface Rule {
 id:string;
 enabled?:boolean;
 on:WatchKind[];
 when?:RuleWhen;
 panel?:{kind:PanelKind;priority:number;autoExpireMin?:number};
 notify?:{channels:NoticeChannel[];template:string;cooldownMin?:number;batchSec?:number};
 /** Only a hint shown on the panel item; a rule never wakes a model by itself. */
 escalate?:{mode:'report'};
}
export interface WatchConfig {
 version:1;
 scope:{watch:'all'|'selected';exclude:string[]};
 quietHours?:{from:string;to:string;allow:WatchKind[]};
 rules:Rule[];
 quick:{enabled:boolean;maxLength:number};
 limits:{webPerHour:number;wechatPerHour:number};
}

export const DEFAULT_RULES:Rule[]=[
 {id:'approval',on:['approval.opened'],panel:{kind:'approval',priority:1},notify:{channels:['web','wechat'],template:'⏳ {title} 等你确认：{approvalTitle} {link}',cooldownMin:10}},
 {id:'error',on:['run.errored'],panel:{kind:'error',priority:2},notify:{channels:['web','wechat'],template:'❌ {title} 出错：{error} {link}',cooldownMin:15}},
 {id:'interrupted',on:['run.interrupted'],panel:{kind:'error',priority:2},notify:{channels:['web'],template:'⚠️ {title} 运行中断，未自动重试 {link}',cooldownMin:15}},
 {id:'stuck',on:['run.stuck'],when:{noProgressMin:20},panel:{kind:'stuck',priority:2},notify:{channels:['web'],template:'🐢 {title} 已 {minutes} 分钟无进展 {link}',cooldownMin:30}},
 {id:'done',on:['run.completed'],panel:{kind:'completed',priority:4,autoExpireMin:720},notify:{channels:['web'],template:'✅ {title} 已完成 {link}',batchSec:60}},
 {id:'truncated',on:['task.truncated'],panel:{kind:'truncated',priority:3}},
 {id:'backlog',on:['queue.depth'],when:{queuedAtLeast:3},panel:{kind:'backlog',priority:3}},
 {id:'verify',on:['task.settled'],panel:{kind:'verify',priority:2},escalate:{mode:'report'}},
 {id:'tracking',on:['tracking.error'],panel:{kind:'tracking_error',priority:3}},
];
export const DEFAULT_WATCH_CONFIG:WatchConfig={version:1,scope:{watch:'all',exclude:[]},rules:DEFAULT_RULES,quick:{enabled:true,maxLength:12},limits:{webPerHour:60,wechatPerHour:20}};

export class RulesError extends Error {}
type Row=Record<string,unknown>;
const row=(v:unknown):v is Row=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function keys(v:Row,allowed:string[],where:string){for(const k of Object.keys(v))if(!allowed.includes(k))throw new RulesError(`${where}: unknown key ${k}`);}
function strings<T extends string>(v:unknown,choices:readonly T[]|undefined,max:number,where:string):T[]{
 if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||x.length>256||(choices!==undefined&&!choices.includes(x as T))))throw new RulesError(`${where}: invalid list`);
 return [...v] as T[];
}
function int(v:unknown,min:number,max:number,where:string){if(!Number.isSafeInteger(v)||Number(v)<min||Number(v)>max)throw new RulesError(`${where}: expected integer ${min}-${max}`);return Number(v);}
const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
function parseRule(v:unknown,index:number):Rule{
 const where=`rules[${index}]`;
 if(!row(v))throw new RulesError(`${where}: expected object`);
 keys(v,['id','enabled','on','when','panel','notify','escalate'],where);
 if(typeof v.id!=='string'||!/^[a-z][a-z0-9_-]{0,39}$/.test(v.id))throw new RulesError(`${where}.id invalid`);
 const rule:Rule={id:v.id,on:[]};
 if(v.enabled!==undefined){if(typeof v.enabled!=='boolean')throw new RulesError(`${where}.enabled invalid`);rule.enabled=v.enabled;}
 if(v.enabled===false&&Object.keys(v).every(k=>k==='id'||k==='enabled'))return rule;
 rule.on=strings(v.on,WATCH_KINDS,WATCH_KINDS.length,`${where}.on`);if(!rule.on.length)throw new RulesError(`${where}.on empty`);
 if(v.when!==undefined){
  if(!row(v.when))throw new RulesError(`${where}.when invalid`);keys(v.when,['state','engine','noProgressMin','queuedAtLeast','conv'],`${where}.when`);
  const when:RuleWhen={};
  if(v.when.state!==undefined)when.state=strings(v.when.state,CONV_STATES,CONV_STATES.length,`${where}.when.state`);
  if(v.when.engine!==undefined)when.engine=strings(v.when.engine,undefined,10,`${where}.when.engine`);
  if(v.when.conv!==undefined)when.conv=strings(v.when.conv,undefined,50,`${where}.when.conv`);
  if(v.when.noProgressMin!==undefined)when.noProgressMin=int(v.when.noProgressMin,5,1440,`${where}.when.noProgressMin`);
  if(v.when.queuedAtLeast!==undefined)when.queuedAtLeast=int(v.when.queuedAtLeast,1,100,`${where}.when.queuedAtLeast`);
  rule.when=when;
 }
 if(v.panel!==undefined){
  if(!row(v.panel))throw new RulesError(`${where}.panel invalid`);keys(v.panel,['kind','priority','autoExpireMin'],`${where}.panel`);
  if(!PANEL_KINDS.includes(v.panel.kind as PanelKind)||v.panel.kind==='config_invalid')throw new RulesError(`${where}.panel.kind invalid`);
  rule.panel={kind:v.panel.kind as PanelKind,priority:int(v.panel.priority,1,5,`${where}.panel.priority`),...(v.panel.autoExpireMin!==undefined?{autoExpireMin:int(v.panel.autoExpireMin,1,10080,`${where}.panel.autoExpireMin`)}:{})};
 }
 if(v.notify!==undefined){
  if(!row(v.notify))throw new RulesError(`${where}.notify invalid`);keys(v.notify,['channels','template','cooldownMin','batchSec'],`${where}.notify`);
  const channels=strings(v.notify.channels,NOTICE_CHANNELS,2,`${where}.notify.channels`);
  if(typeof v.notify.template!=='string'||!v.notify.template.trim()||v.notify.template.length>200)throw new RulesError(`${where}.notify.template invalid`);
  for(const match of v.notify.template.matchAll(/\{([A-Za-z]+)\}/g))if(!(TEMPLATE_FIELDS as readonly string[]).includes(match[1]))throw new RulesError(`${where}.notify.template field {${match[1]}} not allowed`);
  rule.notify={channels,template:v.notify.template,...(v.notify.cooldownMin!==undefined?{cooldownMin:int(v.notify.cooldownMin,0,1440,`${where}.notify.cooldownMin`)}:{}),...(v.notify.batchSec!==undefined?{batchSec:int(v.notify.batchSec,1,3600,`${where}.notify.batchSec`)}:{})};
 }
 if(v.escalate!==undefined){if(!row(v.escalate)||v.escalate.mode!=='report'||Object.keys(v.escalate).length!==1)throw new RulesError(`${where}.escalate only supports {"mode":"report"}`);rule.escalate={mode:'report'};}
 if(rule.on.includes('run.stuck')&&rule.when?.noProgressMin===undefined)throw new RulesError(`${where}: run.stuck rules need when.noProgressMin`);
 return rule;
}
/** Parse a user rules.json over the built-in defaults. Throws RulesError with a bounded message. */
export function parseWatchConfig(raw:unknown):WatchConfig{
 if(!row(raw))throw new RulesError('rules.json must be an object');
 keys(raw,['version','scope','quietHours','rules','quick','limits'],'rules.json');
 if(raw.version!==1)throw new RulesError('rules.json version must be 1');
 const config:WatchConfig=structuredClone(DEFAULT_WATCH_CONFIG);
 if(raw.scope!==undefined){
  if(!row(raw.scope))throw new RulesError('scope invalid');keys(raw.scope,['watch','exclude'],'scope');
  if(raw.scope.watch!==undefined){if(raw.scope.watch!=='all'&&raw.scope.watch!=='selected')throw new RulesError('scope.watch invalid');config.scope.watch=raw.scope.watch;}
  if(raw.scope.exclude!==undefined)config.scope.exclude=strings(raw.scope.exclude,undefined,200,'scope.exclude');
 }
 if(raw.quietHours!==undefined){
  const q=raw.quietHours;if(!row(q))throw new RulesError('quietHours invalid');keys(q,['from','to','allow'],'quietHours');
  if(typeof q.from!=='string'||!clock.test(q.from)||typeof q.to!=='string'||!clock.test(q.to))throw new RulesError('quietHours.from/to must be HH:MM');
  config.quietHours={from:q.from,to:q.to,allow:q.allow===undefined?[]:strings(q.allow,WATCH_KINDS,WATCH_KINDS.length,'quietHours.allow')};
 }
 if(raw.quick!==undefined){
  if(!row(raw.quick))throw new RulesError('quick invalid');keys(raw.quick,['enabled','maxLength'],'quick');
  if(raw.quick.enabled!==undefined){if(typeof raw.quick.enabled!=='boolean')throw new RulesError('quick.enabled invalid');config.quick.enabled=raw.quick.enabled;}
  if(raw.quick.maxLength!==undefined)config.quick.maxLength=int(raw.quick.maxLength,4,40,'quick.maxLength');
 }
 if(raw.limits!==undefined){
  if(!row(raw.limits))throw new RulesError('limits invalid');keys(raw.limits,['webPerHour','wechatPerHour'],'limits');
  if(raw.limits.webPerHour!==undefined)config.limits.webPerHour=int(raw.limits.webPerHour,0,1000,'limits.webPerHour');
  if(raw.limits.wechatPerHour!==undefined)config.limits.wechatPerHour=int(raw.limits.wechatPerHour,0,200,'limits.wechatPerHour');
 }
 if(raw.rules!==undefined){
  if(!Array.isArray(raw.rules)||raw.rules.length>50)throw new RulesError('rules must be an array of at most 50 rules');
  const overrides=raw.rules.map(parseRule);
  if(new Set(overrides.map(r=>r.id)).size!==overrides.length)throw new RulesError('duplicate rule id');
  const merged=config.rules.map(rule=>overrides.find(o=>o.id===rule.id)??rule);
  for(const rule of overrides)if(!merged.some(r=>r.id===rule.id))merged.push(rule);
  config.rules=merged;
 }
 return config;
}
export function activeRules(config:WatchConfig):Rule[]{return config.rules.filter(rule=>rule.enabled!==false&&rule.on.length>0);}
/** Smallest enabled stuck threshold in minutes, or undefined when stuck detection is off. */
export function stuckThresholdMin(config:WatchConfig):number|undefined{
 const values=activeRules(config).filter(r=>r.on.includes('run.stuck')).map(r=>r.when?.noProgressMin).filter((v):v is number=>v!==undefined);
 return values.length?Math.min(...values):undefined;
}
/** Single-line, clipped, control-free template value. */
export function templateValue(value:unknown,max:number):string{
 // eslint-disable-next-line no-control-regex
 const text=String(value??'').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g,' ').replace(/\s+/g,' ').trim();
 return text.length>max?text.slice(0,max-1)+'…':text;
}
export function renderTemplate(template:string,fields:Partial<Record<typeof TEMPLATE_FIELDS[number],unknown>>):string{
 const text=template.replace(/\{([A-Za-z]+)\}/g,(_all,name:string)=>templateValue((fields as Record<string,unknown>)[name],name==='title'?60:name==='link'?300:120));
 return templateValue(text,300);
}
export function inQuietHours(config:WatchConfig,now:Date):boolean{
 const q=config.quietHours;if(!q)return false;
 const minutes=(t:string)=>Number(t.slice(0,2))*60+Number(t.slice(3));
 const current=now.getHours()*60+now.getMinutes(),from=minutes(q.from),to=minutes(q.to);
 return from===to?false:from<to?current>=from&&current<to:current>=from||current<to;
}
