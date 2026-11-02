import {createSpeechPresentation,summaryReadProof} from './plugins/completion-speech/presentation.js';
import {syncDigest} from './sync-digest.js';
import {updateAssistant} from './render.js';
import {randomId} from './ids.js';
import {browserSpeech,createSpeechController,createSpeechTransport} from './plugins/completion-speech/browser.js';
/** Optional UI mount; failures never block Coffee navigation or native execution. */
export function initCompletionSpeech({request,context,masterButton,settingsButton,takeoverButton,toast,onPresentation=()=>{},speech=browserSpeech()}){
 let status=null,changing=false,closed=false,scope=context()?.user,failed=false;const listeners=[],key='pi-coffee.speech-browser.v1';let browserId;
 const listen=(node,event,handler)=>{node?.addEventListener(event,handler);listeners.push(()=>node?.removeEventListener(event,handler));};
 try{browserId=sessionStorage.getItem(key);if(!browserId){browserId=randomId();sessionStorage.setItem(key,browserId);}}catch{browserId=randomId();}
 const scopedRequest=async(body,options)=>{const user=context()?.user;if(!user||closed)throw Object.assign(Error('请先登录'),{kind:'authentication'});const value=await request(body,options);if(closed||user!==context()?.user)throw Object.assign(Error('账号已切换'),{kind:'cancelled'});return value;};
 const uiTransport=createSpeechTransport(scopedRequest),presentationTransport=createSpeechTransport(scopedRequest),call=uiTransport.call;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 const dialog=node('dialog');dialog.className='runners-dialog speech-settings';dialog.setAttribute('aria-labelledby','speech-settings-title');
 const title=node('h2','完成播报设置');title.id='speech-settings-title';const label=node('label','系统声音 '),voices=node('select');voices.setAttribute('aria-label','系统声音');label.append(voices);
 const notice=node('p','页面须保持打开；后台播放受浏览器限制。系统声音可能使用网络服务。');const errorText=node('p');errorText.setAttribute('role','status');
 const preview=node('button','试听'),retry=node('button','启用或重试语音'),done=node('button','关闭');for(const b of [preview,retry,done])b.type='button';
 const recoveryList=node('div');recoveryList.className='speech-recovery-list';const login=node('a','重新登录');login.href='/auth/login';login.hidden=true;dialog.append(title,label,preview,retry,errorText,recoveryList,login,notice,done);document.body.append(dialog);
 const showDialog=()=>{if(!dialog.open){if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');}};
 const error=err=>{if(err.kind==='cancelled')return;failed=true;errorText.textContent=err.message;login.hidden=err.kind!=='authentication';takeoverButton.hidden=false;takeoverButton.textContent=({audio:'启用或重试语音',authentication:'播报需要重新登录',authorization:'播报权限不足',unavailable:'播报组件不可用',compatibility:'更新播报组件'})[err.kind]??'播报连接恢复中';};
 const connection=value=>{
  if(value.diagnostics){
   const latest=new Map();for(const d of value.diagnostics)latest.set(JSON.stringify([d.id,d.completionId]),d);recoveryList.replaceChildren();
   for(const d of [...latest.values()].filter(d=>['uncertain','blocked'].includes(d.state)).slice(-10)){
    const button=node('button',`手动重播 ${d.id.slice(0,12)}`);button.type='button';button.className='speech-recovery-replay';button.onclick=async()=>{button.disabled=true;try{if(!await replay(d.id,d.completionId))errorText.textContent='该播报已过期、已撤销或暂不可用。';}finally{button.disabled=false;}};recoveryList.append(button);
   }
  }
 if(value.kind==='ready'||value.kind==='uncertain'){failed=false;login.hidden=true;const skipped=value.diagnostics?.filter(d=>['expired','overflow'].includes(d.reason)).length??0;errorText.textContent=(value.kind==='uncertain'?'播放结果不确定，可在下方手动重播。':'播报已就绪。')+` 待播 ${value.pending??0} 项。`+(skipped?` 已过期或超出容量 ${skipped} 项。`:'');if(status)render(status);}else if(value.kind==='network'||value.kind==='conflict')errorText.textContent='播报连接恢复中，将自动重试。';};
 const renderVoices=()=>{const available=speech.voices?.()??[],selection=status?.voiceURI??'';voices.replaceChildren();const automatic=node('option','自动匹配语言');automatic.value='';voices.append(automatic);for(const voice of available){const option=node('option',`${voice.name||voice.voiceURI} (${voice.lang||''})`);option.value=voice.voiceURI;voices.append(option);}voices.value=available.some(v=>v.voiceURI===selection)?selection:'';if(!available.length)errorText.textContent='系统暂未提供声音；可点击启用或重试。';};
 const render=value=>{status=value;masterButton.disabled=changing||!context()?.user;masterButton.textContent=(value.enabled?'✓ ':'')+'完成播报';masterButton.setAttribute('aria-checked',String(Boolean(value.enabled)));takeoverButton.hidden=!value.enabled||(!failed&&value.browserId===browserId);retry.textContent=value.browserId&&value.browserId!==browserId?'接管到此浏览器':'启用或重试语音';if(!failed)takeoverButton.textContent='在此浏览器播报';speech.setVoice?.(value.voiceURI);};
 const controller=createSpeechController({request:scopedRequest,context,browserId,speech,onStatus:value=>{render(value);void presentation.refresh();},onError:error,onState:connection});
 const presentation=createSpeechPresentation({request:presentationTransport.call,context,digest:syncDigest,onChange:onPresentation,onReplay:(id,completionId)=>void replay(id,completionId),renderAnswer:(n,text)=>updateAssistant(n,text,{done:true})});
 function scopeChanged(){const user=context()?.user;if(scope!==user){controller.resetScope();uiTransport.cancel();presentationTransport.cancel();speech.setVoice?.('');scope=user;status=null;failed=false;recoveryList.replaceChildren();masterButton.disabled=true;voices.replaceChildren();errorText.textContent='';if(dialog.open)dialog.close?.();}return user;}
 let presentationScope;function presentationChanged(){const key=JSON.stringify([context()?.user,context()?.id]);if(key!==presentationScope){presentationScope=key;presentationTransport.cancel();}}
 async function refresh(){scopeChanged();presentationChanged();if(closed)return;void presentation.refresh();await controller.poll();if(!status)masterButton.disabled=true;}
 async function configure(){if(changing)return;const enabled=!status?.enabled;if(!enabled)controller.cancel();changing=true;try{if(enabled&&!speech.available())throw Object.assign(Error('当前浏览器不支持语音播报'),{kind:'audio'});render(await call({action:'configure',enabled}));if(enabled)render(await call({action:'designate',browserId}));failed=false;void controller.retry().catch(error);}catch(e){error(e);toast(e.message);}finally{changing=false;if(status)render(status);}}
 async function recover(){try{if(!speech.available())throw Object.assign(Error('当前浏览器不支持语音播报'),{kind:'audio'});render(await call({action:'designate',browserId}));failed=false;errorText.textContent='';takeoverButton.textContent='在此浏览器播报';void controller.retry().catch(error);}catch(e){error(e);toast(e.message);}}
 async function replay(id,completionId){scopeChanged();if(!status?.enabled){toast('请先开启完成播报');return false;}if(status.browserId!==browserId){toast('请先在播报设置中接管到此浏览器');showDialog();return false;}try{return await controller.replay(id,completionId);}catch(e){error(e);return false;}}
 function taskAction(task){const owner=context()?.user;const button=node('button',(status?.selected?.[task.id]?.enabled?'✓ ':'')+'完成播报');if(status?.selected?.[task.id]?.profileStatus==='unsupported'){button.textContent+='（提示词版本不可用）';button.title='已保留原提示词版本，请恢复对应版本的播报插件；对话仍可正常运行';}button.type='button';button.className='popitem';button.disabled=!['pi','codex'].includes(task.engine??'pi')||Boolean(task.archived);button.setAttribute('aria-pressed',String(Boolean(status?.selected?.[task.id]?.enabled)));button.addEventListener('click',async()=>{if(changing||context()?.user!==owner)return;changing=true;button.disabled=true;if(status?.selected?.[task.id]?.enabled)controller.revoke(task.id);try{render(await call({action:'select',id:task.id,enabled:!status?.selected?.[task.id]?.enabled}));button.textContent=(status?.selected?.[task.id]?.enabled?'✓ ':'')+'完成播报';button.setAttribute('aria-pressed',String(Boolean(status?.selected?.[task.id]?.enabled)));toast('播报设置从下一轮消息起生效');}catch(e){toast(e.message);}finally{changing=false;button.disabled=false;if(status)render(status);}});return button;}
 listen(masterButton,'click',()=>void configure());listen(settingsButton,'click',()=>{renderVoices();showDialog();});listen(takeoverButton,'click',()=>void recover());listen(retry,'click',()=>void recover());
 listen(voices,'change',async()=>{try{render(await call({action:'voice',voiceURI:voices.value}));}catch(e){toast(e.message);}});
 listen(preview,'click',async()=>{controller.pause();try{await speech.speak('这是任务完成摘要的试听。This is a completion brief preview.');void controller.retry().catch(error);}catch(e){error(Object.assign(e,{kind:'audio'}));}});
 listen(done,'click',()=>{if(dialog.close)dialog.close();else dialog.removeAttribute('open');});listen(globalThis.speechSynthesis,'voiceschanged',renderVoices);
 const wake=()=>{scopeChanged();presentationChanged();uiTransport.expire();presentationTransport.expire();controller.start();controller.wake();void presentation.refresh();};
 for(const event of ['online','focus','pageshow'])listen(window,event,wake);
 listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible')wake();});listen(document,'resume',wake);
 listen(window,'pagehide',()=>{controller.suspend();uiTransport.cancel();presentationTransport.cancel();});
 controller.start();
 return {refresh,controller,replay,taskAction,scopeChanged,revoke:id=>controller.revoke(id),project:entries=>presentation.apply(entries),summaryProof:summaryReadProof,close(){closed=true;uiTransport.close();presentationTransport.close();for(const remove of listeners)remove();controller.close();presentation.close();dialog.remove();}};
}
