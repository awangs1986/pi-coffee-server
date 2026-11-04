/** Minimal owner collection status; native details remain in each account plan. */
export function renderPersonalCollections({data,output,request,signal,current,refresh}){
 if(!data.personal||!data.canManage)return;
 for(const operation of data.collectionRestores||[]){
  const section=document.createElement('section'),title=document.createElement('h3');title.textContent=`所选账号恢复 · ${operation.state}`;section.append(title);
  for(const account of operation.accounts||[]){
   const line=document.createElement('p');line.textContent=`${account.scope} · ${account.state}${account.blocked?' · 材料不完整':''}`;section.append(line);
   for(const row of account.rows||[]){const text=document.createElement('p');text.textContent=`${row.taskId} · ${row.state} · 原生会话 ${(row.nativeBindings||[]).join('、')}${row.errorCode?' · '+row.errorCode:''}`;section.append(text);}
  }
  const action=(label,name)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=async()=>{button.disabled=true;try{await request({action:name,id:operation.id,...(name==='collection-confirm'?{digest:operation.digest}:{})},signal);if(current())await refresh();}catch(error){if(current()){const line=document.createElement('p');line.textContent=error.message||'恢复失败';section.append(line);}}finally{button.disabled=false;}};section.append(button);};
  if(operation.errorCode){const line=document.createElement('p');line.textContent=operation.errorCode;section.append(line);}
  if(operation.digest&&!operation.cancelRequested&&!operation.accounts?.some(a=>a.blocked)&&['staged','publishing','partial'].includes(operation.state))action(operation.state==='staged'?'确认恢复全部所选账号':'继续恢复所选账号','collection-confirm');
  if(!['completed','cancelled'].includes(operation.state))action('取消未完成的账号恢复','collection-cancel');
  output.append(section);
 }
}
