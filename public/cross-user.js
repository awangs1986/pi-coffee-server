export const CROSS_USER_COMMAND={name:'cross-user',invocation:'/cross-user',description:'读取其他用户的指定对话作为当前对话的参考：/cross-user 对话ID',source:'web'};
export function initCrossUser({context,send,toast,request=fetch}){
 let busy=false;
 return {handle(text){
  if(!/^\/cross-user(?:\s|$)/i.test(text))return false;
  const match=/^\/cross-user\s+([a-zA-Z0-9][a-zA-Z0-9-]{0,127})$/i.exec(text);
  if(!match){toast('用法：/cross-user 对话ID');return true;}
  const captured=context();
  if(busy){toast('正在读取，请勿重复提交');return true;}
  if(!captured.id||!captured.ready){toast('请先打开自己已有且空闲的对话');return true;}
  if(captured.attachments){toast('此命令只读取对话，请先处理附件草稿');return true;}
  busy=true;toast('正在读取指定对话…');
  void (async()=>{
   try{
    const response=await request('/api/cross-user',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId:captured.id,sourceId:match[1]}),signal:AbortSignal.timeout(35000)});
    const result=await response.json(),current=context();
    if(current.id!==captured.id||current.user!==captured.user||current.epoch!==captured.epoch||current.text.trim()!==text||!current.ready||current.attachments)return;
    if(!response.ok)throw Error(result.error||'读取失败，原命令已保留');
    if(typeof result.prompt!=='string'||!result.prompt||result.prompt.length>350000)throw Error('引用内容无效，未发送');
    if(send(result.prompt)!==false&&result.truncated)toast('已读取最近对话内容；较早记录超出上限，已明确标注截断');
   }catch(error){const current=context();if(current.id===captured.id&&current.user===captured.user&&current.epoch===captured.epoch)toast(error.message||'读取失败，原命令已保留');}
   finally{busy=false;}
  })();return true;
 }};
}
