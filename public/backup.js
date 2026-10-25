/** Scoped protection status. Checkpoints and repository backups are distinct. */
export function initBackupControls({context,onOpen=()=>{},request=async(body,signal)=>{
 const response=await fetch('/api/backup',{method:body?'POST':'GET',headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal});
 const data=await response.json();if(!response.ok)throw Error(data.error||'备份状态读取失败');return data;
}}){
 let dialog=null,controller=null,scope=null,generation=0;
 function close(){generation++;controller?.abort();controller=null;dialog?.remove();dialog=null;}
 async function open(){
  close();onOpen();const owner=context()?.user,epoch=++generation;controller=new AbortController();const active=controller;
  const modal=document.createElement('dialog');dialog=modal;modal.style.cssText='width:min(720px,94vw);max-height:85dvh;overflow:auto';
  const title=document.createElement('h2');title.textContent='任务备份与保护状态';
  const help=document.createElement('p');help.textContent='检查点是封存的任务材料，尚不等于已写入加密备份仓库。运行中的任务沿用旧点，不会因采集被暂停。';
  const account=document.createElement('select');account.setAttribute('aria-label','备份账号');account.hidden=true;
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='刷新状态';
  const done=document.createElement('button');done.type='button';done.textContent='关闭';done.onclick=close;
  const output=document.createElement('div');output.setAttribute('aria-live','polite');output.textContent='正在读取…';
  modal.append(title,help,account,refresh,done,output);document.body.append(modal);modal.addEventListener('cancel',event=>{event.preventDefault();close();});
  if(typeof modal.showModal==='function')modal.showModal();else modal.setAttribute('open','');
  const current=()=>dialog===modal&&generation===epoch&&context()?.user===owner;
  async function read(body){
   refresh.disabled=true;
   try{const data=await request(body,active.signal);if(!current()){if(dialog===modal)close();return;}
    scope=data.scope;output.replaceChildren();
    if(data.canManage&&data.managedScopes?.length){account.hidden=false;const value=scope;account.replaceChildren();for(const name of data.managedScopes){const option=document.createElement('option');option.value=name;option.textContent=name;account.append(option);}account.value=value;}
    else account.hidden=true;
    const excluded=document.createElement('p');excluded.textContent='本期保护 Pi / Codex；Claude / Cursor / Grok 延期，不计入已保护范围。';output.append(excluded);
    if(!data.tasks?.length){const empty=document.createElement('p');empty.textContent='当前账号没有任务。';output.append(empty);}
    for(const task of data.tasks||[]){
     const row=document.createElement('section');row.style.cssText='border-top:1px solid currentColor;padding:10px 0;overflow-wrap:anywhere';
     const label=document.createElement('strong');label.textContent=`${task.taskId} · ${task.engine}`;
     const state=document.createElement('p');const names={protected:'已有封存点',unprotected:'未保护',waiting:'等待安全窗口',unavailable:'尚不支持采集',capturing:'正在采集',failed:'采集失败'};
     state.textContent=`${names[task.state]||task.state} · 覆盖：${task.coverage}`;
     const point=document.createElement('p');point.textContent=task.checkpointId?`检查点 ${task.checkpointId} · 采集于 ${task.captureAt} · 点龄 ${Math.floor(Math.max(0,task.ageMs||0)/3600000)} 小时${task.stale?' · 超过 24 小时':''}`:'尚无可恢复检查点';
     row.append(label,state,point);
     if(task.reason){const reason=document.createElement('p');reason.textContent=task.reason;row.append(reason);}
     if(data.canManage&&task.coverage!=='excluded'){
      const action=document.createElement('button');action.type='button';action.textContent=task.state==='capturing'?'取消采集':'生成检查点';
      action.onclick=async()=>{action.disabled=true;try{await request({action:task.state==='capturing'?'cancel':'capture',scope,taskId:task.taskId},active.signal);if(current())await read({action:'status',scope});}catch(error){if(current()){const message=document.createElement('p');message.textContent=error.message||'采集操作失败';row.append(message);}}finally{action.disabled=false;}};row.append(action);
     }
     output.append(row);
    }
   }catch(error){if(current())output.textContent=error.message||'备份状态读取失败';}
   finally{refresh.disabled=false;}
  }
  refresh.onclick=()=>void read(account.hidden?undefined:{action:'status',scope:account.value});account.onchange=()=>void read({action:'status',scope:account.value});
  await read();
 }
 return {open,close};
}
