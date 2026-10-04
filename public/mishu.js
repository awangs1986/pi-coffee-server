/** Per-Chat selection; setup remains an explicit native Pi slash command. */
export function initMishuControls({button,context,request,changed,toast,busyChanged=()=>{}}) {
  let generation=0, selected=false, readyId=null, pending=false;
  const eligible=task=>task?.id&&task.workspaceKind==='chat'&&(task.engine||'pi')==='pi'&&!task.archived;
  const render=(checked,disabled)=>{
    button.setAttribute('aria-checked',String(checked));button.disabled=disabled;
    const check=button.querySelector('.mishu-check');if(check)check.textContent=checked?'✓':'';
  };
  async function refresh(){
    const task=context(),epoch=++generation;readyId=null;selected=false;render(false,true);
    if(!eligible(task)){button.title='请先打开一个 Pi Chat，再配置 MISHU';return;}
    try{
      const status=await request({action:'status',id:task.id});
      if(epoch!==generation||context()?.id!==task.id)return;
      selected=status.selected===true;readyId=task.id;
      button.title=status.enabled?'MISHU 已启用；取消勾选会停用':'勾选后，在当前 Chat 输入 /mishu-setup';
      render(selected,pending||Boolean(context()?.busy));
    }catch(error){if(epoch===generation&&context()?.id===task.id){render(false,true);button.title=error.message;}}
  }
  button.addEventListener('click',async()=>{
    const task=context();if(pending||!eligible(task)||task.busy||readyId!==task.id)return;
    const epoch=++generation,desired=!selected;pending=true;busyChanged(true,task.id);render(selected,true);
    try{
      const result=await request({action:'select',id:task.id,selected:desired});
      if(epoch!==generation||context()?.id!==task.id)return;
      selected=result.selected===true;render(selected,false);
      toast(selected?'MISHU 已勾选，请输入 /mishu-setup 显式启用并选择可联系的对话。':'MISHU 已停用。已投递的任务继续运行。');
      changed(task.id);
    }catch(error){if(epoch===generation&&context()?.id===task.id){render(selected,false);toast(error.message);}}
    finally{pending=false;busyChanged(false,task.id);}
  });
  function updateAvailability(){const task=context();render(readyId===task?.id&&selected,pending||!eligible(task)||readyId!==task?.id||Boolean(task?.busy));}
  return {refresh,updateAvailability};
}
