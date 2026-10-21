/** Read-only evidence panel. DOM textContent preserves untrusted excerpts as data. */
export function initMishuEvidence({context,request,toast}) {
 let dialog=null,controller=null;
 function close(){controller?.abort();controller=null;dialog?.remove();dialog=null;}
 async function open(){
  close();const source=context();if(!source?.id||(source.engine||'pi')!=='pi')return toast('MISHU 证据入口仅支持已启用的 Pi Chat');
  controller=new AbortController();const activeController=controller;
  const modal=document.createElement('dialog');dialog=modal;modal.className='mishu-evidence';
  modal.style.cssText='width:min(680px,94vw);max-height:85dvh;overflow:auto';
  const title=document.createElement('h2');title.textContent='MISHU 原话与证据';
  const target=document.createElement('input');target.placeholder='联系人完整 ID（留空仅当前秘书）';target.setAttribute('aria-label','证据来源对话 ID');
  const query=document.createElement('input');query.placeholder='关键词（留空查看近期）';query.setAttribute('aria-label','证据关键词');
  const anchor=document.createElement('input');anchor.placeholder='消息 ID（可选，定位附近原话）';anchor.setAttribute('aria-label','证据消息锚点');
  for(const input of [target,query,anchor])input.style.cssText='display:block;width:100%;margin:8px 0;box-sizing:border-box';
  const read=document.createElement('button');read.textContent='查找证据';const done=document.createElement('button');done.textContent='关闭';done.onclick=close;
  const output=document.createElement('div');output.setAttribute('aria-live','polite');
  read.onclick=async()=>{
   read.disabled=true;output.textContent='正在只读查询…';
   try{const result=await request({action:'evidence',id:source.id,version:1,mode:anchor.value.trim()?'anchor':query.value.trim()?'search':'recent',...(target.value.trim()?{targetId:target.value.trim()}:{}),...(anchor.value.trim()?{anchorId:anchor.value.trim()}:{}),...(query.value.trim()?{query:query.value.trim()}:{}),limit:20},activeController.signal);
    if(dialog!==modal||context()?.id!==source.id||context()?.user!==source.user||context()?.epoch!==source.epoch)return close();output.replaceChildren();
    const coverage=document.createElement('p');coverage.textContent=result.available?`来源：原生历史；新鲜度 ${result.freshness}；${result.truncated?'范围有截断':'当前返回范围完整'}${result.missingAnchor?'；消息锚点已丢失或超出范围':''}`:'来源不可用；不会启动原生 CLI 或创建替代会话';output.append(coverage);
    for(const entry of result.entries||[]){const block=document.createElement('article'),meta=document.createElement('p'),text=document.createElement('pre');meta.textContent=`${entry.kind==='user-original'?'用户原话':entry.kind==='model-output'?'模型输出（可能为摘要）':'历史笔记'} · ${entry.at||'时间未知'} · ${entry.conversationId} / ${entry.messageId} · ${entry.truncated?'已截断':'所示范围'} ${entry.range?.start??0}–${entry.range?.end??0}`;text.textContent=entry.text;text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';block.append(meta,text);output.append(block);}
    if(result.available&&!result.entries?.length){const empty=document.createElement('p');empty.textContent='当前有界范围内没有匹配原话。';output.append(empty);}
   }catch(error){if(dialog===modal)output.textContent=error.message||'证据查询失败';}finally{read.disabled=false;}
  };
  modal.append(title,target,query,anchor,read,done,output);modal.addEventListener('cancel',event=>{event.preventDefault();close();});document.body.append(modal);modal.showModal();read.click();
 }
 return {open,close};
}
