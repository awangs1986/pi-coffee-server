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

it('shows durable failure after reopening the dialog without creating or retrying a Fork',()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');HTMLDialogElement.prototype.showModal=function(){};
 const request=vi.fn();const controls=initForkControls({task:()=>({engine:'codex',forking:{status:'failed',error:'Workspace Git request exceeds its resource budget'}}),modes:()=>['native','handoff'],request,refresh:async()=>{},changed:()=>{},complete:()=>{},selection:()=>1,toast:()=>{}});
 controls.open({id:'source'});expect(document.getElementById('fork-status')!.textContent).toContain('Workspace Git request exceeds its resource budget');expect(controls.busy('source')).toBe(false);expect(request).not.toHaveBeenCalled();
});
it('keeps a durable operation across dialog reload and offers only Host-authorized resume',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');HTMLDialogElement.prototype.showModal=function(){};HTMLDialogElement.prototype.close=function(){};
 const calls:any[]=[];const saved=new Map<string,string>();const storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)};
 const options={task:()=>({id:'source',engine:'codex'}),modes:()=>['handoff'],durable:()=>true,scope:()=> 'alice',storage,request:async value=>{calls.push(value);return {operationId:value.operationId,targetTaskId:value.targetTaskId,status:'failed',phase:'seed',revision:8,error:'seed failed',allowedActions:['resume']};},refresh:async()=>{},changed:()=>{},complete:()=>{},selection:()=>1,toast:()=>{}};
 const first=initForkControls(options);first.open({id:'source'});document.getElementById('fork-confirm')!.click();await new Promise(r=>setTimeout(r,0));
 expect(calls[0].action).toBe('preparation_start');expect(document.getElementById('fork-resume')!.hidden).toBe(false);
 const original=calls[0].operationId;
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');const second=initForkControls(options);second.open({id:'source'});await new Promise(r=>setTimeout(r,0));
 expect(calls.at(-1)).toMatchObject({action:'preparation_get',operationId:original});
 expect(calls.filter(c=>c.action==='preparation_start')).toHaveLength(1);
});
it('allows an explicit new Fork after a definite failure while retaining the failed operation until that click',async()=>{
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');HTMLDialogElement.prototype.showModal=function(){};HTMLDialogElement.prototype.close=function(){};
 const calls:any[]=[];const controls=initForkControls({task:()=>({id:'source',engine:'codex'}),modes:()=>['handoff'],durable:()=>true,scope:()=> 'retry-test',storage:null,request:async input=>{calls.push(input);return {operationId:input.operationId,status:'failed',phase:'source-snapshot',allowedActions:[],error:'Source was busy'};},refresh:async()=>{},changed:()=>{},complete:()=>{},selection:()=>1,toast:()=>{}});
 controls.open({id:'source'});document.getElementById('fork-confirm')!.click();await new Promise(resolve=>setTimeout(resolve,0));expect(calls).toHaveLength(1);
 document.getElementById('fork-confirm')!.click();await new Promise(resolve=>setTimeout(resolve,0));expect(calls).toHaveLength(2);expect(calls[1].operationId).not.toBe(calls[0].operationId);
});
