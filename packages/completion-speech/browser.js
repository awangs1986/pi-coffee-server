/** No application, native engine or MISHU imports: all effects are supplied. */
export function browserSpeech({synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance}={}){
 let settle;
 return {available:()=>Boolean(synthesis&&Utterance),cancel(){synthesis?.cancel();settle?.();},speak:text=>new Promise((resolve,reject)=>{
  if(!synthesis||!Utterance){reject(Error('当前浏览器无法语音播报'));return;}
  settle?.();const utterance=new Utterance(text);utterance.lang=/[\u3400-\u9fff]/u.test(text)?'zh-CN':'en-US';
  let timer,finished=false;const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);utterance.onend=null;utterance.onerror=null;if(settle===finish)settle=undefined;error?reject(error):resolve();};settle=finish;
  utterance.onend=()=>finish();utterance.onerror=()=>finish(Error('语音未能播放，请点击启用后重试'));
  timer=setTimeout(()=>{synthesis.cancel();finish(Error('语音播放超时'));},60000);synthesis.speak(utterance);
 })};
}
export function createSpeechController({request,context,browserId,speech=browserSpeech(),onStatus=()=>{},onError=()=>{}}){
 let closed=false,polling=false,draining=false,scope=null,generation=0,active=null,release;
 function cancel(){generation++;speech.cancel();release?.();release=undefined;active=null;}
 async function finish(item){try{await request({action:'finish',browserId,id:item.id,completionId:item.completionId});}catch{/* Durable attempt remains consumed when offline. */}}
 const current=(epoch,user)=>!closed&&epoch===generation&&context()?.user===user;
 async function drain(items,epoch,user){
  if(draining)return;draining=true;
  try{
   while(items.length&&current(epoch,user)){
    const item=items[0],claim=await request({action:'claim',browserId,id:item.id,completionId:item.completionId});
    if(!claim.claimed){items=items.slice(1);continue;}
    if(!current(epoch,user)){await finish(item);break;}
    active=claim.item;
    const cancelled=new Promise(resolve=>{release=resolve;});
    try{await Promise.race([speech.speak(claim.item.text),cancelled]);}finally{active=null;release=undefined;if(context()?.user===user)await finish(item);}
    if(!current(epoch,user))break;
    items=(await request({action:'pending',browserId})).items??[];
   }
  }catch(error){if(current(epoch,user))onError(error);}finally{draining=false;}
 }
 async function poll(){
  if(closed)return;const user=context()?.user;
  if(user!==scope){cancel();scope=user;}
  if(!user||polling)return;polling=true;const epoch=generation;let work;
  try{
   const status=await request({action:'status'});if(!current(epoch,user))return;
   onStatus(status);if(!status.enabled||status.browserId!==browserId){cancel();return;}
   const pending=await request({action:'pending',browserId});if(!current(epoch,user))return;
   if(active&&(!pending.active||pending.active.id!==active.id||pending.active.completionId!==active.completionId)){cancel();return;}
   if(!draining)work=drain(pending.items??[],epoch,user);
  }catch(error){if(current(epoch,user))onError(error);}finally{polling=false;}
  await work;
 }
 return {poll,cancel,close(){closed=true;cancel();}};
}
