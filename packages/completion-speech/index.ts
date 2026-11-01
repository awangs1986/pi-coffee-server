import {PROFILE_VERSION,SPEECH_PROFILE,resolveSpeechProfile} from './profile.js';
export {PROFILE_VERSION,SPEECH_PROFILE};
export const PLUGIN_VERSION='0.1.0';
export interface SpeechSelection {enabled:boolean;profileVersion:string;}
export interface SpeechBrief {id:string;completionId:string;profileVersion:string;summary?:string;completedAt:string;outcome:'result'|'failure';}
export interface SpeechProjection {completionId:string;profileVersion:string;summary?:string;status?:'awaiting_user';answerDigest:string;completedAt:string;}
export interface SpeechState {projections?:Record<string,SpeechProjection[]>;enabled:boolean;browserId:string|null;voiceURI?:string;selected:Record<string,SpeechSelection>;completions:Record<string,SpeechBrief>;attempts:Record<string,string>;active?:{id:string;completionId:string;browserId:string;startedAt:number;replay?:boolean};}
export interface SpeechTask {id:string;title:string;engine:string;archived?:boolean;completionId?:string;completedAt?:string;readCompletionId?:string;runStatus?:string;}
export interface SpeechAdapter {load():Promise<SpeechState|undefined>;save(state:SpeechState):Promise<void>;task(id:string):Promise<SpeechTask|undefined>;now?():number;digest?(text:string):Promise<string>;}
export type SpeechEnvelope={kind:'summary';summary:string;fullText:string}|{kind:'awaiting_user';fullText:string};
export function parseSpeechEnvelope(text:string,version=PROFILE_VERSION):SpeechEnvelope|undefined {
 const matches=[...text.matchAll(/^```coffee-speech\s*\n([\s\S]*?)\n```\s*$/gm)];
 if(matches.length!==1)return;
 const match=matches[0];if(text.slice(match.index!+match[0].length).trim())return;
 try{const data=JSON.parse(match[1]);if(!data||data.profile_version!==version)return;const fullText=text.slice(0,match.index).trimEnd();
  if(Object.keys(data).sort().join(',')==='profile_version,status'&&data.status==='awaiting_user')return {kind:'awaiting_user',fullText};
  if(Object.keys(data).sort().join(',')!=='profile_version,summary'||typeof data.summary!=='string'||!data.summary.trim()||data.summary.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.summary))return;
  return {kind:'summary',summary:data.summary.trim(),fullText};
 }catch{return;}
}
export function parseBrief(text:string,version=PROFILE_VERSION):{summary:string;fullText:string}|undefined {const envelope=parseSpeechEnvelope(text,version);return envelope?.kind==='summary'?{summary:envelope.summary,fullText:envelope.fullText}:undefined;}
/** Owns only authorized IDs supplied by its adapter; never discovers native accounts. */
export class CompletionSpeech {
 private state?:SpeechState;private tail:Promise<unknown>=Promise.resolve();
 constructor(private adapter:SpeechAdapter){}
 private now(){return this.adapter.now?.()??Date.now();}
 private async loaded(){
  if(!this.state){this.state=await this.adapter.load()??{enabled:false,browserId:null,selected:{},completions:{},attempts:{}};
   // An attempted delivery is durable. Its uncertain audio is never replayed on restart.
   delete this.state.active;
  }return this.state;
 }
 private prunePresentation(s:SpeechState){
  const cached=Object.entries(s.projections??{}).flatMap(([key,values])=>values.map(value=>({key,value}))).filter(({value})=>Number.isFinite(Date.parse(value.completedAt))&&this.now()-Date.parse(value.completedAt)<=86400000).sort((a,b)=>b.value.completedAt.localeCompare(a.value.completedAt)).slice(0,100);
  s.projections={};const retained=new Set<string>();for(const {key,value} of cached){(s.projections[key]??=[]).push(value);retained.add(JSON.stringify([key,value.completionId]));}
  if(this.adapter.digest)for(const brief of Object.values(s.completions))if(brief.summary&&!retained.has(JSON.stringify([brief.id,brief.completionId])))delete brief.summary;
 }
 private async eligible(s:SpeechState){
  const items:Array<SpeechBrief&{title:string;text:string}>=[];
  for(const brief of Object.values(s.completions)){
   const task=await this.adapter.task(brief.id);
   if(!task){delete s.completions[brief.id];delete s.attempts[brief.id];delete s.selected[brief.id];if(s.projections)delete s.projections[brief.id];continue;}
   const age=this.now()-Date.parse(brief.completedAt);
   if(task.archived||!s.selected[brief.id]?.enabled||task.readCompletionId===brief.completionId||task.completionId!==brief.completionId)s.attempts[brief.id]=brief.completionId;
   if(!s.enabled||task.archived||!s.selected[brief.id]?.enabled||task.runStatus!=='settled'||task.completionId!==brief.completionId||task.readCompletionId===brief.completionId||s.attempts[brief.id]===brief.completionId||!Number.isFinite(age)||age<0||age>300000)continue;
   items.push({...brief,title:task.title,text:task.title+'。'+(brief.summary??(brief.outcome==='failure'?'任务出现错误，请查看对话。':'本轮已结束，请查看对话确认结果。'))});
  }
  items.sort((a,b)=>a.completedAt.localeCompare(b.completedAt));
  for(const dropped of items.splice(0,Math.max(0,items.length-10)))s.attempts[dropped.id]=dropped.completionId;
  if(s.active){const t=await this.adapter.task(s.active.id);if(!s.enabled||s.browserId!==s.active.browserId||!t||t.archived||(!s.active.replay&&(!s.selected[s.active.id]?.enabled||t.runStatus!=='settled'||t.completionId!==s.active.completionId||t.readCompletionId===s.active.completionId))||this.now()-s.active.startedAt>60000)delete s.active;}
  // Reclaim only brief text. Durable delivery identities are not cache entries.
  let count=0;for(const brief of Object.values(s.completions).sort((a,b)=>b.completedAt.localeCompare(a.completedAt))){if(brief.summary&&(this.now()-Date.parse(brief.completedAt)>86400000||count++>=100))delete brief.summary;}
  this.prunePresentation(s);return items;
 }

