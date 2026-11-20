const transient = status => status === 408 || status === 429 || status >= 500;
const wait = ms => new Promise(done=>setTimeout(done,ms));
const failure = status => Object.assign(Error(status === 409 ? '文件已替换' : status === 413 ? '文件超过预览上限，请下载原件' : status === 404 ? '文件已移除' : status === 403 ? '文件不可访问' : '文件暂时无法读取'),{status});

export function createTaskFileAccess({context,endpoint,renew,fetcher=fetch}) {
  let renewal;
  async function renewOnce(scope) {
    if (renewal?.scope === scope) return renewal.work;
    const attempt = {scope, work:Promise.resolve().then(renew)};
    renewal=attempt;
    try { return await attempt.work; } finally { if(renewal===attempt)renewal=null; }
  }
  return async function read(route,path,{version,method='GET',signal}={}) {
    const scope=context();
    const current=()=>scope && context()===scope && !signal?.aborted;
    let renewed=false,failures=0;
    for (;;) {
      if(!current())throw new DOMException('Selection changed','AbortError');
      const url=endpoint(route,path,version);
      try {
        const timeout=AbortSignal.timeout(12000);
        const response=await fetcher(url,{method,cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout});
        if(!current()){await response.body?.cancel();throw new DOMException('Selection changed','AbortError');}
        if(response.ok)return {response,url};
        await response.body?.cancel();
        if(response.status===401 && !renewed){renewed=true;await renewOnce(scope);continue;}
        throw failure(response.status);
      } catch(error) {
        if (!current() || error.name==='AbortError' || (error.status && !transient(error.status)) || failures===2) throw error;
        await wait([250,750][failures++]);
      }
    }
  };
}

export function installTaskDownloads(root,{read,context,onError}) {
  const busy=new WeakSet();
  root.addEventListener('click',async event=>{
    const link=event.target.closest?.('a[data-workspace-path],a[data-document-path],a[data-delivery-path]');
    if(!link || !root.contains(link) || !link.hasAttribute('href') || event.defaultPrevented ||
       event.button!==0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
       link.querySelector('img[data-workspace-path]'))return;
    event.preventDefault();
    if(busy.has(link))return;
    busy.add(link);
    const scope=context(),path=link.dataset.deliveryPath||link.dataset.documentPath||link.dataset.workspacePath;
    try {
      const {url}=await read('workspace-download',path,{method:'HEAD',version:link.dataset.deliveryVersion});
      if(!scope || context()!==scope || !link.isConnected)return;
      const download=link.ownerDocument.createElement('a');
      download.href=url;download.download=path.split('/').at(-1);download.rel='noopener noreferrer';
      link.ownerDocument.body.append(download);download.click();download.remove();
    } catch(error) {
      if(context()===scope && link.isConnected && error.name!=='AbortError')onError(error.message);
    } finally {busy.delete(link);}
  });
}
