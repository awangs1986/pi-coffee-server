// Resolve only through the active conversation's existing scoped transfer grant.
// This module never translates VM paths or broadens the Host file allow-list.
const watched = new WeakMap();
export function bindWorkspaceArtifactLinks(root, endpoint, {recover,context=()=>null}={}) {
  const nodes=root.matches?.('[data-workspace-path]') ? [root,...root.querySelectorAll('[data-workspace-path]')] : root.querySelectorAll('[data-workspace-path]');
  for (const node of nodes) {
    const path=node.getAttribute('data-workspace-path');
    const preview=!node.hasAttribute('data-workspace-download') && (node.tagName==='IMG' || node.tagName==='A' && node.querySelector('img[data-workspace-path]'));
    const url=endpoint(preview?'preview':'workspace-download',path,node.dataset.deliveryVersion);
    if(node.tagName==='IMG') {
      const status=node.closest('.workspace-image')?.querySelector('.workspace-image-status');
      const owner=watched.get(node) || {};
      owner.scope=context();
      if(!watched.has(node)) {
        watched.set(node,owner);
        let retries=0,pending=false;
        async function retry() {
          const scope=owner.scope;
          const current=()=>node.isConnected && context()===scope && owner.scope===scope;
          if(!recover || pending || !current())return;
          pending=true;
          try {
            await recover(path,node.dataset.deliveryVersion);
            if(!current())return;
            const src=endpoint('preview',path,node.dataset.deliveryVersion);
            if(src){node.hidden=false;node.src=src;}
          } catch(error) {
            if(!current() || error.name==='AbortError')return;
            const permanent=[401,403,404,409,413].includes(error.status);
            if(status){
              status.textContent=error.message||'图片暂时无法显示';
              if(!permanent)addRetry();
            }
          } finally {pending=false;}
        }
        function addRetry(){
          if(!status || !recover || status.querySelector('button'))return;
          const button=node.ownerDocument.createElement('button');
          button.type='button';button.className='msg-tool';button.textContent='重试';
          button.onclick=()=>{retries=1;void retry();};status.append(button);
        }
        node.addEventListener('load',()=>{node.hidden=false;retries=0;if(status)status.hidden=true;});
        node.addEventListener('error',()=>{
          node.hidden=true;
          if(status){status.textContent='图片无法显示：文件不可用、访问授权失效或连接中断。';status.hidden=false;}
          if(recover && retries++===0)void retry();else addRetry();
        });
      }
      if(url && node.getAttribute('src')!==url){node.hidden=false;if(status){status.textContent='正在加载图片…';status.hidden=false;}node.src=url;}
      if(!url && node.hasAttribute('src')){node.removeAttribute('src');node.hidden=true;}
    } else {
      if(url){node.href=url;node.target='_blank';node.rel='noopener noreferrer';node.removeAttribute('aria-disabled');}
      else {node.removeAttribute('href');node.setAttribute('aria-disabled','true');}
    }
  }
}
