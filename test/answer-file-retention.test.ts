import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {AnswerDeliveries} from '../src/host/answer-deliveries.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('retains every recorded answer after importing the old journal and restarting the Host',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-answer-retention-'));
 const store=new Workspaces(join(root,'workspaces'),{taskRoot:join(root,'tasks')});
 const task=await store.createChatConversation('history');
 const dir=join(task.taskRoot!,'artifacts'),journal=join(task.taskRoot!,'history','answer-deliveries.json');
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model');}};
 let host:HostServer|undefined;
 async function readKeys(...keys:string[]){
   if(!host){host=new HostServer({port:0,token:'fixture',factory,workspaces:store});await host.start();}
   const query=new URLSearchParams(keys.map(key=>['key',key]));
   const response=await fetch('http://127.0.0.1:'+host.address().port+'/api/conversations/history/deliveries?'+query,{headers:{authorization:'Bearer fixture'}});
   expect(response.status).toBe(200);return (await response.json()).deliveries;
 }
 try{
   await writeFile(join(dir,'old.zip'),'old bytes');
   const info=await stat(join(dir,'old.zip'));
   const fingerprint=[info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':');
   const old=Array.from({length:40},(_,i)=>({binding:JSON.stringify(['pi',task.id,null]),key:'pi-message:'+(i+1),files:[{path:'../artifacts/old.zip',fingerprint}]}));
   await writeFile(journal,JSON.stringify(old));
   expect(await readKeys('pi-message:1')).toMatchObject([{key:'pi-message:1',files:[{available:true}]}]);
   const tracker=new AnswerDeliveries(store,()=>{});
   await tracker.begin(task.id,'new');tracker.observe(task.id,{type:'agent_start'});
   await writeFile(join(dir,'new.zip'),'new bytes');
   tracker.observe(task.id,{type:'message_end',message:{role:'assistant',timestamp:41,content:[{type:'text',text:'ready'}]}});
   expect(await tracker.observe(task.id,{type:'agent_settled'})).toBe(true);
   await host!.close();host=undefined;
   expect(await readKeys('pi-message:1','pi-message:41')).toMatchObject([
     {key:'pi-message:1',files:[{path:'../artifacts/old.zip',available:true}]},
     {key:'pi-message:41',files:[{path:'../artifacts/new.zip',available:true}]},
   ]);
   expect(await readKeys('pi-message:42')).toEqual([]);
 }finally{await host?.close();await rm(root,{recursive:true,force:true});}
});
