// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {openTaskFilePreview} from '../public/task-file-preview.js';

afterEach(()=>document.body.replaceChildren());
it('resolves a Markdown document image from its own directory and retains the scoped preview action',async()=>{
 const container=document.createElement('div');document.body.append(container);
 const dispose=openTaskFilePreview(container,{path:'../artifacts/reports/answer.md',context:()=> 'first',
   read:async()=>({response:new Response('# Result\n\n![diagram](../figures/one%20two.svg)')}),
   endpoint:(route:string,path:string)=>'/'+route+'?'+new URLSearchParams({path})});
 try{
  await vi.waitFor(()=>expect(container.querySelector('h1')?.textContent).toBe('Result'));
  const image=container.querySelector('img')!;
  expect(new URL(image.src).searchParams.get('path')).toBe('../artifacts/figures/one two.svg');
  expect(new URL(image.src).pathname).toBe('/preview');
 }finally{dispose();}
});
it('drops a completed preview after its conversation is no longer selected',async()=>{
 const container=document.createElement('div');document.body.append(container);
 const pending=Promise.withResolvers<unknown>();let scope='first';
 const dispose=openTaskFilePreview(container,{path:'a.md',context:()=>scope,read:()=>pending.promise,endpoint:()=>'/file'});
 scope='second';pending.resolve({response:new Response('# Old task')});
 await new Promise(done=>setTimeout(done,0));
 expect(container.textContent).not.toContain('Old task');dispose();expect(container.childNodes.length).toBe(0);
});
