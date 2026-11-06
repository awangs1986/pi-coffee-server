const phases={accepted:'已接受',readiness:'检查 Agent',workspace:'准备工作目录','source-snapshot':'读取源对话','native-binding':'准备原生会话','summary-binding':'准备摘要会话',summary:'生成交接摘要','seed-binding':'准备目标会话',seed:'写入交接内容',settings:'恢复模型设置',cleanup:'清理准备资源',publication:'发布任务',completed:'准备完成',resume:'恢复准备'};
export const preparationLabel=operation=>operation.status==='uncertain'?'结果未确认，资料已保留；请检查后再继续。'+(operation.error||''):operation.error||phases[operation.phase]||'准备中';
/** A lost HTTP reply only permits reading the same identity, never another start. */
export async function prepareTask(input,{request,active=()=>true,changed=()=>{},queryOnly=false}={}){
 const call=async value=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{return await request(value,{signal:controller.signal});}finally{clearTimeout(timer);}};
 let operation;
 if(!queryOnly){
  try{operation=await call({action:'preparation_start',...input});}
  catch(error){if(error.status>=400&&error.status<500)throw error;operation=await call({action:'preparation_get',operationId:input.operationId});}
 }
 while(active()){
  operation??=await call({action:'preparation_get',operationId:input.operationId});changed(operation);
  if(operation.status==='completed')return operation.task;
  if(['failed','cancelled','uncertain'].includes(operation.status))throw Object.assign(Error(preparationLabel(operation)),{operation});
  await new Promise(resolve=>setTimeout(resolve,750));operation=undefined;
 }
 throw Error('已停止查看准备进度；后台操作保留，请重新打开核对');
}

/** Compatibility only for Hosts that do not advertise durable preparation. */
export async function prepareLegacyTask(input,request){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),130000);
 try{return await request(input,{signal:controller.signal});}
 catch(error){if(controller.signal.aborted)throw Error('创建确认超时；首条消息已保留。重试会沿用同一任务，不会重复创建。');throw error;}
 finally{clearTimeout(timer);}
}

export function initPreparationRecovery({request,complete,toast,scope=()=>''}){
 const $=id=>document.getElementById(id),dialog=$('preparation-dialog');let current=null,owner=null,busy=false;
 function render(){
  if(!current)return;$('preparation-status').textContent=preparationLabel(current);
  for(const [action,id] of [['cancel','preparation-stop'],['resume','preparation-resume']]){const button=$(id);button.hidden=!current.allowedActions?.includes(action);button.disabled=busy;}
 }
 async function act(action){
  if(busy||!current?.allowedActions?.includes(action)||owner!==scope())return;
  const operation=current,actor=owner;busy=true;render();
  try{
   await request({action:'preparation_'+action,operationId:operation.operationId,expectedRevision:operation.revision});
   const task=await prepareTask(operation,{request,queryOnly:true,active:()=>owner===actor&&scope()===actor,changed:value=>{current=value;render();}});
   if(scope()!==actor)return;dialog.close();complete(task);
  }catch(error){if(scope()!==actor)return;if(error.operation)current=error.operation;else current=await request({action:'preparation_get',operationId:operation.operationId}).catch(()=>current);toast(error.message);}
  finally{busy=false;render();}
 }
 $('preparation-close').addEventListener('click',()=>dialog.close());
 $('preparation-stop').addEventListener('click',()=>{void act('cancel');});
 $('preparation-resume').addEventListener('click',()=>{void act('resume');});
 return {open(operation){current=operation;owner=scope();render();dialog.showModal();}};
}
