export const SSHME_COMMAND={name:'sshme',invocation:'/sshme',description:'连接我的 Windows 电脑并协助完成要求',source:'web'};
export function parseSshme(text){const match=/^\/sshme(?:\s+([\s\S]*))?$/i.exec(text.trim());return match ? (match[1]??'').trim() : null;}

export function initSshme({onOpen,isCurrent,onReady}){
 const $=id=>document.getElementById(id),dialog=$('sshme-dialog'),form=$('sshme-form');
 let saved=null,context=null,request='',epoch=0,busy=false,available=false;
 const status=(message)=>{$('sshme-status').textContent=message;};
 const controls=()=>{for(const node of form.querySelectorAll('input,button'))node.disabled=busy||!available;};
 async function api(body){const res=await fetch('/api/runners',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||'连接操作失败');return data;}
 function passwordHint(){
  const same=saved && saved.host===$('sshme-host').value.trim() && saved.port===Number($('sshme-port').value) && saved.username===$('sshme-username').value.trim();
  $('sshme-password').placeholder=same&&saved.hasPassword?'已保存，留空保持原密码':'留空使用 VM 的 SSH 密钥';
  return same;
 }
 for(const id of ['sshme-host','sshme-port','sshme-username'])$(id).addEventListener('input',passwordHint);
 async function open(value){
  if(dialog.open||busy)return;
  const current=++epoch;context=value.context;request=value.request;saved=null;available=false;form.reset();$('sshme-password').value='';
  $('sshme-request').textContent=request;onOpen();dialog.showModal();status('正在读取连接信息…');controls();
  try{
   const [address,data]=await Promise.all([fetch('/api/client-address').then(async res=>{if(!res.ok)throw Error('无法读取访问地址');return res.json();}),api({action:'list'})]);
   if(epoch!==current)return;
   if(data.runners.length>1 || data.runners.some(r=>r.platform!=='windows'))throw Error('请先在“配置测试服务器”中整理旧连接配置');
   saved=data.runners[0]??null;
   $('sshme-host').value=address.suggestedHost??saved?.host??'';
   const sameHost=saved?.host===$('sshme-host').value;
   $('sshme-port').value=sameHost?saved.port:22;$('sshme-username').value=sameHost?saved.username:'';passwordHint();
   available=true;status(address.suggestedHost?'地址根据本次网页连接填写，请确认是你的 Windows 电脑。':'无法确认电脑的局域网地址，请填写或确认 SSH 地址。');controls();
  }catch(error){if(epoch===current){status(error.message);controls();}}
 }
 $('sshme-close').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>{epoch++;$('sshme-password').value='';request='';context=null;});
 form.addEventListener('submit',event=>{
  event.preventDefault();if(busy||!available)return;
  if(!isCurrent(context)){status('当前对话或输入已改变，请关闭后重新输入 /sshme。');return;}
  const current=epoch,submittedContext=context,submittedRequest=request,same=passwordHint();
  const runner={...(saved?{id:saved.id}:{}),name:saved?.name??'我的 Windows 电脑',host:$('sshme-host').value.trim(),port:Number($('sshme-port').value),username:$('sshme-username').value.trim(),platform:'windows',workdir:same?(saved?.workdir??''):'',password:$('sshme-password').value,clearPassword:!same};
  $('sshme-password').value='';busy=true;controls();status('正在保存并测试连接…');
  void (async()=>{
   try{
    const result=await api({action:'save',runner});if(epoch!==current)return;saved=result.runner;passwordHint();
    const prepared=await api({action:'sshme',id:saved.id,request:submittedRequest});if(epoch!==current)return;
    if(!isCurrent(submittedContext))throw Error('连接已保存，但当前对话或输入已改变；请重新输入 /sshme。');
    onReady(prepared.prompt,submittedContext);dialog.close();
   }catch(error){if(epoch===current)status(error.message);}
   finally{busy=false;controls();}
  })();
 });
 return {open};
}
