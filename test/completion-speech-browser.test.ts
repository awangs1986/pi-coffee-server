// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createSpeechController} from '../packages/completion-speech/browser.js';
it('claims a completion once before speaking and never sends a viewed receipt or model request',async()=>{
 const spoken:string[]=[],requests:any[]=[];let claim=true;let task={user:'alice'};
 const item={id:'a',completionId:'c1',text:'Task. Completed.'};
 const request=async(body:any)=>{requests.push(body);if(body.action==='status')return {enabled:true,browserId:'browser-a'};if(body.action==='pending')return {items:[item]};if(body.action==='claim'){const claimed=claim;claim=false;return {claimed,item};}return {};};
 const controller=createSpeechController({request,context:()=>task,browserId:'browser-a',speech:{cancel:vi.fn(),speak:async text=>{spoken.push(text);}}});
 await controller.poll();await controller.poll();expect(spoken).toEqual(['Task. Completed.']);expect(requests.every(r=>['status','pending','claim'].includes(r.action))).toBe(true);
 task={user:'bob'};await controller.poll();expect(spoken).toHaveLength(1);controller.close();
});
it('cancels when disabled and never claims or speaks from a non-designated browser',async()=>{
 const speak=vi.fn(),cancel=vi.fn();const request=vi.fn(async()=>({enabled:true,browserId:'another-browser'}));
 const controller=createSpeechController({request,context:()=>({user:'alice'}),browserId:'browser-a',speech:{cancel,speak}});await controller.poll();expect(speak).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);controller.close();expect(cancel).toHaveBeenCalled();
});
