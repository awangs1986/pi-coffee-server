import {createHash} from 'node:crypto';
import {CompletionSpeech,type SpeechTask,type SpeechState} from '../../packages/completion-speech/index.js';
export function speechPolicy(){
 let now=Date.parse('2026-11-02T12:00:00Z'),saved:SpeechState|undefined,failSave=false;
 const tasks=new Map<string,SpeechTask>(),adapter={load:async()=>saved,save:async(s:SpeechState)=>{if(failSave)throw Error('Synthetic storage unavailable');saved=structuredClone(s);},task:async(id:string)=>tasks.get(id),now:()=>now,digest:async(text:string)=>createHash('sha256').update(text).digest('hex')};let policy=new CompletionSpeech(adapter),op=0;
 const call=(input:Record<string,unknown>)=>policy.handle({protocol:2,browserId:'browser-one',pageId:'page-one',...(['reserve','commit','release','finish','replay'].includes(String(input.action))?{operationId:'operation-'+(++op)}:{}),...input}) as Promise<any>;
 // Only delivery operations accept page/browser fields.
 const request=(input:Record<string,unknown>)=>['reserve','commit','release','finish','replay','pending'].includes(String(input.action))?call(input):policy.handle({protocol:2,...input}) as Promise<any>;
 return {tasks,request,get policy(){return policy;},restart(){policy=new CompletionSpeech(adapter);},advance(ms:number){now+=ms;},failSave(value:boolean){failSave=value;},async init(){await request({action:'configure',enabled:true});await request({action:'designate',browserId:'browser-one'});},async complete(id='task',completionId='c1',text='Completed'){
  tasks.set(id,{id,title:'Task '+id,engine:'pi',completionId,completedAt:new Date(now).toISOString(),runStatus:'settled'});await request({action:'select',id,enabled:true});await policy.settled(id,'0.1.0',text,false);
 },async reserve(id='task',completionId='c1'){return request({action:'reserve',id,completionId});},async commit(r:any,id='task',completionId='c1'){return request({action:'commit',id,completionId,token:r.reservation.token,ownerEpoch:r.reservation.ownerEpoch});}};
}
