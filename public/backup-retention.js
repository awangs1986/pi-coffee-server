/** Administrator-only, concrete preview followed by explicit revision approval. */
export function renderBackupRetention(data,{request,refresh,isCurrent}){
 if(!data.canManage||!data.retention)return null;
 const section=document.createElement('section');section.style.overflowWrap='anywhere';
 const text=(parent,tag,value)=>{const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;};
 text(section,'h3','恢复点保留');text(section,'p','30 个日点 + 12 个周点 + 12 个月点取并集；各任务最后完整点和活跃恢复引用继续保护。');
 if(data.retention.available===false){text(section,'p','保留状态暂不可用，请刷新后核实。');return section;}
 for(const pin of (data.retention.pins||[]).slice(0,100))text(section,'p',`${pin.operationId} · pin 到期 ${pin.expiresAt}${pin.activeLease?' · 活跃租约，继续保护':pin.releasedAt?' · 已请求释放':''}`);
 const plans=document.createElement('div');section.append(plans);
 const showPlan=plan=>{
  const card=document.createElement('section');text(card,'h4',`计划 ${plan.id} · revision ${plan.revision} · ${plan.state}`);
  text(card,'p',`账号：${(plan.scopes||[]).join('、')} · ${plan.timeZone} · 保留 ${plan.keep?.length||0} 个，拟回收 ${plan.remove?.length||0} 个快照`);
  for(const row of (plan.remove||[]).slice(0,100))text(card,'p',`拟回收 ${row.snapshotId}`);
  for(const row of (plan.keep||[]).slice(0,100))text(card,'p',`保留 ${row.snapshotId} · ${(row.reasons||[]).map(reason=>reason.kind).join('、')}`);
  if((plan.remove?.length||0)>100||(plan.keep?.length||0)>100)text(card,'p','仅展示前 100 项；下载计划查看全部精确快照。');
  const download=document.createElement('button');download.type='button';download.textContent='下载计划 JSON';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='backup-retention-'+plan.id+'.json';link.click();URL.revokeObjectURL(url);};card.append(download);
  if(['previewed','failed','executing'].includes(plan.state)&&data.repository?.enabled&&!data.repository.activationUnavailable){
   const execute=document.createElement('button');execute.type='button';execute.textContent=plan.state==='previewed'?'批准并执行此计划':'核对并继续此计划';
   execute.onclick=async()=>{execute.disabled=true;try{await request({action:'retention-execute',scope:data.scope,id:plan.id,revision:plan.revision,digest:plan.digest});if(isCurrent())await refresh();}catch(error){if(isCurrent())text(card,'p',error.message||'保留计划执行失败');}finally{execute.disabled=false;}};card.append(execute);
  }
  if(plan.errorCode)text(card,'p',`上次结果：${plan.errorCode}`);plans.prepend(card);
 };
 for(const plan of (data.retention.plans||[]).slice(0,30).reverse())showPlan(plan);
 if(data.repository?.enabled&&!data.repository.activationUnavailable){
  const addPreview=(label,scopes)=>{const preview=document.createElement('button');preview.type='button';preview.textContent=label;preview.onclick=async()=>{preview.disabled=true;try{const plan=await request({action:'retention-preview',scope:data.scope,scopes,timeZone:'America/Toronto'});if(isCurrent())showPlan(plan);}catch(error){if(isCurrent())text(section,'p',error.message||'保留计划预览失败');}finally{preview.disabled=false;}};section.append(preview);};
  addPreview('预览当前账号保留计划',[data.scope]);
  if(data.managedScopes?.length>1)addPreview('预览所有受管账号保留计划',[...new Set(data.managedScopes)]);
 }
 return section;
}
