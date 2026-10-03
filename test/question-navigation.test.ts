// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createDialogManager} from '../public/dialogs.js';
it('leaves sidebar actions accessible while an Agent question waits, without answering it',async()=>{
 document.body.innerHTML='<main id="app"><aside><button id="more">对话操作</button></aside><textarea></textarea></main><div id="question" class="hidden"><div role="dialog"><button>回答</button></div></div>';
 const app=document.querySelector('#app')!,question=document.querySelector('#question')!,more=document.querySelector<HTMLButtonElement>('#more')!,cancel=vi.fn();
 const dialogs=createDialogManager(app,more);dialogs.show(question,cancel,undefined,{nonModal:true});await Promise.resolve();
 expect((app as HTMLElement).inert).toBe(false);more.focus();expect(document.activeElement).toBe(more);
 more.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));expect(cancel).not.toHaveBeenCalled();
 expect(question.classList.contains('hidden')).toBe(false);dialogs.hide(question);expect(cancel).not.toHaveBeenCalled();
});
