/** No application, native engine or MISHU imports: all effects are supplied. */
export function browserSpeech({synthesis=globalThis.speechSynthesis,Utterance=globalThis.SpeechSynthesisUtterance}={}){
 return {available:()=>Boolean(synthesis&&Utterance),cancel:()=>synthesis?.cancel(),speak:text=>new Promise((resolve,reject)=>{
  if(!synthesis||!Utterance){reject(Error('当前浏览器无法语音播报'));return;}
  const utterance=new Utterance(text);utterance.lang=/[\u3400-\u9fff]/u.test(text)?'zh-CN':'en-US';
  let timer;const finish=error=>{clearTimeout(timer);utterance.onend=null;utterance.onerror=null;error?reject(error):resolve();};
  utterance.onend=()=>finish();utterance.onerror=()=>finish(Error('语音未能播放，请点击启用后重试'));
  timer=setTimeout(()=>{synthesis.cancel();finish(Error('语音播放超时'));},60000);synthesis.speak(utterance);
 })};
}
export function createSpeechController({request,context,browserId,speech=browserSpeech(),onStatus=()=>{},onError=()=>{}}){
 let closed=false,polling=false,playing=false,scope=null,generation=0;
 function cancel(){generation++;speech.cancel();playing=false;}
 async function poll(){
  if(closed||polling)return;const user=context()?.user;
  if(user!==scope){cancel();scope=user;}
  if(!user)return;polling=true;const epoch=generation;
  try{
   const status=await request({action:'status'});if(closed||epoch!==generation||context()?.user!==user)return;
   onStatus(status);if(!status.enabled||status.browserId!==browserId){cancel();return;}if(playing)return;
   const pending=await request({action:'pending',browserId});if(closed||epoch!==generation||context()?.user!==user)return;
   for(const item of pending.items??[]){
    if(closed||epoch!==generation||context()?.user!==user)break;
    const claim=await request({action:'claim',browserId,id:item.id,completionId:item.completionId});
    if(!claim.claimed)continue;if(closed||epoch!==generation||context()?.user!==user)break;
    playing=true;try{await speech.speak(claim.item.text);}finally{playing=false;}
   }
  }catch(error){if(!closed&&epoch===generation)onError(error);}finally{polling=false;}
 }
 return {poll,cancel,close(){closed=true;cancel();}};
}
