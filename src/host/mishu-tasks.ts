import {createHash,randomUUID} from 'node:crypto';

/** Durable coordination data, never native execution history or user acceptance. */
export interface TaskBrief {
 assignment?:import('./mishu-dispatch.js').Assignment;
 taskId:string;sourceBinding:string;targetId:string;binding:string;revision:number;
 purpose:string;scope:string;summary:string;nextStep:string;
 workState:'recorded'|'stopped';observation:'not-started'|'watching'|'reply-available'|'incomplete'|'uncertain'|'waiting'|'stopped';acceptance:'pending';
 obligation?:{runId:string;nativeBinding:string;watermark:string;state:'pending'|'reply-available'|'incomplete'|'uncertain'|'cancelled';generation:number};
 fact?:{text:string;latestReply?:string;entries:{id:string;revision:string}[]};
 notification?:{automatic?:boolean;id:string;revision:number;state:'pending'|'committed';reportId?:string};reports?:import('./mishu-reports.js').ReportRecord[];observationError?:string;

 createdAt:string;updatedAt:string;
}
export interface TaskJournal {tasks:TaskBrief[];operations:{id:string;fingerprint:string;task:TaskBrief}[]}
export const TASK_LIMITS={tasks:200,operations:2000,page:50,purpose:500,scope:2000,summary:4000,nextStep:1000} as const;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const fields=['purpose','scope','summary','nextStep'] as const;
const keys:Record<string,string[]>={register:['operationId','targetId','binding',...fields],update:['operationId','taskId','expectedRevision',...fields],observe:['operationId','taskId','expectedRevision','runId'],stop:['operationId','taskId','expectedRevision'],list:['offset','limit'],get:['taskId']};
export async function taskOperation(journal:TaskJournal,sourceBinding:string,input:Record<string,unknown>,authorize:(targetId:string,binding:string)=>Promise<unknown>,observe?:(task:TaskBrief,runId:string)=>Promise<void>){
 const operation=String(input.operation),allowed=keys[operation];
 if(input.version!==1||!allowed||Object.keys(input).some(k=>!['action','version','operation',...allowed].includes(k)))throw Error('Unsupported task interface version, operation or field');
 const current=journal.tasks.filter(t=>t.sourceBinding===sourceBinding);
 if(operation==='list'){
  const offset=input.offset??0,limit=input.limit??20;
  if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>TASK_LIMITS.tasks||!Number.isInteger(limit)||Number(limit)<1||Number(limit)>TASK_LIMITS.page)throw Error('Invalid task page; limit is 1–50');
  // Removed contacts are not readable through an old task reference.
  const visible:TaskBrief[]=[];for(const task of current){try{await authorize(task.targetId,task.binding);visible.push(task);}catch{/* Authorization is checked again on every get or mutation. */}}
  const end=Number(offset)+Number(limit);return {version:1,tasks:visible.slice(Number(offset),end),nextOffset:end<visible.length?end:null,limits:TASK_LIMITS};
 }
 const task=operation==='register'?undefined:current.find(t=>t.taskId===input.taskId);
 if(operation!=='register'&&!task)throw Error('Task unavailable in this secretary');
 if(operation==='get'){await authorize(task!.targetId,task!.binding);return {version:1,task};}
 if(!id(input.operationId))throw Error('A stable operationId is required');
 const normalized:Record<string,unknown>={};for(const k of [...allowed].sort())if(input[k]!==undefined)normalized[k]=input[k];
 const fingerprint=createHash('sha256').update(JSON.stringify([sourceBinding,operation,normalized])).digest('hex');
 const prior=journal.operations.find(p=>p.id===input.operationId);
 const targetId=operation==='register'?input.targetId:task!.targetId,expected=operation==='register'?input.binding:task!.binding;
 if(!id(targetId)||typeof expected!=='string'||!expected)throw Error('Exact configured target and binding required');
 await authorize(targetId,expected);
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('operationId already belongs to different content');return {version:1,task:prior.task};}
 if(journal.operations.length>=TASK_LIMITS.operations)throw Error('Task operation capacity reached');
 for(const key of fields)if(input[key]!==undefined&&(typeof input[key]!=='string'||!(input[key] as string).trim()||(input[key] as string).length>TASK_LIMITS[key]))throw Error(`Invalid ${key}; maximum ${TASK_LIMITS[key]} characters`);
 let result:TaskBrief;
 const now=new Date().toISOString();
 if(operation==='register'){
  if(journal.tasks.length>=TASK_LIMITS.tasks)throw Error('Task brief capacity reached (200)');
  if(fields.some(k=>typeof input[k]!=='string'))throw Error('Task requires purpose, scope, summary and nextStep');
  result={taskId:randomUUID(),sourceBinding,targetId,binding:expected,revision:1,purpose:String(input.purpose),scope:String(input.scope),summary:String(input.summary),nextStep:String(input.nextStep),workState:'recorded',observation:'not-started',acceptance:'pending',createdAt:now,updatedAt:now};journal.tasks.push(result);
 }else{
  if(input.expectedRevision!==task!.revision)throw Error('Task revision conflict; reload before editing');
  if(task!.workState==='stopped')throw Error('Task record is stopped');
  if(operation==='update'&&!fields.some(k=>input[k]!==undefined))throw Error('No task correction supplied');
  result={...task!,revision:task!.revision+1,updatedAt:now};
  if(operation==='observe'){if(!id(input.runId)||!observe)throw Error('Exact native runId and observation capability required');await observe(result,input.runId);}else if(operation==='stop'){result.workState='stopped';if(result.obligation){result.observation='stopped';result.notification=undefined;result.obligation={...result.obligation,state:'cancelled',generation:result.obligation.generation+1};}}else for(const key of fields)if(input[key]!==undefined)result[key]=String(input[key]);
  journal.tasks[journal.tasks.indexOf(task!)]=result;
 }
 journal.operations.push({id:input.operationId,fingerprint,task:{...result}});
 return {version:1,task:result};
}
