import {speechCall,speechClient} from './helpers/speech-client.js';
import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {createCompletionSpeech} from '../src/host/completion-speech.js';

it.each([true,false])('speaks exactly once when foreground marks read before claim: %s',async(readBeforeClaim)=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-foreground-'));
 const workspaces=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});
 const task=await workspaces.createChatConversation('foreground');
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Speech must not start a model');}};
 const speech=createCompletionSpeech(join(workspaces.root,'.coffee','completion-speech'),workspaces);
 const capture=async()=>{
  await workspaces.recordRunStatus(task.id,'running');await speech.prepare(task.id);
  speech.event(task.id,{type:'message_end',message:{role:'assistant',timestamp:Date.now(),content:'Done\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"Task complete."}\n```'}});
  const done=speech.event(task.id,{type:'agent_settled'});await workspaces.recordRunStatus(task.id,'settled');await done?.();
  return (await workspaces.runStatuses()).get(task.id)!.completionId!;
 };
 await speechCall(speech,{action:'configure',enabled:true});await speechCall(speech,{action:'select',id:task.id,enabled:true});await speechCall(speech,{action:'designate',browserId:'foreground-browser'});
 const first=await capture();
 let server=new HostServer({port:0,token:'synthetic-foreground',factory,workspaces});await server.start();
 const call=async(path:string,body:unknown)=>{
  const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer synthetic-foreground','content-type':'application/json'},body:JSON.stringify(body)});
  expect(response.status).toBe(200);return response.json();
 };
 const client=speechClient(body=>call('/api/completion-speech',body));const playback=(action:string,completionId?:string)=>client({action,browserId:'foreground-browser',...(completionId?{id:task.id,completionId}:{})});
 const read=(completionId:string)=>call('/api/workspace',{action:'completion_read',reads:[{id:task.id,completionId}]});
 try{
  if(readBeforeClaim)await read(first);
  expect((await playback('pending')).items).toMatchObject([{id:task.id,completionId:first}]);
  expect(await playback('claim',first)).toMatchObject({claimed:true});
  if(!readBeforeClaim)await read(first);
  expect((await playback('pending')).active).toMatchObject({id:task.id,completionId:first});
  expect((await workspaces.runStatuses()).get(task.id)?.readCompletionId).toBe(first);
  expect(await playback('claim',first)).toMatchObject({claimed:false});
  await playback('finish',first);expect((await playback('pending')).items).toEqual([]);
  await server.close();
  server=new HostServer({port:0,token:'synthetic-foreground',factory,workspaces});await server.start();
  expect((await playback('pending')).items).toEqual([]);
 }finally{await server.close();await rm(root,{recursive:true,force:true});}
});
