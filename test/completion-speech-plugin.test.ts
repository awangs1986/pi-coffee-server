import {expect,it} from 'vitest';
import {CompletionSpeech} from '../packages/completion-speech/index.js';
import {SpeechTurnCapture} from '../packages/completion-speech/index.js';
it('runs with an independent authorized adapter and rejects stale, read, cancelled or copied tool-only results',async()=>{
 let now=Date.parse('2026-11-01T12:00:00Z');let saved:any;
 const task={id:'task',title:'Current title',engine:'codex',runStatus:'settled',completionId:'c1',completedAt:new Date(now).toISOString(),readCompletionId:undefined as string|undefined};
 const policy=new CompletionSpeech({load:async()=>saved,save:async value=>{saved=structuredClone(value);},task:async id=>id==='task'?task:undefined,now:()=>now});
 await policy.handle({action:'configure',enabled:true});await policy.handle({action:'select',id:'task',enabled:true});await policy.handle({action:'designate',browserId:'browser-one'});
 const capture=new SpeechTurnCapture(policy);await capture.prepare('task');capture.event('task',{type:'message_end',message:{role:'tool',content:'```coffee-speech\n{"profile_version":"0.1.0","summary":"FAKE_SUCCESS"}\n```'}});await capture.event('task',{type:'agent_settled'})?.();
 const first:any=await policy.handle({action:'pending',browserId:'browser-one'});expect(first.items[0].summary).toBeUndefined();expect(first.items[0].text).toContain('确认结果');expect(first.items[0].text).not.toContain('FAKE_SUCCESS');
 task.readCompletionId='c1';expect(await policy.handle({action:'pending',browserId:'browser-one'})).toEqual({items:[]});task.readCompletionId=undefined;now+=300001;expect(await policy.handle({action:'pending',browserId:'browser-one'})).toEqual({items:[]});
 task.completionId='c2';task.completedAt=new Date(now).toISOString();await capture.prepare('task');expect(capture.event('task',{type:'agent_settled',aborted:true})).toBeUndefined();expect(await policy.handle({action:'pending',browserId:'browser-one'})).toEqual({items:[]});
 task.completionId='c3';await capture.prepare('task');capture.event('task',{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'Provider failed'}});await capture.event('task',{type:'agent_settled'})?.();expect((await policy.handle({action:'pending',browserId:'browser-one'}) as any).items[0].text).toContain('任务出现错误');
});
