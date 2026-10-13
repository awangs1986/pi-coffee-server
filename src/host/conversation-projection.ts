/** Display projection only. Native evidence and execution consumers retain originals. */
export function compactEntry(entry:any):any|null {
  if(entry?.kind!=='tool')return entry;
  return entry.isError ? {kind:'note',id:entry.id,entityRevision:entry.entityRevision,at:entry.at,text:'工具执行失败；切换到详细模式查看。'} : null;
}
export function compactOperation(op:any):any {
  if(op.type==='upsertTool'||op.payload?.entry?.kind==='tool') {
    const entry=op.payload?.entry&&compactEntry(op.payload.entry);
    return entry?{...op,type:'replaceText',payload:{entry,isNew:true}}:{opId:op.opId,revision:op.revision,type:'setMetadata',payload:{}};
  }
  return op;
}
export function compactEvent(event:any):any|null {
  if(!event||typeof event!=='object')return event;
  if(['tool_update','tool_execution_start','tool_execution_update','tool_execution_end'].includes(event.type)) {
    if(event.isError)return {type:'display_notice',text:'工具执行失败；切换到详细模式查看。',error:true};
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
  if(event.message) {
    if(['toolResult','tool'].includes(event.message.role))return null;
    return {...event,message:{...event.message,content:Array.isArray(event.message.content)?event.message.content.filter((part:any)=>['text','image'].includes(part.type)):event.message.content}};
  }
  return event;
}
