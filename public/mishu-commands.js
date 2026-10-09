/** Codex slash commands are application controls, never native/model prompts. */
export function initMishuCommands({context,request,dialogs,toast,onOpen=()=>{},onChanged=()=>{},configureButton}) {
 let dialog=null,epoch=0;
 const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
 const identity=task=>JSON.stringify([task?.id,task?.user,task?.epoch]);
 function close(){++epoch;if(dialog){dialogs.hide(dialog);dialog.remove();dialog=null;}}
 function current(captured){const task=context();return identity(task)===identity(captured)&&!task?.busy;}
 function shell(title){close();onOpen();dialog=node('div',null,'modal-backdrop mishu-setup');const card=node('section',null,'modal mishu-setup-card');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label',title);const heading=node('h2',title),body=node('div',null,'mishu-setup-body'),footer=node('div',null,'mishu-setup-footer');card.append(heading,body,footer);dialog.append(card);document.body.append(dialog);dialogs.show(dialog,close);return {body,footer};}
 function cancel(footer){const b=node('button','取消');b.type='button';b.onclick=close;footer.append(b);}
 async function setup(){
  const captured={...context()};if(captured.engine!=='codex'||captured.busy)return;
  const {body,footer}=shell('MISHU 设置');body.textContent='正在读取联系对象…';cancel(footer);const occurrence=epoch;
  try{
   const data=await request({action:'setup_open',id:captured.id});if(epoch!==occurrence)return;if(!current(captured))throw Error('当前对话已改变，请重新打开设置');
   body.replaceChildren(node('p','选择已有对话。新对象限最近 72 小时；有效的旧对象可继续保留。'));const rows=new Map([...(data.conversations??[]),...(data.configuredTargets??[])].map(row=>[row.id,row]));const retained=new Set((data.configuredTargets??[]).map(row=>row.id));const selected=[];
   for(const row of rows.values()){const label=node('label',null,'mishu-contact'),input=node('input');input.type='checkbox';input.checked=retained.has(row.id);input.setAttribute('aria-label',row.title);label.append(input,node('span',`${row.title} · ${row.engine} · ${row.project}`));body.append(label);selected.push({row,input});}
   const permission=node('select');permission.setAttribute('aria-label','消息权限');for(const [value,title] of [['information','仅信息通知'],['execution','允许授权执行']]){const option=node('option',title);option.value=value;permission.append(option);}permission.value='information';body.append(node('p','消息权限'),permission);
   const next=node('button','完成选择');next.type='button';footer.prepend(next);
   next.onclick=()=>{
    if(!current(captured)){toast('当前对话已改变，请重新打开设置');close();return;}
    const targets=selected.filter(x=>x.input.checked).map(x=>({id:x.row.id,binding:x.row.binding}));if(!targets.length||targets.length>20){toast('请选择 1–20 个联系对象');return;}
    const allowInstructions=permission.value==='execution';body.replaceChildren(node('p',selected.filter(x=>x.input.checked).map(x=>x.row.title).join('\n')),node('p',allowInstructions?'允许按你的明确指令转达执行任务。目标原生权限问题仍由你处理。':'仅信息通知，不要求目标修改或开工。'),node('p','自动提醒当前不可用；你可以回来询问进度和回执。'));next.textContent='确认启用';
    next.onclick=async()=>{
     if(!current(captured)){toast('当前对话已改变，请重新打开设置');close();return;}for(const b of footer.querySelectorAll('button'))b.disabled=true;
     try{await request({action:'setup_confirm',id:captured.id,ticket:data.ticket,targets,allowInstructions});if(epoch!==occurrence)return;close();toast('MISHU 已启用');onChanged(captured.id);}
     catch(error){if(epoch===occurrence){body.append(node('p',error.message));next.disabled=true;footer.querySelectorAll('button')[1].disabled=false;}}
    };
   };
  }catch(error){if(epoch===occurrence)body.textContent=error.message;}
 }
 async function inspect(operation){
  const captured={...context()};const {body,footer}=shell('MISHU');body.textContent='正在读取…';cancel(footer);const occurrence=epoch;
  try{const data=await request({action:'inspect',id:captured.id,operation});if(epoch!==occurrence||identity(context())!==identity(captured))return;
   if(operation==='tasks'){body.textContent='';for(const task of data.tasks??[]){body.append(node('h3',task.purpose),node('p',[task.summary,task.nextStep,`状态：${task.workState} / ${task.observation}`,task.fact?.entries?.map(e=>e.text).join('\n')].filter(Boolean).join('\n')));}if(!body.children.length)body.textContent='暂无登记任务。';}
   else{body.textContent=data.enabled?'MISHU 协调已启用。':'MISHU 尚未启用协调。';if(data.source?.reason)body.append(node('p',data.source.reason));if(operation==='disable')onChanged(captured.id);}
  }catch(error){if(epoch===occurrence)body.textContent=error.message;}
 }
 function handle(text){
  if(context()?.engine!=='codex'||!/^\/mishu(?:-|\s|$)/.test(text.trim()))return false;
  const command=text.trim();if(context()?.busy){toast('请等待当前轮次结束后使用 MISHU 控制');return true;}
  if(command==='/mishu-setup')void setup();
  else if(command==='/mishu'||command==='/mishu-tasks'||command==='/mishu-disable')void inspect(command==='/mishu'?'status':command.slice(7));
  else toast('当前 Codex 的无工具汇报、自动提醒及历史授权恢复不可用；使用 /mishu-tasks 查看事实，或直接询问秘书。');
  return true;
 }
 configureButton?.addEventListener('click',()=>void setup());
 return {handle,setup,close};
}
