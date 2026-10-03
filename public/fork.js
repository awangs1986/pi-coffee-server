export function initForkControls({task,modes,request,refresh,changed,complete,selection,toast}){
 const $=id=>document.getElementById(id),dialog=$('fork-dialog');let source=null,pending=null,inFlight=false,uncertain=false;
 const choices=()=>[...document.querySelectorAll('input[name="fork-mode"]')];
 function update(){const handoff=choices().some(c=>c.checked&&c.value==='handoff');$('fork-warning').hidden=!handoff;$('fork-confirm').textContent=uncertain?'核对并重试原 Fork':handoff?'接受并创建 Fork':'创建 Fork';$('fork-confirm').disabled=inFlight||Boolean(pending&&!uncertain)||!choices().some(c=>c.checked&&!c.disabled);}
 function busy(id){return pending?.sourceId===id||task(id)?.forking?.status==='preparing'||task(id)?.fork?.status==='preparing';}
 function sync(){
  if(!pending)return;const target=task(pending.targetId);if(!target?.fork||target.fork.status==='preparing')return;
  const operation=pending;pending=null;uncertain=false;update();changed();
  if(target.fork.status==='completed'){dialog.close();complete(operation.targetId,operation.selection);toast('Fork 已创建，原对话保留');}
  else {$('fork-status').textContent=target.fork.error||'Fork 失败，原对话保留。副本文件已保留供检查。';toast('Fork 未完成，请检查保留的副本');}
 }
 function open(session){if(pending&&pending.sourceId!==session.id){toast('请先核对正在准备的 Fork');return;}source=session;const available=modes(task(session.id)?.engine??'pi');$('fork-source').textContent=session.name||session.preview||'当前对话';$('fork-status').textContent='';
  for(const c of choices()){c.disabled=!available.includes(c.value)||Boolean(pending&&pending.mode!==c.value);c.checked=false;}
  const first=choices().find(c=>!c.disabled);if(first)first.checked=true;
  $('fork-native-unavailable').hidden=available.includes('native');update();dialog.showModal();
 }
 choices().forEach(c=>c.addEventListener('change',update));$('fork-cancel').addEventListener('click',()=>dialog.close());
 $('fork-confirm').addEventListener('click',()=>{
  if(!source||inFlight||(pending&&!uncertain)||(!pending&&busy(source.id)))return;
  const mode=choices().find(c=>c.checked&&!c.disabled)?.value;if(!mode)return;
  const operation=pending??{sourceId:source.id,targetId:crypto.randomUUID(),mode,selection:selection()};pending=operation;inFlight=true;const retry=uncertain;uncertain=false;update();changed();$('fork-status').textContent='正在准备独立副本…关闭此窗口不会取消操作。';
  void (async()=>{try{
   if(retry){await refresh();sync();if(pending!==operation)return;}
   await request({action:'fork',id:operation.sourceId,targetId:operation.targetId,mode:operation.mode,...(operation.mode==='handoff'?{acceptDrift:true}:{})});await refresh();sync();
  }catch(error){
   // Only an explicit 4xx rejection proves this attempt was not accepted. A
   // transport/server failure retains the operation ID for safe reconciliation.
   if(!retry&&error.status>=400&&error.status<500){pending=null;}else uncertain=true;
   $('fork-status').textContent=error.message+'；连接不确定时仅核对或重试原 Fork，不会创建第二份。';await refresh().catch(()=>{});sync();
  }finally{inFlight=false;update();changed();}})();
 });
 return {open,busy,sync,recoverable:id=>uncertain&&pending?.sourceId===id};
}
