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
