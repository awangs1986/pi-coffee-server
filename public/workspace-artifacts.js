// Resolve only through the active conversation's existing scoped transfer grant.
// This module never translates VM paths or broadens the Host file allow-list.
const watched = new WeakSet();
export function bindWorkspaceArtifactLinks(root, endpoint) {
  for (const node of root.querySelectorAll('[data-workspace-path]')) {
    const path=node.getAttribute('data-workspace-path');
    const preview=!node.hasAttribute('data-workspace-download') && (node.tagName==='IMG' || node.tagName==='A' && node.querySelector('img[data-workspace-path]'));
    const url=endpoint(preview?'preview':'workspace-download',path);
    if(node.tagName==='IMG') {
      const status=node.closest('.workspace-image')?.querySelector('.workspace-image-status');
      if(!watched.has(node)) {
        watched.add(node);
        node.addEventListener('load',()=>{node.hidden=false;if(status)status.hidden=true;});
        node.addEventListener('error',()=>{
          node.hidden=true;
          if(status){status.textContent='图片无法显示：文件不可用、访问授权失效或连接中断。';status.hidden=false;}
        });
      }
      if(url && node.getAttribute('src')!==url){node.hidden=false;if(status){status.textContent='正在加载图片…';status.hidden=false;}node.src=url;}
    } else {
      if(url){node.href=url;node.target='_blank';node.rel='noopener noreferrer';node.removeAttribute('aria-disabled');}
      else {node.removeAttribute('href');node.setAttribute('aria-disabled','true');}
    }
  }
}
