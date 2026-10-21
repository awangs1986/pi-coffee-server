import {it,expect} from 'vitest';import {JSDOM} from 'jsdom';
// @ts-expect-error Browser JS modules
import {initMishuMemory} from '../public/mishu-memory.js';
// @ts-expect-error Browser JS modules
import {initMishuEvidence} from '../public/mishu-evidence.js';
// @ts-expect-error Browser JS modules
import {initMishuUsage} from '../public/mishu-usage.js';
it.each([['memory',initMishuMemory],['evidence',initMishuEvidence],['usage',initMishuUsage]])('closes %s and aborts pending reads when the application switches account/context',async(_name,init)=>{
 const dom=new JSDOM('<body></body>',{url:'http://coffee/'});Object.assign(globalThis,{document:dom.window.document});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};let release:(data:unknown)=>void=()=>{},signal:AbortSignal|undefined,source={id:'same-id',engine:'pi',user:'alice',epoch:1};let notifyReceived=()=>{};const received=new Promise<void>(r=>notifyReceived=r);const request=(_body:unknown,nextSignal:AbortSignal)=>{signal=nextSignal;notifyReceived();return new Promise(r=>release=r);};const ui=init({context:()=>source,request,toast:()=>{}});const opened=ui.open();await received;source={id:'same-id',engine:'pi',user:'bob',epoch:2};ui.close();expect(signal?.aborted).toBe(true);release({available:true,enabled:true,text:'ALICE_PRIVATE',entries:[{text:'ALICE_PRIVATE'}],records:[{model:'ALICE_PRIVATE'}],limits:{entries:500,text:2000,history:20}});await opened;await new Promise(r=>setTimeout(r,10));expect(document.body.textContent).not.toContain('ALICE_PRIVATE');expect(document.querySelector('dialog')).toBeNull();dom.window.close();
});
