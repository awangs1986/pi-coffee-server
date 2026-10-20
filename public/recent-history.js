// Native display pagination is separate from the live latest-message area.
const endpoint=(id,action,params)=>`/api/conversations/${encodeURIComponent(id)}/${action}?${new URLSearchParams(params)}`;
async function read(url,fetcher){const response=await fetcher(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error(response.status===409?'历史分页已过期，请重新打开对话':'历史读取失败，请重试');return response.json();}
export function addHistoryDownload(node,{id,token,isCurrent,fetcher=fetch}){
 if(!token)return;
 const button=document.createElement('button');button.type='button';button.className='msg-tool';button.textContent='下载完整内容';node.append(button);
 button.addEventListener('click',async()=>{
  if(button.disabled||!isCurrent()||!button.isConnected)return;button.disabled=true;
  try{const value=await read(endpoint(id,'recent-content',{token}),fetcher);if(!isCurrent()||!button.isConnected)return;
   const url=URL.createObjectURL(new Blob([JSON.stringify(value.entry,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='conversation-message.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);button.textContent='下载完整内容';
  }catch(error){if(isCurrent()&&button.isConnected)button.textContent=error.message;}finally{button.disabled=false;}
 });
}
export function recentHistoryPanel({id,cursor,mode,isCurrent,renderEntry,fetcher=fetch}){
 const root=document.createElement('section');root.className='recent-history-pages';
 const controls=document.createElement('div'),older=document.createElement('button'),back=document.createElement('button'),status=document.createElement('span'),body=document.createElement('div');
 for(const [button,text] of [[older,'加载更早记录'],[back,'返回较新一页']]){button.type='button';button.className='msg-tool';button.textContent=text;}
 body.hidden=true;back.hidden=true;older.hidden=!cursor;controls.append(older,back,status);root.append(controls,body);
 let next=cursor,busy=false,position=-1;const visited=[];
 async function load(token,index){
  if(busy||!token||!isCurrent()||!root.isConnected)return;busy=true;older.disabled=back.disabled=true;status.textContent='正在读取…';
  try{const page=await read(endpoint(id,'recent-page',{cursor:token,displayMode:mode}),fetcher);if(!isCurrent()||!root.isConnected)return;
   if(!Array.isArray(page.entries)||page.entries.length>40)throw Error('无效的历史分页');
   if(index===visited.length){visited.push(token);if(visited.length>64){visited.shift();index--;}}
   position=index;next=page.olderCursor;body.replaceChildren();body.hidden=false;
   for(const item of page.entries){const node=renderEntry(item);addHistoryDownload(node,{id,token:item.contentToken,isCurrent,fetcher});body.append(node);}
   older.hidden=!next;back.hidden=false;status.textContent=page.entries.length?'':'这一页没有可显示的消息，可继续加载更早记录';
  }catch(error){if(isCurrent()&&root.isConnected)status.textContent=error.message;}finally{busy=false;older.disabled=back.disabled=false;}
 }
 older.onclick=()=>{if(position<visited.length-1)visited.splice(position+1);void load(next,position+1);};
 back.onclick=()=>{if(busy)return;if(position<=0){position=-1;next=cursor;body.replaceChildren();body.hidden=true;back.hidden=true;older.hidden=!next;status.textContent='';}else void load(visited[position-1],position-1);};
 return root;
}
