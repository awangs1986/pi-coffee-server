// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {it,expect,vi,afterEach} from 'vitest';
import {initQueueControls} from '../public/queue-controls.js';
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 document.documentElement.innerHTML=readFileSync('public/index.html','utf8');
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const send=vi.fn(()=>true),toast=vi.fn();let id=0;
 const controls=initQueueControls({container:document.getElementById('queue'),send,toast,requestId:()=>`action-${++id}`,canPromote:()=>true});
 const item={id:'one',revision:1,text:'original',imageCount:1,status:'pending'};controls.update([item]);return {controls,send,toast,item};
}
const click=(action:string)=>(document.querySelector(`[data-queue-action="${action}"]`) as HTMLButtonElement).click();
it('edits a queued item without replacing the composer draft or image attachments',()=>{
 const {controls,send}=setup();const prompt=document.getElementById('prompt') as HTMLTextAreaElement;prompt.value='unsent draft';
 click('edit');const edit=document.getElementById('queue-edit-text') as HTMLTextAreaElement;edit.value='new instruction';
 document.getElementById('queue-edit-form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(send).toHaveBeenCalledWith({v:1,type:'queue_action',requestId:'action-1',id:'one',revision:1,action:'edit',text:'new instruction'});
 expect(prompt.value).toBe('unsent draft');expect(document.querySelector('#queue')!.textContent).toContain('1 张图片');
 controls.error('action-1','指令已经执行');expect(edit.value).toBe('new instruction');expect(document.getElementById('queue-edit-dialog')!.hasAttribute('open')).toBe(true);
});
it.each(['cancel','promote'])('submits %s once and uses authoritative snapshots',action=>{
 const {controls,send}=setup();click(action);click(action);expect(send).toHaveBeenCalledTimes(1);
 expect(send.mock.calls[0][0]).toMatchObject({action,id:'one',revision:1});
 expect(document.querySelector('#queue')!.textContent).toContain('original');controls.update([]);controls.ack('action-1');
 expect(document.querySelector('#queue')!.classList.contains('hidden')).toBe(true);
});
it('disables mutations while disconnected and never replays uncertain actions',()=>{
 const {controls,send,item}=setup();controls.connection(false);click('promote');expect(send).not.toHaveBeenCalled();
 controls.connection(true);click('promote');controls.connection(false);controls.reset();controls.update([item]);controls.connection(true);
 expect(send).toHaveBeenCalledTimes(1);
});
