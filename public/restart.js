export const RESTART_COMMAND={name:'restart',source:'web',description:'重启 Web 和 Host（会停止运行中的 Agent）'};
export const isRestart=text=>/^\/restart(?:\s|$)/i.test(String(text).trim());
const key='coffee-maintenance-restart';
const messages={restart_forbidden:'只有配置的运维账号可以重启服务',restart_unconfigured:'管理员尚未配置重启服务',restart_busy:'已有重启操作正在执行',restart_cooldown:'刚执行过重启，请稍后再试'};
export function createRestartController({notify,accepted=()=>{},request=(...args)=>fetch(...args),storage=globalThis.sessionStorage,confirm=message=>globalThis.confirm(message),newId=()=>crypto.randomUUID(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 let pending=false,work=Promise.resolve();
 const remember=id=>{try{id?storage.setItem(key,id):storage.removeItem(key);}catch{}};
 async function status(options,id){const response=await request('/api/restart'+(id?'?id='+encodeURIComponent(id):''),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000),...options});
  if(response.status===401){const error=Error('服务需要登录，请重新登录后查看重启结果');error.code='login_required';throw error;}
  const body=await response.json();if(!response.ok)throw Error(messages[body.error]||'无法读取或提交重启操作');return body;
 }
 async function monitor(id){
  const until=Date.now()+960000;let unavailable=false;
  while(Date.now()<until){
   try{
    const body=await status(undefined,id),op=body.operation;
    if(op?.id===id){
     if(op.phase==='succeeded'||op.phase==='failed'){remember(null);notify(op.phase==='succeeded'?'Web 和 Host 已重启，健康检查通过':'重启未完成，请检查运维日志；不会自动重试');return;}
    }else{remember(null);notify('没有当前账号可查看的重启回执，请检查服务状态');return;}
   }catch(error){if(error.code==='login_required'){notify(error.message);return;}if(!unavailable){notify('服务正在重启，等待连接恢复…');unavailable=true;}}
   await wait(2000);
  }
  notify('尚未收到重启结果，请检查服务状态；不会再次提交');
 }
 async function execute(text){
  try{
   const state=await status();
   if(!state.available){notify(messages.restart_unconfigured);return;}
   if(state.busy){notify(messages.restart_busy);return;}
   if(!await confirm('重启 Web 和 Host 会短暂断开所有网页连接，并停止所有正在运行的 Agent。历史和文件会保留，未完成指令不会自动重发。确认重启？'))return;
   const id=newId();remember(id);
   try{await status({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,confirmed:true})});accepted(text);notify('已提交重启，等待 Web 和 Host 恢复…');}
   catch(error){if(!(error instanceof TypeError)&&error.name!=='TimeoutError'){remember(null);throw error;}notify('提交结果未知，正在查询回执；不会自动重发');}
   await monitor(id);
  }catch(error){notify(error.message);}finally{pending=false;}
 }
 return {
  handle(text){if(!isRestart(text))return false;if(String(text).trim().toLowerCase()!=='/restart'){notify('请只输入 /restart，不需要附加参数');return true;}if(pending){notify(messages.restart_busy);return true;}pending=true;work=execute(text);return true;},
  settled:()=>work,
  async restore(){let id;try{id=storage.getItem(key);}catch{}if(!id||pending)return;pending=true;try{await monitor(id);}finally{pending=false;}},
 };
}
