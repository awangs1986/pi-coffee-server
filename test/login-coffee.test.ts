// @vitest-environment jsdom
import {readFileSync,statSync} from 'node:fs';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error browser module
import {createLoginCoffee} from '../public/login-coffee.js';
afterEach(()=>{vi.useRealTimers();document.body.replaceChildren();});
it('only welcomes a successful identified login once, never a reconnect, and removes the overlay',()=>{
 vi.useFakeTimers();const coffee=createLoginCoffee({document,matchMedia:()=>({matches:false})});
 coffee.play(null);expect(document.querySelector('.login-coffee')).toBeNull();
 coffee.play('alice');expect(document.querySelector('.login-coffee')).not.toBeNull();
 coffee.play('alice');expect(document.querySelectorAll('.login-coffee')).toHaveLength(1);
 vi.advanceTimersByTime(2400);expect(document.querySelector('.login-coffee')).toBeNull();
 coffee.play('alice');expect(document.querySelector('.login-coffee')).toBeNull();
 coffee.reset();coffee.play('alice');expect(document.querySelector('.login-coffee')).not.toBeNull();coffee.dispose();
 expect(vi.getTimerCount()).toBe(0);
});
it('supports immediate button or Escape dismissal without stealing focus',()=>{
 const prompt=document.createElement('textarea');document.body.append(prompt);prompt.focus();
 const coffee=createLoginCoffee({document,matchMedia:()=>({matches:false})});coffee.play('alice');
 expect(document.activeElement).toBe(prompt);
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect(document.querySelector('.login-coffee')).toBeNull();
 coffee.reset();coffee.play('alice');(document.querySelector('.login-coffee-skip') as HTMLButtonElement).click();expect(document.querySelector('.login-coffee')).toBeNull();coffee.dispose();
});
it('uses a short static illustration with reduced motion and clears it on logout',()=>{
 vi.useFakeTimers();const coffee=createLoginCoffee({document,matchMedia:()=>({matches:true})});coffee.play('alice');
 expect(document.querySelector('.login-coffee')?.classList.contains('reduced-motion')).toBe(true);
 vi.advanceTimersByTime(800);expect(document.querySelector('.login-coffee')).toBeNull();
 coffee.reset();coffee.play('bob');coffee.reset();expect(document.querySelector('.login-coffee')).toBeNull();expect(vi.getTimerCount()).toBe(0);
});

it('consumes a welcome-screen click instead of activating an unseen app button',()=>{
 const underlying=document.createElement('button');const action=vi.fn();underlying.onclick=action;document.body.append(underlying);
 const coffee=createLoginCoffee({document,matchMedia:()=>({matches:false})});coffee.play('alice');
 (document.querySelector('.login-coffee-scene') as HTMLElement).click();
 expect(document.querySelector('.login-coffee')).toBeNull();expect(action).not.toHaveBeenCalled();coffee.dispose();
});

it('loads one bounded local retro artwork and dismisses a failed image without a stalled screen',()=>{
 const coffee=createLoginCoffee({document,matchMedia:()=>({matches:false})});coffee.play('alice');
 const image=document.querySelector<HTMLImageElement>('.login-coffee-picture img')!;expect(image.getAttribute('src')).toBe('/login-coffee-maid-chibi.webp');
 expect(document.querySelector('canvas,video,iframe')).toBeNull();expect(statSync('public/login-coffee-maid-chibi.webp').size).toBeLessThan(100*1024);
 image.dispatchEvent(new Event('error'));expect(document.querySelector('.login-coffee')).toBeNull();coffee.dispose();
});

it('allows Enter to reach the composer and only consumes explicit Escape dismissal',()=>{
 const underlying=vi.fn();document.addEventListener('keydown',underlying);
 const coffee=createLoginCoffee({document,matchMedia:()=>({matches:false})});
 coffee.play('alice');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));expect(underlying).toHaveBeenCalledTimes(1);expect(document.querySelector('.login-coffee')).not.toBeNull();
 document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));expect(document.querySelector('.login-coffee')).toBeNull();expect(underlying).toHaveBeenCalledTimes(1);document.removeEventListener('keydown',underlying);coffee.dispose();
});
