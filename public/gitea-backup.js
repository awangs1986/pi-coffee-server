/** Owner-only service controls. Trusted commands and private paths are configured locally. */
export function renderGiteaBackup({data,output,request,signal,current,refresh}){
 if(!data.personal||!data.canManage||!data.gitea)return;
 const service=data.gitea,section=document.createElement('section');output.append(section);
 const text=value=>{const p=document.createElement('p');p.textContent=value;section.append(p);};
 const heading=document.createElement('h3');heading.textContent='Gitea 与登录配置';section.append(heading);
 text(service.configured?`Gitea ${service.version} · ${service.allowServicePause?'已配置 Gitea 短暂停写窗口':'需要本地停写窗口'}`:'尚未配置 Gitea 备份');
 if(service.last)text(`最近服务作业：${service.last.state}${service.last.captureAt?' · 采集于 '+service.last.captureAt:''}${service.last.errorCode?' · '+service.last.errorCode:''}${service.last.warning?' · '+service.last.warning:''}`);
 function button(label,body){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await request(body,signal);if(current())await refresh();}catch(error){if(current())text(error.message||'Gitea 操作失败');}finally{b.disabled=false;}};section.append(b);}
 if(service.configured)button('备份 Gitea 与登录配置',{action:'gitea-backup'});
 for(const point of service.points||[]){text(`服务恢复点 ${point.id} · ${point.state} · ${point.points?.[0]?.captureAt||'采集时间未知'}${point.retiredAt?' · 已回收':''}`);if(point.state==='succeeded'&&!point.retiredAt)button('预览恢复 Gitea',{action:'gitea-preview',jobId:point.id});}
 for(const plan of service.restores||[]){text(`恢复 ${plan.id} · ${plan.state}${plan.errorCode?' · '+plan.errorCode:''}`);for(const target of plan.targets||[])text(`${target.replaces?'替换并保留原资料':'恢复缺失目录'}：${target.path}`);if(plan.state!=='completed')button('确认恢复 Gitea',{action:'gitea-confirm',id:plan.id,digest:plan.digest});}
}
