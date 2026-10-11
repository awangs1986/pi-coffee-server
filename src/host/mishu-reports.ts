import {formatReportFacts} from 'pi-coffee-mishu/host-policy';
import {randomUUID} from 'node:crypto';
import {INPUT_QUEUE_POLICY} from './input-queue.js';
import type {TaskBrief} from './mishu-tasks.js';
import type {AgentRunEvidence} from './agent-adapter.js';

export const NOTIFICATION_LIMITS={foregroundBurst:INPUT_QUEUE_POLICY.foregroundBurst,coalesceMs:250,wakesPerWindow:12,budgetWindowMs:3600000,automaticRecoveries:1,eventVersions:16,evidenceReferences:64,outboxBytes:262144,outstanding:20,recordsPerTask:100,factCharacters:4000,latestReplyCharacters:4000,reportCharacters:16000} as const;
export interface ReportEvent {revision:number;state:TaskBrief['observation'];text:string;latestReply?:string;truncated?:boolean;latestReplyTruncated?:boolean;entries:{id:string;revision:string}[]}
/** Delivery references only. Native transcript owns the report text. */
export interface ReportRecord {
 id:string;sourceLabel:string;notificationId:string;notificationRevision:number;taskId:string;sourceBinding:string;
 generation:number;processingId:string;state:'pending'|'admitted'|'processing'|'committed'|'uncertain'|'cancelled';
 brief?:{purpose:string;scope:string;nextStep:string};events?:ReportEvent[];eventVersions?:number[];recoveries?:number;admissionFailures?:number;retryAt?:number;retryBlocked?:boolean;
 deliveryAttempted?:boolean;automatic?:boolean;notificationGeneration?:number;createdAt:string;nativeBinding?:string;outputs?:{id:string;revision:string}[];error?:string;
}
export function reportIntent(task:TaskBrief):ReportRecord {
 if(!task.notification||(!task.fact?.entries.length&&!['waiting','uncertain'].includes(task.observation))||!task.obligation||task.workState==='stopped'||task.obligation.state==='cancelled')throw Error('No authorized native facts available to report');
 return {id:randomUUID(),sourceLabel:task.purpose,notificationId:task.notification.id,notificationRevision:task.notification.revision,
 taskId:task.taskId,sourceBinding:task.sourceBinding,generation:task.obligation.generation,
 brief:{purpose:task.purpose,scope:task.scope,nextStep:task.nextStep},events:structuredClone(task.notification.events??[]),eventVersions:(task.notification.events??[]).map(e=>e.revision),processingId:randomUUID(),state:'processing',createdAt:new Date().toISOString()};
}
export function reportContent(task:TaskBrief,report?:ReportRecord):string {
 const brief=report?.brief??task;
 const facts=report?.events?.length?report.events.at(-1):task.fact;
 return formatReportFacts({purpose:brief.purpose,scope:brief.scope,state:report?.events?.at(-1)?.state??task.observation,fact:facts?.text,latestReply:facts?.latestReply,truncated:facts?.truncated??null,latestReplyTruncated:facts?.latestReplyTruncated??null,events:report?.events?.map(event=>({latestReply:event.latestReply,truncated:event.truncated??null,latestReplyTruncated:event.latestReplyTruncated??null,revision:event.revision,state:event.state,text:event.text})),nextStep:brief.nextStep});
}
export function verifiedReport(report:ReportRecord,evidence:AgentRunEvidence):boolean {
 if(evidence.freshness!=='current'||evidence.runId!==report.processingId||evidence.state!=='reply-available'||!evidence.binding||!evidence.entries?.length)return false;
 const text=evidence.entries.map(e=>e.text).join('\n');
 return text.length<=16000&&['进展','限制','下一步','来源'].every(label=>new RegExp(label+'[：:]\\s*\\S').test(text))&&text.includes(report.sourceLabel);
}
