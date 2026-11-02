// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {mountOptionalSpeech} from '../public/speech-bootstrap.js';
it('recovers a transient component load without reload or duplicate controllers after overlapping wakes',async()=>{
 vi.useFakeTimers();let attempts=0;const close=vi.fn(),ready=vi.fn(),error=vi.fn();
 const component=mountOptionalSpeech({load:async()=>{if(++attempts===1)throw Error('temporary asset failure');return {};},mount:()=>({close}),onReady:ready,onError:error});
 try{await vi.advanceTimersByTimeAsync(0);expect(error).toHaveBeenCalledTimes(1);window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));await vi.advanceTimersByTimeAsync(0);expect(ready).toHaveBeenCalledTimes(1);expect(attempts).toBe(2);expect(vi.getTimerCount()).toBe(0);}finally{component.close();expect(close).toHaveBeenCalledTimes(1);vi.useRealTimers();}
});
it('expires a suspended bootstrap by wall clock and remounts immediately on wake',async()=>{
 vi.useFakeTimers();let attempts=0;const ready=vi.fn(),component=mountOptionalSpeech({load:async()=>++attempts===1?new Promise(()=>{}):{},mount:()=>({close(){}}),onReady:ready});
 try{await vi.advanceTimersByTimeAsync(0);vi.setSystemTime(Date.now()+11000);window.dispatchEvent(new Event('pageshow'));await vi.advanceTimersByTimeAsync(0);expect(ready).toHaveBeenCalledTimes(1);expect(attempts).toBe(2);}finally{component.close();vi.useRealTimers();}
});
