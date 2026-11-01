import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {CompletionSpeech,SpeechTurnCapture} from '../packages/completion-speech/index.js';
import {projectHistory} from '../src/host/pi-adapter.js';
import {projectTurns} from '../src/host/codex/translate.js';

it.each(['pi','codex'])('keeps the captured %s native source message key through persisted history projection',async engine=>{
 const text='Complete.\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"Done."}\n```';
 const task={id:'task',engine,title:'Task',runStatus:'settled',completionId:'completion',completedAt:new Date().toISOString()};
 const policy=new CompletionSpeech({load:async()=>undefined,save:async()=>{},task:async()=>task,digest:async value=>createHash('sha256').update(value).digest('hex')});
 await policy.handle({action:'configure',enabled:true});await policy.handle({action:'select',id:'task',enabled:true});
 const capture=new SpeechTurnCapture(policy);await capture.prepare('task');
 const message={role:'assistant',content:[{type:'text',text}],...(engine==='pi'?{timestamp:1793534400000}:{})};
 capture.event('task',{type:'message_end',...(engine==='codex'?{id:'native-item'}:{}),text,message});await capture.event('task',{type:'agent_settled'})?.();
 const history=engine==='pi'?projectHistory([{type:'message',id:'pi-tree-entry',message}],null).entries:projectTurns([{id:'native-turn',items:[{id:'native-item',type:'agentMessage',text}]}]);
 expect((await policy.handle({action:'summaries',id:'task'}) as any).items[0].sourceMessageKey).toBe((history[0] as any).sourceMessageKey);
 expect((history[0] as any).sourceMessageKey).toBe(engine==='pi'?'pi-message:1793534400000':'native-message:native-item');
});

it('preserves native source identity and whole-answer digest through bounded native recent pages',async()=>{
 const {RecentHistoryPager}=await import('../src/host/recent-history.js');const text='long '.repeat(4000);
 const pager=new RecentHistoryPager({getHistoryBinding:()=> 'synthetic-native',getHistoryPage:async()=>({entries:[{kind:'assistant',id:'native',sourceMessageKey:'native-message:native',text}],leafId:'native'})} as any);
 try{const page=await pager.page('compact');expect(page.entries[0]).toMatchObject({sourceMessageKey:'native-message:native',contentDigest:createHash('sha256').update(text).digest('hex')});expect((page.entries[0] as any).text.length).toBeLessThan(text.length);}finally{pager.close();}
});
