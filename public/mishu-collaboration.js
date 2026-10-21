import {randomId} from './ids.js';
/** Ordinary product decisions stay outside the native permission dialog. */
export function initMishuCollaboration({button,context,request,dialogs,toast}){
 let source=null,sequence=0;
 const overlay=document.createElement('div');overlay.className='modal-overlay hidden';overlay.dataset.mishuCollaboration='';
 Object.assign(overlay.style,{position:'fixed',inset:'0',display:'grid',placeItems:'center',padding:'12px',background:'rgba(0,0,0,.5)'});
 const panel=document.createElement('section');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','MISHU 协作与待决定事项');panel.setAttribute('aria-modal','true');
 Object.assign(panel.style,{display:'flex',flexDirection:'column',gap:'12px',width:'min(720px,100%)',maxHeight:'calc(100dvh - 24px)',minHeight:'0',background:'var(--bg,#ffffff)',color:'var(--text,#171717)',padding:'16px',borderRadius:'12px',boxSizing:'border-box'});
 overlay.append(panel);document.body.append(overlay);
 const heading=document.createElement('h2');heading.textContent='MISHU 协作';panel.append(heading);
 const tabs=document.createElement('nav');tabs.setAttribute('aria-label','MISHU 协作内容');panel.append(tabs);
 const body=document.createElement('div');Object.assign(body.style,{overflowY:'auto',minHeight:'0',overflowWrap:'anywhere'});panel.append(body);
 const footer=document.createElement('div'),closeButton=makeButton('关闭',close);footer.append(closeButton);panel.append(footer);
 let tab='clarifications';
 function makeButton(label,action){const element=document.createElement('button');element.type='button';element.textContent=label;element.addEventListener('click',()=>void action());return element;}
 function text(parent,value,tag='p'){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}
 function current(){const c=context();return source&&c&&c.id===source.id&&c.user===source.user&&c.epoch===source.epoch;}
 function close(){sequence++;source=null;dialogs.hide(overlay);}
 async function call(input){if(!current())throw Error('秘书已切换，请重新打开');const result=await request({id:source.id,...input});if(!current())throw Error('秘书已切换，请重新打开');return result;}
 async function refresh(){const ticket=++sequence;body.replaceChildren();text(body,'正在读取…');try{const data=await call({action:tab,version:1,operation:'list'});if(ticket!==sequence||!current())return;body.replaceChildren();if(tab==='collaboration')renderProgress(data);else if(tab==='followups'){const related=await call({action:'collaboration',version:1,operation:'list',limit:50});if(ticket===sequence&&current())renderPlans(data,related.items||[]);}else renderQuestions(data);}catch(error){if(ticket===sequence&&current()){body.replaceChildren();text(body,error.message);}}}
 function renderPlans(data,tasks){
  text(body,'默认没有自动往返。只有你在这里明确授权的既有事项，收到相关新回信后才进行有限信息联系；不会执行新任务、创建会话或代答原生审批。没有新事实保持安静。停止计划不会停止目标工作。');
  for(const plan of data.plans||[]){const card=document.createElement('article');body.append(card);text(card,plan.text,'h3');text(card,`${plan.state} · 已用 ${plan.used} / ${plan.maxTotal} 次；每负责人最多 ${plan.maxPerTarget} 次`);
   for(const target of plan.targets||[])text(card,`${tasks.find(t=>t.taskId===target.taskId)?.purpose||'已登记事项'}：已用 ${target.used} 次`);
   text(card,plan.reason||'剩余责任：等待相关新回信；无新证据不联系。');
   const last=plan.attempts?.at(-1);if(last)text(card,`最后联系证据：${last.createdAt} · ${last.state||'已记录'}`);
   if(['active','exhausted'].includes(plan.state)){const stop=makeButton('停止计划（不停止目标工作）',async()=>{stop.disabled=true;try{await call({action:'followups',version:1,operation:'stop',operationId:randomId(),planId:plan.planId,expectedRevision:plan.revision});await refresh();}catch(error){if(current()){toast(error.message);stop.disabled=false;}}});stop.dataset.planStop='';card.append(stop);}
  }
  text(body,'新建有限信息联系计划','h3');const form=document.createElement('form');form.style.display='grid';form.style.gap='10px';body.append(form);
  const choices=tasks.filter(t=>t.state!=='stopped');for(const task of choices){const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.planTask=task.taskId;label.append(checkbox,document.createTextNode(` ${task.purpose} · ${task.target.title}`));form.append(label);}
  if(!choices.length){text(form,'请先保存任务简报。');return;}
  const label=document.createElement('label');label.textContent='每次新回信后要询问的问题（只信息联系）';const question=document.createElement('textarea');question.dataset.planQuestion='';question.maxLength=1000;question.rows=3;question.style.width='100%';label.append(question);form.append(label);
  function count(labelText,maximum){const label=document.createElement('label');label.textContent=labelText;const select=document.createElement('select');for(let n=1;n<=maximum;n++){const option=document.createElement('option');option.value=String(n);option.textContent=String(n);select.append(option);}label.append(select);form.append(label);return select;}
  const total=count('总联系次数上限：',5),each=count('每负责人次数上限：',3);
  text(form,'停止条件：次数到限、你停止计划、事项停止、撤权或换绑。开启后不补跑旧回信；到限保留剩余责任。');
  const create=makeButton('明确开启有限信息联系计划',()=>{});create.type='submit';create.dataset.planCreate='';form.append(create);
  form.addEventListener('submit',async event=>{event.preventDefault();const taskIds=[...form.querySelectorAll('[data-plan-task]:checked')].map(c=>c.dataset.planTask);if(!taskIds.length||!question.value.trim())return toast('请选择已有事项并明确填写问题');if(Number(each.value)>Number(total.value))return toast('每负责人次数不能超过总次数');create.disabled=true;try{await call({action:'followups',version:1,operation:'create',operationId:randomId(),taskIds,text:question.value.trim(),maxTotal:Number(total.value),maxPerTarget:Number(each.value),trigger:'new-reply',stopCondition:'budget-user-or-access'});await refresh();}catch(error){if(current()){toast(error.message);create.disabled=false;}}});
 }
 function renderProgress(data){
  text(body,'各事项沿用已有任务简报、派工和回执。未回信保持待回信；运行结束、报告交付、已读和验收分别显示。');
  if(!data.items?.length)text(body,'暂无已登记的协作事项。');
  for(const item of data.items||[]){const card=document.createElement('article');card.style.borderBottom='1px solid #777';card.style.padding='12px 0';body.append(card);text(card,item.purpose,'h3');text(card,`负责人：${item.target.title} · ${item.target.engine}`);text(card,`状态：${item.stateLabel||item.state} · ${item.evidenceAt||'证据时间未知'}`);text(card,`期待结果：${item.expectedResult||'见任务简报'}`);text(card,`执行：${item.execution||'尚未开始'}；汇报：${item.report||'尚未汇报'}；已读：未知；验收：待用户确认`);text(card,`汇报去向：${item.destination.label}`);text(card,item.remainingResponsibility||'尚待核实责任');
   if(item.reply){text(card,item.reply,'blockquote');if(item.truncated!==false)text(card,item.truncated?'回信已截断，请查看目标原生记录。':'回信完整性未知，请核对原生记录。');}
   const link=document.createElement('a');link.href=item.destination.link;link.textContent='返回原秘书';card.append(link);
  }
  if(data.nextOffset!==null&&data.nextOffset!==undefined)body.append(makeButton('查看更多事项',async()=>{try{const next=await call({action:'collaboration',version:1,operation:'list',offset:data.nextOffset,limit:50});renderProgress(next);}catch(error){if(current())toast(error.message);}}));
 }
 function renderQuestions(data){
  text(body,'普通待决定事项只影响相关工作。其他事情可以继续聊；原生审批仍到目标对话处理。');
  const questions=data.questions||[];if(!questions.length)text(body,'暂无普通待决定事项。');
  for(const q of questions){const card=document.createElement('article');card.style.borderBottom='1px solid #777';card.style.padding='12px 0';body.append(card);text(card,q.question,'h3');text(card,`${q.state==='pending'?'待你决定':q.state==='answered'?'已回答':q.state} · ${q.createdAt||''}`);
   if(q.answer){text(card,`已保存：${q.answer.text}`);text(card,({pending:'正在等待秘书串行续行。',admitted:'已排队，秘书将继续这一事项。',processing:'秘书正在继续这一事项。',committed:'秘书已继续对应事项，请查看对话回复。',uncertain:'续行结果待核实，请查看原生对话；未自动重放。',cancelled:'续行已取消；答案和其他事项仍保留。',available:'历史回答已保留，可在对话中继续。'})[q.answer.continuation]||'答案已保存。');text(card,'答案不授予新的执行权限。');}
   if(q.execution)text(card,`回答后将继续此前已授权的行动：${q.execution.text}`);else if(q.state==='pending')text(card,'此问题未预授权行动；回答后秘书只读说明，不会派工。');
   if(q.state!=='pending')continue;
   const input=document.createElement('textarea');input.dataset.answer='';input.setAttribute('aria-label','明确回答');input.maxLength=2000;input.rows=3;input.style.width='100%';input.style.boxSizing='border-box';
   for(const option of q.options||[]){const pick=makeButton(option,()=>{input.value=option;input.focus();});pick.dataset.option='';card.append(pick);}card.append(input);
   const save=makeButton('保存回答',async()=>{if(!input.value.trim())return toast('请明确输入或选择回答');save.disabled=true;try{await call({action:'clarifications',version:1,operation:'answer',operationId:randomId(),questionId:q.questionId,expectedRevision:q.revision,answer:input.value.trim()});await refresh();}catch(error){if(current()){toast(error.message);save.disabled=false;}}});save.dataset.save='';card.append(save);
   card.append(makeButton('取消这个事项',async()=>{try{await call({action:'clarifications',version:1,operation:'cancel',operationId:randomId(),questionId:q.questionId,expectedRevision:q.revision});await refresh();}catch(error){if(current())toast(error.message);}}));
  }
 }
 async function open(){const c=context();if(!c||c.engine&&c.engine!=='pi'||c.workspaceKind!=='chat'){toast('MISHU 协作仅适用于 Pi Chat 秘书');return;}source={...c};dialogs.show(overlay,close,closeButton,{nonModal:true});await refresh();}
 tabs.append(makeButton('有限后续联系',()=>{tab='followups';return refresh();}));
 tabs.append(makeButton('协作进度',()=>{tab='collaboration';return refresh();}));
 tabs.append(makeButton('待决定事项',()=>{tab='clarifications';return refresh();}));
 button?.addEventListener('click',()=>void open());return {open,close};
}
