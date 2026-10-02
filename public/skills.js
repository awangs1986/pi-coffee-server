// Browser management only. Source fetching, native discovery and file changes belong to Host.
export function initSkills({context,onOpen,onClose,onChanged,notify}) {
 const $=selector=>document.querySelector(selector),page=$('#skills-page');
 let epoch=0,busy=false,available=false,preview=null;
 const make=(tag,className,text)=>{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;};
 const scope=()=>({engine:$('#skills-engine').value,scope:$('#skills-scope').value,...($('#skills-scope').value==='project'?{conversationId:context().id}:{})});
 const request=async value=>{
  const response=await fetch('/api/skills',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
  const data=await response.json();if(!response.ok)throw new Error(response.status===404?'此 VM 尚未启用 Skills 管理，请先更新 Host。':data.error||'Skill 操作失败');return data;
 };
 function controls(){
  const task=context(),project=task.kind==='project'&&task.id&&task.engine===$('#skills-engine').value;
  $('#skills-scope').querySelector('option[value="project"]').disabled=!project;
  if(!project)$('#skills-scope').value='user';
  for(const node of page.querySelectorAll('input,select,button'))if(node.id!=='skills-close')node.disabled=busy||node.dataset.skillUnavailable==='true';
  $('#skills-install').disabled=busy||!available||Boolean(preview&&!selectedSkills().length);$('#skills-install').textContent=preview?`安装所选（${selectedSkills().length}）`:'读取 Skill 列表';$('#skills-reload').disabled=busy||!available||!task.id||task.engine!==$('#skills-engine').value;
 }
 function selectedSkills(){return [...$('#skill-candidates').querySelectorAll('input:checked:not([data-skill-unavailable="true"])')].map(node=>node.dataset.skillSubdir);}
 function resetSource(){preview=null;$('#skill-candidates').replaceChildren();$('#skill-candidates').classList.add('hidden');$('#skills-read-again').classList.add('hidden');}
 function renderSource(selected=[]){
  const list=$('#skill-candidates');list.replaceChildren();list.classList.remove('hidden');$('#skills-read-again').classList.remove('hidden');
  list.append(make('p','skills-help',`${preview.skills.length} 个 Skill · ${preview.revision.slice(0,12)} · 勾选后安装`));
  const search=document.createElement('input');search.type='search';search.placeholder='搜索 Skill';search.setAttribute('aria-label','搜索仓库中的 Skill');
  search.addEventListener('input',()=>{const query=search.value.trim().toLowerCase();for(const row of list.querySelectorAll('.skill-candidate'))row.classList.toggle('hidden',!row.textContent.toLowerCase().includes(query));});list.append(search);
  const selection=make('div','skill-actions','');
  for(const [id,label,checked] of [['skills-select-all','全选可安装项',true],['skills-select-none','取消全选',false]]){
   const button=make('button','btn small',label);button.type='button';button.id=id;
   button.addEventListener('click',()=>{for(const row of list.querySelectorAll('.skill-candidate:not(.hidden)')){const check=row.querySelector('input');if(check.dataset.skillUnavailable!=='true')check.checked=checked;}controls();});selection.append(button);
  }list.append(selection);
  for(const item of preview.skills){
   const row=make('label','skill-candidate',''),check=document.createElement('input');check.type='checkbox';check.dataset.skillSubdir=item.subdir;
   check.dataset.skillUnavailable=String(Boolean(item.installed||item.problem));check.checked=!item.installed&&!item.problem&&selected.includes(item.subdir);check.addEventListener('change',controls);
   const content=make('span','skill-candidate-content','');content.append(make('strong','',item.name),make('span','skill-path',item.subdir),make('span','skill-description',item.description));
   if(item.installed||item.problem||item.error)content.append(make('span',item.problem||item.error?'skills-error':'skill-state',item.problem||item.error||'已存在，不会覆盖'));
   row.append(check,content);list.append(row);
  }
  for(const warning of preview.warnings||[])list.append(make('p','skills-error',warning));
  controls();
 }
 function status(message,error=false){$('#skills-status').textContent=message;$('#skills-status').classList.toggle('error',error);}
 function close(){const wasOpen=!page.classList.contains('hidden');++epoch;page.classList.add('hidden');$('#app').classList.remove('skills-open');if(wasOpen)onClose?.();}
 function resetDetail(){$('#skill-detail').classList.add('hidden');$('#skill-content').textContent='';}
 async function refresh(){
  const current=++epoch;controls();resetDetail();available=false;$('#skills-list').replaceChildren();status('正在读取 VM Skills…');controls();
  try{
   const data=await request({action:'list',...scope()});if(current!==epoch)return;
   if(!Array.isArray(data.skills))throw new Error('VM 返回了无效的 Skill 列表');
   available=true;$('#skills-directory').textContent=data.directory;render(data.skills);
   status((data.warnings||[]).join(' · ')||'已读取 VM 中的 Skills。');
  }catch(error){if(current===epoch){available=false;status(error.message,true);}}
  finally{if(current===epoch)controls();}
 }
 async function action(kind,item){
  if(busy)return;const current=epoch,target=scope();busy=true;controls();
  try{
   const data=await request({action:kind,...target,...(item?{id:item.id}:{})});if(current!==epoch)return;
   if(kind==='detail'){
    $('#skill-detail').classList.remove('hidden');$('#skill-detail-title').textContent=item.name;$('#skill-content').textContent=data.content;$('#skill-detail').scrollIntoView?.({block:'nearest'});
   }else{onChanged?.(target);resetSource();await refresh();if(!page.classList.contains('hidden'))status('已保存。新启动的 Agent 会读取变更；当前任务空闲时可点击“重新加载当前任务”。');}
  }catch(error){if(current===epoch)status(error.message,true);else notify(error.message);}
  finally{busy=false;controls();}
 }
 function render(skills){
  const list=$('#skills-list');list.replaceChildren();
  if(!skills.length){list.append(make('p','skills-empty','此范围还没有 Skill。可从 Git 仓库安装。'));return;}
  for(const item of skills){
   const row=make('article','skill-card',''),head=make('div','skill-card-head','');
   head.append(make('h2','',item.name),make('span','skill-state',item.managed?(item.enabled?'Web 管理 · 已启用':'Web 管理 · 已停用'):!item.enabled?'已停用 · 保留备份':item.canDisable?'VM 已有 · 可停用':'插件或链接来源 · 只读'));
   row.append(head,make('p','skill-description',item.description),make('p','skill-path',item.path));
   if(item.repoUrl)row.append(make('p','skill-source',`${item.repoUrl} · ${item.ref} · ${item.revision?.slice(0,12)||'—'}`));
   if(item.modified||item.problem)row.append(make('p','skills-error',item.problem||'检测到本地修改，请先在 VM 处理，管理器不会覆盖。'));
   const actions=make('div','skill-actions','');
   for(const [kind,label] of [['detail','查看'],...(item.managed?[['update','更新'],[item.enabled?'disable':'enable',item.enabled?'停用':'启用']]:item.canDisable?[['disable_native','停用（保留备份）']]:item.canRestore?[['restore_native','恢复 VM 版本']]:[])]){
    const button=make('button','btn small',label);button.type='button';button.dataset.skillAction=kind;button.addEventListener('click',()=>action(kind,item));actions.append(button);
   }row.append(actions);list.append(row);
  }
 }
 async function open(){
  resetSource();onOpen();$('#skills-engine').value=context().engine||'pi';$('#skills-scope').value='user';page.classList.remove('hidden');$('#app').classList.add('skills-open');await refresh();$('#skills-engine').focus();
 }
 $('#skills-btn').addEventListener('click',open);$('#skills-close').addEventListener('click',()=>{close();$('#brand-menu-btn').focus();});
 for(const id of ['skills-engine','skills-scope'])$('#'+id).addEventListener('change',()=>{resetSource();void refresh();});
 $('#skills-refresh').addEventListener('click',()=>{resetSource();void refresh();});
 $('#skill-detail-close').addEventListener('click',resetDetail);
 for(const id of ['skill-url','skill-ref','skill-subdir'])$('#'+id).addEventListener('input',()=>{resetSource();controls();});
 $('#skills-read-again').addEventListener('click',()=>{resetSource();$('#skills-form').requestSubmit();});
 $('#skills-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!available)return;const current=epoch,target=scope();
  const selected=selectedSkills();if(preview&&!selected.length)return;
  busy=true;controls();
  try{
   if(!preview){
    status('正在读取仓库中的 Skills…');
    const source={repoUrl:$('#skill-url').value.trim(),ref:$('#skill-ref').value.trim()||'HEAD',subdir:$('#skill-subdir').value.trim()||'.'};
    const data=await request({action:'discover',...target,...source});if(current!==epoch)return;
    if(!Array.isArray(data.skills)||typeof data.revision!=='string')throw new Error('Host 未返回 Skill 列表，请更新 Host 后重试。');
    preview={...data,source};renderSource();status(data.skills.length?'请选择需要安装的 Skill。':'未发现有效的 SKILL.md，请检查仓库、分支或子目录。',!data.skills.length);
   }else{
    const batch=preview;let installed=0,failed=0;
    for(const subdir of selected){
     if(current!==epoch)break;
     const item=batch.skills.find(s=>s.subdir===subdir);status(`正在安装 ${item.name}（${installed+failed+1}/${selected.length}）…`);
     try{await request({action:'install',...target,...batch.source,subdir,expectedRevision:batch.revision});item.installed=true;delete item.error;installed++;}
     catch(error){item.error=error.message;failed++;}
    }
    if(installed)onChanged?.(target);
    const message=`安装结果：${installed} 成功，${failed} 失败。`;
    if(current!==epoch){notify(message+' 未开始的项目已停止。');return;}
    renderSource(selected);await refresh();
    if(!page.classList.contains('hidden'))status(message+(installed?' 新启动的 Agent 会读取变更。':''),failed>0);
   }
  }catch(error){if(current===epoch)status(error.message,true);else notify(error.message);}
  finally{busy=false;controls();}
 });
 $('#skills-reload').addEventListener('click',async()=>{
  if(busy)return;const current=epoch;busy=true;controls();status('正在检查当前任务是否空闲…');
  try{await request({action:'reload',...scope(),conversationId:context().id});if(current===epoch)status('已请求重新加载，历史记录保留；正在运行或有后台工作的任务不会被停止。');}
  catch(error){if(current===epoch)status(error.message,true);}finally{busy=false;controls();}
 });
 return {close,isOpen:()=>!page.classList.contains('hidden')};
}
