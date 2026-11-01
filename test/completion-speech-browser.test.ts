// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createSpeechController} from '../packages/completion-speech/browser.js';
it('claims a completion once before speaking and never sends a viewed receipt or model request',async()=>{
 const spoken:string[]=[],requests:any[]=[];let claim=true;let task={user:'alice'};
 const item={id:'a',completionId:'c1',text:'Task. Completed.'};
 const request=async(body:any)=>{requests.push(body);if(body.action==='status')return {enabled:true,browserId:'browser-a'};if(body.action==='pending')return {items:[item]};if(body.action==='claim'){const claimed=claim;claim=false;return {claimed,item};}return {};};
 const controller=createSpeechController({request,context:()=>task,browserId:'browser-a',speech:{cancel:vi.fn(),speak:async text=>{spoken.push(text);}}});
 await controller.poll();await controller.poll();expect(spoken).toEqual(['Task. Completed.']);expect(requests.every(r=>['status','pending','claim','finish'].includes(r.action))).toBe(true);
 task={user:'bob'};await controller.poll();expect(spoken).toHaveLength(1);controller.close();
});
it('cancels when disabled and never claims or speaks from a non-designated browser',async()=>{
 const speak=vi.fn(),cancel=vi.fn();const request=vi.fn(async()=>({enabled:true,browserId:'another-browser'}));
 const controller=createSpeechController({request,context:()=>({user:'alice'}),browserId:'browser-a',speech:{cancel,speak}});await controller.poll();expect(speak).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);controller.close();expect(cancel).toHaveBeenCalled();
});
it('revokes in-flight audio immediately on ownership loss even when cancel omits native callbacks',async()=>{
 let owner='browser-a',resolveSpeech:()=>void=()=>{};const cancel=vi.fn();const speech={cancel,speak:vi.fn(()=>new Promise<void>(r=>{resolveSpeech=r;}))};let claimed=false;
 const request=async(body:any)=>body.action==='status'?{enabled:true,browserId:owner}:body.action==='pending'?{items:[{id:'a',completionId:'c1'}],...(claimed?{active:{id:'a',completionId:'c1',browserId:'browser-a'}}:{})}:body.action==='claim'?{claimed:!claimed&&(claimed=true),item:{id:'a',completionId:'c1',text:'Done'}}:{finished:true};
 const controller=createSpeechController({request,context:()=>({user:'alice'}),browserId:'browser-a',speech});const draining=controller.poll();await vi.waitFor(()=>expect(speech.speak).toHaveBeenCalledTimes(1));owner='browser-b';await controller.poll();expect(cancel).toHaveBeenCalledTimes(2);await draining;resolveSpeech();controller.close();
});
it('native browser cancellation settles the speech promise without relying on end callbacks',async()=>{
 const {browserSpeech}=await import('../packages/completion-speech/browser.js');const synthesis={cancel:vi.fn(),speak:vi.fn()} as any;class Utterance {constructor(readonly text:string){}}const boundary=browserSpeech({synthesis,Utterance:Utterance as any});const done=boundary.speak('Result');boundary.cancel();await done;expect(synthesis.cancel).toHaveBeenCalled();
});
