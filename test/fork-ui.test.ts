// @vitest-environment jsdom
import {readFileSync} from 'node:fs';import {it,expect,vi,afterEach} from 'vitest';import {initForkControls} from '../public/fork.js';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it.each([true,false])('offers native and Handoff modes and opens an independent task (native UUID available: %s)',async nativeUuid=>{
 if(!nativeUuid)vi.stubGlobal('crypto',{getRandomValues:crypto.getRandomValues.bind(crypto)});
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const tasks:any[]=[{id:'source',engine:'pi',workspaceKind:'project'}],requests:any[]=[];const complete=vi.fn();
 const controls=initForkControls({task:id=>tasks.find(t=>t.id===id),modes:()=>['native','handoff'],request:async value=>{requests.push(value);tasks.push({id:value.targetId,fork:{status:'preparing'}});return {};},refresh:async()=>{},changed:()=>{},complete,selection:()=>1,toast:()=>{}});
 controls.open({id:'source',name:'Original'});expect(document.getElementById('fork-dialog')!.hasAttribute('open')).toBe(true);
 (document.querySelector('input[name="fork-mode"][value="handoff"]') as HTMLInputElement).click();expect(document.getElementById('fork-warning')!.hidden).toBe(false);
 document.getElementById('fork-confirm')!.click();await new Promise(r=>setTimeout(r,0));expect(requests[0]).toMatchObject({action:'fork',id:'source',mode:'handoff',acceptDrift:true});expect(controls.busy('source')).toBe(true);
 tasks.at(-1).fork.status='completed';controls.sync();expect(complete).toHaveBeenCalledWith(requests[0].targetId,1);expect(controls.busy('source')).toBe(false);
});
it('retains an uncertain operation and retries its original ID instead of charging for a second Fork',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');HTMLDialogElement.prototype.showModal=function(){};HTMLDialogElement.prototype.close=function(){};
 const requests:any[]=[];let offline=true;const tasks:any[]=[{id:'source',engine:'codex'}];
 const controls=initForkControls({task:id=>tasks.find(t=>t.id===id),modes:()=>['native','handoff'],request:async value=>{requests.push(value);if(offline)throw Error('Failed to fetch');tasks.push({id:value.targetId,fork:{status:'completed'}});},refresh:async()=>{if(offline)throw Error('offline');},changed:()=>{},complete:()=>{},selection:()=>1,toast:()=>{}});
 controls.open({id:'source'});document.getElementById('fork-confirm')!.click();await new Promise(r=>setTimeout(r,0));expect(controls.busy('source')).toBe(true);
 offline=false;document.getElementById('fork-confirm')!.click();await new Promise(r=>setTimeout(r,0));expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(controls.busy('source')).toBe(false);
});
