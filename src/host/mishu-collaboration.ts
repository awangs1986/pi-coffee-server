import type {TaskBrief} from './mishu-tasks.js';
import type {Clarification} from './mishu-clarifications.js';
/** A projection of existing execution ledgers, never a second executor. */
export interface CollaborationReceipt {messageId:string;taskId?:string;targetId:string;binding:string;state:string;createdAt:string;error?:string;result?:string;truncated?:boolean}
export function collaborationItem(sourceId:string,task:TaskBrief,target:{id:string;title:string;engine:string},receipts:CollaborationReceipt[],questions:Clarification[]){
 const related=receipts.filter(r=>r.targetId===task.targetId&&r.binding===task.binding&&(r.taskId===task.taskId||r.messageId===task.assignment?.messageId));
 const latest=related.at(-1),assignment=task.assignment,execution=assignment?.state??'not-started';
 const pending=questions.filter(q=>q.taskId===task.taskId&&q.state==='pending');
 const committed=task.reports?.some(r=>r.state==='committed'&&r.notificationRevision===task.notification?.revision)||task.notification?.state==='committed';
 const report=committed?'reported':task.reports?.some(r=>r.state==='uncertain')?'uncertain':task.reports?.some(r=>['pending','admitted','processing'].includes(r.state))?'pending':'not-reported';
 let state='recorded';
 if(task.workState==='stopped')state='stopped';
 else if(pending.length||task.observation==='waiting')state='waiting-user';
 else if(task.observation==='uncertain'||assignment?.state==='uncertain'||latest?.state==='uncertain')state='uncertain';
 else if(task.observation==='incomplete'||latest?.error)state='failed';
 else if(report==='reported')state='reported';
 else if(task.observation==='reply-available'||latest?.state==='settled'&&latest.result)state='reply-available';
 else if(assignment?.state==='running'||latest?.state==='running')state='running';
 else if(assignment&&['accepted','queued','delivering'].includes(assignment.state)||latest&&['accepted','queued','delivering'].includes(latest.state))state='queued';
 else if(task.obligation||related.length)state='awaiting-reply';
 return {taskId:task.taskId,purpose:task.purpose,expectedResult:task.scope,nextStep:task.nextStep,target,destination:{sourceId,taskId:task.taskId,label:'原秘书 · '+task.purpose,link:'/conversations/'+encodeURIComponent(sourceId)},state,contacted:Boolean(related.length||assignment),execution,report,read:'unknown',acceptance:task.acceptance,evidenceAt:task.updatedAt,createdAt:task.createdAt,questions:pending.map(q=>({questionId:q.questionId,question:q.question,revision:q.revision})),relatedMessages:related.map(r=>({messageId:r.messageId,state:r.state,createdAt:r.createdAt,...(r.error?{error:r.error}:{})})),reply:task.fact?.latestReply??latest?.result??null,truncated:task.fact?.latestReplyTruncated??latest?.truncated??null,remainingResponsibility:state==='reported'?'等待用户阅读或验收；已汇报不等于验收':state==='stopped'?'已停止记录；目标工作不会因此停止':pending.length?'等待这个事项的明确回答':'等待负责人回信或补充证据'};
}
