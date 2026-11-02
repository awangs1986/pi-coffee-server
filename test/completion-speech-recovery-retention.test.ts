import {expect,it} from 'vitest';
import {CompletionSpeech,type SpeechState} from '../packages/completion-speech/index.js';
it('keeps a 20-minute offline result eligible through 24 hours, then expires it without marking read',async()=>{
 let now=Date.parse('2026-11-02T12:00:00Z'),saved:SpeechState|undefined;
 const task={id:'task',title:'Retained result',engine:'pi',completionId:'c1',completedAt:new Date(now).toISOString(),runStatus:'settled'};
 const policy=new CompletionSpeech({load:async()=>saved,save:async s=>{saved=structuredClone(s);},task:async()=>task,now:()=>now});
 await policy.handle({action:'configure',enabled:true});await policy.handle({action:'select',id:'task',enabled:true});await policy.handle({action:'designate',browserId:'browser-one'});
 await policy.settled('task','0.1.0','Completed',false);
 const pending=()=>policy.handle({action:'pending',browserId:'browser-one',pageId:'page-one'}) as Promise<any>;
 now+=20*60*1000;expect((await pending()).items).toHaveLength(1);
 now=Date.parse('2026-11-03T12:00:00Z');expect((await pending()).items).toHaveLength(1);
 now++;expect(await pending()).toMatchObject({items:[],diagnostics:[{state:'skipped',reason:'expired'}]});
});
