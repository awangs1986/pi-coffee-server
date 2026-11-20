import {el,renderMarkdown,boundedTextSlice} from './render.js';
import {canonicalTaskPath,previewKind} from './task-file-reference.js';
import {bindWorkspaceArtifactLinks} from './workspace-artifacts.js';

function markdownPreview(text,path,{endpoint,read,context}) {
  const root=el('div','markdown');
  const body=el('div','file-markdown-page'),next=el('button','msg-tool','下一段'),back=el('button','msg-tool','上一段');
  next.type=back.type='button';
  root.append(body,back,next);
  const pages=[0];let page=0;
  function show(){
    const slice=boundedTextSlice(text,{start:pages[page]});
    const template=document.createElement('template');template.innerHTML=renderMarkdown(slice.text);
    // Set local image destinations before attaching the fragment to the page.
    for(const img of template.content.querySelectorAll('img[src]')){
      const src=img.getAttribute('src');
      if(!/^(?:https?:|data:image\/)/i.test(src)){img.removeAttribute('src');}
    }
    const directory=path.slice(0,path.lastIndexOf('/')+1);
    for(const node of template.content.querySelectorAll('[data-workspace-path]')){
      const local=node.dataset.workspacePath;
      node.dataset.workspacePath=canonicalTaskPath(local.startsWith('/')?local:directory+local);
    }
    body.replaceChildren(template.content);
    bindWorkspaceArtifactLinks(body,endpoint,{context,recover:(p,v)=>read('preview',p,{method:'HEAD',version:v})});
    back.hidden=next.hidden=slice.start===0 && slice.end===text.length;
    back.disabled=page===0;next.disabled=slice.end>=text.length;pages[page+1]=slice.end;
  }
  back.onclick=()=>{if(page>0){page--;show();}};
  next.onclick=()=>{if(!next.disabled){page++;show();}};
  show();return root;
}

export function openTaskFilePreview(container,{path,version,read,endpoint,context}) {
  const controller=new AbortController(),scope=context();
  const current=()=>!controller.signal.aborted && context()===scope && container.isConnected;
  let objectUrl;
  async function load(){
    container.replaceChildren(el('p','workspace-note','正在读取预览…'));
    try {
      const {response}=await read('preview',path,{version,signal:controller.signal});
      const kind=previewKind(path);
      if(kind==='image'){
        const bytes=await response.blob();
        if(!current())return;
        if(!/^image\//i.test(bytes.type))throw Error('文件不是可预览的图片');
        if(objectUrl)URL.revokeObjectURL(objectUrl);
        objectUrl=URL.createObjectURL(bytes);
        const image=document.createElement('img');image.alt=path.split('/').at(-1);image.src=objectUrl;
        await image.decode();if(current())container.replaceChildren(image);
      } else {
        const text=await response.text();if(!current())return;
        container.replaceChildren(markdownPreview(text,path,{endpoint,read,context}));
      }
    } catch(error) {
      if(!current())return;
      container.replaceChildren(el('p','workspace-warning',error.message || '预览失败，请重试'));
      if(![401,403,404,409,413].includes(error.status)){
        const retry=el('button','msg-tool','重试');retry.type='button';retry.onclick=()=>void load();container.append(retry);
      }
    }
  }
  void load();
  return ()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);container.replaceChildren();};
}
