/** Schedule status is account-scoped by Host. No polling or model reminders. */
export function renderBackupSchedule(data,{request,refresh,isCurrent}){
 const schedule=data.schedule;if(!schedule)return null;
 const section=document.createElement('section');
 const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=value;section.append(node);return node;};
 text('h3','每日备份计划');
 const policy=schedule.schedule;
 text('p',policy?`每天 ${String(policy.hour).padStart(2,'0')}:${String(policy.minute).padStart(2,'0')} · ${policy.timeZone}`:'尚未配置每日计划');
 text('p',schedule.workerState==='recent'?`最近调度检查：${schedule.lastCheckedAt}`:schedule.workerState==='overdue'?`最近调度检查已超过 2 分钟：${schedule.lastCheckedAt}`:'尚未观察到独立调度进程运行；保存计划后需要完成服务启用');
 if(schedule.coverage){
  const names={complete:'Pi / Codex 范围完整',partial:'部分任务未保护',stale:'恢复点已过期',unknown:'覆盖范围尚未核实'};
  text('p',names[schedule.coverage.state]||schedule.coverage.state);
  if(schedule.coverage.repositoryAvailable===false)text('p','备份仓库暂不可用；显示上次确认的恢复点，当前覆盖范围尚未核实');
  for(const point of schedule.coverage.points||[])text('p',`${point.taskId} · 检查点采集时间 ${point.captureAt}`);
  if(schedule.coverage.unprotected?.length)text('p','未保护任务：'+schedule.coverage.unprotected.join('、'));
  if(schedule.coverage.excluded?.length)text('p','延期排除：'+schedule.coverage.excluded.map(task=>`${task.taskId} (${task.engine})`).join('、'));
 }
 for(const run of schedule.runs||[])text('p',`${run.date} · ${run.state} · 作业结束时间 ${run.finishedAt||'尚未结束'}`);
 for(const alert of schedule.alerts||[])text('p',`${alert.resolvedAt?'已解决':'未解决'}告警 ${alert.kind}：${alert.message}${alert.resolvedAt?' · '+alert.resolvedAt:''}`);
 if(data.canManage&&!data.repository?.activationUnavailable&&data.managedScopes?.length){
  const time=document.createElement('input');time.type='time';time.setAttribute('aria-label','每日备份时间');time.value=policy?`${String(policy.hour).padStart(2,'0')}:${String(policy.minute).padStart(2,'0')}`:'04:00';
  const zone=document.createElement('input');zone.setAttribute('aria-label','备份时区');zone.value=policy?.timeZone||'America/Toronto';
  const save=document.createElement('button');save.type='button';save.textContent='保存每日计划';
  save.onclick=async()=>{save.disabled=true;try{const [hour,minute]=time.value.split(':').map(Number);await request({action:'schedule-configure',revision:crypto.randomUUID(),scopes:data.managedScopes,timeZone:zone.value,hour,minute});if(isCurrent())await refresh();}catch(error){if(isCurrent())text('p',error.message||'每日计划保存失败');}finally{save.disabled=false;}};
  section.append(time,zone,save);
 }
 return section;
}
