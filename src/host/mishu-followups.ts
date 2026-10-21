import {createHash,randomUUID} from 'node:crypto';
import type {TaskBrief} from './mishu-tasks.js';
import type {CollaborationReceipt} from './mishu-collaboration.js';
export interface FollowupPlan {
 planId:string;sourceBinding:string;generation:number;revision:number;createdAt:string;updatedAt:string;
 state:'active'|'stopped'|'exhausted'|'invalidated';trigger:'new-reply';text:string;stopCondition:string;
 targets:{taskId:string;targetId:string;binding:string;taskRevision:number;scopeHash:string;used:number;lastEvidence?:string}[];
 maxTotal:number;maxPerTarget:number;used:number;reason?:string;
 authorization:{eventId:string;channel:'browser'|'command';at:string;fingerprint:string};
 attempts:{messageId:string;taskId:string;targetId:string;binding:string;evidence:string;evidenceRef:string;state:'reserved'|'accepted'|'settled'|'uncertain'|'cancelled';createdAt:string;error?:string}[];
}
export interface Followups {version:1;plans:FollowupPlan[];operations:{id:string;fingerprint:string;planId:string}[]}
export const FOLLOWUP_LIMITS={plans:50,operations:500,maxTotal:5,maxPerTarget:3,targets:20,textChars:1000} as const;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
export const followupScope=(task:TaskBrief)=>createHash('sha256').update(JSON.stringify([task.sourceBinding,task.targetId,task.binding,task.purpose,task.scope])).digest('hex');
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function followupEvidence(task:TaskBrief,receipts:CollaborationReceipt[]){
 const receipt=receipts.filter(r=>r.taskId===task.taskId&&r.targetId===task.targetId&&r.binding===task.binding&&r.state==='settled'&&r.result&&!r.error&&r.truncated===false).at(-1);
 const value=receipt?.result??(task.observation==='reply-available'&&task.fact?.latestReplyTruncated===false?task.fact.latestReply:undefined);
 if(!value?.trim())return undefined;
 return {hash:createHash('sha256').update(value.normalize('NFKC').trim()).digest('hex'),ref:receipt?'message:'+receipt.messageId:'task:'+task.taskId+':fact:'+createHash('sha256').update(JSON.stringify(task.fact?.entries??[])).digest('hex')};
}
export function followupOperation(journal:Followups,sourceBinding:string,generation:number,input:Record<string,unknown>,tasks:TaskBrief[],receipts:CollaborationReceipt[],channel?:'browser'|'command',now=Date.now()){
 const op=String(input.operation),keys:Record<string,string[]>={list:[],create:['operationId','taskIds','text','trigger','maxTotal','maxPerTarget','stopCondition'],stop:['operationId','planId','expectedRevision']};
 if(input.version!==1||!keys[op]||Object.keys(input).some(k=>!['action','version','operation',...keys[op]].includes(k)))throw Error('Unsupported bounded followup operation or field');
 for(const plan of journal.plans)if(plan.sourceBinding===sourceBinding&&plan.generation!==generation&&plan.state==='active'){plan.state='invalidated';plan.reason='授权或联系人设置已改变；不会继续联系';plan.revision++;plan.updatedAt=new Date(now).toISOString();}
 const current=journal.plans.filter(p=>p.sourceBinding===sourceBinding);
 if(op==='list')return {version:1,plans:current,limits:FOLLOWUP_LIMITS,available:true,reporting:'联系回信继续由现有回执/任务和已开启的提醒处理；计划不自动唤醒秘书模型。'};
 if(!channel)throw Error('Only a direct user can create or stop a bounded followup plan');
 if(!id(input.operationId))throw Error('Stable followup operationId required');
 const fingerprint=createHash('sha256').update(JSON.stringify([sourceBinding,generation,op,Object.fromEntries(keys[op].filter(k=>input[k]!==undefined).sort().map(k=>[k,input[k]]))])).digest('hex');
 const prior=journal.operations.find(o=>o.id===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)throw Error('operationId belongs to different followup content');const plan=current.find(p=>p.planId===prior.planId);if(!plan||plan.generation!==generation)throw Error('Followup authorization changed');return {version:1,plan};}
 if(journal.operations.length>=500)throw Error('Followup operation capacity reached');
 let plan:FollowupPlan;
 if(op==='create'){
  if(journal.plans.length>=50)throw Error('Followup plan capacity reached');
  if(input.trigger!=='new-reply'||!text(input.text,1000)||input.stopCondition!=='budget-user-or-access'||!Number.isSafeInteger(input.maxTotal)||Number(input.maxTotal)<1||Number(input.maxTotal)>5||!Number.isSafeInteger(input.maxPerTarget)||Number(input.maxPerTarget)<1||Number(input.maxPerTarget)>3||Number(input.maxPerTarget)>Number(input.maxTotal))throw Error('An explicit information-only question, stop condition and bounded total/target counts are required');
  if(!Array.isArray(input.taskIds)||!input.taskIds.length||input.taskIds.length>20||input.taskIds.some(t=>!id(t))||new Set(input.taskIds).size!==input.taskIds.length)throw Error('Choose exact saved tasks');
  const targets=input.taskIds.map(taskId=>{const task=tasks.find(t=>t.taskId===taskId&&t.sourceBinding===sourceBinding&&t.workState!=='stopped');if(!task)throw Error('Followup task unavailable');return {taskId:task.taskId,targetId:task.targetId,binding:task.binding,taskRevision:task.revision,scopeHash:followupScope(task),used:0,...(followupEvidence(task,receipts)?{lastEvidence:followupEvidence(task,receipts)!.hash}:{})};});
  if(new Set(targets.map(t=>t.targetId)).size!==targets.length)throw Error('Choose at most one existing matter per responsible contact in each plan');
  // One active plan per saved matter avoids multiplying its default-off budget.
  if(current.some(p=>p.state==='active'&&p.generation===generation&&p.targets.some(t=>targets.some(n=>n.taskId===t.taskId))))throw Error('This matter already has an active followup plan');
  const at=new Date(now).toISOString();plan={planId:randomUUID(),sourceBinding,generation,revision:1,createdAt:at,updatedAt:at,state:'active',trigger:'new-reply',text:String(input.text),stopCondition:String(input.stopCondition),targets,maxTotal:Number(input.maxTotal),maxPerTarget:Number(input.maxPerTarget),used:0,authorization:{eventId:'mishu-plan-'+randomUUID(),channel,at,fingerprint},attempts:[]};journal.plans.push(plan);
 }else{
  const found=current.find(p=>p.planId===input.planId);if(!found||found.generation!==generation)throw Error('Followup plan authority changed');plan=found;if(input.expectedRevision!==plan.revision)throw Error('Plan revision changed; reload before stopping');plan.state='stopped';plan.reason='用户已停止计划；未停止目标工作';plan.revision++;plan.updatedAt=new Date(now).toISOString();
 }
 journal.operations.push({id:input.operationId,fingerprint,planId:plan.planId});return {version:1,plan};
}
export function validateFollowups(value:unknown){
 const j=value as Followups;if(!j||j.version!==1||!Array.isArray(j.plans)||j.plans.length>50||!Array.isArray(j.operations)||j.operations.length>500||Object.keys(j).some(k=>!['version','plans','operations'].includes(k)))throw Error('Invalid followup journal');
 const ids=new Set<string>();for(const p of j.plans){
  if(!id(p.planId)||ids.has(p.planId)||typeof p.sourceBinding!=='string'||!Number.isSafeInteger(p.generation)||p.generation<0||!Number.isSafeInteger(p.revision)||p.revision<1||!Number.isFinite(Date.parse(p.createdAt))||!Number.isFinite(Date.parse(p.updatedAt))||!['active','stopped','exhausted','invalidated'].includes(p.state)||p.trigger!=='new-reply'||!text(p.text,1000)||p.stopCondition!=='budget-user-or-access'||!Number.isInteger(p.maxTotal)||p.maxTotal<1||p.maxTotal>5||!Number.isInteger(p.maxPerTarget)||p.maxPerTarget<1||p.maxPerTarget>3||!Number.isInteger(p.used)||p.used<0||p.used>p.maxTotal||!Array.isArray(p.targets)||!p.targets.length||p.targets.length>20||!Array.isArray(p.attempts)||p.attempts.length!==p.used)throw Error('Invalid followup plan');ids.add(p.planId);
  if(Object.keys(p).some(k=>!['planId','sourceBinding','generation','revision','createdAt','updatedAt','state','trigger','text','stopCondition','targets','maxTotal','maxPerTarget','used','reason','authorization','attempts'].includes(k)))throw Error('Unknown followup field');
  if(p.reason!==undefined&&!text(p.reason,1000))throw Error('Invalid followup reason');
  if(!p.authorization||!id(p.authorization.eventId)||!['browser','command'].includes(p.authorization.channel)||!Number.isFinite(Date.parse(p.authorization.at))||!/^[a-f0-9]{64}$/.test(p.authorization.fingerprint))throw Error('Invalid followup authorization');
  if(Object.keys(p.authorization).some(k=>!['eventId','channel','at','fingerprint'].includes(k)))throw Error('Unknown followup authorization field');
  if(new Set(p.targets.map(t=>t.targetId)).size!==p.targets.length)throw Error('Duplicate responsible contact');
  for(const t of p.targets)if(Object.keys(t).some(k=>!['taskId','targetId','binding','taskRevision','scopeHash','used','lastEvidence'].includes(k))||t.lastEvidence!==undefined&&!/^[a-f0-9]{64}$/.test(t.lastEvidence)||!id(t.taskId)||!id(t.targetId)||typeof t.binding!=='string'||!Number.isSafeInteger(t.taskRevision)||t.taskRevision<1||!/^[a-f0-9]{64}$/.test(t.scopeHash)||!Number.isInteger(t.used)||t.used<0||t.used>p.maxPerTarget||t.used!==p.attempts.filter(a=>a.targetId===t.targetId).length)throw Error('Invalid followup target budget');
  const messages=new Set<string>();for(const a of p.attempts){if(Object.keys(a).some(k=>!['messageId','taskId','targetId','binding','evidence','evidenceRef','state','createdAt','error'].includes(k))||a.error!==undefined&&!text(a.error,1000)||!id(a.messageId)||messages.has(a.messageId)||!p.targets.some(t=>t.taskId===a.taskId&&t.targetId===a.targetId&&t.binding===a.binding)||!/^[a-f0-9]{64}$/.test(a.evidence)||!text(a.evidenceRef,4000)||!['reserved','accepted','settled','uncertain','cancelled'].includes(a.state)||!Number.isFinite(Date.parse(a.createdAt)))throw Error('Invalid followup reservation');messages.add(a.messageId);}
 }
 const operations=new Set<string>();for(const o of j.operations){if(Object.keys(o).some(k=>!['id','fingerprint','planId'].includes(k))||!id(o.id)||operations.has(o.id)||!/^[a-f0-9]{64}$/.test(o.fingerprint)||!ids.has(o.planId))throw Error('Invalid followup operation');operations.add(o.id);}
}
