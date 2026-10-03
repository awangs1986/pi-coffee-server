// Shared modal lifecycle: topmost dialog owns focus and shortcuts, background stays inert.
export function createDialogManager(background, fallback) {
  const stack=[];
  const top=()=>stack.at(-1);
  const focusables=node=>[...node.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(el=>!el.disabled && el.tabIndex>=0 && !el.closest('.hidden,[hidden]'));
  function sync(){background.inert=stack.length>0;for(const [i,entry] of stack.entries()){entry.node.inert=i!==stack.length-1;entry.node.style.zIndex=String(100+i);}}
  function show(node,cancel,initial){
    const existing=stack.find(e=>e.node===node);
    if(!existing)stack.push({node,cancel,opener:document.activeElement});
    node.classList.remove('hidden');sync();
    queueMicrotask(()=>{if(top()?.node===node)(initial || focusables(node)[0] || node).focus();});
  }
  function hide(node){
    const index=stack.findIndex(e=>e.node===node);node.classList.add('hidden');node.inert=false;
    if(index<0)return;
    const wasTop=index===stack.length-1,[entry]=stack.splice(index,1);sync();
    if(wasTop){const target=top() ? focusables(top().node)[0] : entry.opener?.isConnected && !entry.opener.closest('.hidden,[hidden]') ? entry.opener : fallback;target?.focus();}
  }
  document.addEventListener('keydown',event=>{
    const current=top();if(!current)return;
    if(event.isComposing || event.keyCode===229)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();current.cancel();return;}
    if((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k'){event.preventDefault();event.stopImmediatePropagation();return;}
    if(event.key==='Tab'){
      const nodes=focusables(current.node),first=nodes[0],last=nodes.at(-1);
      if(!first){event.preventDefault();return;}
      if(!current.node.contains(document.activeElement) || event.shiftKey && document.activeElement===first || !event.shiftKey && document.activeElement===last){event.preventDefault();(event.shiftKey?last:first).focus();}
    }
  },true);
  document.addEventListener('focusin',event=>{const current=top();if(current && !current.node.contains(event.target))focusables(current.node)[0]?.focus();});
  return {show,hide,active:()=>!!top()};
}
