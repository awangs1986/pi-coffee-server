// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createTaskFileAccess,installTaskDownloads} from '../public/task-file-access.js';

it('finishes a clicked download after a same-conversation repaint and cancels it on a switch',async()=>{
 const root=document.createElement('div');document.body.append(root);
 let scope='first',pending=Promise.withResolvers<{url:string}>();
 const read=vi.fn(()=>pending.promise),download=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 installTaskDownloads(root,{read,context:()=>scope,onError:message=>{throw Error(message);}});
 const clickThenRepaint=()=>{
   const link=document.createElement('a');link.href='/original';link.dataset.deliveryPath='file.zip';
   root.replaceChildren(link);link.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
   root.replaceChildren(link.cloneNode(true));
 };
 try{
   clickThenRepaint();expect(read).toHaveBeenCalledTimes(1);
   pending.resolve({url:'/original'});await pending.promise;
   expect(download).toHaveBeenCalledTimes(1);
   pending=Promise.withResolvers();clickThenRepaint();scope='second';pending.resolve({url:'/original'});await pending.promise;
   expect(download).toHaveBeenCalledTimes(1);
 }finally{download.mockRestore();root.remove();}
});

it('coalesces simultaneous expired grants and rechecks even when the URL remains identical',async()=>{
 let expired=true;
 const release=Promise.withResolvers<void>();
 const renew=vi.fn(async()=>{await release.promise;expired=false;});
 const read=createTaskFileAccess({context:()=> 'authorized task',endpoint:()=>'/same-url',renew,
  fetcher:async()=>new Response(null,{status:expired?401:200})});
 const a=read('preview','a.svg',{method:'HEAD'}),b=read('workspace-download','b.zip',{method:'HEAD'});
 await vi.waitFor(()=>expect(renew).toHaveBeenCalledTimes(1));release.resolve();
 const values=await Promise.all([a,b]);expect(values.map(v=>[v.url,v.response.status])).toEqual([['/same-url',200],['/same-url',200]]);
});

it('stops on a definitive file denial and discards a response after a selection change',async()=>{
 let scope='first';
 const pending=Promise.withResolvers<Response>();
 const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:403})).mockImplementationOnce(()=>pending.promise);
 const read=createTaskFileAccess({context:()=>scope,endpoint:()=>'/file',renew:()=>{throw Error('unneeded');},fetcher});
 await expect(read('preview','a.md')).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledTimes(1);
 const result=read('preview','a.md');scope='other';pending.resolve(new Response('old bytes'));
 await expect(result).rejects.toMatchObject({name:'AbortError'});
});
