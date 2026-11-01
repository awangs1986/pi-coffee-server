import {PROFILE_VERSION,SPEECH_PROFILE} from './profile.js';
export {PROFILE_VERSION,SPEECH_PROFILE};
export const PLUGIN_VERSION='0.1.0';
export interface SpeechSelection {enabled:boolean;profileVersion:string;}
export interface SpeechBrief {id:string;completionId:string;profileVersion:string;summary?:string;completedAt:string;outcome:'result'|'failure';}
export interface SpeechState {enabled:boolean;browserId:string|null;selected:Record<string,SpeechSelection>;completions:Record<string,SpeechBrief>;attempts:Record<string,string>;}
export interface SpeechTask {id:string;title:string;engine:string;archived?:boolean;completionId?:string;completedAt?:string;readCompletionId?:string;runStatus?:string;}
export interface SpeechAdapter {load():Promise<SpeechState|undefined>;save(state:SpeechState):Promise<void>;task(id:string):Promise<SpeechTask|undefined>;now?():number;}
export function parseBrief(text:string,version=PROFILE_VERSION):{summary:string;fullText:string}|undefined {
 const matches=[...text.matchAll(/^```coffee-speech\s*\n([\s\S]*?)\n```\s*$/gm)];
 if(matches.length!==1)return;
 const match=matches[0];if(text.slice(match.index!+match[0].length).trim())return;
 try{const data=JSON.parse(match[1]);if(!data||Object.keys(data).sort().join(',')!=='profile_version,summary'||data.profile_version!==version||typeof data.summary!=='string'||!data.summary.trim()||data.summary.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.summary))return;
 return {summary:data.summary.trim(),fullText:text.slice(0,match.index).trimEnd()};}catch{return;}
}
/** Owns only authorized IDs supplied by its adapter; never discovers native accounts. */
export class CompletionSpeech {
 private state?:SpeechState;private tail:Promise<unknown>=Promise.resolve();
 constructor(private adapter:SpeechAdapter){}
 private now(){return this.adapter.now?.()??Date.now();}
 private async loaded(){return this.state??=await this.adapter.load()??{enabled:false,browserId:null,selected:{},completions:{},attempts:{}};}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const next=this.tail.then(run);this.tail=next.catch(()=>undefined);return next;}
 async status(){await this.tail;const s=await this.loaded();return {pluginVersion:PLUGIN_VERSION,enabled:s.enabled,browserId:s.browserId,selected:structuredClone(s.selected)};}
 async handle(input:Record<string,unknown>){return this.serial(async()=>{
  const s=await this.loaded(),action=input.action;
  const allowed:Record<string,string[]>={status:['action'],configure:['action','enabled'],select:['action','id','enabled'],designate:['action','browserId'],pending:['action','browserId'],claim:['action','browserId','id','completionId']};
  if(typeof action!=='string'||!allowed[action]||Object.keys(input).some(k=>!allowed[action].includes(k)))throw Error('Invalid speech request');
  if(action==='status')return {pluginVersion:PLUGIN_VERSION,enabled:s.enabled,browserId:s.browserId,selected:structuredClone(s.selected)};
  if(action==='configure'){if(typeof input.enabled!=='boolean')throw Error('Invalid speech switch');s.enabled=input.enabled;}
  if(action==='select'){
   const id=input.id;if(typeof id!=='string'||typeof input.enabled!=='boolean')throw Error('Invalid speech selection');
   const task=await this.adapter.task(id);if(!task||task.archived||!['pi','codex'].includes(task.engine))throw Error('Select an active Pi or Codex conversation');
   s.selected[id]={enabled:input.enabled,profileVersion:s.selected[id]?.profileVersion??PROFILE_VERSION};
  }
  if(action==='designate'){if(typeof input.browserId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(input.browserId))throw Error('Invalid speech browser');s.browserId=input.browserId;}
  if(action==='pending'||action==='claim'){
   if(typeof input.browserId!=='string'||!s.enabled||s.browserId!==input.browserId)return action==='claim'?{claimed:false}:{items:[]};
   const items: Array<SpeechBrief&{title:string;text:string}>=[];
   for(const brief of Object.values(s.completions)){
    const task=await this.adapter.task(brief.id);
    if(!task||task.archived||!s.selected[brief.id]?.enabled||task.runStatus!=='settled'||task.completionId!==brief.completionId||task.readCompletionId===brief.completionId||s.attempts[brief.id]===brief.completionId||this.now()-Date.parse(brief.completedAt)>300000)continue;
    const text=task.title+'。'+(brief.summary??(brief.outcome==='failure'?'任务出现错误，请查看对话。':'本轮已结束，请查看对话确认结果。'));
    items.push({...brief,title:task.title,text});
   }
   if(action==='pending')return {items:items.sort((a,b)=>a.completedAt.localeCompare(b.completedAt)).slice(-10)};
   const item=items.find(v=>v.id===input.id&&v.completionId===input.completionId);if(!item)return {claimed:false};
   s.attempts[item.id]=item.completionId;await this.adapter.save(s);return {claimed:true,item};
  }
  await this.adapter.save(s);return {pluginVersion:PLUGIN_VERSION,enabled:s.enabled,browserId:s.browserId,selected:structuredClone(s.selected)};
 });}
 async prepare(id:string):Promise<{profileVersion:string;instructions:string}|undefined>{await this.tail;const s=await this.loaded(),task=await this.adapter.task(id),selection=s.selected[id];if(!s.enabled||!selection?.enabled||!task||task.archived||!['pi','codex'].includes(task.engine)||selection.profileVersion!==PROFILE_VERSION)return;return {profileVersion:selection.profileVersion,instructions:SPEECH_PROFILE};}
 async settled(id:string,profileVersion:string,text:string,failure:boolean){return this.serial(async()=>{
  const s=await this.loaded(),task=await this.adapter.task(id);if(!task||task.archived||task.runStatus!=='settled'||!task.completionId||!task.completedAt)return;
  s.completions[id]={id,completionId:task.completionId,profileVersion,completedAt:task.completedAt,outcome:failure?'failure':'result',...(parseBrief(text,profileVersion)?{summary:parseBrief(text,profileVersion)!.summary}:{})};
  const entries=Object.values(s.completions).sort((a,b)=>b.completedAt.localeCompare(a.completedAt));s.completions=Object.fromEntries(entries.filter(v=>this.now()-Date.parse(v.completedAt)<=86400000).slice(0,100).map(v=>[v.id,v]));await this.adapter.save(s);
 });}
}