 private selections(s:SpeechState){return Object.fromEntries(Object.entries(s.selected).map(([id,choice])=>[id,{...choice,...(!resolveSpeechProfile(choice.profileVersion)?{profileStatus:'unsupported' as const}:{})}]));}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const next=this.tail.then(run);this.tail=next.catch(()=>undefined);return next;}
 async status(){await this.tail;const s=await this.loaded();return {pluginVersion:PLUGIN_VERSION,enabled:s.enabled,browserId:s.browserId,voiceURI:s.voiceURI??'',selected:this.selections(s)};}
 async handle(input:Record<string,unknown>){return this.serial(async()=>{
  const s=await this.loaded(),action=input.action;
  const allowed:Record<string,string[]>={summaries:['action','id'],status:['action'],configure:['action','enabled'],select:['action','id','enabled'],designate:['action','browserId'],pending:['action','browserId'],claim:['action','browserId','id','completionId'],finish:['action','browserId','id','completionId'],voice:['action','voiceURI'],replay:['action','browserId','id','completionId']};
  if(typeof action!=='string'||!allowed[action]||Object.keys(input).some(k=>!allowed[action].includes(k)))throw Error('Invalid speech request');
  if(action==='summaries'){if(typeof input.id!=='string'||!await this.adapter.task(input.id))throw Error('Conversation unavailable');this.prunePresentation(s);await this.adapter.save(s);return {items:structuredClone(s.projections?.[input.id]??[])};}
  if(action==='status')return {pluginVersion:PLUGIN_VERSION,enabled:s.enabled,browserId:s.browserId,voiceURI:s.voiceURI??'',selected:this.selections(s)};
  if(action==='voice'){if(typeof input.voiceURI!=='string'||input.voiceURI.length>256||/[\u0000-\u001f]/.test(input.voiceURI))throw Error('Invalid speech voice');s.voiceURI=input.voiceURI;}
  if(action==='replay'){
   if(typeof input.id!=='string'||typeof input.completionId!=='string'||typeof input.browserId!=='string')throw Error('Invalid replay request');
   await this.eligible(s);this.prunePresentation(s);const latest=s.completions[input.id],brief=latest?.completionId===input.completionId?latest:s.projections?.[input.id]?.find(v=>v.completionId===input.completionId),task=await this.adapter.task(input.id);
   if(!s.enabled||s.browserId!==input.browserId||s.active||!brief?.summary||brief.completionId!==input.completionId||!task||task.archived){await this.adapter.save(s);return {claimed:false};}
   if(latest?.completionId===brief.completionId)s.attempts[input.id]=brief.completionId;s.active={id:input.id,completionId:brief.completionId,browserId:input.browserId,startedAt:this.now(),replay:true};await this.adapter.save(s);return {claimed:true,item:{...brief,id:input.id,title:task.title,text:task.title+'。'+brief.summary}};
  }
  if(action==='configure'){if(typeof input.enabled!=='boolean')throw Error('Invalid speech switch');s.enabled=input.enabled;if(!s.enabled){for(const b of Object.values(s.completions))s.attempts[b.id]=b.completionId;delete s.active;}}
  if(action==='select'){
   const id=input.id;if(typeof id!=='string'||typeof input.enabled!=='boolean')throw Error('Invalid speech selection');
   const task=await this.adapter.task(id);if(!task||task.archived||!['pi','codex'].includes(task.engine))throw Error('Select an active Pi or Codex conversation');
   s.selected[id]={enabled:input.enabled,profileVersion:s.selected[id]?.profileVersion??PROFILE_VERSION};if(!input.enabled){if(s.completions[id])s.attempts[id]=s.completions[id].completionId;if(s.active?.id===id)delete s.active;}
  }
  if(action==='designate'){if(typeof input.browserId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(input.browserId))throw Error('Invalid speech browser');s.browserId=input.browserId;if(s.active?.browserId!==s.browserId)delete s.active;}
  if(action==='finish'){
   if(s.active&&s.active.browserId===input.browserId&&s.active.id===input.id&&s.active.completionId===input.completionId)delete s.active;
   await this.adapter.save(s);return {finished:true};
  }
  const items=await this.eligible(s);
  if(action==='pending'||action==='claim'){
   if(typeof input.browserId!=='string'||!s.enabled||s.browserId!==input.browserId){await this.adapter.save(s);return action==='claim'?{claimed:false}:{items:[]};}
   if(action==='pending'){await this.adapter.save(s);return {items,...(s.active?{active:s.active}:{})};}
   const item=items.find(v=>v.id===input.id&&v.completionId===input.completionId);if(!item||s.active){await this.adapter.save(s);return {claimed:false};}
   s.attempts[item.id]=item.completionId;s.active={id:item.id,completionId:item.completionId,browserId:input.browserId,startedAt:this.now()};await this.adapter.save(s);return {claimed:true,item};
  }

  await this.adapter.save(s);return {pluginVersion:PLUGIN_VERSION,enabled:s.enabled,browserId:s.browserId,voiceURI:s.voiceURI??'',selected:this.selections(s)};
 });}
 async prepare(id:string):Promise<{profileVersion:string;instructions:string}|undefined>{await this.tail;const s=await this.loaded(),selection=s.selected[id];if(!s.enabled||!selection?.enabled)return;const task=await this.adapter.task(id);if(!task||task.archived||!['pi','codex'].includes(task.engine))return;const instructions=resolveSpeechProfile(selection.profileVersion);if(!instructions)return;return {profileVersion:selection.profileVersion,instructions};}
 async settled(id:string,profileVersion:string,text:string,failure:boolean,admit:()=>boolean=()=>true){return this.serial(async()=>{
  const s=structuredClone(await this.loaded()),task=await this.adapter.task(id);if(!resolveSpeechProfile(profileVersion)||!admit()||!task||task.archived||task.runStatus!=='settled'||!task.completionId||!task.completedAt)return;
  const envelope=parseSpeechEnvelope(text,profileVersion),brief=envelope?.kind==='summary'?envelope:undefined;
  if(envelope&&this.adapter.digest){const answerDigest=await this.adapter.digest(text);s.projections??={};s.projections[id]=[...(s.projections[id]??[]).filter(v=>v.completionId!==task.completionId),{completionId:task.completionId,profileVersion,...(brief?{summary:brief.summary}:{status:'awaiting_user' as const}),answerDigest,completedAt:task.completedAt}];

  }
  if(envelope?.kind==='awaiting_user'){delete s.completions[id];s.attempts[id]=task.completionId;this.prunePresentation(s);if(!admit())return;this.state=s;await this.adapter.save(s);return;}
  if(!s.enabled||!s.selected[id]?.enabled)s.attempts[id]=task.completionId;
  s.completions[id]={id,completionId:task.completionId,profileVersion,completedAt:task.completedAt,outcome:failure?'failure':'result',...(brief?{summary:brief.summary}:{})};
  await this.eligible(s);if(!admit())return;this.state=s;await this.adapter.save(s);
 });}
}

