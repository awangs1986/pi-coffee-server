// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {prepareTask} from '../public/task-preparation.js';
it('queries the original operation after a lost acceptance response without submitting another preparation',async()=>{
 const requests:any[]=[];
 const result=await prepareTask({operationId:'one',targetTaskId:'one',kind:'create-chat',engine:'codex'},{request:async input=>{
  requests.push(input);if(input.action==='preparation_start')throw Error('network disconnected');
  return {operationId:'one',targetTaskId:'one',status:'completed',task:{id:'one',creationState:'ready'}};
 }});
 expect(result).toEqual({id:'one',creationState:'ready'});
 expect(requests).toEqual([{action:'preparation_start',operationId:'one',targetTaskId:'one',kind:'create-chat',engine:'codex'},{action:'preparation_get',operationId:'one'}]);
});
it('offers explicit recovery without resuming a failed creation just because its dialog opened',async()=>{
 const {initPreparationRecovery}=await import('../public/task-preparation.js');
 document.body.innerHTML='<dialog id="preparation-dialog"><p id="preparation-status"></p><button id="preparation-close"></button><button id="preparation-stop"></button><button id="preparation-resume"></button></dialog>';
 HTMLDialogElement.prototype.showModal=function(){};HTMLDialogElement.prototype.close=function(){};
 const calls:any[]=[],completed:string[]=[];
 const recovery=initPreparationRecovery({request:async input=>{calls.push(input);return {operationId:'owned',targetTaskId:'task',status:'completed',task:{id:'task'}};},complete:task=>completed.push(task.id),toast:()=>{},scope:()=> 'alice'});
 recovery.open({operationId:'owned',targetTaskId:'task',revision:7,status:'failed',phase:'workspace',allowedActions:['resume']});
 expect(calls).toEqual([]);
 document.getElementById('preparation-resume')!.click();await new Promise(resolve=>setTimeout(resolve,0));
 expect(calls).toEqual([{action:'preparation_resume',operationId:'owned',expectedRevision:7},{action:'preparation_get',operationId:'owned'}]);expect(completed).toEqual(['task']);
});
