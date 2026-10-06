import {randomUUID} from 'node:crypto';
import type {TaskBrief} from './mishu-tasks.js';

/** Text copied by a human, never a TaskBrief or an execution capability. */
export interface HistoricalNote {
 noteId:string;sourceBinding:string;fromTaskId:string;fromSourceBinding:string;
 purpose:string;scope:string;summary:string;nextStep:string;recordedAt:string;restoredAt:string;operationId:string;
}
export function historyOperation(tasks:TaskBrief[],notes:HistoricalNote[],sourceBinding:string,input:Record<string,unknown>){
 const allowed=input.operation==='list'?['offset','limit']:input.operation==='restore'?['taskId','operationId']:[];
 if(input.version!==1||!['list','restore'].includes(String(input.operation))||Object.keys(input).some(k=>!['action','version','operation',...allowed].includes(k)))throw Error('Unsupported history interface');
 const historical=tasks.filter(t=>t.sourceBinding!==sourceBinding);
 if(input.operation==='list'){
  const offset=input.offset??0,limit=input.limit??20;
  if(!Number.isInteger(offset)||Number(offset)<0||Number(offset)>200||!Number.isInteger(limit)||Number(limit)<1||Number(limit)>50)throw Error('Invalid history page');
  const end=Number(offset)+Number(limit);
  return {version:1,tasks:historical.slice(Number(offset),end).map(({taskId,purpose,scope,summary,nextStep,updatedAt})=>({taskId,purpose,scope,summary,nextStep,updatedAt})),notes:notes.filter(n=>n.sourceBinding===sourceBinding),nextOffset:end<historical.length?end:null};
 }
 if(typeof input.operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input.operationId))throw Error('A stable operationId is required');
 const original=historical.find(t=>t.taskId===input.taskId);if(!original)throw Error('Historical note unavailable in this secretary');
 const prior=notes.find(n=>n.operationId===input.operationId&&n.sourceBinding===sourceBinding);
 if(prior){if(prior.fromTaskId!==original.taskId)throw Error('operationId already belongs to another historical note');return {version:1,note:prior};}
 // Reopening the chooser cannot fill the journal with copies of the same revision.
 const existing=notes.find(n=>n.sourceBinding===sourceBinding&&n.fromTaskId===original.taskId&&n.recordedAt===original.updatedAt);if(existing)return {version:1,note:existing};
 if(notes.length>=200)throw Error('Historical note capacity reached (200); existing notes preserved');
 const note:HistoricalNote={noteId:randomUUID(),sourceBinding,fromTaskId:original.taskId,fromSourceBinding:original.sourceBinding,purpose:original.purpose,scope:original.scope,summary:original.summary,nextStep:original.nextStep,recordedAt:original.updatedAt,restoredAt:new Date().toISOString(),operationId:input.operationId};notes.push(note);return {version:1,note};
}
