// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {initMishuControls} from '../public/mishu.js';
it('checks only the current Pi Chat and invites explicit setup without enabling it',async()=>{
 document.body.innerHTML=readFileSync('public/index.html','utf8');
 const button=document.querySelector<HTMLButtonElement>('#mishu-toggle')!;
 let current={id:'secretary',engine:'pi',workspaceKind:'chat',busy:false};
 const request=vi.fn(async(input:any)=>input.action==='status'?{selected:false,enabled:false}:{selected:input.selected,enabled:false});
 const changed=vi.fn(),toast=vi.fn(),busyChanged=vi.fn();
 const ui=initMishuControls({button,context:()=>current,request,changed,toast,busyChanged});
 await ui.refresh();expect(button.disabled).toBe(false);expect(button.getAttribute('aria-checked')).toBe('false');
 button.click();expect(busyChanged).toHaveBeenCalledWith(true,'secretary');await vi.waitFor(()=>expect(changed).toHaveBeenCalledWith('secretary'));
 expect(request).toHaveBeenLastCalledWith({action:'select',id:'secretary',selected:true});
 expect(button.getAttribute('aria-checked')).toBe('true');expect(toast).toHaveBeenCalledWith(expect.stringContaining('/mishu-setup'));
 current={id:'work',engine:'codex',workspaceKind:'project',busy:false};await ui.refresh();expect(button.disabled).toBe(true);expect(button.getAttribute('aria-checked')).toBe('false');
});
it('ignores a stale status response after switching conversations',async()=>{
 document.body.innerHTML='<button id="m" aria-checked="false"></button>';const button=document.querySelector<HTMLButtonElement>('#m')!;
 let current={id:'old',engine:'pi',workspaceKind:'chat',busy:false};let release!:(v:any)=>void;
 const request=vi.fn((input:any)=>input.id==='old'?new Promise(r=>release=r):Promise.resolve({selected:false}));
 const changed=vi.fn();const ui=initMishuControls({button,context:()=>current,request,changed,toast:vi.fn()});
 const pending=ui.refresh();current={...current,id:'new'};await ui.refresh();release({selected:true});await pending;
 expect(button.getAttribute('aria-checked')).toBe('false');expect(changed).not.toHaveBeenCalled();
});

it('keeps selection unavailable until the current Chat has finished opening',async()=>{
 document.body.innerHTML='<button id="m" aria-checked="false"></button>';const button=document.querySelector<HTMLButtonElement>('#m')!;
 let current={id:'chat',engine:'pi',workspaceKind:'chat',busy:true};
 const request=vi.fn(async()=>({selected:false}));const ui=initMishuControls({button,context:()=>current,request,changed:vi.fn(),toast:vi.fn()});
 await ui.refresh();expect(button.disabled).toBe(true);button.click();expect(request).toHaveBeenCalledTimes(1);
 current={...current,busy:false};ui.updateAvailability();expect(button.disabled).toBe(false);
});
