// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {initMishuCommands} from '../public/mishu-commands.js';
const old={id:'old-contact',binding:'native-old',title:'旧项目',engine:'codex',project:'Project'};
it('looks up an old contact by exact ID, stages it, and saves only after confirmation',async()=>{
 document.body.innerHTML='';const calls:any[]=[],request=vi.fn(async(v:any)=>{calls.push(v);return v.action==='setup_open'?{ticket:'setup-ticket',conversations:[],configuredTargets:[]}:v.action==='setup_lookup'?{conversation:old}:{};});
 const ui=initMishuCommands({context:()=>({id:'source',engine:'codex',busy:false}),request,dialogs:{show(){},hide(){}},toast:vi.fn()});await ui.setup();
 const id=document.querySelector<HTMLInputElement>('input[aria-label="完整对话 ID"]');expect(id).not.toBeNull();id!.value=old.id;
 const button=(label:string)=>Array.from(document.querySelectorAll('button')).find(n=>n.textContent===label)!;
 button('按 ID 添加').click();await vi.waitFor(()=>expect(document.querySelector<HTMLInputElement>('input[aria-label="旧项目"]')?.checked).toBe(true));
 expect(calls).toContainEqual({action:'setup_lookup',id:'source',ticket:'setup-ticket',targetId:old.id});expect(calls.some(v=>v.action==='setup_confirm')).toBe(false);
 button('完成选择').click();expect(calls.some(v=>v.action==='setup_confirm')).toBe(false);button('确认启用').click();
 await vi.waitFor(()=>expect(calls.find(v=>v.action==='setup_confirm')).toMatchObject({targets:[{id:old.id,binding:old.binding}],allowInstructions:false}));
});
it('ignores a late lookup after cancelling without saving any contact',async()=>{
 document.body.innerHTML='';let reply!:(v:any)=>void;const calls:any[]=[],request=vi.fn(async(v:any)=>{calls.push(v);return v.action==='setup_open'?{ticket:'t',conversations:[],configuredTargets:[]}:new Promise(r=>reply=r);});
 const ui=initMishuCommands({context:()=>({id:'source',engine:'codex',busy:false}),request,dialogs:{show(){},hide(){}},toast:vi.fn()});await ui.setup();
 const input=document.querySelector<HTMLInputElement>('input[aria-label="完整对话 ID"]');expect(input).not.toBeNull();input!.value=old.id;
 Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='按 ID 添加')!.click();ui.close();reply({conversation:old});await Promise.resolve();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(calls.some(v=>v.action==='setup_confirm')).toBe(false);
});
