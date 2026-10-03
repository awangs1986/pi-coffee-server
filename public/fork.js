export function initForkControls({task,modes,request,refresh,changed,complete,selection,toast}){
 const $=id=>document.getElementById(id),dialog=$('fork-dialog');let source=null,pending=null;
 const choices=()=>[...document.querySelectorAll('input[name="fork-mode"]')];
 function update(){const handoff=choices().some(c=>c.checked&&c.value==='handoff');$('fork-warning').hidden=!handoff;$('fork-confirm').textContent=handoff?'接受并创建 Fork':'创建 Fork';$('fork-confirm').disabled=Boolean(pending)||!choices().some(c=>c.checked&&!c.disabled);}
 function busy(id){return pending?.sourceId===id||task(id)?.forking?.status==='preparing'||task(id)?.fork?.status==='preparing';}
 function sync(){
  if(!pending)return;const target=task(pending.targetId);if(!target?.fork||target.fork.status==='preparing')return;
  const operation=pending;pending=null;update();changed();
  if(target.fork.status==='completed'){dialog.close();complete(operation.targetId,operation.selection);toast('Fork 已创建，原对话保留');}
  else {$('fork-status').textContent=target.fork.error||'Fork 失败，原对话保留。副本文件已保留供检查。';toast('Fork 未完成，请检查保留的副本');}
 }
 function open(session){source=session;const available=modes(task(session.id)?.engine??'pi');$('fork-source').textContent=session.name||session.preview||'当前对话';$('fork-status').textContent='';
  for(const c of choices()){c.disabled=!available.includes(c.value);c.checked=false;}
  const first=choices().find(c=>!c.disabled);if(first)first.checked=true;
  $('fork-native-unavailable').hidden=available.includes('native');update();dialog.showModal();
 }
 choices().forEach(c=>c.addEventListener('change',update));$('fork-cancel').addEventListener('click',()=>dialog.close());
 $('fork-confirm').addEventListener('click',()=>{
  if(!source||pending||busy(source.id))return;const mode=choices().find(c=>c.checked&&!c.disabled)?.value;if(!mode)return;
  const operation={sourceId:source.id,targetId:crypto.randomUUID(),selection:selection()};pending=operation;update();changed();$('fork-status').textContent='正在准备独立副本…关闭此窗口不会取消操作。';
  void (async()=>{try{await request({action:'fork',id:operation.sourceId,targetId:operation.targetId,mode,...(mode==='handoff'?{acceptDrift:true}:{})});await refresh();sync();}
  catch(error){if(pending===operation)pending=null;update();changed();$('fork-status').textContent=error.message+'；若连接曾中断，请先刷新列表核对，勿重复创建。';await refresh().catch(()=>{});}})();
 });
 return {open,busy,sync};
}
