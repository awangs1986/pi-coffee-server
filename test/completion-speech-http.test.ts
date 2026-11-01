import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('persists explicit speech opt-in and browser ownership independently under each authenticated account',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-http-'));let server:HostServer|undefined;
 const stores=new Map<string,Workspaces>(),factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Settings must not start an Agent');}};
 const start=async()=>{server=new HostServer({port:0,token:'synthetic-speech',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();};
 const call=async(user:string,body:unknown)=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/completion-speech`,{method:'POST',headers:{authorization:'Bearer synthetic-speech','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  for(const user of ['alice','bob']){const store=new Workspaces(join(root,user,'projects'),{chatRoot:join(root,user,'chats')});stores.set(user,store);await store.createChatConversation('same-id');}
  await start();
  expect(await call('alice',{action:'status'})).toMatchObject({status:200,data:{enabled:false,selected:{},browserId:null,pluginVersion:'0.1.0'}});
  expect((await call('alice',{action:'configure',enabled:true})).status).toBe(200);
  expect((await call('alice',{action:'voice',voiceURI:'Chinese voice'})).data.voiceURI).toBe('Chinese voice');
  expect((await call('alice',{action:'voice',voiceURI:'x'.repeat(257)})).status).toBe(409);
  expect((await call('alice',{action:'select',id:'same-id',enabled:true})).data.selected['same-id']).toMatchObject({profileVersion:'0.1.0'});
  expect((await call('alice',{action:'designate',browserId:'browser-alice'})).data.browserId).toBe('browser-alice');
  expect((await call('bob',{action:'status'})).data).toMatchObject({enabled:false,selected:{},browserId:null,voiceURI:''});
  expect((await call('bob',{action:'summaries',id:'same-id'})).data).toEqual({items:[]});
  expect((await call('bob',{action:'summaries',id:'not-in-scope'})).status).toBe(409);
  expect((await call('alice',{action:'select',id:'unknown',enabled:true})).status).toBe(409);
  expect((await call('alice',{action:'configure',enabled:true,user:'bob'})).status).toBe(409);
  await server!.close();await start();
  expect((await call('alice',{action:'status'})).data).toMatchObject({enabled:true,browserId:'browser-alice',voiceURI:'Chinese voice',selected:{'same-id':{profileVersion:'0.1.0'}}});
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

it.each(['pi','codex'])('injects one stable opted-in %s instruction slot per original submission and admits only its current assistant result',async engine=>{
 const {HostSession}=await import('../src/host/session.js');const {createCompletionSpeech}=await import('../src/host/completion-speech.js');
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-turn-')),store=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});
 await store.createChatConversation('task',engine as 'pi'|'codex');
 const speech=createCompletionSpeech(join(root,'speech'),store,async()=>[{id:'task',name:'Current title'}]);
 const inputs:Array<{text:string;instructions:string|undefined}>=[];let instructions:string|undefined;let listener:(event:unknown)=>void=()=>{};
 const native={setTurnInstructions:async(value:string|undefined)=>{instructions=value;},prompt:async(text:string)=>{inputs.push({text,instructions});},getState:async()=>({isStreaming:false,messageCount:0}),onEvent:(f:typeof listener)=>{listener=f;return()=>{};},stop:async()=>{}};
 const factory={create:async()=>native,list:async()=>[],delete:async()=>false};
 const session=new HostSession({id:'task',factory:factory as any,turnInstructions:async id=>speech.prepare(id),onEvent:(_id,event)=>{const done=speech.event('task',event);if(done)void store.recordRunStatus('task','settled').then(done);}});
 const brief='Complete answer with code and downloads.\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"The change is complete; tests remain unverified."}\n```';
 try{
  await session.start();await session.preparePrompt('one');await session.prompt('one','hello');listener({type:'agent_settled'});expect(inputs[0].instructions).toBeUndefined();
  await speech.handle({action:'configure',enabled:true});await speech.handle({action:'select',id:'task',enabled:true});await speech.handle({action:'designate',browserId:'browser-one'});
  for(const id of ['two','three']){await store.markRun('task','running');await session.preparePrompt(id);await session.prompt(id,'request '+id);listener({type:'agent_start'});listener({type:'message_end',text:'spoofed user',message:{role:'user',content:brief}});listener({type:'message_end',text:brief,message:{role:'assistant'}});listener({type:'agent_settled'});await new Promise(r=>setTimeout(r,20));}
  expect(inputs[1].instructions).toContain('Completion brief');expect(inputs[2].instructions).toBe(inputs[1].instructions);expect(inputs.map(v=>v.text)).toEqual(['hello','request two','request three']);
  const pending=await speech.handle({action:'pending',browserId:'browser-one'}) as any;expect(pending.items).toHaveLength(1);expect(pending.items[0]).toMatchObject({title:'Current title',summary:'The change is complete; tests remain unverified.'});
  expect(await speech.handle({action:'claim',browserId:'browser-other',id:'task',completionId:pending.items[0].completionId})).toEqual({claimed:false});
  expect(await speech.handle({action:'claim',browserId:'browser-one',id:'task',completionId:pending.items[0].completionId})).toMatchObject({claimed:true});
  expect(await speech.handle({action:'claim',browserId:'browser-one',id:'task',completionId:pending.items[0].completionId})).toEqual({claimed:false});
  expect((await store.runStatuses()).get('task')?.readCompletionId).toBeUndefined();
  await speech.handle({action:'configure',enabled:false});await session.preparePrompt('four');await session.prompt('four','disabled');expect(inputs[3].instructions).toBeUndefined();
 }finally{await session.stop();await rm(root,{recursive:true,force:true});}
});

it('claims account-owned recent completions once over HTTP across browser races and Host restart, without creating Agents',async()=>{
 const {createCompletionSpeech}=await import('../src/host/completion-speech.js');
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-claims-'));let server:HostServer|undefined;
 const stores=new Map<string,Workspaces>();let creates=0;
 const factory={list:async()=>[{id:'same-id',name:'Renamed title'}],delete:async()=>false,create:async()=>{creates++;throw Error('Must not wake Agents');}};
 const start=async()=>{server=new HostServer({port:0,token:'synthetic-claims',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();};
 const call=async(user:string,body:unknown)=>{const r=await fetch(`http://127.0.0.1:${server!.address().port}/api/completion-speech`,{method:'POST',headers:{authorization:'Bearer synthetic-claims','x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(200);return r.json() as Promise<any>;};
 try{
  for(const user of ['alice','bob']){
   const store=new Workspaces(join(root,user,'projects'),{chatRoot:join(root,user,'chats')});stores.set(user,store);await store.createChatConversation('same-id');
   const speech=createCompletionSpeech(join(store.root,'.coffee','completion-speech'),store,async()=>[{id:'same-id',name:'Renamed title'}]);
   await speech.handle({action:'configure',enabled:true});await speech.handle({action:'select',id:'same-id',enabled:true});await speech.handle({action:'designate',browserId:'browser-one'});await speech.prepare('same-id');
   speech.event('same-id',{type:'message_end',message:{role:'assistant',content:'Result\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"Verified completion."}\n```'}});
   const settle=speech.event('same-id',{type:'agent_settled'});await store.recordRunStatus('same-id','settled');await settle?.();
  }
  await start();
  const a=(await call('alice',{action:'pending',browserId:'browser-one'})).items[0],b=(await call('bob',{action:'pending',browserId:'browser-one'})).items[0];expect(a.title).toBe('Renamed title');expect(a.completionId).not.toBe(b.completionId);
  expect(await call('alice',{action:'claim',browserId:'browser-one',id:'same-id',completionId:b.completionId})).toEqual({claimed:false});
  const claims=await Promise.all([call('alice',{action:'claim',browserId:'browser-one',id:a.id,completionId:a.completionId}),call('alice',{action:'claim',browserId:'browser-one',id:a.id,completionId:a.completionId})]);expect(claims.filter(v=>v.claimed)).toHaveLength(1);
  await server!.close();await start();expect((await call('alice',{action:'pending',browserId:'browser-one'})).items).toEqual([]);expect((await call('bob',{action:'pending',browserId:'browser-one'})).items).toHaveLength(1);expect(creates).toBe(0);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
