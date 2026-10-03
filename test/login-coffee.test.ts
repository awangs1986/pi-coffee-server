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
 const image=document.querySelector<HTMLImageElement>('.login-coffee-picture img')!;expect(image.getAttribute('src')).toBe('/login-coffee-art.webp');
 expect(document.querySelector('canvas,video,iframe')).toBeNull();expect(statSync('public/login-coffee-art.webp').size).toBeLessThan(500*1024);
 const bytes=readFileSync('public/login-coffee-art.webp');expect(bytes.subarray(8,12).toString()).toBe('WEBP');
 let offset=12,hasAlpha=false;while(offset+8<=bytes.length){const size=bytes.readUInt32LE(offset+4);if(bytes.subarray(offset,offset+4).toString()==='ALPH')hasAlpha=true;offset+=8+size+(size%2);}
 expect(hasAlpha,'the character asset must retain its transparent cutout').toBe(true);
 image.dispatchEvent(new Event('error'));expect(document.querySelector('.login-coffee')).toBeNull();coffee.dispose();
});

it('consumes welcome dismissal keys before underlying composer or approval handlers',()=>{
 const underlying=vi.fn();document.addEventListener('keydown',underlying);
 const coffee=createLoginCoffee({document,matchMedia:()=>({matches:false})});
 for(const key of ['Escape','Enter']){coffee.reset();coffee.play('alice');document.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));expect(document.querySelector('.login-coffee')).toBeNull();}
 expect(underlying).not.toHaveBeenCalled();document.removeEventListener('keydown',underlying);coffee.dispose();
});
