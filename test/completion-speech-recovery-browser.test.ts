// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {createSpeechController} from '../packages/completion-speech/browser.js';
it('automatically resumes an uncommitted result after a temporary claim network failure',async()=>{
 let attempts=0,spoken=0;
 const item={id:'task',completionId:'c1',text:'Task completed.'};
 const request=async({action}:any)=>{
  if(action==='status')return {protocolVersion:2,enabled:true,browserId:'browser-one',ownerEpoch:1};
  if(action==='pending')return {items:spoken?[]:[item]};
  if(action==='reserve'){if(++attempts===1)throw new TypeError('Temporary network loss');return {reserved:true,reservation:{token:'token-one',ownerEpoch:1}};}
  if(action==='commit')return {committed:true,item,deliveryId:'d1',ownerEpoch:1};
  return {};
 };
 const controller=createSpeechController({request,context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel:vi.fn(),speak:async()=>{spoken++;}}});
 try{await controller.poll();await controller.poll();await controller.poll();expect(spoken).toBe(1);}finally{controller.close();}
});

it('releases a hung request after ten seconds and fences its late response',async()=>{
 vi.useFakeTimers();let calls=0,late:(value:any)=>void=()=>{};
 const onStatus=vi.fn(),request=async({action}:any)=>{
  if(action==='status'){calls++;if(calls===1)return new Promise(resolve=>{late=resolve;});return {protocolVersion:2,enabled:true,browserId:'browser-one',ownerEpoch:1};}
  return {items:[]};
 };
 const controller=createSpeechController({request,context:()=>({user:'alice'}),browserId:'browser-one',onStatus,speech:{cancel:vi.fn(),speak:vi.fn()}});
 try{const stuck=controller.poll();await vi.advanceTimersByTimeAsync(10001);await stuck;await controller.poll();expect(calls).toBe(2);late({protocolVersion:2,enabled:false});await Promise.resolve();expect(onStatus).toHaveBeenCalledTimes(1);expect(onStatus.mock.calls[0][0].enabled).toBe(true);}finally{controller.close();vi.useRealTimers();}
});

it('retries transport failures with one bounded scheduler and coalesces wake events after suspended deadlines',async()=>{
 vi.useFakeTimers();let calls=0,hang=false;const errors=vi.fn();
 const controller=createSpeechController({request:async({action}:any)=>{if(action==='status'){calls++;if(hang)return new Promise(()=>{});if(calls<3)throw new TypeError('offline');return {protocolVersion:2,enabled:false};}return {};},context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel(){},async speak(){}},onError:errors});
 try{
  controller.start();await vi.advanceTimersByTimeAsync(0);expect(calls).toBe(1);
  await vi.advanceTimersByTimeAsync(1200);expect(calls).toBe(2);
  await vi.advanceTimersByTimeAsync(2400);expect(calls).toBe(3);
  hang=true;controller.wake();await vi.advanceTimersByTimeAsync(0);expect(calls).toBe(4);
  vi.setSystemTime(Date.now()+11000);hang=false;controller.wake();controller.wake();controller.wake();await vi.advanceTimersByTimeAsync(0);expect(calls).toBe(5);
  expect(vi.getTimerCount()).toBe(1);
 }finally{controller.close();vi.useRealTimers();}
});

