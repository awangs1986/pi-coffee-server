import {it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
// @ts-expect-error public browser module
import {initMishuMemory} from '../public/mishu-memory.js';
it('opens a model-independent memory form; cancellation does not write and enabling persists only explicit intent',async()=>{
 const dom=new JSDOM('<button id="memory"></button>',{url:'http://coffee/'});Object.assign(globalThis,{document:dom.window.document});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const calls:Record<string,unknown>[]=[];let enabled=false;const ui=initMishuMemory({context:()=>({id:'source',engine:'pi',user:'user',epoch:1}),button:document.querySelector('#memory'),toast:(s:string)=>{throw Error(s);},request:async(input:Record<string,unknown>)=>{calls.push(input);if(input.operation==='configure')enabled=input.enabled===true;if(input.operation==='status')return {enabled,limits:{entries:500,text:2000,history:20},oldBindings:[]};return {entries:[],total:0,nextOffset:null};}});
 await ui.open();expect(document.querySelector('dialog')?.open).toBe(true);expect(calls.some(c=>c.operation==='configure')).toBe(false);
 const find=(text:string)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;find('开启记忆').click();await new Promise(r=>setTimeout(r,20));expect(enabled).toBe(true);find('新增记忆').click();expect(document.querySelector('textarea')).toBeTruthy();find('取消').click();expect(calls.some(c=>c.operation==='save')).toBe(false);ui.close();dom.window.close();
});
