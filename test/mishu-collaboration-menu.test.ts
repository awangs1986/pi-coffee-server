// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {initMishuCollaboration} from '../public/mishu-collaboration.js';
it('shows a pending decision, preserves ordinary chat and submits an explicit exact-revision answer only',async()=>{
 document.body.innerHTML='<button id="open">MISHU 协作</button>';const request=vi.fn(async(input:any)=>input.operation==='answer'?{question:{state:'answered'}}:{questions:[{questionId:'q-a',revision:3,state:'pending',question:'A 的格式？',options:['短摘要','详细'],createdAt:'2026-10-21T00:00:00Z'}]});
 const dialogs={show:vi.fn(node=>node.classList.remove('hidden')),hide:vi.fn(node=>node.classList.add('hidden'))};
 const ui=initMishuCollaboration({button:document.querySelector('#open'),context:()=>({id:'secretary',engine:'pi',workspaceKind:'chat',epoch:1}),request,dialogs,toast:vi.fn()});
 await ui.open();expect(document.body.textContent).toContain('A 的格式？');expect(request).toHaveBeenCalledTimes(1);
 const input=document.querySelector<HTMLTextAreaElement>('[data-answer]')!;expect(input.value).toBe('');
 (document.querySelector('[data-option]') as HTMLButtonElement).click();expect(input.value).toBe('短摘要');
 (document.querySelector('[data-save]') as HTMLButtonElement).click();await vi.waitFor(()=>expect(request).toHaveBeenCalledWith(expect.objectContaining({action:'clarifications',id:'secretary',operation:'answer',questionId:'q-a',expectedRevision:3,answer:'短摘要'})));
 ui.close();expect(dialogs.hide).toHaveBeenCalled();
});
it('discards a stale source response after switching conversations',async()=>{
 document.body.innerHTML='<button id="open">MISHU 协作</button>';let source={id:'old',engine:'pi',workspaceKind:'chat',epoch:1},release!:(v:any)=>void;
 const ui=initMishuCollaboration({button:document.querySelector('#open'),context:()=>source,request:()=>new Promise(r=>release=r),dialogs:{show:vi.fn(),hide:vi.fn()},toast:vi.fn()});
 const loading=ui.open();source={...source,id:'new',epoch:2};release({questions:[{question:'PRIVATE_OLD'}]});await loading;expect(document.body.textContent).not.toContain('PRIVATE_OLD');
});