it('keeps delivery alive when summary presentation hangs and wakes without a conversation socket',async()=>{
 const {initCompletionSpeech}=await import('../public/completion-speech.js');
 sessionStorage.setItem('pi-coffee.speech-browser.v1','browser-one');let statuses=0;
 const buttons=[0,1,2].map(()=>document.createElement('button'));document.body.append(...buttons);
 const ui=initCompletionSpeech({request:async({action}:any)=>{if(action==='summaries')return new Promise(()=>{});if(action==='status'){statuses++;return {protocolVersion:2,enabled:true,browserId:'browser-one',selected:{}};}return {items:[]};},context:()=>({user:'alice',id:'task'}),masterButton:buttons[0],settingsButton:buttons[1],takeoverButton:buttons[2],toast(){},speech:{available:()=>true,cancel(){},async speak(){}}});
 try{await ui.refresh();const before=statuses;window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('pageshow'));await vi.waitFor(()=>expect(statuses).toBeGreaterThan(before));expect(buttons[0].disabled).toBe(false);}finally{ui.close();document.body.replaceChildren();}
});
it.each(['pending','reserve','commit','finish'])('bounds a hung %s operation, aborts transport and never duplicates audio',async(action)=>{
 const {speechPolicy}=await import('./helpers/speech-policy.js');const f=speechPolicy();await f.init();await f.complete();vi.useFakeTimers();let stuck=true,signal:AbortSignal|undefined;const speak=vi.fn(async()=>{});
 const controller=createSpeechController({request:async(body:any,options:any)=>{const result=await f.request(body);if(body.action===action&&stuck){stuck=false;signal=options.signal;return new Promise(()=>{});}return result;},context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel(){},speak}});
 try{const work=controller.poll();await vi.advanceTimersByTimeAsync(10001);await work;expect(signal?.aborted).toBe(true);await controller.poll();await controller.poll();expect(speak).toHaveBeenCalledTimes(action==='commit'?0:1);}finally{controller.close();vi.useRealTimers();}
});
it('honors Retry-After through wake bursts, and suspends authentication retries until explicit recovery',async()=>{
 vi.useFakeTimers();let attempts=0,mode='rate';const request=async()=>{attempts++;if(mode==='rate')throw Object.assign(Error('wait'),{status:429,retryAfterMs:120000});if(mode==='auth')throw Object.assign(Error('login'),{status:401});return {protocolVersion:2,enabled:false};};
 const controller=createSpeechController({request,context:()=>({user:'alice'}),browserId:'browser-one',speech:{cancel(){},async speak(){}}});
 try{controller.start();await vi.advanceTimersByTimeAsync(0);controller.wake();await vi.advanceTimersByTimeAsync(10000);expect(attempts).toBe(1);mode='auth';await vi.advanceTimersByTimeAsync(110001);expect(attempts).toBe(2);await vi.advanceTimersByTimeAsync(60000);controller.wake();await vi.advanceTimersByTimeAsync(0);expect(attempts).toBe(2);await controller.poll();expect(attempts).toBe(2);mode='ok';await controller.retry();expect(attempts).toBe(3);}finally{controller.close();vi.useRealTimers();}
});
it('discards a late commit after account change without speaking or sending its receipt under the new account',async()=>{
 const {speechPolicy}=await import('./helpers/speech-policy.js');const f=speechPolicy();await f.init();await f.complete();let user='alice',release:(value:any)=>void=()=>{},entered:()=>void=()=>{};const atCommit=new Promise<void>(r=>{entered=r;});const sends:any[]=[];
 const speak=vi.fn(),controller=createSpeechController({request:async(body:any)=>{sends.push({user,...body});if(user==='bob')return {protocolVersion:2,enabled:false};const result=await f.request(body);if(body.action==='commit'){entered();return new Promise(resolve=>{release=()=>resolve(result);});}return result;},context:()=>({user}),browserId:'browser-one',speech:{cancel(){},speak}});
 try{const first=controller.poll();await atCommit;user='bob';controller.resetScope();await controller.poll();release({});await first;expect(speak).not.toHaveBeenCalled();expect(sends.filter(r=>r.user==='bob'&&r.action==='finish')).toEqual([]);}finally{controller.close();}
});
it('never presents old-account status when the account changes before a delayed status response',async()=>{
 let user='alice',release:(value:any)=>void=()=>{},entered:()=>void=()=>{};const started=new Promise<void>(r=>{entered=r;}),onStatus=vi.fn();
 const controller=createSpeechController({request:async({action}:any)=>{if(action==='status'){entered();return new Promise(resolve=>{release=resolve;});}return {items:[]};},context:()=>({user}),browserId:'browser-one',speech:{cancel(){},async speak(){}},onStatus});
 try{const work=controller.poll();await started;user='bob';release({protocolVersion:2,enabled:true,browserId:'browser-one',selected:{'alice-private':{enabled:true}}});await work;expect(onStatus).not.toHaveBeenCalled();}finally{controller.close();}
});
it('bounds hung presentation reads independently and refreshes them after a wake',async()=>{
 const {initCompletionSpeech}=await import('../public/completion-speech.js');vi.useFakeTimers();sessionStorage.setItem('pi-coffee.speech-browser.v1','browser-one');let first=true,signal:AbortSignal|undefined;const changed=vi.fn(),buttons=[0,1,2].map(()=>document.createElement('button'));document.body.append(...buttons);
 const ui=initCompletionSpeech({request:async({action}:any,options:any)=>{if(action==='status')return {protocolVersion:2,enabled:true,browserId:'browser-one',selected:{}};if(action==='summaries'&&first){first=false;signal=options.signal;return new Promise(()=>{});}return {items:[]};},context:()=>({user:'alice',id:'task'}),masterButton:buttons[0],settingsButton:buttons[1],takeoverButton:buttons[2],onPresentation:changed,toast(){},speech:{cancel(){},async speak(){}}});
 try{await ui.refresh();await vi.advanceTimersByTimeAsync(10001);expect(signal?.aborted).toBe(true);window.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(0);expect(changed).toHaveBeenCalled();expect(buttons[0].disabled).toBe(false);}finally{ui.close();document.body.replaceChildren();vi.useRealTimers();}
});
