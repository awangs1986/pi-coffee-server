/** Web interaction only; the Host owns the operation across reloads/disconnects. */
export function initTakeoverControls({context,request,refresh,changed,complete,toast}){
 const $=id=>document.getElementById(id),dialog=$('takeover-dialog');let selection=null,submitting=null,timer=null;const seen=new Set(),awaiting=new Map();
 const busy=id=>submitting===id||awaiting.has(id)||context()?.takeover?.status==='preparing'&&context()?.id===id;
 const close=()=>{selection=null;dialog.close();};
 $('takeover-cancel').onclick=close;dialog.addEventListener('cancel',()=>{selection=null;});
 $('takeover-confirm').onclick=async()=>{
  const selected=selection,current=context();if(!selected||current?.id!==selected.id||current.engine!==selected.from){close();return;}
  submitting=selected.id;close();changed();
  try{const operation=await request({action:'takeover',id:selected.id,engine:selected.to,expectedEngine:selected.from,acceptDrift:true});awaiting.set(selected.id,operation.id);}
  catch(error){toast(error.message);}
  finally{submitting=null;await refresh();changed();}
 };
 function sync(task){
  clearTimeout(timer);timer=null;
  if(task && awaiting.has(task.id) && task.takeover?.id===awaiting.get(task.id))awaiting.delete(task.id);
  changed();
  if(task && awaiting.has(task.id)){timer=setTimeout(()=>void refresh(),1000);return;}
  if(task?.takeover?.status==='preparing'){timer=setTimeout(()=>void refresh(),1000);return;}
  const op=task?.takeover;if(!op||seen.has(op.id))return;seen.add(op.id);
  if(op.status==='completed')complete(task.id);
  else if(op.status==='failed')toast(`交接未完成，已保留原 Agent。${op.error||''}`);
 }
 return {busy,sync,open(to){const task=context();if(!task||task.workspaceKind!=='project'||task.archived||busy(task.id)||!['pi','codex'].includes(task.engine)||task.engine===to)return;
  selection={id:task.id,from:task.engine,to};$('takeover-target').textContent=`${task.engine==='pi'?'Pi':'Codex'} → ${to==='pi'?'Pi':'Codex'}`;dialog.showModal();
 }};
}
