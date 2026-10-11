// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {bindWorkspaceArtifactLinks} from '../public/workspace-artifacts.js';
import {renderMarkdown} from '../public/render.js';
import {ConversationSyncView} from '../public/conversation-sync-view.js';

it('keeps a completed image reply visible when the next turn is running', async()=>{
  const container=document.createElement('div');document.body.append(container);
  const view=new ConversationSyncView({container,scroller:container,repository:{},context:()=>({conversationId:'task'})});
  view.select('task');
  view.show({conversationId:'task',bindingEpoch:'epoch',runState:'running',appliedRevision:'2',entries:[{id:'reply',kind:'assistant',entityRevision:'1',text:'![Preview](../attachments/preview.webp)'}]});
  // A completed prior message is not an in-progress Markdown stream merely
  // because the conversation has started another turn.
  expect(container.querySelector('img[data-workspace-path]')).not.toBeNull();
  expect(container.querySelector('a.artifact-download')).not.toBeNull();
});

it('formats completion with unchanged text and preserves previews during later runs', async()=>{
 const container=document.createElement('div');document.body.append(container);
 const view=new ConversationSyncView({container,scroller:container,repository:{},context:()=>({conversationId:'task'})});view.select('task');
 const state={conversationId:'task',bindingEpoch:'epoch',runState:'running',entries:[{id:'reply',kind:'assistant',entityRevision:'1',status:'inProgress',text:'![Preview](../attachments/preview.webp)'}]};
 view.show(state);expect(container.querySelector('img')).toBeNull();
 view.show({...state,entries:[{...state.entries[0],entityRevision:'2',status:'completed'}]});
 await vi.waitFor(()=>expect(container.querySelector('img')).not.toBeNull());
 view.show({...state,runState:'idle',entries:[{...state.entries[0],entityRevision:'2',status:'completed'}]});
 expect(container.querySelector('img')).not.toBeNull();
 view.clear();
});

it('binds late grants to preview/download and gives visible failure feedback',()=>{
 const root=document.createElement('div');root.innerHTML=renderMarkdown('![Preview](../attachments/preview.webp)');document.body.append(root);
 bindWorkspaceArtifactLinks(root,()=>null);
 const image=root.querySelector('img')!,download=root.querySelector('.artifact-download')!;
 expect(image.hasAttribute('src')).toBe(false);expect(download.hasAttribute('href')).toBe(false);
 const endpoint=(action:string,path:string)=>'https://files.example/'+action+'?path='+encodeURIComponent(path);
 bindWorkspaceArtifactLinks(root,endpoint);
 expect(image.src).toContain('/preview?');expect(download.getAttribute('href')).toContain('/workspace-download?');
 image.dispatchEvent(new Event('error'));expect(image.hidden).toBe(true);expect(root.textContent).toContain('图片无法显示');
 bindWorkspaceArtifactLinks(root,(action:string,path:string)=>endpoint(action,path)+'&renewed=1');
 image.dispatchEvent(new Event('load'));expect(image.hidden).toBe(false);expect(root.querySelector('.workspace-image-status')?.hasAttribute('hidden')).toBe(true);
});

it('downloads ordinary local file links and preserves embedded image preview',()=>{
 const root=document.createElement('div');
 root.innerHTML=renderMarkdown('[APK](/home/fixture/project/workspace/build/app.apk) [ZIP](build/app.zip) [Attachment](../attachments/data.csv)\n\n![Preview](images/picture.png)');
 const endpoint=(action:string,path:string)=>'https://files.example/'+action+'?path='+encodeURIComponent(path);
 bindWorkspaceArtifactLinks(root,()=>null);
 for(const a of root.querySelectorAll('a[data-workspace-path]'))expect(a.hasAttribute('href')).toBe(false);
 bindWorkspaceArtifactLinks(root,endpoint);
 const links=[...root.querySelectorAll<HTMLAnchorElement>('a[data-workspace-path]')];
 for(const label of ['APK','ZIP','Attachment'])expect(links.find(a=>a.textContent===label)?.href).toContain('/workspace-download?');
 expect(root.querySelector<HTMLImageElement>('img')!.src).toContain('/preview?');
 expect(root.querySelector<HTMLAnchorElement>('a:has(img)')!.href).toContain('/preview?');
 expect(root.querySelector<HTMLAnchorElement>('.artifact-download')!.href).toContain('/workspace-download?');
 bindWorkspaceArtifactLinks(root,(action,path)=>endpoint(action,path)+'&renewed=1');
 expect(links[0].href).toContain('&renewed=1');
});


it('turns a native visualize HTML marker into a scoped downloadable file',()=>{
 const root=document.createElement('div');
 root.innerHTML=renderMarkdown('\uE200visualize\uE202{"path":"/synthetic/task/workspace/output/animation.html"}\uE201');
 const link=root.querySelector<HTMLAnchorElement>('a.visualization-download');
 expect(link,'native visualization output needs an actual download link').not.toBeNull();
 expect(link!.textContent).toContain('下载 HTML');
 expect(root.textContent).not.toContain('visualize');
 bindWorkspaceArtifactLinks(root,()=>null);expect(link!.hasAttribute('href')).toBe(false);
 bindWorkspaceArtifactLinks(root,(action,path)=>'/files/'+action+'?path='+encodeURIComponent(path));
 expect(link!.getAttribute('href')).toContain('/workspace-download?');
 expect(link!.dataset.workspacePath).toBe('/synthetic/task/workspace/output/animation.html');
});

it('leaves visualize examples in code inert and rejects remote or malformed references',()=>{
 const marker='\uE200visualize\uE202{"path":"output/animation.html"}\uE201';
 for(const text of ['`'+marker+'`','```text\n'+marker+'\n```','\uE200visualize\uE202{"path":"https://example.test/animation.html"}\uE201','\uE200visualize\uE202{invalid}\uE201']){
  const root=document.createElement('div');root.innerHTML=renderMarkdown(text);
  expect(root.querySelector('.visualization-download')).toBeNull();
  expect(root.querySelector('iframe,script')).toBeNull();
 }
});


it('escapes visualize filenames instead of turning them into chat markup',()=>{
 const path='output/quote\"<img src=x onerror=alert(1)>.html';
 const root=document.createElement('div');root.innerHTML=renderMarkdown('\uE200visualize\uE202'+JSON.stringify({path})+'\uE201');
 const link=root.querySelector<HTMLElement>('.visualization-download')!;
 expect(link.dataset.workspacePath).toBe(path);expect(root.querySelector('img,script,iframe')).toBeNull();
 expect(link.hasAttribute('onerror')).toBe(false);
});
