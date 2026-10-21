import {randomId} from './ids.js';
/** Candidate previews are user decisions. Opening the panel never calls a model. */
export function initMishuConsolidation({parent,context,source,request,toast}){
 const section=document.createElement('section');section.setAttribute('aria-label','MISHU 记忆整理');parent.append(section);let sequence=0,closed=false;
 const current=()=>{const c=context();return !closed&&c?.id===source.id&&c?.user===source.user&&c?.epoch===source.epoch;};
 async function call(body){if(!current())throw Error('秘书已切换，请重新打开记忆');const value=await request({action:'memory_consolidation',id:source.id,version:1,...body});if(!current())throw Error('秘书已切换，请重新打开记忆');return value;}
 function text(parent,value,tag='p'){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}
 function button(parent,label,run){const e=document.createElement('button');e.type='button';e.textContent=label;e.onclick=async()=>{e.disabled=true;try{await run();}catch(error){if(current())toast(error.message);}finally{if(current())e.disabled=false;}};parent.append(e);return e;}
 async function refresh(){const ticket=++sequence;try{const state=await call({operation:'status'});if(ticket!==sequence||!current())return;section.replaceChildren();text(section,'记忆整理','h3');text(section,`每批最多 ${state.limits.messages} 条消息、${state.limits.inputChars} 字符、${state.limits.changes} 条建议；每小时辅助调用最多 ${state.limits.hourlyCalls} 次。候选不会自行改变正式记忆。`);
   if(!state.available)text(section,state.reason||'当前原生整理不可用；人工记忆管理仍可使用。');
   const target=document.createElement('input');target.placeholder='来源联系人完整 ID（留空仅当前秘书）';target.setAttribute('aria-label','整理证据来源');target.style.cssText='display:block;max-width:100%;box-sizing:border-box';section.append(target);
   const prepare=button(section,'手动整理',async()=>{await call({operation:'prepare',operationId:randomId(),...(target.value.trim()?{targetId:target.value.trim()}: {})});await refresh();});prepare.disabled=!state.available;
   button(section,'刷新整理状态',refresh);
   const auto=document.createElement('div');auto.dataset.mishuAutomatic='';section.append(auto);
   if(typeof state.automatic?.supported==='boolean'){
    text(auto,`空闲自动整理：${state.automatic.enabled?'已开启':'默认关闭'}。只读取开启后的当前秘书新消息。${state.automatic.pending||''}`);
    if(state.automatic.supported||state.automatic.enabled){button(auto,state.automatic.enabled?'暂停自动整理':'设置自动整理',async()=>{if(state.automatic.enabled){await call({operation:'configure',enabled:false,operationId:randomId()});await refresh();return;}const form=document.createElement('div');text(form,'开启后仅处理当前秘书此刻之后的新消息；每批 20 条、12000 字符、10 条变更，辅助调用每小时最多 12 次。用户新输入优先。确定的明确偏好可保存，其他内容保留候选。');button(form,'开启当前秘书的空闲整理',async()=>{await call({operation:'configure',enabled:true,operationId:randomId()});await refresh();});button(form,'取消设置',()=>form.remove());auto.append(form);});}
    else text(auto,state.automatic.reason||'当前来源无法证明安全后台整理能力。');
   }
   const labels={reserved:'已预留调用',running:'正在原生整理',ready:'候选待查看',adopting:'正在保存选择',adopted:'所选候选已采纳',cancelled:'已取消',uncertain:'结果待核实，未重新生成'};
   for(const job of state.jobs||[]){const card=document.createElement('article');card.style.cssText='border:1px solid currentColor;padding:10px;margin:10px 0;overflow-wrap:anywhere';section.append(card);text(card,`${job.automatic?'空闲整理':'手动整理'} · ${labels[job.state]||job.state} · ${job.createdAt}`);if(job.error)text(card,job.error);
    const selection=[];
    for(const [index,change] of (job.changes||[]).entries()){const label=document.createElement('label');label.style.display='block';const check=document.createElement('input');check.type='checkbox';check.disabled=!['ready','adopting'].includes(job.state);label.append(check,document.createTextNode(` ${change.op==='add'?'新增':change.op==='edit'?'修改':'删除'}：${change.text||job.oldValues?.[change.entryId]||'记忆条目'}`));selection.push({check,index});card.append(label);if(change.entryId)text(card,`原值：${job.oldValues?.[change.entryId]||'不可用'}`);const detail=document.createElement('details');text(detail,'逐条来源','summary');text(detail,`${change.source?.conversationId} / ${change.source?.messageId}\n${change.source?.quote||''}\n范围 ${change.source?.start}–${change.source?.end}`);card.append(detail);}
    if(['ready','adopting'].includes(job.state)){button(card,'采纳所选建议',async()=>{const indices=selection.filter(x=>x.check.checked).map(x=>x.index);if(!indices.length&&job.changes?.length)return toast('请先勾选要采纳的建议');await call({operation:'adopt',jobId:job.id,indices});await refresh();});}
    if(!['adopted','cancelled'].includes(job.state))button(card,'取消这次整理',async()=>{await call({operation:'cancel',jobId:job.id});await refresh();});
   }
  }catch(error){if(ticket===sequence&&current()){section.replaceChildren();text(section,'记忆整理暂不可用：'+error.message);}}
 }
 return {refresh,close(){closed=true;sequence++;section.remove();}};
}
