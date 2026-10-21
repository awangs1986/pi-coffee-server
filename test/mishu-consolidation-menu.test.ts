import {it,expect} from 'vitest';import {JSDOM} from 'jsdom';
import {initMishuConsolidation} from '../public/mishu-consolidation.js';
it('does not generate on opening and adopts only explicitly checked source-backed candidates',async()=>{
 const dom=new JSDOM('<main></main>');Object.assign(globalThis,{document:dom.window.document});const calls:any[]=[];let state='ready';
 const view=initMishuConsolidation({parent:document.querySelector('main'),source:{id:'source'},context:()=>({id:'source'}),toast:()=>{},request:async(input:any)=>{calls.push(input);if(input.operation==='adopt')state='adopted';return {available:true,limits:{messages:20,inputChars:12000,changes:10,hourlyCalls:12},jobs:[{id:'job',state,createdAt:'2026-10-21',changes:[{op:'add',text:'<script>plain text</script>',source:{conversationId:'source',messageId:'user-1',quote:'简短回答',start:0,end:4}},{op:'add',text:'second',source:{conversationId:'source',messageId:'user-2',quote:'中文',start:0,end:2}}]}]};}});
 await view.refresh();expect(calls.map(x=>x.operation)).toEqual(['status']);expect(document.querySelector('script')).toBeNull();
 const checks=document.querySelectorAll<HTMLInputElement>('input[type=checkbox]');expect(checks).toHaveLength(2);checks[0].checked=true;
 [...document.querySelectorAll('button')].find(e=>e.textContent==='采纳所选建议')!.click();await new Promise(r=>setTimeout(r,0));expect(calls.find(x=>x.operation==='adopt')).toMatchObject({jobId:'job',indices:[0]});view.close();dom.window.close();
});