/** Capture only live assistant final messages belonging to the explicitly submitted turn. */
export class SpeechTurnCapture {
 private turns=new Map<string,{version:string;text:string;failure:boolean;waiting:boolean}>();
 private generations=new Map<string,number>();
 constructor(readonly policy:CompletionSpeech){}
 async prepare(id:string){const generation=(this.generations.get(id)??0)+1;this.generations.set(id,generation);this.turns.delete(id);const choice=await this.policy.prepare(id);if(this.generations.get(id)!==generation)return;if(choice)this.turns.set(id,{version:choice.profileVersion,text:'',failure:false,waiting:false});return choice?.instructions;}
 event(id:string,event:unknown):(()=>Promise<void>)|undefined {
  const run=this.turns.get(id);if(!run||!event||typeof event!=='object'||Array.isArray(event))return;
  const value=event as Record<string,any>;
  if(['extension_ui_request','native_request'].includes(value.type)&&['select','confirm','input','editor'].includes(value.method))run.waiting=true;
  if(value.type==='message_end'&&value.message?.role==='assistant'){
   const content=value.message.content;
   run.text=typeof value.text==='string'?value.text:typeof content==='string'?content:Array.isArray(content)?content.filter((p:Record<string,unknown>)=>p.type==='text'&&typeof p.text==='string').map((p:Record<string,unknown>)=>p.text).join(''):'';
   run.waiting=false;run.failure=value.message.stopReason==='error'||Boolean(value.message.errorMessage);
  }
  if(['agent_interrupted','run_interrupted'].includes(value.type)){this.turns.delete(id);return;}
  if(['agent_settled','run_completed'].includes(value.type)){
   this.turns.delete(id);if(value.aborted===true||run.waiting)return;
   const generation=this.generations.get(id);return ()=>this.policy.settled(id,run.version,run.text,run.failure,()=>this.generations.get(id)===generation);
  }
 }
}
