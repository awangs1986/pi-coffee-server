import {prepareTask,preparationLabel} from './task-preparation.js';
import {randomId} from './ids.js';
export function initForkControls({task,modes,request,refresh,changed,complete,selection,toast,durable=()=>false,scope=()=>'',storage=globalThis.sessionStorage}){
 const $=id=>document.getElementById(id),dialog=$('fork-dialog');let source=null,pending=null,inFlight=false,uncertain=false,view=null;
 const storageKey=()=>`coffee.pending-fork.${scope()}`;
 const save=()=>{try{if(pending?.durable)storage?.setItem(storageKey(),JSON.stringify(pending));else storage?.removeItem(storageKey());}catch{/* optional browser storage */}};
 const input=operation=>({operationId:operation.targetId,targetTaskId:operation.targetId,sourceId:operation.sourceId,kind:operation.mode==='handoff'?'handoff-fork':'native-fork',...(operation.mode==='handoff'?{acceptDrift:true}:{})});
 async function monitor(operation,queryOnly=false){
  inFlight=true;update();
  try{await prepareTask(input(operation),{request,queryOnly,active:()=>pending===operation&&operation.scope===scope(),changed:next=>{view=next;$('fork-status').textContent=preparationLabel(next);update();}});
   if(pending!==operation)return;pending=null;view=null;save();dialog.close();await refresh();complete(operation.targetId,operation.selection);toast('Fork 已创建，原对话保留');
  }catch(error){if(pending!==operation)return;view=error.operation??view;uncertain=!error.operation;$('fork-status').textContent=error.message;save();await refresh().catch(()=>{});}
  finally{inFlight=false;update();changed();}
 }
 for(const action of ['cancel','resume'])$('fork-'+(action==='cancel'?'stop':'resume'))?.addEventListener('click',()=>{if(!pending?.durable||!view?.allowedActions?.includes(action))return;const operation=pending;void request({action:'preparation_'+action,operationId:operation.targetId,expectedRevision:view.revision}).then(()=>{if(action==='resume')void monitor(operation,true);}).catch(error=>{$('fork-status').textContent=error.message;});});
 const failed=()=>pending?.durable&&['failed','cancelled'].includes(view?.status);
 const choices=()=>[...document.querySelectorAll('input[name="fork-mode"]')];
 function update(){if($('fork-stop'))$('fork-stop').hidden=!pending?.durable||!view?.allowedActions?.includes('cancel');if($('fork-resume'))$('fork-resume').hidden=!pending?.durable||!view?.allowedActions?.includes('resume');const handoff=choices().some(c=>c.checked&&c.value==='handoff');$('fork-warning').hidden=!handoff;$('fork-confirm').textContent=failed()?'新建另一个 Fork':uncertain?'核对并重试原 Fork':handoff?'接受并创建 Fork':'创建 Fork';$('fork-confirm').disabled=inFlight||Boolean(pending&&!uncertain&&!failed())||!choices().some(c=>c.checked&&!c.disabled);}
 function busy(id){return pending?.sourceId===id||task(id)?.forking?.status==='preparing'||task(id)?.fork?.status==='preparing';}
 function sync(){
  if(!pending||pending.durable)return;const target=task(pending.targetId);if(!target?.fork||target.fork.status==='preparing')return;
  const operation=pending;pending=null;uncertain=false;update();changed();
  if(target.fork.status==='completed'){dialog.close();complete(operation.targetId,operation.selection);toast('Fork 已创建，原对话保留');}
  else {$('fork-status').textContent=target.fork.error||'Fork 失败，原对话保留。副本文件已保留供检查。';toast('Fork 未完成，请检查保留的副本');}
 }
 function open(session){if(durable()&&!pending){try{const saved=JSON.parse(storage?.getItem(storageKey())||'null');if(saved?.durable&&saved.scope===scope())pending=saved;}catch{/* absent draft */}}if(pending&&pending.sourceId!==session.id){toast('请先核对正在准备的 Fork');return;}source=session;const available=modes(task(session.id)?.engine??'pi');$('fork-source').textContent=session.name||session.preview||'当前对话';const previous=task(session.id)?.forking;$('fork-status').textContent=previous?.status==='failed'?(previous.error||'Fork 失败，原对话及副本已保留。'):previous?.status==='preparing'?'正在准备独立副本…关闭此窗口不会取消操作。':'';
  for(const c of choices()){c.disabled=!available.includes(c.value)||Boolean(pending&&pending.mode!==c.value);c.checked=false;}
  const first=choices().find(c=>!c.disabled);if(first)first.checked=true;
  $('fork-native-unavailable').hidden=available.includes('native');update();dialog.showModal();if(pending?.durable&&!inFlight)void monitor(pending,true);
 }
 choices().forEach(c=>c.addEventListener('change',update));$('fork-cancel').addEventListener('click',()=>dialog.close());
 $('fork-confirm').addEventListener('click',()=>{
  if(!source||inFlight||(pending&&!uncertain&&!failed())||(!pending&&busy(source.id)))return;
  const mode=choices().find(c=>c.checked&&!c.disabled)?.value;if(!mode)return;
  if(failed()){pending=null;view=null;uncertain=false;save();}
  if(durable()){const operation=pending??{sourceId:source.id,targetId:randomId(),mode,selection:selection(),durable:true,scope:scope()};pending=operation;save();void monitor(operation,Boolean(view));return;}
  const operation=pending??{sourceId:source.id,targetId:randomId(),mode,selection:selection()};pending=operation;inFlight=true;const retry=uncertain;uncertain=false;update();changed();$('fork-status').textContent='正在准备独立副本…关闭此窗口不会取消操作。';
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
