import {createHash,randomUUID} from 'node:crypto';
/** Ordinary product decisions. These records are never native permission/tool replies. */
export interface Clarification {
 questionId:string;sourceBinding:string;generation:number;taskId?:string;revision:number;question:string;options:string[];createdAt:string;expiresAt?:string;
 state:'pending'|'answered'|'cancelled'|'superseded'|'expired';
 answer?:{text:string;eventId:string;channel:'browser'|'command';at:string;continuation:'available'};
}
export interface Clarifications {version:1;questions:Clarification[];operations:{id:string;fingerprint:string;questionId:string}[]}
export const CLARIFICATION_LIMITS={questions:100,operations:1000,questionChars:2000,answerChars:2000,options:12,optionChars:200} as const;
const stableId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export function clarificationOperation(journal:Clarifications,sourceBinding:string,generation:number,input:Record<string,unknown>,channel?:'browser'|'command',now=Date.now()){
 const op=String(input.operation),allowed:Record<string,string[]>={list:[],create:['operationId','kind','question','options','taskId','expiresAt','supersedes'],get:['questionId'],answer:['operationId','questionId','expectedRevision','answer'],cancel:['operationId','questionId','expectedRevision']};
 if(input.version!==1||!allowed[op]||Object.keys(input).some(k=>!['action','version','operation',...allowed[op]].includes(k)))throw Error('Unsupported ordinary clarification operation or field');
 const current=journal.questions.filter(q=>q.sourceBinding===sourceBinding&&q.generation===generation);
 for(const q of current)if(q.state==='pending'&&q.expiresAt&&Date.parse(q.expiresAt)<=now){q.state='expired';q.revision++;}
 if(op==='list')return {version:1,questions:current,limits:CLARIFICATION_LIMITS,resumption:{available:true,mode:'next-user-turn',reason:'回答已保存；秘书在下一次用户消息中继续对应事项，不自动派工，也不回答原生审批。'}};
 if(op==='get'){const question=current.find(q=>q.questionId===input.questionId);if(!question)throw Error('Question unavailable');return {version:1,question};}
 if(op==='answer'&&!channel)throw Error('Only a direct user answer from Browser or /mishu-questions is accepted');
 if(!stableId(input.operationId))throw Error('Stable operationId required');
 const fingerprint=createHash('sha256').update(JSON.stringify([sourceBinding,generation,op,Object.fromEntries(allowed[op].filter(k=>input[k]!==undefined).sort().map(k=>[k,input[k]]))])).digest('hex');
 const prior=journal.operations.find(o=>o.id===input.operationId);
 if(prior){if(prior.fingerprint!==fingerprint)throw Error('operationId belongs to different content');const question=current.find(q=>q.questionId===prior.questionId);if(!question)throw Error('Question authority changed');return {version:1,question};}
 if(journal.operations.length>=CLARIFICATION_LIMITS.operations)throw Error('Clarification operation capacity reached');
 let question:Clarification;
 if(op==='create'){
  if(input.kind!=='ordinary'||!text(input.question,CLARIFICATION_LIMITS.questionChars))throw Error('Only an ordinary nonblocking question may be saved; never native/tool/setup approval');
  if(journal.questions.length>=CLARIFICATION_LIMITS.questions)throw Error('Clarification capacity reached');
  if(input.taskId!==undefined&&!stableId(input.taskId))throw Error('Invalid task reference');
  const options=input.options??[];if(!Array.isArray(options)||options.length>12||options.some(o=>!text(o,200))||new Set(options).size!==options.length)throw Error('Invalid question options');
  if(input.expiresAt!==undefined&&(typeof input.expiresAt!=='string'||!Number.isFinite(Date.parse(input.expiresAt))||Date.parse(input.expiresAt)<=now))throw Error('Question expiry must be in the future');
  if(input.supersedes!==undefined){const old=current.find(q=>q.questionId===input.supersedes);if(!old||old.state!=='pending'||old.taskId!==input.taskId)throw Error('Supersession requires the same pending matter');old.state='superseded';old.revision++;}
  question={questionId:randomUUID(),sourceBinding,generation,...(input.taskId?{taskId:String(input.taskId)}:{}),revision:1,question:String(input.question),options,createdAt:new Date(now).toISOString(),...(input.expiresAt?{expiresAt:String(input.expiresAt)}:{}),state:'pending'};journal.questions.push(question);
 }else{
  const found=current.find(q=>q.questionId===input.questionId);if(!found)throw Error('Question unavailable');question=found;
  if(op==='answer'&&question.state==='answered'&&question.answer?.text===input.answer&&question.answer?.channel===channel&&input.expectedRevision===question.revision-1){journal.operations.push({id:input.operationId,fingerprint,questionId:question.questionId});return {version:1,question};}
  if(question.state!=='pending'||input.expectedRevision!==question.revision)throw Error('Question is closed, expired or revision changed');
  if(op==='answer'){
   if(!text(input.answer,CLARIFICATION_LIMITS.answerChars))throw Error('An explicit nonempty user answer is required; no default or timeout');
   question.answer={text:input.answer,eventId:'mishu-answer-'+randomUUID(),channel:channel!,at:new Date(now).toISOString(),continuation:'available'};question.state='answered';
  }else question.state='cancelled';
  question.revision++;
 }
 journal.operations.push({id:input.operationId,fingerprint,questionId:question.questionId});return {version:1,question};
}
export function validateClarifications(value:unknown){
 const j=value as Clarifications;if(!j||j.version!==1||!Array.isArray(j.questions)||j.questions.length>100||!Array.isArray(j.operations)||j.operations.length>1000)throw Error('Invalid clarifications journal');
 if(Object.keys(j).some(k=>!['version','questions','operations'].includes(k)))throw Error('Unknown clarifications journal field');
 const ids=new Set<string>();for(const q of j.questions){
  if(!stableId(q.questionId)||ids.has(q.questionId)||typeof q.sourceBinding!=='string'||!Number.isSafeInteger(q.generation)||q.generation<0||!Number.isSafeInteger(q.revision)||q.revision<1||!text(q.question,2000)||!Array.isArray(q.options)||q.options.length>12||q.options.some(o=>!text(o,200))||!Number.isFinite(Date.parse(q.createdAt))||!['pending','answered','cancelled','superseded','expired'].includes(q.state))throw Error('Invalid clarification');ids.add(q.questionId);
  if(Object.keys(q).some(k=>!['questionId','sourceBinding','generation','taskId','revision','question','options','createdAt','expiresAt','state','answer'].includes(k))||(q.taskId!==undefined&&!stableId(q.taskId))||(q.expiresAt!==undefined&&!Number.isFinite(Date.parse(q.expiresAt))))throw Error('Invalid clarification field');
  if(q.answer){const a=q.answer;if(!text(a.text,2000)||!stableId(a.eventId)||!['browser','command'].includes(a.channel)||!Number.isFinite(Date.parse(a.at))||a.continuation!=='available'||q.state!=='answered'||Object.keys(a).some(k=>!['text','eventId','channel','at','continuation'].includes(k)))throw Error('Invalid clarification answer');}else if(q.state==='answered')throw Error('Missing answer evidence');
 }
 const operations=new Set<string>();for(const o of j.operations){if(!stableId(o.id)||operations.has(o.id)||typeof o.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(o.fingerprint)||!ids.has(o.questionId)||Object.keys(o).some(k=>!['id','fingerprint','questionId'].includes(k)))throw Error('Invalid clarification operation');operations.add(o.id);}
}
