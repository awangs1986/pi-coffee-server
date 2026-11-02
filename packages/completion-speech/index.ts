import {PROFILE_VERSION,SPEECH_PROFILE,resolveSpeechProfile} from './profile.js';
export {PROFILE_VERSION,SPEECH_PROFILE};
export const PLUGIN_VERSION='0.1.2';
export interface SpeechSelection {enabled:boolean;profileVersion:string;}
export interface SpeechBrief {id:string;completionId:string;profileVersion:string;summary?:string;completedAt:string;outcome:'result'|'failure';}
export interface SpeechProjection {sourceMessageKey?:string;completionId:string;profileVersion:string;summary?:string;status?:'awaiting_user';answerDigest:string;completedAt:string;}
export interface SpeechState {version?:2;ownerEpoch?:number;deliveries?:Record<string,SpeechDelivery>;diagnostics?:SpeechReceipt[];operations?:SpeechOperation[];projections?:Record<string,SpeechProjection[]>;enabled:boolean;browserId:string|null;voiceURI?:string;selected:Record<string,SpeechSelection>;completions:Record<string,SpeechBrief>;attempts:Record<string,string>;active?:{id:string;completionId:string;browserId:string;startedAt:number;replay?:boolean;pageId?:string;ownerEpoch?:number;deliveryId?:string};}
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
export type DeliveryPhase='pending'|'reserved'|'committed'|'played'|'uncertain'|'blocked'|'skipped';
export interface SpeechReservation {token:string;browserId:string;pageId:string;ownerEpoch:number;operationId:string;expiresAt:number;}
export interface SpeechDelivery extends SpeechBrief {state:DeliveryPhase;reason?:string;reservation?:SpeechReservation;}
export interface SpeechReceipt {id:string;completionId:string;state:DeliveryPhase;reason?:string;at:number;}
export interface SpeechOperation {id:string;fingerprint:string;at:number;}
export const SPEECH_PROTOCOL=2;
export class SpeechRequestError extends Error {
 constructor(readonly code:string,message:string,readonly status=409){super(message);}
}
/** Owns only authorized IDs supplied by its adapter; never discovers native accounts. */
export class CompletionSpeech {
 private state?:SpeechState;private tail:Promise<unknown>=Promise.resolve();
 constructor(private adapter:SpeechAdapter){}
 private now(){return this.adapter.now?.()??Date.now();}
 private async loaded(){
  if(!this.state){
   const s=structuredClone(await this.adapter.load()??{enabled:false,browserId:null,selected:{},completions:{},attempts:{}});
   if(s.version&&s.version!==2)throw new SpeechRequestError('protocol_mismatch','播报存储版本不可用，请更新组件');
   s.version=2;s.ownerEpoch??=0;s.deliveries??={};s.diagnostics??=[];s.operations??=[];
   for(const brief of Object.values(s.completions))if(!s.deliveries[brief.id]){const d:SpeechDelivery={...brief,state:'pending'};s.deliveries[brief.id]=d;if(s.attempts[brief.id]===brief.completionId)this.terminal(s,d,'uncertain','legacy-consumed');}
   for(const d of Object.values(s.deliveries)){
    if(d.state==='reserved'){d.state='pending';delete d.reservation;}
    if(d.state==='committed')this.terminal(s,d,'uncertain','host-restart');
   }
   if(s.active){const d=s.deliveries[s.active.id];if(d?.completionId===s.active.completionId)this.terminal(s,d,'uncertain','host-restart');delete s.active;}
   await this.eligible(s);await this.adapter.save(s);this.state=s;
  }return this.state;
 }
 private async persist(s:SpeechState){this.prunePresentation(s);await this.adapter.save(s);this.state=s;}
 private terminal(s:SpeechState,d:SpeechDelivery,state:DeliveryPhase,reason?:string){
  if(d.state===state&&d.reason===reason)return;
  d.state=state;d.reason=reason;delete d.reservation;s.attempts[d.id]=d.completionId;
  if(s.active?.id===d.id&&s.active.completionId===d.completionId)delete s.active;
  (s.diagnostics??=[]).push({id:d.id,completionId:d.completionId,state,...(reason?{reason}:{}),at:this.now()});
 }
 private prunePresentation(s:SpeechState){
  const cached=Object.entries(s.projections??{}).flatMap(([key,values])=>values.map(value=>({key,value}))).filter(({value})=>Number.isFinite(Date.parse(value.completedAt))&&this.now()-Date.parse(value.completedAt)<=86400000).sort((a,b)=>b.value.completedAt.localeCompare(a.value.completedAt)).slice(0,100);
  s.projections={};const retained=new Set<string>();for(const {key,value} of cached){(s.projections[key]??=[]).push(value);retained.add(JSON.stringify([key,value.completionId]));}
  if(this.adapter.digest)for(const brief of Object.values(s.completions))if(brief.summary&&!retained.has(JSON.stringify([brief.id,brief.completionId])))delete brief.summary;
  s.diagnostics=(s.diagnostics??[]).filter(v=>this.now()-v.at<=86400000).slice(-100);
  s.operations=(s.operations??[]).filter(v=>this.now()-v.at<=86400000).slice(-100);
  let retainedBriefs=0;
  for(const b of Object.values(s.completions).sort((a,b)=>b.completedAt.localeCompare(a.completedAt)))if(b.summary&&(this.now()-Date.parse(b.completedAt)>86400000||retainedBriefs++>=100))delete b.summary;
  for(const d of Object.values(s.deliveries??{}))if(!['pending','reserved','committed'].includes(d.state)&&(!s.completions[d.id]?.summary||this.now()-Date.parse(d.completedAt)>86400000))delete d.summary;
 }
 private item(brief:SpeechBrief,title:string){const {id,completionId,profileVersion,summary,completedAt,outcome}=brief;return {id,completionId,profileVersion,summary,completedAt,outcome,title,text:title+'。'+(brief.summary??(brief.outcome==='failure'?'任务出现错误，请查看对话。':'本轮已结束，请查看对话确认结果。'))};}
 private selections(s:SpeechState){return Object.fromEntries(Object.entries(s.selected).map(([id,choice])=>[id,{...choice,...(!resolveSpeechProfile(choice.profileVersion)?{profileStatus:'unsupported' as const}:{})}]));}
 private statusOf(s:SpeechState){return {protocolVersion:SPEECH_PROTOCOL,pluginVersion:PLUGIN_VERSION,ownerEpoch:s.ownerEpoch,enabled:s.enabled,browserId:s.browserId,voiceURI:s.voiceURI??'',selected:this.selections(s)};}
 private serial<T>(run:()=>Promise<T>):Promise<T>{const next=this.tail.then(run);this.tail=next.catch(()=>undefined);return next;}
 async status(){return this.serial(async()=>this.statusOf(await this.loaded()));}
 private identifier(value:unknown){return typeof value==='string'&&value.length>0&&value.length<=256&&!/[\u0000-\u001f]/.test(value);}
 private operation(s:SpeechState,input:Record<string,unknown>){
  if(!this.identifier(input.operationId))throw new SpeechRequestError('invalid_request','无效的播报操作身份');
  const fingerprint=JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b))));
  const old=s.operations?.find(v=>v.id===input.operationId);
  if(old&&old.fingerprint!==fingerprint)throw new SpeechRequestError('operation_conflict','播报操作身份不能复用为其他内容');
  if(!old)(s.operations??=[]).push({id:input.operationId as string,fingerprint,at:this.now()});
  return Boolean(old);
 }
 private async eligible(s:SpeechState){
  const items:Array<SpeechBrief&{title:string;text:string}>=[];
  for(const d of Object.values(s.deliveries??{})){
   const task=await this.adapter.task(d.id);
   if(!task){delete s.deliveries![d.id];delete s.completions[d.id];delete s.attempts[d.id];delete s.selected[d.id];if(s.projections)delete s.projections[d.id];if(s.active?.id===d.id)delete s.active;s.diagnostics=s.diagnostics?.filter(v=>v.id!==d.id);continue;}
   const live=['pending','reserved','committed'].includes(d.state),age=this.now()-Date.parse(d.completedAt);
   const reason=!s.enabled?'disabled':task.archived?'archived':!s.selected[d.id]?.enabled?'deselected':task.completionId!==d.completionId?'superseded':!Number.isFinite(age)||age<0||age>86400000?'expired':undefined;
   if(live&&reason)this.terminal(s,d,'skipped',reason);
   if(d.state==='reserved'&&(!d.reservation||d.reservation.expiresAt<=this.now()||d.reservation.ownerEpoch!==s.ownerEpoch)){d.state='pending';delete d.reservation;}
   if(d.state==='committed'&&s.active?.id===d.id&&(this.now()-s.active.startedAt>60000||task.runStatus!=='settled'))this.terminal(s,d,'uncertain','playback-ended-without-receipt');
   if(['pending','reserved'].includes(d.state)&&!reason&&task.runStatus==='settled')items.push(this.item(d,task.title));
  }
  items.sort((a,b)=>a.completedAt.localeCompare(b.completedAt)||a.id.localeCompare(b.id));
  for(const dropped of items.splice(0,Math.max(0,items.length-10)))this.terminal(s,s.deliveries![dropped.id],'skipped','overflow');
  if(s.active?.replay){const task=await this.adapter.task(s.active.id);if(!s.enabled||!task||task.archived||s.active.ownerEpoch!==s.ownerEpoch||this.now()-s.active.startedAt>60000)delete s.active;}
  this.prunePresentation(s);return items;
 }
 async handle(input:Record<string,unknown>){return this.serial(async()=>{
  const s=structuredClone(await this.loaded()),action=input.action;
  const fields:Record<string,string[]>={status:[],summaries:['id'],configure:['enabled'],select:['id','enabled'],voice:['voiceURI'],designate:['browserId'],pending:['browserId','pageId'],reserve:['browserId','pageId','id','completionId','operationId'],commit:['browserId','pageId','id','completionId','operationId','token','ownerEpoch'],release:['browserId','pageId','id','completionId','operationId','token','ownerEpoch'],finish:['browserId','pageId','id','completionId','operationId','deliveryId','outcome'],replay:['browserId','pageId','id','completionId','operationId']};
  if(typeof action!=='string'||!fields[action]||Object.keys(input).some(k=>!['action','protocol',...fields[action]].includes(k)))throw new SpeechRequestError('invalid_request','无效的播报请求');
  if(input.protocol!==undefined&&input.protocol!==2)throw new SpeechRequestError('protocol_mismatch','播报组件已更新，请更新页面');
  if(action==='status')return this.statusOf(s);
  if(action==='summaries'){if(typeof input.id!=='string'||!await this.adapter.task(input.id))throw new SpeechRequestError('unavailable','对话不可用');await this.eligible(s);await this.persist(s);return {items:structuredClone(s.projections?.[input.id]??[])};}
  if(action==='configure'){
   if(typeof input.enabled!=='boolean')throw new SpeechRequestError('invalid_request','无效的播报开关');s.enabled=input.enabled;
   if(!s.enabled){for(const d of Object.values(s.deliveries??{}))if(['pending','reserved','committed'].includes(d.state))this.terminal(s,d,'skipped','disabled');delete s.active;}
  }
  if(action==='select'){
   const id=input.id;if(typeof id!=='string'||typeof input.enabled!=='boolean')throw new SpeechRequestError('invalid_request','无效的播报选择');
   const task=await this.adapter.task(id);if(!task||task.archived||!['pi','codex'].includes(task.engine))throw new SpeechRequestError('unavailable','请选择有效的 Pi 或 Codex 对话');
   s.selected[id]={enabled:input.enabled,profileVersion:s.selected[id]?.profileVersion??PROFILE_VERSION};if(!input.enabled&&s.deliveries?.[id])this.terminal(s,s.deliveries[id],'skipped','deselected');if(!input.enabled&&s.active?.id===id)delete s.active;
  }
  if(action==='voice'){if(typeof input.voiceURI!=='string'||input.voiceURI.length>256||/[\u0000-\u001f]/.test(input.voiceURI))throw new SpeechRequestError('invalid_request','无效的系统声音');s.voiceURI=input.voiceURI;}
  if(action==='designate'){
   if(typeof input.browserId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(input.browserId))throw new SpeechRequestError('invalid_request','无效的播放浏览器');
   s.browserId=input.browserId;s.ownerEpoch=(s.ownerEpoch??0)+1;
   for(const d of Object.values(s.deliveries??{})){if(d.state==='reserved'){d.state='pending';delete d.reservation;}if(d.state==='committed')this.terminal(s,d,'uncertain','browser-takeover');}delete s.active;
  }
  const items=await this.eligible(s);
  if(['pending','reserve','commit','release','finish','replay'].includes(action)){
   if(!this.identifier(input.browserId)||!this.identifier(input.pageId))throw new SpeechRequestError('invalid_request','无效的播放页面身份');
   const owner=s.enabled&&s.browserId===input.browserId;
   if(action==='pending'){
    await this.persist(s);if(!owner)return {items:[]};
    const reservation=Object.values(s.deliveries??{}).find(d=>d.state==='reserved'&&d.reservation&&d.reservation.browserId===input.browserId&&d.reservation.pageId===input.pageId);
    return {items,...(s.active?{active:s.active}:{}),...(reservation?{reservation:{id:reservation.id,completionId:reservation.completionId,...reservation.reservation}}:{}),...(s.diagnostics?.length?{diagnostics:structuredClone(s.diagnostics)}:{})};
   }
   if(!owner){await this.persist(s);return action==='commit'?{committed:false}:action==='reserve'?{reserved:false}:action==='release'?{released:false}:action==='finish'?{finished:false}:{claimed:false};}
   if(!this.identifier(input.id)||!this.identifier(input.completionId))throw new SpeechRequestError('invalid_request','无效的结果身份');
   const repeated=this.operation(s,input),d=s.deliveries?.[input.id as string],item=items.find(v=>v.id===input.id&&v.completionId===input.completionId);
   if(action==='reserve'){
    const existing=d?.reservation;
    if(d?.state==='reserved'&&existing&&existing.operationId===input.operationId&&existing.browserId===input.browserId&&existing.pageId===input.pageId){await this.persist(s);return {reserved:true,reservation:existing};}
    if(!item||s.active||Object.values(s.deliveries??{}).some(v=>v.state==='reserved')){await this.persist(s);return {reserved:false};}
    d!.state='reserved';d!.reservation={token:crypto.randomUUID(),browserId:input.browserId as string,pageId:input.pageId as string,ownerEpoch:s.ownerEpoch??0,operationId:input.operationId as string,expiresAt:this.now()+30000};
    await this.persist(s);return {reserved:true,reservation:d!.reservation};
   }
   if(action==='commit'||action==='release'){
    const r=d?.reservation,valid=d?.state==='reserved'&&r&&r.token===input.token&&r.browserId===input.browserId&&r.pageId===input.pageId&&r.ownerEpoch===input.ownerEpoch;
    if(action==='release'){if(valid){d!.state='pending';delete d!.reservation;}await this.persist(s);return {released:Boolean(valid)};}
    if(!valid||!item||s.active||repeated){await this.persist(s);return {committed:false,state:d?.state};}
    d!.state='committed';delete d!.reservation;s.attempts[item.id]=item.completionId;
    const deliveryId=crypto.randomUUID();s.active={id:item.id,completionId:item.completionId,browserId:input.browserId as string,pageId:input.pageId as string,ownerEpoch:s.ownerEpoch,startedAt:this.now(),deliveryId};
    await this.persist(s);return {committed:true,deliveryId,item,ownerEpoch:s.ownerEpoch};
   }
   if(action==='finish'){
    if(!['played','uncertain','blocked'].includes(String(input.outcome)))throw new SpeechRequestError('invalid_request','无效的播放回执');
    const active=s.active,valid=active&&active.deliveryId===input.deliveryId&&active.id===input.id&&active.completionId===input.completionId&&active.browserId===input.browserId&&active.pageId===input.pageId;
    if(valid){if(!active.replay&&d&&d.completionId===input.completionId)this.terminal(s,d,input.outcome as DeliveryPhase,input.outcome==='played'?undefined:'browser-'+input.outcome);else (s.diagnostics??=[]).push({id:input.id as string,completionId:input.completionId as string,state:input.outcome as DeliveryPhase,at:this.now()});delete s.active;}
    await this.persist(s);return {finished:true};
   }
   if(action==='replay'){
    const latest=s.completions[input.id as string],brief=d?.completionId===input.completionId?d:latest?.completionId===input.completionId?latest:s.projections?.[input.id as string]?.find(v=>v.completionId===input.completionId),task=await this.adapter.task(input.id as string);
    if(repeated||s.active||Object.values(s.deliveries??{}).some(v=>v.state==='reserved')||!brief||('status' in brief&&brief.status==='awaiting_user')||!task||task.archived||this.now()-Date.parse(brief.completedAt)>86400000){await this.persist(s);return {claimed:false};}
    if(d&&d.completionId===input.completionId)this.terminal(s,d,'uncertain','explicit-replay');
    const deliveryId=crypto.randomUUID();s.active={id:input.id as string,completionId:input.completionId as string,browserId:input.browserId as string,pageId:input.pageId as string,ownerEpoch:s.ownerEpoch,startedAt:this.now(),deliveryId,replay:true};
    await this.persist(s);return {claimed:true,deliveryId,ownerEpoch:s.ownerEpoch,item:this.item({...brief,id:input.id as string,outcome:'outcome' in brief?brief.outcome:'result'},task.title)};
   }
  }
  await this.persist(s);return this.statusOf(s);
 });}
 async prepare(id:string):Promise<{profileVersion:string;instructions:string}|undefined>{return this.serial(async()=>{const s=await this.loaded(),selection=s.selected[id];if(!s.enabled||!selection?.enabled)return;const task=await this.adapter.task(id);if(!task||task.archived||!['pi','codex'].includes(task.engine))return;const instructions=resolveSpeechProfile(selection.profileVersion);if(!instructions)return;return {profileVersion:selection.profileVersion,instructions};});}
 async settled(id:string,profileVersion:string,text:string,failure:boolean,admit:()=>boolean=()=>true,sourceMessageKey?:string){return this.serial(async()=>{
  const s=structuredClone(await this.loaded()),task=await this.adapter.task(id);if(!resolveSpeechProfile(profileVersion)||!admit()||!task||task.archived||task.runStatus!=='settled'||!task.completionId||!task.completedAt)return;
  if(s.deliveries?.[id]?.completionId===task.completionId||s.attempts[id]===task.completionId)return;
  const envelope=parseSpeechEnvelope(text,profileVersion),brief=envelope?.kind==='summary'?envelope:undefined;
  if(envelope&&this.adapter.digest){const answerDigest=await this.adapter.digest(text);s.projections??={};s.projections[id]=[...(s.projections[id]??[]).filter(v=>v.completionId!==task.completionId),{completionId:task.completionId,profileVersion,...(sourceMessageKey?{sourceMessageKey}:{}),...(brief?{summary:brief.summary}:{status:'awaiting_user' as const}),answerDigest,completedAt:task.completedAt}];}
  if(envelope?.kind==='awaiting_user'){delete s.completions[id];delete s.deliveries?.[id];if(s.active?.id===id)delete s.active;s.attempts[id]=task.completionId;this.prunePresentation(s);if(!admit())return;await this.persist(s);return;}
  if(s.deliveries?.[id]&&['pending','reserved','committed'].includes(s.deliveries[id].state))this.terminal(s,s.deliveries[id],'skipped','superseded');
  s.completions[id]={id,completionId:task.completionId,profileVersion,completedAt:task.completedAt,outcome:failure?'failure':'result',...(brief?{summary:brief.summary}:{})};
  s.deliveries??={};s.deliveries[id]={...s.completions[id],state:'pending'};
  await this.eligible(s);if(!admit())return;await this.persist(s);
 });}
}

