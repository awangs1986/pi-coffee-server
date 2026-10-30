import {it,expect,vi} from 'vitest';
const renamePause=vi.hoisted(()=>({current:undefined as {entered:()=>void;wait:Promise<void>}|undefined}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,rename:async(from:Parameters<typeof fs.rename>[0],to:Parameters<typeof fs.rename>[1])=>{if(String(to).endsWith('/history-observation.json')&&renamePause.current){renamePause.current.entered();await renamePause.current.wait;}return fs.rename(from,to);}};});
import {mkdtemp,mkdir,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {NativeAgentFactory} from '../src/host/native/factory.js';
import {Workspaces} from '../src/host/workspaces.js';
import {readNativeSourceHandoff,verifyNativeSourceHandoff} from '../src/host/native-source-handoff.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'owned-audit-')),store=new Workspaces(join(root,'projects'));const task=await store.createChatConversation('pi-task','pi'),sessionDir=join(root,'sessions'),agentDir=join(root,'agent');await mkdir(sessionDir);await mkdir(agentDir);
 const source=SessionManager.create(task.cwd,sessionDir,{id:task.id});source.appendModelChange('fixture','fixture');source.appendThinkingLevelChange('high');source.appendMessage({role:'user',content:'Original offline history',timestamp:1});
 const lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),pi=new RpcPiSessionFactory({cwd:task.cwd,sessionDir,agentDir,nativeCustody:custody,writerFence:fence,env:{PI_OFFLINE:'1'}}),factory=new NativeAgentFactory({workspaces:store,pi,commandCustody:custody,writerFence:fence});return {root,store,task,sessionDir,agentDir,source,custody,fence,pi,factory};
}
it('owned Pi audit establishes first real current lifecycle from pristine custody without opening a user session',async()=>{
 const f=await fixture();try{
  await expect(readNativeSourceHandoff(f)).rejects.toThrow();const before=await readFile(f.source.getSessionFile()!,'utf8');
  await f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(15000)});
  await expect.poll(async()=>(await f.custody.state()).state,{timeout:5000}).toBe('quiescent');const token=await readNativeSourceHandoff(f),lease=await f.fence.lease();
  try{expect((await verifyNativeSourceHandoff(token,{fence:f.fence,lease,stores:[{scope:'fixture',engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:[f.task.id]}]})).observations).toEqual([{engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:[f.task.id]}]);}finally{lease.release();}
  expect(await readFile(f.source.getSessionFile()!,'utf8')).toBe(before);expect((await f.store.lookup(f.task.id))!.nativeBinding).toEqual(f.task.nativeBinding);
 }finally{await f.factory.close();await rm(f.root,{recursive:true,force:true});}
},25000);

