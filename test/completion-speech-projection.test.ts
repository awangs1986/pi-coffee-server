import {speechCall,speechClient} from './helpers/speech-client.js';
import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompletionSpeech} from '../src/host/completion-speech.js';
import {Workspaces} from '../src/host/workspaces.js';

it('publishes only captured opted-in briefs bound to the entire answer, and retains history after disable without copying answers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-project-'));
 const store=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});await store.createChatConversation('task');
 const speech=createCompletionSpeech(join(root,'speech'),store);
 const summary='The result is ready, verification is pending.';
 const answer='Full answer '+ 'private body '.repeat(4000)+'\n\n```coffee-speech\n'+JSON.stringify({profile_version:'0.1.0',summary})+'\n```';
 try{
  await speechCall(speech,{action:'configure',enabled:true});await speechCall(speech,{action:'select',id:'task',enabled:true});
  await store.markRun('task','running');await speech.prepare('task');
  speech.event('task',{type:'message_end',id:'captured-native-answer',text:answer,message:{role:'assistant'}});
  const done=speech.event('task',{type:'agent_settled'});await store.recordRunStatus('task','settled');await done?.();
  const value=await speechCall(speech,{action:'summaries',id:'task'}) as any;
  expect(value.items).toHaveLength(1);expect(value.items[0]).toMatchObject({summary,sourceMessageKey:'native-message:captured-native-answer',answerDigest:createHash('sha256').update(answer).digest('hex')});
  expect(JSON.stringify(value)).not.toContain('private body');
  await speechCall(speech,{action:'configure',enabled:false});
  expect((await speechCall(speech,{action:'summaries',id:'task'}) as any).items).toEqual(value.items);
  await expect(speechCall(speech,{action:'summaries',id:'not-in-scope'})).rejects.toThrow();
  await store.markRun('task','running');await speech.prepare('task');speech.event('task',{type:'message_end',id:'captured-native-answer',text:answer,message:{role:'assistant'}});const off=speech.event('task',{type:'agent_settled'});await store.recordRunStatus('task','settled');await off?.();
  expect((await speechCall(speech,{action:'summaries',id:'task'}) as any).items).toEqual(value.items);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('reclaims expired presentation brief texts without erasing durable delivery identity',async()=>{
 const {CompletionSpeech}=await import('../packages/completion-speech/index.js');let now=Date.parse('2026-11-01T12:00:00Z'),saved:any;
 const task={id:'task',engine:'pi',title:'Task',runStatus:'settled',completionId:'c1',completedAt:new Date(now).toISOString()};
 const policy=new CompletionSpeech({load:async()=>saved,save:async value=>{saved=structuredClone(value);},task:async id=>id==='task'?task:undefined,now:()=>now,digest:async text=>createHash('sha256').update(text).digest('hex')});
 await speechCall(policy,{action:'configure',enabled:true});await speechCall(policy,{action:'select',id:'task',enabled:true});await speechCall(policy,{action:'designate',browserId:'browser-one'});
 const text='Done.\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"PRIVATE_BRIEF"}\n```';
 await policy.settled('task','0.1.0',text,false);await speechCall(policy,{action:'claim',browserId:'browser-one',id:'task',completionId:'c1'});now+=86400001;
 expect(await speechCall(policy,{action:'summaries',id:'task'})).toMatchObject({items:[]});expect(JSON.stringify(saved)).not.toContain('PRIVATE_BRIEF');expect(saved.attempts.task).toBe('c1');
});
