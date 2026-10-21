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
it('renders per-target partial progress, original destination and separate delivery/read/acceptance facts',async()=>{
 document.body.innerHTML='<button id="open">MISHU 协作</button>';
 const request=vi.fn(async(input:any)=>input.action==='collaboration'?{items:[{taskId:'a',purpose:'修复 A',expectedResult:'通过验证',state:'reply-available',target:{title:'同名项目',engine:'pi'},destination:{label:'原秘书 · 修复 A',link:'/conversations/source'},execution:'settled',report:'not-reported',read:'unknown',acceptance:'pending',evidenceAt:'2026-10-21',remainingResponsibility:'等待 B 的回复',reply:'A 完成验证',truncated:false},{taskId:'b',purpose:'检查 B',state:'awaiting-reply',target:{title:'同名项目',engine:'codex'},destination:{label:'原秘书 · 检查 B',link:'/conversations/source'},remainingResponsibility:'尚未收到 B 的回信'}]}:{questions:[]});
 const ui=initMishuCollaboration({button:document.querySelector('#open'),context:()=>({id:'source',engine:'pi',workspaceKind:'chat',epoch:1}),request,dialogs:{show:vi.fn(),hide:vi.fn()},toast:vi.fn()});await ui.open();
 [...document.querySelectorAll('nav button')].find((b:any)=>b.textContent==='协作进度')?.dispatchEvent(new MouseEvent('click'));await vi.waitFor(()=>expect(document.body.textContent).toContain('A 完成验证'));
 expect(document.body.textContent).toContain('尚未收到 B 的回信');expect(document.body.textContent).toContain('已读：未知');expect(document.body.textContent).toContain('验收：待用户确认');expect(document.body.textContent).toContain('原秘书 · 修复 A');ui.close();
});
