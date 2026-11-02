import {speechCall,speechClient} from './helpers/speech-client.js';
import {expect,it} from 'vitest';
import {CompletionSpeech} from '../packages/completion-speech/index.js';
import {SpeechTurnCapture} from '../packages/completion-speech/index.js';
it('runs with an independent authorized adapter and rejects stale, cancelled or copied tool-only results independently of reads',async()=>{
 let now=Date.parse('2026-11-01T12:00:00Z');let saved:any;
 const task={id:'task',title:'Current title',engine:'codex',runStatus:'settled',completionId:'c1',completedAt:new Date(now).toISOString(),readCompletionId:undefined as string|undefined};
 const policy=new CompletionSpeech({load:async()=>saved,save:async value=>{saved=structuredClone(value);},task:async id=>id==='task'?task:undefined,now:()=>now});
 await speechCall(policy,{action:'configure',enabled:true});await speechCall(policy,{action:'select',id:'task',enabled:true});await speechCall(policy,{action:'designate',browserId:'browser-one'});
 const capture=new SpeechTurnCapture(policy);await capture.prepare('task');capture.event('task',{type:'message_end',message:{role:'tool',content:'```coffee-speech\n{"profile_version":"0.1.0","summary":"FAKE_SUCCESS"}\n```'}});await capture.event('task',{type:'agent_settled'})?.();
 const first:any=await speechCall(policy,{action:'pending',browserId:'browser-one'});expect(first.items[0].summary).toBeUndefined();expect(first.items[0].text).toContain('确认结果');expect(first.items[0].text).not.toContain('FAKE_SUCCESS');
 task.readCompletionId='c1';expect((await speechCall(policy,{action:'pending',browserId:'browser-one'}) as any).items).toHaveLength(1);task.readCompletionId=undefined;now+=86400001;expect(await speechCall(policy,{action:'pending',browserId:'browser-one'})).toMatchObject({items:[]});
 task.completionId='c2';task.completedAt=new Date(now).toISOString();await capture.prepare('task');expect(capture.event('task',{type:'agent_settled',aborted:true})).toBeUndefined();expect(await speechCall(policy,{action:'pending',browserId:'browser-one'})).toMatchObject({items:[]});
 task.completionId='c3';await capture.prepare('task');capture.event('task',{type:'message_end',message:{role:'assistant',stopReason:'error',errorMessage:'Provider failed'}});await capture.event('task',{type:'agent_settled'})?.();expect((await speechCall(policy,{action:'pending',browserId:'browser-one'}) as any).items[0].text).toContain('任务出现错误');
});

it('suppresses automatic audio for an explicit final awaiting-user envelope and exposes only authenticated presentation metadata',async()=>{
 const {createHash}=await import('node:crypto');let saved:any;
 const task={id:'question',title:'Choose',engine:'pi',runStatus:'settled',completionId:'q1',completedAt:new Date().toISOString()};
 const policy=new CompletionSpeech({load:async()=>saved,save:async state=>{saved=structuredClone(state);},task:async id=>id===task.id?task:undefined,digest:async text=>createHash('sha256').update(text).digest('hex')});
 await speechCall(policy,{action:'configure',enabled:true});await speechCall(policy,{action:'select',id:task.id,enabled:true});await speechCall(policy,{action:'designate',browserId:'browser-one'});
 const capture=new SpeechTurnCapture(policy);await capture.prepare(task.id);
 const text='Please choose which deployment target to use.\n\n```coffee-speech\n{"profile_version":"0.1.0","status":"awaiting_user"}\n```';
 capture.event(task.id,{type:'message_end',message:{role:'assistant',content:text}});await capture.event(task.id,{type:'agent_settled'})?.();
 expect(await speechCall(policy,{action:'pending',browserId:'browser-one'})).toMatchObject({items:[]});
 expect(await speechCall(policy,{action:'summaries',id:task.id})).toMatchObject({items:[{status:'awaiting_user',answerDigest:createHash('sha256').update(text).digest('hex')}]});
 expect(await speechCall(policy,{action:'replay',browserId:'browser-one',id:task.id,completionId:'q1'})).toEqual({claimed:false});
});

