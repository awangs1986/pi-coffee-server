// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {ConversationRepository,displayEntity} from '../public/conversation-repository.js';
import {ConversationSyncView} from '../public/conversation-sync-view.js';
const views:any[]=[];afterEach(()=>{for(const view of views.splice(0))view.dispose();document.body.replaceChildren();});
it('releases evicted conversation bodies from successful serialization tails',async()=>{
 const store={read:async()=>undefined,commit:async()=>({persisted:false}),invalidate(){},close(){}};
 const repo=new ConversationRepository({store,useWorkers:false,maxMemoryConversations:5});repo.setScope('fixture');
 try{
  for(let n=0;n<20;n++){const id='c'+n;await repo.acceptSnapshot(id,{conversationId:id,bindingEpoch:'epoch',snapshotId:'snapshot',baseRevision:'0',headRevision:'0',entries:[{id:'message',kind:'assistant',text:'x'.repeat(8000),entityRevision:'1'}]});}
  expect([...repo.actors.values()].filter(a=>a.state)).toHaveLength(5);
  for(const actor of repo.actors.values())expect(await actor.queue).toBeUndefined();
 }finally{repo.dispose();}
});
it('restores ordinary uploaded attachments in the durable transcript without caching grants',()=>{
 const root=document.createElement('div');document.body.append(root);
 const view=new ConversationSyncView({container:root,scroller:root,repository:{},context:()=>({conversationId:'task'})});views.push(view);view.select('task');
 const item=displayEntity({id:'user',kind:'user',entityRevision:'1',text:'Read this\n\n[已上传到工作目录的文件]\n- ../attachments/report.pdf (10 KB)'});
 view.show({conversationId:'task',bindingEpoch:'epoch',runState:'settled',entries:[item]});
 expect(root.querySelector('.file-chip')?.getAttribute('data-upload-path')).toBe('../attachments/report.pdf');
 expect(root.querySelector('.text')?.textContent).toBe('Read this');
 expect(root.querySelector('.file-chip')?.hasAttribute('href')).toBe(false);
 expect(item).not.toHaveProperty('files');
});
it.each(['replaceText','deleteEntity','appendText'])('applies %s to buffered older history before it becomes visible',async type=>{
 const root=document.createElement('div');document.body.append(root);
 const page={entries:Array.from({length:40},(_,i)=>({id:'old-'+i,kind:'user',entityRevision:'1',text:'original '+i})),olderCursor:null};
 const view=new ConversationSyncView({container:root,scroller:root,repository:{loadOlder:async()=>page},context:()=>({conversationId:'task'})});views.push(view);view.select('task');
 const state={conversationId:'task',bindingEpoch:'epoch',appliedRevision:'1',olderCursor:'page',entries:[{id:'latest',kind:'user',entityRevision:'1',text:'latest'}]};view.show(state);await view.older();
 view.show({...state,appliedRevision:'2'},{details:{reason:'changes',operations:[{type,entityId:'old-0',entityRevision:'2',payload:type==='appendText'?{baseLength:'original 0'.length,text:' CORRECTED'}:{entry:{id:'old-0',kind:'user',text:'CORRECTED',entityRevision:'2'}}}]}});
 await view.older();await vi.waitFor(()=>expect(root.querySelector('[data-entity-id="old-1"]')).not.toBeNull());
 if(type==='deleteEntity')expect(root.querySelector('[data-entity-id="old-0"]')).toBeNull();
 else expect(root.querySelector('[data-entity-id="old-0"]')?.textContent).toContain('CORRECTED');
});
