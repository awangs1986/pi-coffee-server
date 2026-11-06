import type {AgentHistoryRead} from './agent-adapter.js';
/** A bounded, engine-neutral snapshot; no tools, thinking, file bodies or runtime startup. */
export function referenceSnapshot(read:AgentHistoryRead){
 if(read.sourceFreshness!=='current')throw Error('Conversation history is unavailable; no Agent was started');
 const eligible=read.history.entries.flatMap(e=>(e.kind==='user'||e.kind==='assistant')&&typeof e.text==='string'&&e.text.trim()?[{role:e.kind,text:e.text}]:[]);
 const messages:{role:'user'|'assistant';text:string}[]=[];let remaining=48000,truncated=false;
 for(let i=eligible.length-1;i>=0;i--){
  if(messages.length>=200||remaining<=0){truncated=true;break;}
  const entry=eligible[i],text=entry.text!;const body=text.slice(-remaining);if(body.length<text.length)truncated=true;
  messages.unshift({role:entry.role,text:body});remaining-=body.length;
 }
 if(!messages.length)throw Error('Conversation has no readable dialogue');
 return {messages,truncated,checkedAt:read.checkedAt};
}