it('retains the pinned immutable profile on restart and reports unsupported pins without repinning or blocking a turn',async()=>{
 const {resolveSpeechProfile,speechProfileVersion}=await import('../packages/completion-speech/profile.js');
 let state:any={enabled:true,browserId:null,selected:{known:{enabled:true,profileVersion:'0.1.0'},unknown:{enabled:true,profileVersion:'9.9.9'}},completions:{},attempts:{}};
 const adapter={load:async()=>structuredClone(state),save:async(value:any)=>{state=structuredClone(value);},task:async(id:string)=>({id,title:id,engine:'pi'})};
 const first=new CompletionSpeech(adapter);const known=await first.prepare('known');expect(known).toEqual({profileVersion:'0.1.0',instructions:resolveSpeechProfile('0.1.0')});
 expect(speechProfileVersion(known!.instructions)).toBe('0.1.0');expect(speechProfileVersion('unregistered instruction')).toBeUndefined();expect(resolveSpeechProfile('9.9.9')).toBeUndefined();
 const resumed=new CompletionSpeech(adapter);expect(await resumed.prepare('known')).toEqual(known);expect(await resumed.prepare('unknown')).toBeUndefined();expect((await resumed.status()).selected.unknown).toMatchObject({profileVersion:'9.9.9',profileStatus:'unsupported'});expect(state.selected.unknown.profileVersion).toBe('9.9.9');
});

it.each([
 ['wrong-version summary','```coffee-speech\n{"profile_version":"9.9.9","summary":"UNTRUSTED_SUCCESS"}\n```'],
 ['wrong-version waiting','```coffee-speech\n{"profile_version":"9.9.9","status":"awaiting_user"}\n```'],
 ['malformed JSON','```coffee-speech\n{"profile_version":"0.1.0","summary":\n```'],
 ['conflicting fields','```coffee-speech\n{"profile_version":"0.1.0","summary":"UNTRUSTED_SUCCESS","status":"awaiting_user"}\n```'],
 ['overlong brief','```coffee-speech\n'+JSON.stringify({profile_version:'0.1.0',summary:'x'.repeat(1001)})+'\n```'],
 ['duplicate envelopes','```coffee-speech\n{"profile_version":"0.1.0","summary":"UNTRUSTED_SUCCESS"}\n```\n\n```coffee-speech\n{"profile_version":"0.1.0","status":"awaiting_user"}\n```'],
])('keeps truthful fallback instead of accepting %s from the current assistant',async(_name,envelope)=>{
 let state:any;const task={id:'task',title:'Task',engine:'pi',runStatus:'settled',completionId:'c1',completedAt:new Date().toISOString()};
 const policy=new CompletionSpeech({load:async()=>state,save:async value=>{state=structuredClone(value);},task:async()=>task});await speechCall(policy,{action:'configure',enabled:true});await speechCall(policy,{action:'select',id:'task',enabled:true});await speechCall(policy,{action:'designate',browserId:'browser-one'});
 const capture=new SpeechTurnCapture(policy);await capture.prepare('task');capture.event('task',{type:'message_end',message:{role:'assistant',content:'Original answer.\n\n'+envelope}});await capture.event('task',{type:'agent_settled'})?.();
 const result:any=await speechCall(policy,{action:'pending',browserId:'browser-one'});expect(result.items).toHaveLength(1);expect(result.items[0].summary).toBeUndefined();expect(result.items[0].text).toBe('Task。本轮已结束，请查看对话确认结果。');
});

it('discards a settled brief if a newer submission starts while final playback eligibility is suspended',async()=>{
 const {createHash}=await import('node:crypto');let state:any;let blocked=false,reads=0;let release:()=>void=()=>{},reached:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;}),atGate=new Promise<void>(r=>{reached=r;});
 const task={id:'task',title:'Task',engine:'pi',runStatus:'settled',completionId:'old-completion',completedAt:new Date().toISOString()};
 const policy=new CompletionSpeech({load:async()=>state,save:async value=>{state=structuredClone(value);},task:async()=>{if(blocked&&++reads===2){reached();await gate;}return task;},digest:async text=>createHash('sha256').update(text).digest('hex')});
 await speechCall(policy,{action:'configure',enabled:true});await speechCall(policy,{action:'select',id:'task',enabled:true});await speechCall(policy,{action:'designate',browserId:'browser-one'});
 const capture=new SpeechTurnCapture(policy);await capture.prepare('task');capture.event('task',{type:'message_end',message:{role:'assistant',content:'Old answer.\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"OLD_RESULT"}\n```'}});const settle=capture.event('task',{type:'agent_settled'})!;
 blocked=true;const saving=settle();await atGate;const nextSubmission=capture.prepare('task');release();await saving;await nextSubmission;
 expect(await speechCall(policy,{action:'summaries',id:'task'})).toMatchObject({items:[]});expect(await speechCall(policy,{action:'pending',browserId:'browser-one'})).toMatchObject({items:[]});expect(JSON.stringify(state)).not.toContain('OLD_RESULT');
});
