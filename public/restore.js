/** Render only server-returned scoped operations. Actor privileges are enforced
 * by Host; these controls preserve the reviewed revision and digest. */
export function renderRestoreControls({data,output,request,signal,current,refresh}){
 const section=document.createElement('section'),heading=document.createElement('h3');heading.textContent='找回任务 · 管理员审核后接回';section.append(heading);
 const help=document.createElement('p');help.textContent='先隔离提取并验证，再批准本次修订，最后明确确认接回原路径。默认只找回缺失任务；历史输入不会自动执行。配置与凭证需要重新配置及认证。';section.append(help);
 const operate=async(button,body)=>{button.disabled=true;try{await request(body,signal);if(current())await refresh();}catch(error){if(current()){const message=document.createElement('p');message.textContent=error.message||'恢复操作失败';section.append(message);}}finally{button.disabled=false;}};
 for(const job of data.repository?.jobs||[]){if(job.state!=='succeeded'||job.retiredAt)continue;for(const point of job.points||[]){
  const row=document.createElement('p'),label=document.createElement('span');label.textContent=`${point.taskId} · ${point.captureAt} `;
  const button=document.createElement('button');button.type='button';button.textContent='请求找回此任务';button.onclick=()=>void operate(button,{action:'restore-request',scope:data.scope,taskId:point.taskId,jobId:job.id});row.append(label,button);section.append(row);
 }}
 for(const operation of data.restores||[]){
  const row=document.createElement('section'),label=document.createElement('p');label.textContent=`恢复 ${operation.id} · ${operation.taskId} · ${operation.state} · 阶段 ${operation.phase||''} · 修订 ${operation.revision}`;row.append(label);
  for(const message of [operation.errorCode,...operation.warnings||[],...operation.originalPaths||[]].filter(Boolean)){const line=document.createElement('p');line.textContent=message;row.append(line);}
  if(operation.checkpointId){const point=document.createElement('p');point.textContent=`已验证检查点 ${operation.checkpointId} · 计划摘要 ${operation.digest}`;row.append(point);}
  const action=(name,action)=>{const button=document.createElement('button');button.type='button';button.textContent=name;button.onclick=()=>void operate(button,{action,id:operation.id,scope:data.scope,revision:operation.revision,...(operation.digest?{digest:operation.digest}:{})});row.append(button);};
  const blocked=data.repository?.activationUnavailable;
  if(data.canManage&&!blocked){
   if(operation.state==='requested')action('隔离提取并制定计划','restore-plan');
   if(operation.state==='staged')action('批准此修订','restore-approve');
   if(['approved','publishing','failed'].includes(operation.state)&&operation.digest)action('确认接回原路径','restore-publish');
   if(['staged','approved'].includes(operation.state))action('重新制定修订','restore-revise');
  }
  if(!['completed','completed-after-cancel','cancelled'].includes(operation.state))action('撤回恢复请求','restore-cancel');
  section.append(row);
 }
 output.append(section);
}
