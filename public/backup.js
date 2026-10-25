import {renderAccountRecoveryControls} from './account-recovery.js';
import {renderRestoreControls} from './restore.js';
/** Scoped protection status. Checkpoints and repository backups are distinct. */
import {renderBackupSchedule} from './backup-schedule.js';
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
    const scheduled=renderBackupSchedule(data,{request:body=>request(body,active.signal),refresh:()=>read({action:'status',scope}),isCurrent:current});if(scheduled)output.append(scheduled);
    if(data.canManage&&data.managedScopes?.length){account.hidden=false;const value=scope;account.replaceChildren();for(const name of data.managedScopes){const option=document.createElement('option');option.value=name;option.textContent=name==='__legacy_default__'?'原有账号范围':name;account.append(option);}account.value=value;}
    else account.hidden=true;
    if(data.repository){
     const repository=data.repository,section=document.createElement('section');
     const heading=document.createElement('h3');heading.textContent=`加密仓库 · Restic ${repository.backend?.version||''}`;
     const enabled=document.createElement('p');enabled.textContent=repository.errorCode==='repository_status_unavailable'?'备份服务暂不可用，无法确认仓库状态':repository.enabled?'已启用 · 已验证离线恢复副本':repository.configured?'待导出并验证离线恢复副本':'尚未配置备份目标';section.append(heading,enabled);
     for(const point of repository.points||[]){const label=document.createElement('p');label.textContent=`${point.taskId} · 加密备份采集于 ${point.captureAt} · 点龄 ${Math.floor(Math.max(0,point.ageMs||0)/3600000)} 小时${point.stale?' · 超过 24 小时':''}`;section.append(label);}
     for(const job of repository.jobs||[]){const label=document.createElement('p');label.textContent=`作业 ${job.id} · ${job.state} · 验证 ${job.verification}${job.errorCode?' · '+job.errorCode:''}`;section.append(label);}
     if(repository.activationUnavailable){const reason=document.createElement('p');reason.textContent=repository.activationUnavailable;section.append(reason);}
     if(data.canManage&&!repository.activationUnavailable){
      const operate=async(body)=>{try{const result=await request(body,active.signal);if(current())await read({action:'status',scope});return result;}catch(error){if(current()){const message=document.createElement('p');message.textContent=error.message||'仓库操作失败';section.append(message);}return null;}};
      if(!repository.configured){
       const destination=document.createElement('input');destination.placeholder='已有私有备份目录的绝对路径';destination.setAttribute('aria-label','备份目标目录');
       const configure=document.createElement('button');configure.type='button';configure.textContent='配置加密仓库';configure.onclick=()=>void operate({action:'repository-configure',destination:destination.value});section.append(destination,configure);
      }else{
       const exportCopy=document.createElement('button');exportCopy.type='button';exportCopy.textContent='导出离线恢复包';
       exportCopy.onclick=async()=>{exportCopy.disabled=true;try{const result=await request({action:'repository-export'},active.signal);if(!current())return;const url=URL.createObjectURL(new Blob([result.recoveryPackage],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='pi-coffee-offline-recovery.json';link.click();URL.revokeObjectURL(url);await read({action:'status',scope});}catch(error){if(current()){const message=document.createElement('p');message.textContent=error.message||'导出失败';section.append(message);}}finally{exportCopy.disabled=false;}};
       const recovery=document.createElement('input');recovery.type='file';recovery.accept='.json,application/json';recovery.setAttribute('aria-label','选择已保存的离线恢复包');
       recovery.onchange=async()=>{const file=recovery.files?.[0];if(file&&file.size<=8192)await operate({action:'repository-verify',recoveryPackage:await file.text()});};section.append(exportCopy,recovery);
       if(repository.enabled){const rotate=document.createElement('button');rotate.type='button';rotate.textContent='轮换密钥（须重验新离线副本）';rotate.onclick=()=>void operate({action:'repository-rotate'});section.append(rotate);const run=document.createElement('button');run.type='button';run.textContent='备份当前账号封存点';run.onclick=()=>void operate({action:'repository-backup',scope});section.append(run);}
       const recover=document.createElement('button');recover.type='button';recover.textContent='核对中断作业';recover.onclick=()=>void operate({action:'repository-recover'});section.append(recover);
      }
     }
     output.append(section);
    }
    renderRestoreControls({data,output,request,signal:active.signal,current,refresh:()=>read(data.canManage?{action:'status',scope}:undefined)});
    renderAccountRecoveryControls({data,output,request,signal:active.signal,current,refresh:()=>read(data.canManage?{action:'status',scope}:undefined)});
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
