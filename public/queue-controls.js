export function initQueueControls({container,send,requestId,toast,canPromote}){
 const $=id=>document.getElementById(id),dialog=$('queue-edit-dialog');
 let items=[],native={steering:[],followUp:[]},editing=null,pending=new Map(),connected=true;
 const element=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 function action(item,kind,text){
  const id=requestId('queue');pending.set(id,{itemId:item.id,kind});
  if(!send({v:1,type:'queue_action',requestId:id,id:item.id,revision:item.revision,action:kind,...(text===undefined?{}:{text})})){pending.delete(id);toast('连接已断开，未自动重试');}
  render();
 }
 function render(){
  container.replaceChildren();
  for(const [kind,text] of [...native.steering.map(t=>['已插话',t]),...native.followUp.map(t=>['原生排队',t])]){
   const row=element('div','queue-item');row.append(element('span','queue-kind',kind),element('span','queue-text',text));container.append(row);
  }
  for(const item of items){
   const row=element('div','queue-item'),text=element('span','queue-text',item.text);text.title=item.text;
   row.append(element('span','queue-kind',item.status==='sending'?'发送中':item.status==='failed'?'待确认':'排队'),text);
   if(item.imageCount)row.append(element('span','queue-images',`${item.imageCount} 张图片`));
   if(item.error){row.title=item.error;row.append(element('span','queue-warning',item.error));}
   const controls=element('span','queue-actions');
   for(const [kind,label] of [['edit','编辑'],['promote',item.status==='failed'?'重试发送':'立即插入'],['cancel','取消']]){
    if(kind==='promote'&&!canPromote())continue;
    const button=element('button','context-action',label);button.type='button';button.dataset.queueAction=kind;
    button.disabled=!connected||item.status==='sending'||[...pending.values()].some(p=>p.itemId===item.id);
    button.onclick=()=>{
     if(kind==='edit'){editing={...item};$('queue-edit-text').value=item.text;$('queue-edit-status').textContent='保存前，原指令仍可能开始执行。图片附件将保留。';dialog.showModal();return;}
     if(item.status==='failed'&&kind==='promote'&&!window.confirm('上次发送结果未确认。请先检查对话记录；重复发送可能重复执行。确认重试？'))return;
     action(item,kind);
    };controls.append(button);
   }
   row.append(controls);container.append(row);
  }
  container.classList.toggle('hidden',container.childElementCount===0);
 }
 $('queue-edit-close').onclick=()=>dialog.close();
 $('queue-edit-form').onsubmit=event=>{
  event.preventDefault();if(!editing||!connected)return;
  const text=$('queue-edit-text').value;if(!text.trim()){ $('queue-edit-status').textContent='指令不能为空';return;}
  if([...pending.values()].some(p=>p.itemId===editing.id))return;
  action(editing,'edit',text);$('queue-edit-status').textContent='正在保存…';
 };
 return {
  update(rows){items=rows;render();},
  native(event){native={steering:event.steering||[],followUp:event.followUp||[]};render();},
  connection(value){connected=value;render();},
  ack(id){const p=pending.get(id);if(!p)return false;pending.delete(id);if(p.kind==='edit'){editing=null;dialog.close();}toast(p.kind==='cancel'?'已取消排队':p.kind==='edit'?'已更新指令':'已提交立即插入');render();return true;},
  error(id,message){if(!pending.has(id))return false;pending.delete(id);if(editing&&dialog.open)$('queue-edit-status').textContent=message;toast(message);render();return true;},
  reset(){items=[];native={steering:[],followUp:[]};editing=null;pending.clear();if(dialog.open)dialog.close();render();},
 };
}
