export async function githubAccountRequest(input){
 const response=await fetch('/api/github-accounts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'GitHub 账号操作失败');return result;
}
export function initGitHubAccounts({onOpen=()=>{},projects=()=>[],bind=async()=>{},task=()=>null,bindTask=async()=>{}}={}){
 const $=id=>document.getElementById(id),dialog=$('github-accounts-dialog');let busy=false,epoch=0;
 const status=text=>{$('github-accounts-status').textContent=text;};
 const action=async work=>{if(busy)return;busy=true;epoch++;$('github-accounts-refresh').disabled=true;try{await work();}catch(error){status(error.message);}finally{busy=false;$('github-accounts-refresh').disabled=false;}};
 async function refresh(){if(!busy)await load();}
 async function load(){
  const sequence=++epoch;status('正在读取…');
  try{
   const data=await githubAccountRequest({action:'list'});if(sequence!==epoch)return;
   $('github-connect').disabled=!data.oauthConfigured;
   status(data.oauthConfigured?'GitHub 项目使用项目账号；Gitea 对话可单独选择 GitHub 账号。解除绑定后，后续 GitHub 操作会停止。':'管理员尚未配置 GitHub OAuth App，暂时无法添加账号。');
   const current=task(),taskRow=$('github-task-row'),clear=$('github-task-clear');
   taskRow.hidden=!current;
   if(current){
    const login=data.accounts.find(a=>a.id===current.githubAccountId)?.login;
    $('github-task-summary').textContent='当前对话：'+current.name+' · GitHub：'+(login||(current.githubAccountId?'账号已断开':'尚未选择'));
    clear.hidden=!current.githubAccountId;
    clear.onclick=()=>void action(async()=>{
     if(task()?.id!==current.id)throw Error('当前对话已切换，请刷新后再操作');
     status('正在取消当前对话的 GitHub 授权…');await bindTask(current.id,null);await load();status('已取消该对话的 GitHub 授权，账号连接仍保留。');
    });
   }
   const list=$('github-accounts-list');list.replaceChildren();
   if(!data.accounts.length){const p=document.createElement('p');p.textContent='尚未连接 GitHub 账号';list.append(p);}
   const legacy=$('github-legacy-project');legacy.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='选择尚未绑定的旧 GitHub 项目';legacy.append(empty);
   for(const project of projects().filter(p=>p.forge==='github'&&!p.githubAccountId)){const option=document.createElement('option');option.value=project.id;option.textContent=project.name;legacy.append(option);}
   $('github-legacy-row').hidden=legacy.options.length===1;
   for(const account of data.accounts){
    const row=document.createElement('div');row.className='runner-row';const name=document.createElement('strong');name.textContent=account.login;row.append(name);
    const actions=document.createElement('div');actions.className='runner-actions';
    if(current){
     const button=document.createElement('button');button.type='button';button.className='btn small';
     button.textContent=current.githubAccountId===account.id?'当前对话正在使用':'用于当前对话';button.disabled=current.githubAccountId===account.id;
     button.addEventListener('click',()=>void action(async()=>{
      if(task()?.id!==current.id)throw Error('当前对话已切换，请刷新后再操作');
      status('正在为当前对话设置 '+account.login+'…');await bindTask(current.id,account.id);await load();status(current.name+' 已使用 '+account.login+'，可继续访问 GitHub。');
     }));actions.append(button);
    }
    for(const [key,label] of [['check','检查授权'],['bind','绑定旧项目'],['delete','解除绑定']]){
     if(key==='bind'&&legacy.options.length===1)continue;
     const button=document.createElement('button');button.type='button';button.className='btn small';button.textContent=label;if(key==='delete')button.dataset.accountDelete=account.id;
     button.addEventListener('click',()=>void action(async()=>{
      let boundProject;
      if(key==='delete'&&!confirm('解除 '+account.login+' 的绑定？使用该账号的任务将无法继续访问 GitHub。'))return;
      if(key==='bind'){if(!legacy.value)throw Error('请先选择旧项目');boundProject=legacy.selectedOptions[0].textContent;status('正在绑定 '+boundProject+'…');await bind(legacy.value,account.id);}
      else await githubAccountRequest({action:key,id:account.id});
      await load();if(key==='check')status(account.login+' 授权可用');
      if(key==='bind')status(boundProject+' 已绑定到 '+account.login+'。');
     }));actions.append(button);
    }row.append(actions);list.append(row);
   }
  }catch(error){if(sequence===epoch)status(error.message);}
 }
 function open(){onOpen();dialog.showModal();void refresh();}
 $('github-accounts-btn').addEventListener('click',open);$('github-accounts-close').addEventListener('click',()=>{epoch++;dialog.close();});$('github-accounts-refresh').addEventListener('click',()=>void refresh());
 $('github-connect').addEventListener('click',()=>{
  if(busy)return;const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;
  void action(async()=>{try{const result=await githubAccountRequest({action:'connect'});if(popup)popup.location.href=result.authorizeUrl;else throw Error('请允许弹出窗口后重试');status('请在 GitHub 选择账号并授权，完成后点击刷新。');}catch(error){popup?.close();throw error;}});
 });
 window.addEventListener('focus',()=>{if(dialog.open&&!busy)void refresh();});return {open,refresh};
}
