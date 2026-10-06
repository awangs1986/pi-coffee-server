import {expect,it} from 'vitest';
import {prepareAssignment} from '../src/host/mishu-dispatch.js';
import type {TaskBrief} from '../src/host/mishu-tasks.js';
const task:TaskBrief={taskId:'task',sourceBinding:'source',targetId:'target',binding:'target-native',revision:1,purpose:'Check',scope:'Read-only build',summary:'Pending',nextStep:'Run check',workState:'recorded',observation:'not-started',acceptance:'pending',createdAt:'2026-10-06',updatedAt:'2026-10-06'};
const input={action:'tasks',version:1,operation:'dispatch',taskId:'task',expectedRevision:1,messageId:'model-message-1',text:'Perform the check',authorizationRef:'User requested this check'};
it('keys retry on trusted user run, task and accepted phase while rejecting conflict',()=>{
 const first=prepareAssignment(task,input,'native-user-run',[]).assignment;
 expect(prepareAssignment({...task,revision:8},{...input,messageId:'new-model-id'},'native-user-run',[first])).toMatchObject({created:false,assignment:{id:first.id}});
 expect(()=>prepareAssignment(task,{...input,text:'different work'},'native-user-run',[first])).toThrow('different dispatch content');
 expect(()=>prepareAssignment({...task,revision:2},input,'different-native-user-run',[first])).toThrow('phase changed');
 expect(prepareAssignment({...task,taskId:'another-task'},{...input,taskId:'another-task'},'native-user-run',[first]).assignment.id).not.toBe(first.id);
});
it('explicit new input can repeat identical content after original inspection, retaining retryOf',()=>{
 const first=prepareAssignment(task,input,'original-user-run',[]).assignment;
 const next={...input,expectedRevision:3,retryOf:first.id};
 expect(()=>prepareAssignment({...task,revision:3},next,'next-user-run',[{...first,state:'uncertain'}])).toThrow('unproven');
 const retried=prepareAssignment({...task,revision:3},next,'next-user-run',[{...first,state:'settled'}]);
 expect(retried).toMatchObject({created:true,assignment:{retryOf:first.id,text:first.text}});expect(retried.assignment.id).not.toBe(first.id);
 expect(()=>prepareAssignment({...task,revision:3},{...next,retryOf:undefined},'next-user-run',[{...first,state:'settled'}])).toThrow('retryOf');
});