import {realpath} from 'node:fs/promises';
import {codexFixture} from './codex-recovery-fixture.js';
it.skipIf(!process.env.PI_COFFEE_TEST_CODEX_ROOT)('owned Codex thread reader establishes custody without resuming or rebinding a user thread',async()=>{
 const f=await codexFixture(),lock=join(f.root,'group.lock'),custody=new NativeWriterCustody(join(f.root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),cliPath=await realpath(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex'));
 const factory=new NativeAgentFactory({workspaces:f.store,pi:new RpcPiSessionFactory({nativeCustody:custody,writerFence:fence}),commandCustody:custody,writerFence:fence,codex:{command:process.execPath,args:[cliPath]},codexSessionOptions:()=>({cliPath,codexHome:f.home,env:{HOME:f.root},sandbox:'danger-full-access'})});
 try{const before=await readFile(f.rollout,'utf8'),config=await readFile(join(f.home,'config.toml'),'utf8');await factory.auditNativeHistory(f.task.id,{engine:'codex',signal:AbortSignal.timeout(15000)});
  await expect.poll(async()=>(await custody.state()).state,{timeout:5000}).toBe('quiescent');const token=await readNativeSourceHandoff({custody,fence}),lease=await fence.lease();try{expect((await verifyNativeSourceHandoff(token,{fence,lease,stores:[{scope:'alice',engine:'codex',roots:[f.home,f.sql],bindings:[f.id]}]})).observations).toEqual([{engine:'codex',roots:[f.home,f.sql],bindings:[f.id]}]);}finally{lease.release();}
  expect(await readFile(f.rollout,'utf8')).toBe(before);expect(await readFile(join(f.home,'config.toml'),'utf8')).toBe(config);expect((await f.store.lookup(f.task.id))!.nativeBinding!.id).toBe(f.id);
 }finally{await factory.close();await rm(f.root,{recursive:true,force:true});}
},25000);

it('an already active user runtime is preserved and a logical writer also takes priority over audit',async()=>{
 const f=await fixture();let user:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 try{const release=f.fence.beginWriter('platform');try{await expect(f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(5000)})).rejects.toMatchObject({code:'writers_active'});}finally{release();}
  user=await f.pi.create({sessionId:f.task.id,requireExisting:true});await expect(f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(5000)})).rejects.toMatchObject({code:'writers_active'});expect(JSON.stringify(await user.getHistory())).toContain('Original offline history');expect((await f.custody.state()).state).toBe('active');
 }finally{await user?.stop();await f.factory.close();await rm(f.root,{recursive:true,force:true});}
},20000);

it.each(['new-user','caller'] as const)('a %s cancellation closes only the owned audit and leaves later qualification possible',async(kind)=>{
 const f=await fixture(),controller=new AbortController();let user:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 try{const audit=f.factory.auditNativeHistory(f.task.id,{signal:controller.signal});const outcome=audit.then(()=>({ok:true}),error=>({ok:false,error}));await expect.poll(async()=>(await f.custody.state()).state,{timeout:6000,interval:10}).toBe('active');
  if(kind==='new-user')user=await f.pi.create({sessionId:f.task.id,requireExisting:true});else controller.abort();
  expect(await outcome).toMatchObject({ok:false,error:{code:'capture_revoked'}});
  if(user){expect(JSON.stringify(await user.getHistory())).toContain('Original offline history');expect((await f.custody.state()).state).toBe('active');await user.stop();user=undefined;}
  await expect.poll(async()=>(await f.custody.state()).state,{timeout:6000}).toBe('quiescent');await f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(10000)});await expect(readNativeSourceHandoff(f)).resolves.toBeDefined();
 }finally{controller.abort();await user?.stop();await f.factory.close();await rm(f.root,{recursive:true,force:true});}
},25000);

it('malformed/unresolved custody is never mistaken for pristine audit bootstrap',async()=>{
 const f=await fixture();try{await f.custody.prepare({executable:'/bin/true'});const before=await readdir(f.custody.root);await expect(f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(5000)})).rejects.toMatchObject({code:'writers_unknown'});expect(await readdir(f.custody.root)).toEqual(before);}
 finally{await f.factory.close();await rm(f.root,{recursive:true,force:true});}
});

it('a factory-shaped wrapper cannot claim concrete Pi audit provenance',async()=>{
 const f=await fixture(),fake=new NativeAgentFactory({workspaces:f.store,pi:{create:f.pi.create.bind(f.pi),list:f.pi.list.bind(f.pi),delete:f.pi.delete.bind(f.pi)},commandCustody:f.custody,writerFence:f.fence});
 try{await expect(fake.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(5000)})).rejects.toMatchObject({code:'native_audit_unavailable'});await expect(readdir(f.custody.root)).rejects.toMatchObject({code:'ENOENT'});}
 finally{await fake.close();await f.factory.close();await rm(f.root,{recursive:true,force:true});}
});