/** Capture only live assistant final messages belonging to the explicitly submitted turn. */
export class SpeechTurnCapture {
 private turns=new Map<string,{version:string;text:string;failure:boolean;waiting:boolean}>();
 constructor(readonly policy:CompletionSpeech){}
 async prepare(id:string){const choice=await this.policy.prepare(id);this.turns.delete(id);if(choice)this.turns.set(id,{version:choice.profileVersion,text:'',failure:false,waiting:false});return choice?.instructions;}
 event(id:string,event:unknown):(()=>Promise<void>)|undefined {
  const run=this.turns.get(id);if(!run||!event||typeof event!=='object'||Array.isArray(event))return;
  const value=event as Record<string,any>;
  if(['extension_ui_request','native_request'].includes(value.type)&&['select','confirm','input','editor'].includes(value.method))run.waiting=true;
  if(value.type==='message_end'&&value.message?.role==='assistant'){
   const content=value.message.content;
   run.text=typeof value.text==='string'?value.text:typeof content==='string'?content:Array.isArray(content)?content.filter((p:Record<string,unknown>)=>p.type==='text'&&typeof p.text==='string').map((p:Record<string,unknown>)=>p.text).join(''):'';
   run.waiting=false;run.text=run.text.slice(-32000);run.failure=value.message.stopReason==='error'||Boolean(value.message.errorMessage);
  }
  if(['agent_interrupted','run_interrupted'].includes(value.type)){this.turns.delete(id);return;}
  if(['agent_settled','run_completed'].includes(value.type)){
   this.turns.delete(id);if(value.aborted===true||run.waiting)return;
   return ()=>this.policy.settled(id,run.version,run.text,run.failure);
  }
 }
}
