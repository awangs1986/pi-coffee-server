// User-scoped metadata only; Host owns SSH, credentials and native instructions.
export function initRunners({onOpen}) {
 const $=id=>document.getElementById(id),dialog=$('runners-dialog'),form=$('runner-form');
 let rows=[],editing=null,busy=false,epoch=0,available=false;
 const status=(message,error=false)=>{$('runners-status').textContent=message;$('runners-status').classList.toggle('error',error);};
 const controls=()=>{for(const node of dialog.querySelectorAll('input,select,button'))if(node.id!=='runners-close')node.disabled=busy||!available;};
 const request=async body=>{const response=await fetch('/api/runners',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(response.status===404?'此 VM 尚未启用测试服务器配置，请更新 Host。':data.error||'操作失败');return data;};
 function reset(){editing=null;form.reset();$('runner-password').value='';$('runner-form-title').textContent='Windows 电脑';$('runner-save').textContent='保存';$('runner-password').placeholder='留空使用 VM 的 SSH 密钥';}
 function edit(row){editing=row.id;for(const key of ['name','host','port','username','workdir'])$('runner-'+key).value=row[key];$('runner-password').value='';$('runner-clear-password').checked=false;$('runner-password').placeholder=row.hasPassword?'已保存，留空保持原密码':'留空使用 VM 的 SSH 密钥';$('runner-form-title').textContent='Windows 电脑';}
 function render(){
  const list=$('runners-list');list.replaceChildren();
  const windows=rows.find(r=>r.platform==='windows');if(windows)edit(windows);
  if(!rows.length){const empty=document.createElement('p');empty.className='runner-help';empty.textContent='尚未配置，Agent 不会收到测试服务器提示。';list.append(empty);}
  for(const row of rows){
   const item=document.createElement('div');item.className='runner-row';
   const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
   title.textContent=row.name;detail.textContent=`${row.username}@${row.host}:${row.port} · ${row.platform==='windows'?'Windows + WSL':'旧配置'} · ${row.hasPassword?'密码':'SSH 密钥'}`;
   info.append(title,detail);item.append(info);
   const actions=document.createElement('div');actions.className='runner-actions';
   for(const [action,label] of [['test','测试连接'],['delete','清除配置']]){
    const button=document.createElement('button');button.type='button';button.className='btn small';button.textContent=label;button.dataset.runnerAction=action;
    button.addEventListener('click',()=>{if(busy)return;void perform(async()=>{
     status(action==='test'?'正在连接…':'正在删除…');const data=await request({action,id:row.id});
     if(action==='test')return ()=>status(data.message,!data.ok);
     const list=await request({action:'list'});return ()=>{rows=list.runners;if(editing===row.id)reset();render();status('已清除。各对话会在下一轮消息中得知测试服务器已移除。');};
    });});actions.append(button);
   }item.append(actions);list.append(item);
  }
 }
 async function perform(work){
  if(busy)return;const current=epoch;busy=true;controls();
  try{const apply=await work();if(current===epoch)apply?.();}
  catch(error){if(current===epoch)status(error.message,true);}
  finally{busy=false;controls();}
 }
 async function open(){
  if(busy)return;onOpen();epoch++;reset();rows=[];render();available=false;
  if(!dialog.open)dialog.showModal();
  await perform(async()=>{const data=await request({action:'list'});return ()=>{rows=data.runners;available=true;render();status('这是当前账号 Work 任务共用的测试目标；Chat 不会接收这些指引。更新在 Work 下一轮消息时生效，不打断运行中的任务。');};});
 }
 $('runners-btn').addEventListener('click',()=>void open());
 $('runners-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{epoch++;reset();$('brand-menu-btn').focus();});
 form.addEventListener('submit',event=>{
  event.preventDefault();if(busy||!available)return;
  const runner={...(editing?{id:editing}:{}),name:$('runner-name').value.trim(),host:$('runner-host').value.trim(),port:Number($('runner-port').value),username:$('runner-username').value.trim(),platform:'windows',workdir:$('runner-workdir').value.trim(),password:$('runner-password').value,clearPassword:$('runner-clear-password').checked};
  $('runner-password').value='';
  void perform(async()=>{status('正在保存…');await request({action:'save',runner});const list=await request({action:'list'});return ()=>{rows=list.runners;reset();render();status('已保存。新旧对话将在下一轮消息中获得配置指引，按需用于测试。');};});
 });
 return {close:()=>{if(dialog.open)dialog.close();}};
}
