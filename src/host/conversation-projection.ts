import {isToolExecutionEvent} from '../../public/display-events.js';
/** Display projection only. Native evidence and execution consumers retain originals. */
export function compactEntry(entry:any):any|null {
  return entry?.kind==='tool'?null:entry;
}
export function compactOperation(op:any):any {
  if(op.type==='upsertTool'||op.payload?.entry?.kind==='tool') {
    return {opId:op.opId,revision:op.revision,type:'setMetadata',payload:{}};
  }
  return op;
}
export function compactEvent(event:any):any|null {
  if(!event||typeof event!=='object')return event;
  if(isToolExecutionEvent(event)) {
    return event.type==='tool_execution_start'?{type:'display_boundary'}:null;
  }
  if(event.type==='sync_entity') {
    const entry=compactEntry(event.entry);return entry?{...event,entry}:null;
  }
  if(event.type==='message_update') {
    const delta=event.assistantMessageEvent;
    // Pi includes a cumulative message and partial on delta events. Forwarding
    // either leaks omitted process bodies and grows traffic quadratically.
    return delta?.type==='text_delta'?{type:'message_update',assistantMessageEvent:{type:'text_delta',contentIndex:delta.contentIndex,delta:delta.delta}}:null;
  }
  if(event.message&&typeof event.message==='object') {
    if(['toolResult','tool'].includes(event.message.role))return null;
    return {...event,message:{...event.message,content:Array.isArray(event.message.content)?event.message.content.filter((part:any)=>['text','image'].includes(part.type)):event.message.content}};
  }
  return event;
}
