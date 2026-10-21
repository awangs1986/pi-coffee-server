// @vitest-environment jsdom
import {expect,it,vi} from 'vitest';
import {initMishuEvidence} from '../public/mishu-evidence.js';
import {initMishuUsage} from '../public/mishu-usage.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
it('shows evidence roles, exact references, truncation and missing source as text without executing content',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const request=vi.fn(async()=>({available:true,freshness:'current',truncated:true,entries:[{conversationId:'source',messageId:'original',at:'2026-10-21T12:00:00Z',kind:'user-original',text:'<script>window.leak=true</script>',truncated:true,range:{start:0,end:20}},{conversationId:'source',messageId:'summary',kind:'model-output',text:'摘要',truncated:false,range:{start:0,end:2}}]}));
 const panel=initMishuEvidence({context:()=>({id:'source',engine:'pi'}),request,toast:vi.fn()});await panel.open();await tick();expect(document.body.textContent).toContain('用户原话');expect(document.body.textContent).toContain('模型输出');expect(document.body.textContent).toContain('source / original');expect(document.body.textContent).toContain('范围有截断');expect(document.querySelector('script')).toBeNull();
 const target=document.querySelector('input[aria-label="证据来源对话 ID"]') as HTMLInputElement,targetQuery=document.querySelector('input[aria-label="证据关键词"]') as HTMLInputElement;target.value='contact';targetQuery.value='蓝色';Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='查找证据')!.click();await tick();expect(request).toHaveBeenLastCalledWith({action:'evidence',id:'source',version:1,mode:'search',targetId:'contact',query:'蓝色',limit:20});panel.close();expect(document.querySelector('dialog')).toBeNull();
});
it('keeps unknown usage and known zero Watch separate, and sends category/model/time filters',async()=>{
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const request=vi.fn(async()=>({available:true,coverage:'partial',startedAt:'2026-10-21',hostWatch:{modelCalls:0,known:true},totals:{input:null,output:7,cacheRead:null},records:[{at:'2026-10-21',purpose:'memory',model:'pi/native',source:'native-log',input:undefined,output:7}],budget:{remaining:10},limits:{hourlyCalls:12},next:null}));
 const panel=initMishuUsage({context:()=>({id:'source',engine:'pi'}),request,toast:vi.fn()});await panel.open();expect(document.body.textContent).toContain('Host Watch：确定 0');expect(document.body.textContent).toContain('input 未知');expect(document.body.textContent).toContain('10 / 12');const purpose=document.querySelector('select') as HTMLSelectElement;purpose.value='memory';const model=document.querySelector('input[aria-label="用量模型"]') as HTMLInputElement;model.value='pi/native';Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='查询用量')!.click();await tick();expect(request).toHaveBeenLastCalledWith({action:'usage',id:'source',version:1,purpose:'memory',model:'pi/native',offset:0,limit:20});panel.close();
});
