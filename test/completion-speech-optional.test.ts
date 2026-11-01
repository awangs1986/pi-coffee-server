import {it,expect,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
vi.mock('../packages/completion-speech/index.js',()=>{throw Error('Synthetic absent optional package');});
import {HostServer} from '../src/host/server.js';
import {HostSession} from '../src/host/session.js';
import {Workspaces} from '../src/host/workspaces.js';
import {createCompletionSpeech} from '../src/host/completion-speech.js';
it('keeps Host and native task execution usable when the optional speech package fails to load',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-optional-')),store=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});
 const prompts:string[]=[];const factory:any={list:async()=>[],delete:async()=>false,create:async()=>({setTurnInstructions:async()=>{},prompt:async(text:string)=>{prompts.push(text);},getState:async()=>({isStreaming:false,messageCount:0}),onEvent:()=>()=>{},stop:async()=>{}})};
 const server=new HostServer({port:0,host:'127.0.0.1',token:'synthetic',factory,workspaces:store});
 let session:HostSession|undefined;
 try{
  await store.createChatConversation('chat');await server.start();
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/workspace`,{headers:{authorization:'Bearer synthetic'}});expect(r.status).toBe(200);
  const speech=createCompletionSpeech(join(root,'speech'),store);session=new HostSession({id:'chat',factory,turnInstructions:id=>speech.prepare(id)});
  await session.start();await session.preparePrompt('run');await session.prompt('run','ordinary message');
  expect(prompts).toEqual(['ordinary message']);
 }finally{await session?.stop();await server.close();await rm(root,{recursive:true,force:true});}
});
