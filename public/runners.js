// User-scoped metadata only; Host owns SSH, credentials and native instructions.
export function initRunners({onOpen}) {
 const $=id=>document.getElementById(id),dialog=$('runners-dialog'),form=$('runner-form');
 let rows=[],editing=null,busy=false,epoch=0,available=false;
 const status=(message,error=false)=>{$('runners-status').textContent=message;$('runners-status').classList.toggle('error',error);};
 const controls=()=>{for(const node of dialog.querySelectorAll('input,select,button'))if(node.id!=='runners-close')node.disabled=busy||!available;};
 const request=async body=>{const response=await fetch('/api/runners',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(response.status===404?'此 VM 尚未启用测试服务器配置，请更新 Host。':data.error||'操作失败');return data;};
 function reset(){editing=null;form.reset();$('runner-password').value='';$('runner-form-title').textContent='添加服务器';$('runner-save').textContent='保存';$('runner-cancel-edit').classList.add('hidden');$('runner-password').placeholder='留空使用 VM 的 SSH 密钥';}
 function edit(row){editing=row.id;for(const key of ['name','host','port','username','platform','workdir'])$('runner-'+key).value=row[key];$('runner-password').value='';$('runner-clear-password').checked=false;$('runner-password').placeholder=row.hasPassword?'已保存，留空保持原密码':'留空使用 VM 的 SSH 密钥';$('runner-form-title').textContent='编辑服务器';$('runner-cancel-edit').classList.remove('hidden');$('runner-name').focus();}
 function render(){
  const list=$('runners-list');list.replaceChildren();
  if(!rows.length){const empty=document.createElement('p');empty.className='runner-help';empty.textContent='尚未配置，Agent 不会收到测试服务器提示。';list.append(empty);}
  for(const row of rows){
   const item=document.createElement('div');item.className='runner-row';
   const info=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
   title.textContent=row.name;detail.textContent=`${row.username}@${row.host}:${row.port} · ${row.platform==='windows'?'Windows':row.platform==='wsl'?'WSL':'Linux'} · ${row.hasPassword?'密码':'SSH 密钥'}`;
   info.append(title,detail);item.append(info);
   const actions=document.createElement('div');actions.className='runner-actions';
   for(const [action,label] of [['test','测试连接'],['edit','编辑'],['delete','删除']]){
    const button=document.createElement('button');button.type='button';button.className='btn small';button.textContent=label;button.dataset.runnerAction=action;
    button.addEventListener('click',()=>{if(busy)return;if(action==='edit'){edit(row);return;}void perform(async()=>{
     status(action==='test'?'正在连接…':'正在删除…');const data=await request({action,id:row.id});
     if(action==='test')return ()=>status(data.message,!data.ok);
     const list=await request({action:'list'});return ()=>{rows=list.runners;if(editing===row.id)reset();render();status('已删除。下次启动 Agent 时应用。');};
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
  await perform(async()=>{const data=await request({action:'list'});return ()=>{rows=data.runners;available=true;render();status('配置在下次启动 Agent 时生效，正在运行的任务不受影响。');};});
 }
 $('runners-btn').addEventListener('click',()=>void open());
 $('runners-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{epoch++;reset();$('brand-menu-btn').focus();});
 $('runner-cancel-edit').addEventListener('click',reset);
 form.addEventListener('submit',event=>{
  event.preventDefault();if(busy||!available)return;
  const runner={...(editing?{id:editing}:{}),name:$('runner-name').value.trim(),host:$('runner-host').value.trim(),port:Number($('runner-port').value),username:$('runner-username').value.trim(),platform:$('runner-platform').value,workdir:$('runner-workdir').value.trim(),password:$('runner-password').value,clearPassword:$('runner-clear-password').checked};
  $('runner-password').value='';
  void perform(async()=>{status('正在保存…');await request({action:'save',runner});const list=await request({action:'list'});return ()=>{rows=list.runners;reset();render();status('已保存。新启动的 Agent 会按需读取配置。');};});
 });
 return {close:()=>{if(dialog.open)dialog.close();}};
}