import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
it('an audit can validate a retained Pi binding when the task current engine is Codex',async()=>{
 const f=await codexFixture({project:true,initialEngine:'pi'}),sessionDir=join(f.root,'pi-sessions'),agentDir=join(f.root,'pi-agent');await mkdir(sessionDir);await mkdir(agentDir);const stored=SessionManager.create(f.task.cwd,sessionDir,{id:f.task.id});stored.appendMessage({role:'user',content:'Retained Pi history',timestamp:1});
 const operation={id:randomUUID(),from:'pi' as const,to:'codex' as const,status:'preparing' as const,at:new Date().toISOString()};await f.store.beginTakeover(f.task.id,operation);await f.store.commitTakeover(f.task.id,operation,{state:'bound',id:f.id});
 const lock=join(f.root,'group.lock'),custody=new NativeWriterCustody(join(f.root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),pi=new RpcPiSessionFactory({cwd:f.task.cwd,sessionDir,agentDir,nativeCustody:custody,writerFence:fence}),factory=new NativeAgentFactory({workspaces:f.store,pi,commandCustody:custody,writerFence:fence});
 try{await factory.auditNativeHistory(f.task.id,{engine:'pi',signal:AbortSignal.timeout(10000)});const token=await readNativeSourceHandoff({custody,fence}),lease=await fence.lease();try{expect((await verifyNativeSourceHandoff(token,{fence,lease,stores:[{scope:'alice',engine:'pi',roots:[sessionDir,agentDir],bindings:[f.task.id]}]})).observations[0].bindings).toEqual([f.task.id]);}finally{lease.release();}expect((await f.store.lookup(f.task.id))!.engine).toBe('codex');expect((await f.store.lookup(f.task.id))!.nativeBinding!.id).toBe(f.id);}
 finally{await factory.close();await rm(f.root,{recursive:true,force:true});}
},20000);

it('a Pi audit refuses a legacy source without letting native SDK migration rewrite it',async()=>{
 const f=await fixture();try{const path=f.source.getSessionFile()!,rows=(await readFile(path,'utf8')).split('\n'),header=JSON.parse(rows[0]);header.version=2;rows[0]=JSON.stringify(header);const legacy=rows.join('\n');await writeFile(path,legacy);
  await expect(f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(10000)})).rejects.toMatchObject({code:'native_audit_unavailable'});expect(await readFile(path,'utf8')).toBe(legacy);expect((await f.custody.state()).state).toBe('quiescent');
 }finally{await f.factory.close();await rm(f.root,{recursive:true,force:true});}
},15000);

it('closing the factory cancels its owned audit without needing caller cancellation',async()=>{
 const f=await fixture();try{const outcome=f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(10000)}).then(()=>({ok:true}),error=>({ok:false,error}));await expect.poll(async()=>(await f.custody.state()).state,{timeout:6000,interval:10}).toBe('active');await f.factory.close();expect(await outcome).toMatchObject({ok:false,error:{code:'capture_revoked'}});expect((await f.custody.state()).state).toBe('quiescent');}
 finally{await f.factory.close();await rm(f.root,{recursive:true,force:true});}
},15000);

it('new writer priority during durable observation publication does not leave a poisoned audit receipt',async()=>{
 const f=await fixture();let entered!:()=>void,unblock!:()=>void;const atPublication=new Promise<void>(ok=>{entered=ok;}),wait=new Promise<void>(ok=>{unblock=ok;});renamePause.current={entered,wait};
 let release:(()=>void)|undefined;
 try{const outcome=f.factory.auditNativeHistory(f.task.id,{signal:AbortSignal.timeout(15000)}).then(()=>({ok:true}),error=>({ok:false,error}));await atPublication;release=f.fence.beginWriter('platform');expect(typeof release).toBe('function');unblock();renamePause.current=undefined;expect(await outcome).toMatchObject({ok:false,error:{code:'capture_revoked'}});release();release=undefined;await expect.poll(async()=>(await f.custody.state()).state,{timeout:5000}).toBe('quiescent');await expect(readNativeSourceHandoff(f)).resolves.toBeDefined();}
 finally{unblock();renamePause.current=undefined;release?.();await f.factory.close();await rm(f.root,{recursive:true,force:true});}
},25000);
