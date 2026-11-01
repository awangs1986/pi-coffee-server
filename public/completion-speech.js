import {createSpeechPresentation,summaryReadProof} from './plugins/completion-speech/presentation.js';
import {syncDigest} from './sync-digest.js';
import {updateAssistant} from './render.js';
import {randomId} from './ids.js';
import {browserSpeech,createSpeechController} from './plugins/completion-speech/browser.js';
export function initCompletionSpeech({request,context,masterButton,taskButton,takeoverButton,toast,onPresentation=()=>{}}){
 let status=null,changing=false;const key='pi-coffee.speech-browser.v1';let browserId;
 try{browserId=sessionStorage.getItem(key);if(!browserId){browserId=randomId();sessionStorage.setItem(key,browserId);}}catch{browserId=randomId();}
 const speech=browserSpeech();
 const presentation=createSpeechPresentation({request,context,digest:syncDigest,onChange:onPresentation,renderAnswer:(node,text)=>updateAssistant(node,text,{done:true})});
 const render=value=>{status=value;masterButton.textContent=(value.enabled?'✓ ':'')+'完成播报';masterButton.setAttribute('aria-checked',String(Boolean(value.enabled)));const task=context();const capable=task?.id&&['pi','codex'].includes(task.engine??'pi')&&!task.archived;taskButton.disabled=changing||!capable;taskButton.textContent=(value.selected?.[task?.id]?.enabled?'✓ ':'')+'播报当前对话';takeoverButton.hidden=!value.enabled||value.browserId===browserId;};
 const controller=createSpeechController({request,context,browserId,speech,onStatus:render,onError:error=>{takeoverButton.hidden=false;takeoverButton.textContent='启用或重试语音';takeoverButton.title=error.message;}});
 async function refresh(){void presentation.refresh();try{render(await request({action:'status'}));}catch{masterButton.disabled=true;taskButton.disabled=true;}}
 masterButton.addEventListener('click',async()=>{if(changing)return;changing=true;try{if(!speech.available())throw Error('当前浏览器不支持语音播报');const enabled=!status?.enabled;render(await request({action:'configure',enabled}));if(enabled)render(await request({action:'designate',browserId}));else controller.cancel();void controller.poll();}catch(e){toast(e.message);}finally{changing=false;}});
 taskButton.addEventListener('click',async()=>{const task=context();if(changing||!task?.id)return;changing=true;try{const result=await request({action:'select',id:task.id,enabled:!status?.selected?.[task.id]?.enabled});render(result);toast('播报设置从下一轮消息起生效');}catch(e){toast(e.message);}finally{changing=false;}});
 takeoverButton.addEventListener('click',async()=>{try{render(await request({action:'designate',browserId}));takeoverButton.textContent='在此浏览器播报';void controller.poll();}catch(e){toast(e.message);}});
 const timer=setInterval(()=>{void controller.poll();void presentation.refresh();},5000);const wake=()=>void controller.poll();window.addEventListener('focus',wake);window.addEventListener('pagehide',()=>{controller.cancel();});
 return {refresh,controller,project:entries=>presentation.apply(entries),summaryProof:summaryReadProof,close(){clearInterval(timer);window.removeEventListener('focus',wake);controller.close();presentation.close();}};
}
