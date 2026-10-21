import {randomId} from './ids.js';
/** Ordinary product decisions stay outside the native permission dialog. */
export function initMishuCollaboration({button,context,request,dialogs,toast}){
 let source=null,sequence=0;
 const overlay=document.createElement('div');overlay.className='modal-overlay hidden';overlay.dataset.mishuCollaboration='';
 Object.assign(overlay.style,{position:'fixed',inset:'0',display:'grid',placeItems:'center',padding:'12px',background:'rgba(0,0,0,.5)'});
 const panel=document.createElement('section');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','MISHU 协作与待决定事项');panel.setAttribute('aria-modal','true');
 Object.assign(panel.style,{display:'flex',flexDirection:'column',gap:'12px',width:'min(720px,100%)',maxHeight:'calc(100dvh - 24px)',minHeight:'0',background:'var(--panel,#202124)',color:'var(--text,#eee)',padding:'16px',borderRadius:'12px',boxSizing:'border-box'});
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
 async function refresh(){const ticket=++sequence;body.replaceChildren();text(body,'正在读取…');try{const data=await call({action:tab,version:1,operation:'list'});if(ticket!==sequence||!current())return;body.replaceChildren();if(tab==='collaboration')renderProgress(data);else renderQuestions(data);}catch(error){if(ticket===sequence&&current()){body.replaceChildren();text(body,error.message);}}}
 function renderProgress(data){
  text(body,'各事项沿用已有任务简报、派工和回执。未回信保持待回信；运行结束、报告交付、已读和验收分别显示。');
  const labels={recorded:'已记录，尚未联系',queued:'排队中',running:'执行中','awaiting-reply':'待回信','waiting-user':'等你决定',failed:'失败或不完整',uncertain:'不确定，需核实','reply-available':'已有回信',reported:'已回报',stopped:'已停止记录'};
  if(!data.items?.length)text(body,'暂无已登记的协作事项。');
  for(const item of data.items||[]){const card=document.createElement('article');card.style.borderBottom='1px solid #777';card.style.padding='12px 0';body.append(card);text(card,item.purpose,'h3');text(card,`负责人：${item.target.title} · ${item.target.engine}`);text(card,`状态：${labels[item.state]||item.state} · ${item.evidenceAt||'证据时间未知'}`);text(card,`期待结果：${item.expectedResult||'见任务简报'}`);text(card,`执行：${item.execution||'尚未开始'}；汇报：${item.report||'尚未汇报'}；已读：未知；验收：待用户确认`);text(card,`汇报去向：${item.destination.label}`);text(card,item.remainingResponsibility||'尚待核实责任');
   if(item.reply){text(card,item.reply,'blockquote');if(item.truncated!==false)text(card,item.truncated?'回信已截断，请查看目标原生记录。':'回信完整性未知，请核对原生记录。');}
   const link=document.createElement('a');link.href=item.destination.link;link.textContent='返回原秘书';card.append(link);
  }
  if(data.nextOffset!==null&&data.nextOffset!==undefined)body.append(makeButton('查看更多事项',async()=>{try{const next=await call({action:'collaboration',version:1,operation:'list',offset:data.nextOffset,limit:50});renderProgress(next);}catch(error){if(current())toast(error.message);}}));
 }
 function renderQuestions(data){
  text(body,'普通待决定事项只影响相关工作。其他事情可以继续聊；原生审批仍到目标对话处理。');
  const questions=data.questions||[];if(!questions.length)text(body,'暂无普通待决定事项。');
  for(const q of questions){const card=document.createElement('article');card.style.borderBottom='1px solid #777';card.style.padding='12px 0';body.append(card);text(card,q.question,'h3');text(card,`${q.state==='pending'?'待你决定':q.state==='answered'?'已回答':q.state} · ${q.createdAt||''}`);
   if(q.answer){text(card,`已保存：${q.answer.text}`);text(card,'下次发消息时秘书会继续对应事项。答案不授予新的执行权限。');}
   if(q.state!=='pending')continue;
   const input=document.createElement('textarea');input.dataset.answer='';input.setAttribute('aria-label','明确回答');input.maxLength=2000;input.rows=3;input.style.width='100%';input.style.boxSizing='border-box';
   for(const option of q.options||[]){const pick=makeButton(option,()=>{input.value=option;input.focus();});pick.dataset.option='';card.append(pick);}card.append(input);
   const save=makeButton('保存回答',async()=>{if(!input.value.trim())return toast('请明确输入或选择回答');save.disabled=true;try{await call({action:'clarifications',version:1,operation:'answer',operationId:randomId(),questionId:q.questionId,expectedRevision:q.revision,answer:input.value.trim()});await refresh();}catch(error){if(current()){toast(error.message);save.disabled=false;}}});save.dataset.save='';card.append(save);
   card.append(makeButton('取消这个事项',async()=>{try{await call({action:'clarifications',version:1,operation:'cancel',operationId:randomId(),questionId:q.questionId,expectedRevision:q.revision});await refresh();}catch(error){if(current())toast(error.message);}}));
  }
 }
 async function open(){const c=context();if(!c||c.engine&&c.engine!=='pi'||c.workspaceKind!=='chat'){toast('MISHU 协作仅适用于 Pi Chat 秘书');return;}source={...c};dialogs.show(overlay,close,closeButton,{nonModal:true});await refresh();}
 tabs.append(makeButton('协作进度',()=>{tab='collaboration';return refresh();}));
 tabs.append(makeButton('待决定事项',()=>{tab='clarifications';return refresh();}));
 button?.addEventListener('click',()=>void open());return {open,close};
}
