// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createSpeechController} from '../packages/completion-speech/browser.js';
import {speechPolicy} from './helpers/speech-policy.js';
async function fixture(speech:any){const f=speechPolicy();await f.init();await f.complete();const requests:any[]=[];const controller=createSpeechController({request:body=>{requests.push(body);return f.request(body);},context:()=>({user:'alice'}),browserId:'browser-one',speech});return {...f,controller,requests};}
it('commits once before speaking and never sends a viewed receipt or model request',async()=>{
 const speech={cancel:vi.fn(),speak:vi.fn(async()=>{})},f=await fixture(speech);
 try{await f.controller.poll();await f.controller.poll();expect(speech.speak).toHaveBeenCalledTimes(1);expect(f.requests.every(r=>['status','pending','reserve','commit','finish'].includes(r.action))).toBe(true);expect(f.tasks.get('task')?.readCompletionId).toBeUndefined();}finally{f.controller.close();}
});
it('never reserves or speaks from a non-designated browser',async()=>{
 const speech={cancel:vi.fn(),speak:vi.fn()},f=await fixture(speech);await f.request({action:'designate',browserId:'other-browser'});try{await f.controller.poll();expect(speech.speak).not.toHaveBeenCalled();expect(f.requests).toHaveLength(1);}finally{f.controller.close();}
});
it('revokes in-flight audio on ownership loss even when native cancel omits callbacks',async()=>{
 const speech={cancel:vi.fn(),speak:vi.fn(()=>new Promise(()=>{}))},f=await fixture(speech);const playing=f.controller.poll();
 try{await vi.waitFor(()=>expect(speech.speak).toHaveBeenCalledTimes(1));const count=speech.cancel.mock.calls.length;await f.request({action:'designate',browserId:'another-browser'});await f.controller.poll();expect(speech.cancel.mock.calls.length).toBeGreaterThan(count);await playing;}finally{f.controller.close();}
});
it('native browser cancellation settles the speech promise without relying on end callbacks',async()=>{
 const {browserSpeech}=await import('../packages/completion-speech/browser.js');const synthesis={cancel:vi.fn(),speak:vi.fn()} as any;class Utterance {constructor(readonly text:string){}}const boundary=browserSpeech({synthesis,Utterance:Utterance as any});const done=boundary.speak('Result');boundary.cancel();await done;expect(synthesis.cancel).toHaveBeenCalled();
});
it('selects matching voices, previews and releases a timed-out utterance',async()=>{vi.useFakeTimers();try{const {browserSpeech}=await import('../packages/completion-speech/browser.js');let utterance:any;const voices=[{voiceURI:'en',lang:'en-US'},{voiceURI:'zh',lang:'zh-CN'}];const synthesis={getVoices:()=>voices,cancel:vi.fn(),speak:vi.fn(u=>{utterance=u;})};class Utterance{constructor(readonly text:string){}}const boundary=browserSpeech({synthesis,Utterance});const playing=boundary.speak('测试');expect(utterance.voice).toBe(voices[1]);utterance.onend();await playing;boundary.setVoice('en');const preview=boundary.speak('测试');expect(utterance.voice).toBe(voices[0]);const timed=expect(preview).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(60000);await timed;expect(vi.getTimerCount()).toBe(0);}finally{vi.useRealTimers();}});

it('pauses actual audio errors until explicit retry without model or read requests',async()=>{
 const speech={cancel:vi.fn(),speak:vi.fn().mockRejectedValueOnce(Error('blocked')).mockResolvedValue(undefined)},f=await fixture(speech);
 try{await f.controller.poll();await f.controller.poll();expect(speech.speak).toHaveBeenCalledTimes(1);await f.controller.retry();expect(speech.speak).toHaveBeenCalledTimes(2);expect(f.requests.every(r=>['status','pending','reserve','commit','replay','finish'].includes(r.action))).toBe(true);}finally{f.controller.close();}
});
it('immediately cancels only the archived or deselected speaking conversation',async()=>{
 const speech={cancel:vi.fn(),speak:vi.fn(()=>new Promise(()=>{}))},f=await fixture(speech);const playing=f.controller.poll();
 try{await vi.waitFor(()=>expect(speech.speak).toHaveBeenCalled());const count=speech.cancel.mock.calls.length;f.controller.revoke('unrelated');expect(speech.cancel).toHaveBeenCalledTimes(count);f.controller.revoke('task');expect(speech.cancel).toHaveBeenCalledTimes(count+1);await playing;}finally{f.controller.close();}
});
