import {createHash,randomUUID} from 'node:crypto';
import type {TaskBrief} from './mishu-tasks.js';

/** Business admission identity is independent of the model's transport message ID. */
export interface Assignment {
 id:string;taskId:string;sourceRunId:string;phase:number;targetId:string;binding:string;
 scope:string;fingerprint:string;messageId:string;requestId:string;text:string;authorizationRef:string;
 state:string;createdAt:string;retryOf?:string;error?:string;
}
export function prepareAssignment(task:TaskBrief,input:Record<string,unknown>,sourceRunId:string,prior:Assignment[]):{assignment:Assignment;created:boolean}{
 if(Object.keys(input).some(k=>!['action','version','operation','taskId','expectedRevision','messageId','text','authorizationRef','retryOf'].includes(k))||input.version!==1)throw Error('Unsupported dispatch interface field or version');
 if(typeof input.messageId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.messageId)||typeof input.text!=='string'||!input.text.trim()||input.text.length>4000||typeof input.authorizationRef!=='string'||!input.authorizationRef.trim()||input.authorizationRef.length>500)throw Error('Dispatch requires bounded text, messageId and the explicit user instruction reference');
 if(!Number.isInteger(input.expectedRevision)||Number(input.expectedRevision)<1)throw Error('Dispatch requires a task phase revision');
 const fingerprint=createHash('sha256').update(JSON.stringify([task.targetId,task.binding,task.scope,input.text,input.authorizationRef,input.retryOf??null])).digest('hex');
 const existing=prior.find(a=>a.taskId===task.taskId&&a.sourceRunId===sourceRunId&&a.phase===input.expectedRevision);
 if(existing){if(existing.fingerprint!==fingerprint)throw Error('This user input/task phase already owns different dispatch content');return {assignment:existing,created:false};}
 if(task.workState==='stopped'||task.revision!==input.expectedRevision)throw Error('Task phase changed; reload before dispatch');
 const last=prior.filter(a=>a.taskId===task.taskId).at(-1);
 if(last&&input.retryOf!==last.id)throw Error('Inspect the previous assignment and explicitly name retryOf for another execution');
 if(last&&!['settled','cancelled'].includes(last.state))throw Error('Previous execution is unproven; retry is not allowed');
 if(!last&&input.retryOf!==undefined)throw Error('Unknown retryOf assignment');
 if(task.obligation&&!last)throw Error('This brief already observes an existing run; create a separate task brief for dispatch');
 if(prior.length>=1000)throw Error('Assignment capacity reached');
 const id=randomUUID();return {created:true,assignment:{id,taskId:task.taskId,sourceRunId,phase:Number(input.expectedRevision),targetId:task.targetId,binding:task.binding,scope:task.scope,fingerprint,messageId:input.messageId,requestId:'mishu-dispatch-'+id,text:input.text,authorizationRef:input.authorizationRef,state:'accepted',createdAt:new Date().toISOString(),...(last?{retryOf:last.id}:{})}};
}
