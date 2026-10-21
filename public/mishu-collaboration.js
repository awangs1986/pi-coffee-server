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
 async function refresh(){const ticket=++sequence;body.replaceChildren();text(body,'正在读取…');try{const data=await call({action:tab,version:1,operation:'list'});if(ticket!==sequence||!current())return;body.replaceChildren();renderQuestions(data);}catch(error){if(ticket===sequence&&current()){body.replaceChildren();text(body,error.message);}}}
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
 tabs.append(makeButton('待决定事项',()=>{tab='clarifications';return refresh();}));
 button?.addEventListener('click',()=>void open());return {open,close};
}
