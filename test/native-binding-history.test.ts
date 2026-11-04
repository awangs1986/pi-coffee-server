import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspaces} from '../src/host/workspaces.js';

it('clearing context preserves the native engines and operation provenance of completed handoffs across reload and a later thread rebind',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-binding-history-'));try{
  const store=new Workspaces(join(root,'projects'));await store.createChatConversation('task','codex');await store.setNativeBinding('task',{state:'bound',id:'native-original'});const operation={id:'handoff-operation',purpose:'compaction' as const,version:'0.1.0',from:'codex' as const,to:'codex' as const,status:'preparing' as const,at:'2026-10-25T00:00:00.000Z',sourceNativeId:'native-original'};
  await store.beginTakeover('task',operation);await store.updateTakeover('task',operation.id,{nativeId:'native-handoff'});await store.commitTakeover('task',operation,{state:'bound',id:'native-handoff'});await store.commitContextReset('task',{id:'clear-operation',expectedNativeId:'native-handoff'},'native-reset');
  const restarted=new Workspaces(join(root,'projects')),task=(await restarted.lookup('task'))!;expect(task.takeoverSegments).toBeUndefined();expect(task.takeover).toBeUndefined();expect(task.retainedNativeBindings).toEqual([{engine:'codex',nativeId:'native-original'},{engine:'codex',nativeId:'native-handoff'}]);expect(task.retiredOperationIds).toEqual(['handoff-operation','clear-operation']);expect(task.nativeBinding?.id).toBe('native-reset');
  await restarted.rebindCodexThread('task','native-reset','native-rebound');await restarted.retainForkNative('task','retained-fork');const later=(await new Workspaces(join(root,'projects')).lookup('task'))!;expect(later.retainedNativeBindings).toEqual([{engine:'codex',nativeId:'native-original'},{engine:'codex',nativeId:'native-handoff'},{engine:'codex',nativeId:'native-reset'},{engine:'codex',nativeId:'retained-fork'}]);expect(later.nativeBinding?.id).toBe('native-rebound');
 }finally{await rm(root,{recursive:true,force:true});}
});
