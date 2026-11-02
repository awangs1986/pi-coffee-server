/** No application, native engine or MISHU imports: all effects are supplied. */
export function browserSpeech({synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance}={}){
 let settle,voiceURI='';
 return {voices:()=>synthesis?.getVoices?.()??[],setVoice:value=>{voiceURI=value??'';},available:()=>Boolean(synthesis&&Utterance),cancel(){synthesis?.cancel();settle?.();},speak:text=>new Promise((resolve,reject)=>{
  if(!synthesis||!Utterance){reject(Error('当前浏览器无法语音播报'));return;}
  settle?.();const utterance=new Utterance(text);utterance.lang=/[\u3400-\u9fff]/u.test(text)?'zh-CN':'en-US';
  const voices=synthesis.getVoices?.()??[];if(synthesis.getVoices&&!voices.length){reject(Error('系统暂未提供声音，请点击启用后重试'));return;}utterance.voice=voices.find(v=>v.voiceURI===voiceURI)||voices.find(v=>v.lang?.split('-')[0]===utterance.lang.split('-')[0])||null;
  let timer,finished=false;const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);utterance.onend=null;utterance.onerror=null;if(settle===finish)settle=undefined;error?reject(error):resolve();};settle=finish;
  utterance.onend=()=>finish();utterance.onerror=()=>finish(Error('语音未能播放，请点击启用后重试'));
  timer=setTimeout(()=>{synthesis.cancel();finish(Error('语音播放超时'));},60000);try{synthesis.speak(utterance);}catch{finish(Error('语音未能播放，请点击启用后重试'));}
 })};
}
const speechId=()=>globalThis.crypto?.randomUUID?.()??Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)+'-'+Math.random().toString(36).slice(2);
/** Bounds transport and body reads even when an underlying request ignores abort. */
export function createSpeechTransport(request){
 const inflight=new Set();let closed=false;
 function call(body){
  if(closed)return Promise.reject(Object.assign(Error('播报请求已取消'),{kind:'cancelled'}));
  return new Promise((resolve,reject)=>{
   const abort=new AbortController(),entry={deadline:Date.now()+10000,finish:null};let done=false;
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);inflight.delete(entry);error?reject(error):resolve(value);};
   entry.finish=kind=>{abort.abort();finish(Object.assign(Error(kind==='timeout'?'播报连接超时':'播报请求已取消'),{kind:kind==='timeout'?'network':'cancelled'}));};
   const timer=setTimeout(()=>entry.finish('timeout'),10000);inflight.add(entry);
   Promise.resolve().then(()=>request({protocol:2,...body},{signal:abort.signal})).then(value=>{if(Date.now()>=entry.deadline)entry.finish('timeout');else finish(null,value);},error=>finish(error));
  });
 }
 return {call,expire(){for(const entry of inflight)if(Date.now()>=entry.deadline)entry.finish('timeout');},cancel(){for(const entry of inflight)entry.finish('cancelled');},close(){closed=true;this.cancel();}};
}
export function createSpeechController({request,context,browserId,speech=browserSpeech(),onStatus=()=>{},onError=()=>{},onState=()=>{}}){
 let closed=false,polling=false,draining=false,scope=null,generation=0,pageId=speechId(),active=null,release,paused=false,failedItem=null;
 const transport=createSpeechTransport(request),call=transport.call;
 let started=false,timer,failures=0,retryUntil=0,blocked=false,wakeQueued=false;const receipts=[];
 function schedule(delay=5000){if(!started||closed||blocked)return;clearTimeout(timer);timer=setTimeout(()=>{timer=undefined;void poll();},Math.max(delay,retryUntil-Date.now()));}
 function failure(error){
  if(error.kind==='cancelled')return;
  const status=error.status;error.kind=error.kind??(error.code==='plugin_unavailable'?'unavailable':['invalid_request','operation_conflict','protocol_mismatch'].includes(error.code)?'compatibility':status===401?'authentication':status===403?'authorization':status===404?'unavailable':status===426?'compatibility':status===409?'conflict':'network');
  blocked=['authentication','authorization','unavailable','compatibility'].includes(error.kind);
  const hint=Number(error.retryAfterMs);if(Number.isFinite(hint)&&hint>0)retryUntil=Date.now()+Math.min(hint,300000);
  onError(error);onState({kind:error.kind,pending:0,retryAt:retryUntil||undefined});
  if(!blocked){const delay=[1000,2000,5000,10000,30000][Math.min(failures++,4)];schedule(error.kind==='conflict'?1000:Math.min(30000,delay+Math.floor(Math.random()*Math.min(200,delay/10))));}
 }
 function wake(){
  transport.expire();if(wakeQueued||closed)return;wakeQueued=true;
  queueMicrotask(()=>{wakeQueued=false;if(!closed){if(polling)schedule(0);else {clearTimeout(timer);timer=undefined;if(retryUntil>Date.now())schedule(retryUntil-Date.now());else if(!blocked||context()?.user!==scope)void poll();}}});
 }
 function healthy(){failures=0;retryUntil=0;blocked=false;onState({kind:paused?'audio':'ready',lastSuccess:Date.now()});}
 const identity=()=>({browserId,pageId});
 const current=(epoch,user)=>!closed&&epoch===generation&&context()?.user===user;
 function cancel(){transport.cancel();generation++;pageId=speechId();speech.cancel();release?.();release=undefined;active=null;failedItem=null;}
 async function receipt(item,outcome){const body={action:'finish',browserId,pageId:item.pageId,id:item.id,completionId:item.completionId,deliveryId:item.deliveryId,operationId:speechId(),outcome};try{await call(body);}catch(error){if(error.kind!=='cancelled'&&!closed){receipts.push(body);if(receipts.length>10)receipts.shift();failure(error);}}}
 async function play(claim,epoch,user){
  if(!claim.item||typeof claim.item.text!=='string'||typeof claim.deliveryId!=='string'||!Number.isSafeInteger(claim.ownerEpoch))throw Object.assign(Error('播报许可响应无效'),{kind:'compatibility'});
  const item={...claim.item,deliveryId:claim.deliveryId,pageId,ownerEpoch:claim.ownerEpoch};
  if(!current(epoch,user)){if(context()?.user===user&&!closed)await receipt(item,'uncertain');return;}
  active=item;let outcome='uncertain';const cancelled=new Promise(resolve=>{release=resolve;});
  try{await Promise.race([speech.speak(item.text),cancelled]);if(current(epoch,user)&&active===item)outcome='played';}
  catch(error){if(!current(epoch,user))return;paused=true;failedItem={id:item.id,completionId:item.completionId};onError(Object.assign(error,{kind:'audio'}));outcome='blocked';}
  finally{if(active===item)active=null;release=undefined;if(context()?.user===user)await receipt(item,outcome);}
 }
 async function drain(pending,epoch,user){
  if(draining)return;draining=true;
  try{
   let items=pending.items??[],reservation=pending.reservation;
   while(items.length&&current(epoch,user)&&!paused){
    const item=items[0];let held=reservation?.id===item.id&&reservation.completionId===item.completionId?reservation:null;
    if(!held){const r=await call({action:'reserve',...identity(),id:item.id,completionId:item.completionId,operationId:speechId()});if(!current(epoch,user))break;if(!r.reserved)break;held=r.reservation;}
    const claim=await call({action:'commit',...identity(),id:item.id,completionId:item.completionId,token:held.token,ownerEpoch:held.ownerEpoch,operationId:speechId()});
    if(!claim.committed)break;healthy();
    await play(claim,epoch,user);if(!current(epoch,user)||paused)break;
    pending=await call({action:'pending',...identity()});items=pending.items??[];reservation=pending.reservation;
   }
  }catch(error){if(current(epoch,user))failure(error);}finally{draining=false;}
 }
 async function poll(){
  if(closed)return;const user=context()?.user;
  if(user!==scope){cancel();receipts.length=0;paused=false;blocked=false;failures=0;retryUntil=0;scope=user;}
  if(!user||polling||blocked)return;if(retryUntil>Date.now()){schedule(retryUntil-Date.now());return;}polling=true;const epoch=generation;let work;
  try{
   if(receipts.length){await call(receipts[0]);receipts.shift();if(!current(epoch,user))return;}
   const status=await call({action:'status'});if(!current(epoch,user))return;
   if(status.protocolVersion!==2)throw Object.assign(Error('播报组件版本不兼容，请更新页面'),{kind:'compatibility'});
   speech.setVoice?.(status.voiceURI);onStatus(status);
   if(!status.enabled||status.browserId!==browserId){healthy();cancel();return;}
   const pending=await call({action:'pending',...identity()});if(!current(epoch,user))return;
   onState({kind:paused?'audio':pending.active&&!active?'uncertain':[...new Map((pending.diagnostics??[]).map(d=>[JSON.stringify([d.id,d.completionId]),d])).values()].some(d=>d.state==='uncertain')?'uncertain':'ready',pending:pending.items?.length??0,diagnostics:pending.diagnostics??[]});
   if(!Array.isArray(pending.items))throw Object.assign(Error('播报响应无效'),{kind:'compatibility'});
   if(!pending.items.length||pending.active||paused){failures=0;retryUntil=0;blocked=false;}
   if(active&&(!pending.active||pending.active.deliveryId!==active.deliveryId||pending.active.ownerEpoch!==active.ownerEpoch)){cancel();return;}
   if(pending.active&&!active&&!draining&&pending.active.browserId===browserId&&pending.active.pageId===pageId){await receipt(pending.active,'uncertain');return;}
   if(!draining&&!paused&&!pending.active)work=drain(pending,epoch,user);
  }catch(error){if(current(epoch,user))failure(error);}finally{polling=false;if(started&&timer===undefined&&!blocked)schedule();}
  await work;
 }
 async function replay(id,completionId){
  if(closed||draining)return false;const user=context()?.user;if(!user)return false;
  if(user!==scope){cancel();scope=user;}const epoch=generation;
  const claim=await call({action:'replay',...identity(),id,completionId,operationId:speechId()});if(!claim.claimed)return false;
  paused=false;failedItem=null;draining=true;
  try{await play(claim,epoch,user);return true;}finally{draining=false;}
 }
 return {poll,wake,resetScope(){cancel();scope=null;receipts.length=0;blocked=false;paused=false;failures=0;retryUntil=0;},suspend(){started=false;clearTimeout(timer);timer=undefined;cancel();},start(){if(started||closed)return;started=true;schedule(0);},cancel,revoke(id){if(active?.id===id)cancel();},pause(){paused=true;cancel();},replay,retry(){blocked=false;retryUntil=0;failures=0;paused=false;const item=failedItem;failedItem=null;return item?replay(item.id,item.completionId):poll();},close(){closed=true;clearTimeout(timer);cancel();receipts.length=0;transport.close();}};
}
