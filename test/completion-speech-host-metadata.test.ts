import {speechCall,speechClient} from './helpers/speech-client.js';
import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspaces} from '../src/host/workspaces.js';
import {createCompletionSpeech} from '../src/host/completion-speech.js';
it('does not enumerate native sessions for profile preparation and reads one fresh title snapshot per delivery operation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-speech-metadata-')),store=new Workspaces(join(root,'projects'),{chatRoot:join(root,'chats')});
 let listings=0,title='Initial';const speech=createCompletionSpeech(join(root,'speech'),store,async()=>{listings++;return ['a','b','c'].map(id=>({id,name:title+id}));});
 try{
  for(const id of ['a','b','c'])await store.createChatConversation(id);
  await speechCall(speech,{action:'configure',enabled:true});await speechCall(speech,{action:'designate',browserId:'browser-one'});
  for(const id of ['a','b','c']){await speechCall(speech,{action:'select',id,enabled:true});await store.markRun(id,'running');await speech.prepare(id);speech.event(id,{type:'message_end',message:{role:'assistant',content:'Done\n\n```coffee-speech\n{"profile_version":"0.1.0","summary":"Done."}\n```'}});const done=speech.event(id,{type:'agent_settled'});await store.recordRunStatus(id,'settled');await done?.();}
  expect(listings).toBe(0);
  const pending:any=await speechCall(speech,{action:'pending',browserId:'browser-one'});expect(pending.items).toHaveLength(3);expect(listings).toBe(1);
  title='Renamed';const claim:any=await speechCall(speech,{action:'claim',browserId:'browser-one',id:pending.items[0].id,completionId:pending.items[0].completionId});
  expect(claim.claimed).toBe(true);expect(claim.item.title).toBe('Renamed'+pending.items[0].id);expect(listings).toBe(3);
 }finally{await rm(root,{recursive:true,force:true});}
});