/** Capture only live assistant final messages belonging to the explicitly submitted turn. */
export class SpeechTurnCapture {
 private turns=new Map<string,{version:string;text:string;failure:boolean;waiting:boolean;sourceMessageKey?:string}>();
 private generations=new Map<string,number>();
 constructor(readonly policy:CompletionSpeech){}
 async prepare(id:string){const generation=(this.generations.get(id)??0)+1;this.generations.set(id,generation);this.turns.delete(id);const choice=await this.policy.prepare(id);if(this.generations.get(id)!==generation)return;if(choice)this.turns.set(id,{version:choice.profileVersion,text:'',failure:false,waiting:false});return choice?.instructions;}
 event(id:string,event:unknown):(()=>Promise<void>)|undefined {
  const run=this.turns.get(id);if(!run||!event||typeof event!=='object'||Array.isArray(event))return;
  const value=event as Record<string,any>;
  if(['extension_ui_request','native_request'].includes(value.type)&&['select','confirm','input','editor'].includes(value.method))run.waiting=true;
  if(value.type==='message_end'&&value.message?.role==='assistant'){
   const content=value.message.content;
   run.sourceMessageKey=typeof value.message.timestamp==='number'&&Number.isSafeInteger(value.message.timestamp)?'pi-message:'+value.message.timestamp:typeof value.id==='string'&&value.id.length>0&&value.id.length<=1024?'native-message:'+value.id:undefined;
   run.text=typeof value.text==='string'?value.text:typeof content==='string'?content:Array.isArray(content)?content.filter((p:Record<string,unknown>)=>p.type==='text'&&typeof p.text==='string').map((p:Record<string,unknown>)=>p.text).join('\n'):'';
   run.waiting=false;run.failure=value.message.stopReason==='error'||Boolean(value.message.errorMessage);
  }
  if(['agent_interrupted','run_interrupted'].includes(value.type)){this.turns.delete(id);return;}
  if(['agent_settled','run_completed'].includes(value.type)){
   this.turns.delete(id);if(value.aborted===true||run.waiting)return;
   const generation=this.generations.get(id);return ()=>this.policy.settled(id,run.version,run.text,run.failure,()=>this.generations.get(id)===generation,run.sourceMessageKey);
  }
 }
}
