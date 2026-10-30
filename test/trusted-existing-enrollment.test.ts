import {existingPi,normalPiHandoff} from './trusted-native-enrollment-fixture.js';
import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,stat,readdir,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {Workspaces} from '../src/host/workspaces.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {TrustedSourceAuthority} from '../src/host/trusted-source-authority.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {codexFixture} from './codex-recovery-fixture.js';
import {readNativeSourceHandoff} from '../src/host/native-source-handoff.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';


test('a no-op custodian cannot enroll existing native data or manufacture a cold producer handoff',async()=>{
 const f=await existingPi();try{
  const end=f.fence.beginWriter('native');try{const launch=await f.custody.prepare({executable:'/bin/true'}),child=spawn(process.execPath,[launch.cliPath],{env:{...process.env,...launch.env},stdio:'ignore'});expect((await once(child,'exit'))[0]).toBe(0);}finally{end();}
  await expect(Reflect.apply(f.authority.enrollExisting,f.authority,['awangs',{producer:'host',handoff:{},scopes:f.scopes,checkpointRoot:f.checkpointRoot}])).rejects.toMatchObject({code:'writers_unknown'});
  expect((await f.authority.qualification()).state).toBe('unknown');expect(await readFile(join(f.task.cwd,'note'),'utf8')).toBe('first');expect(SessionManager.open(f.stored.getSessionFile()!).getSessionId()).toBe(f.task.id);
 }finally{await f.cleanup();}
},20000);


test('existing Pi is enrolled from its normal native lifecycle, produces later cuts, and requalifies after a passive Host restart',async()=>{
 const f=await existingPi();let session:Awaited<ReturnType<typeof f.factory.create>>|undefined,reopened:TrustedSourceAuthority|undefined;
 try{
  await chmod(f.source,0o755);session=await f.factory.create({sessionId:f.task.id,requireExisting:true});expect(JSON.stringify(await session.getHistory())).toContain('Existing native context');
  await session.stop();session=undefined;await expect.poll(async()=>(await f.custody.state()).state,{timeout:10000}).toBe('quiescent');
  const receiptCount=(await readdir(f.custody.root)).length,handoff=await readNativeSourceHandoff({custody:f.custody,fence:f.physical});
  const enrolled=await f.authority.enrollExisting('awangs',{producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot});
  expect(enrolled.checkpoint.manifest.members).toMatchObject([{scope:'awangs',taskId:f.task.id,engine:'pi'}]);expect((await f.authority.qualification()).state).toBe('qualified');
  const coordinator=f.authority.createNativeCoordinator({producer:'host',scopes:f.scopes,checkpointRoot:f.checkpointRoot});
  await f.authority.runWriter('host','normal-edit',()=>writeFile(join(f.task.cwd,'note'),'second'));
  expect((await coordinator.capture('awangs',f.task.id,'pi')).state).toBe('protected');const later=(await coordinator.sealedCheckpoint('awangs',f.task.id))!;expect(later.manifest.checkpointId).not.toBe(enrolled.checkpoint.manifest.checkpointId);
  await f.authority.close();const custody=new NativeWriterCustody(f.custody.root,{lock:f.lock}),physical=new PhysicalWriterFence({lock:f.lock,custody});reopened=await f.open(physical);const workspaces=new Workspaces(f.workspaces.root,{gitCommandCustody:custody});workspaces.setBackupWriterFence(reopened.writerFence('host'));await workspaces.list();expect((await reopened.qualification()).state).toBe('unknown');
  const restarted=await reopened.requalify('awangs',{producer:'host',handoff:await readNativeSourceHandoff({custody,fence:physical}),scopes:[{...f.scopes[0],workspaces}],checkpointRoot:f.checkpointRoot});
  expect(restarted.evidence.enrollmentId).not.toBe(enrolled.evidence.enrollmentId);expect((await reopened.qualification()).state).toBe('qualified');expect(await readFile(join(f.task.cwd,'note'),'utf8')).toBe('second');expect((await readdir(custody.root)).length).toBe(receiptCount);expect((await stat(f.source)).mode&0o777).toBe(0o755);
 }finally{await session?.stop();await reopened?.close();await f.cleanup();}
},40000);


test.skipIf(!process.env.PI_COFFEE_TEST_CODEX_ROOT)('existing pinned Codex with separate SQLite home enrolls and requalifies without a provider turn or config migration',async()=>{
 const f=await codexFixture(),control=await mkdtemp(join(tmpdir(),'existing-codex-control-')),lock=join(control,'group.lock'),custody=new NativeWriterCustody(join(control,'custody'),{lock}),physical=new PhysicalWriterFence({lock,custody});
 const roots=[{id:'projects',path:dirname(f.store.root)},{id:'native',path:f.home},{id:'sqlite',path:f.sql}],configuration=join(control,'configuration.json'),graph=join(control,'graph.json');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'codex-group',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots,producers:[{id:'host',kind:'host'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'codex-group',roots:roots.map(root=>({id:root.id,scope:'awangs',engine:'codex'}))}),{mode:0o600});
 const open=()=>TrustedSourceAuthority.open({root:join(control,'authority'),configuration,graph,fence:physical,authorize:async actor=>actor==='awangs'}),authority=await open(),fence=authority.writerFence('host');f.store=new Workspaces(f.store.root,{gitCommandCustody:custody});f.store.setBackupWriterFence(fence);await f.store.list();
 const cliPath=await realpath(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex')),factory=new CodexSessionFactory({cwd:f.task.cwd,cliPath,codexHome:f.home,nativeCustody:custody,env:{HOME:f.root},sandbox:'danger-full-access'}),before=await readFile(join(f.home,'config.toml'));
 const scopes=[{scope:'awangs',workspaces:f.store,codex:{home:f.home,sqliteHome:f.sql,version:'0.159.1'}}],checkpointRoot=join(control,'checkpoints');let session:Awaited<ReturnType<typeof factory.create>>|undefined,reopened:TrustedSourceAuthority|undefined;
 try{
  session=await authority.runWriter('host','ordinary-resume',()=>factory.create({sessionId:f.id,requireExisting:true}));expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;await factory.close();await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');
  const handoff=await readNativeSourceHandoff({custody,fence:physical}),options={producer:'host',handoff,scopes,checkpointRoot},first=await authority.enrollExisting('awangs',options);
  expect(first.checkpoint.manifest.members[0]).toMatchObject({scope:'awangs',engine:'codex',nativeBindings:[f.id]});expect(first.checkpoint.manifest.sources.some(source=>source.recoveryKey==='codex/group-v1')).toBe(true);
  const coordinator=authority.createNativeCoordinator(options);await authority.runWriter('host','ordinary-write',()=>writeFile(join(f.task.cwd,'changed'),'later'));expect((await coordinator.capture('awangs',f.task.id,'codex')).state).toBe('protected');
  await authority.close();reopened=await open();f.store.setBackupWriterFence(reopened.writerFence('host'));const next=await reopened.requalify('awangs',options);expect(next.evidence.enrollmentId).not.toBe(first.evidence.enrollmentId);expect(await readFile(join(f.home,'config.toml'))).toEqual(before);
 }finally{await session?.stop();await factory.close();await reopened?.close();await authority.close();await rm(f.root,{recursive:true,force:true});await rm(control,{recursive:true,force:true});}
},50000);


test.each(['forged','extra-producer','incomplete-scope','untracked-delegation','active-writer'] as const)('existing enrollment refuses %s even after a real completed native lifecycle',async failure=>{
 const f=await existingPi();try{
  const handoff=await normalPiHandoff(f),options={producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot};let release:(()=>void)|undefined;
  if(failure==='extra-producer'){const config=JSON.parse(await readFile(f.configuration,'utf8'));config.producers.push({id:'daemon',kind:'host'});await writeFile(f.configuration,JSON.stringify(config));}
  if(failure==='untracked-delegation')await f.authority.invalidateCoverage('untracked-delegation');
  if(failure==='active-writer')release=f.fence.beginWriter('platform');
  try{await expect(Reflect.apply(f.authority.enrollExisting,f.authority,['awangs',{...options,...failure==='forged'?{handoff:{}}:{},...failure==='incomplete-scope'?{scopes:[]}:{}}])).rejects.toThrow();}finally{release?.();}
  expect((await f.authority.qualification()).state).toBe('unknown');expect(await readFile(join(f.task.cwd,'note'),'utf8')).toBe('first');
 }finally{await f.cleanup();}
},30000);

test.each(['pending-delegation','graph-drift','new-untracked-writer'] as const)('restart requalification preserves %s refusal and the prior complete point',async failure=>{
 const f=await existingPi();let reopened:TrustedSourceAuthority|undefined;try{
  const handoff=await normalPiHandoff(f),options={producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot},initial=await f.authority.enrollExisting('awangs',options);
  if(failure==='pending-delegation')await expect(f.authority.runDelegated('host','lost-acceptance',async()=>{throw Error('lost completion');})).rejects.toThrow();
  if(failure==='graph-drift'){const value=JSON.parse(await readFile(f.graph,'utf8'));value.roots[0].engine='shared';await writeFile(f.graph,JSON.stringify(value));}
  if(failure==='new-untracked-writer')await f.authority.runWriter('untracked','external-operation',async()=>{});
  await f.authority.close();reopened=await f.open();f.workspaces.setBackupWriterFence(reopened.writerFence('host'));await expect(reopened.requalify('awangs',options)).rejects.toThrow();expect((await reopened.qualification()).state).toBe('unknown');expect(JSON.parse(await readFile(join(initial.checkpoint.directory,'manifest.json'),'utf8')).checkpointId).toBe(initial.checkpoint.manifest.checkpointId);
 }finally{await reopened?.close();await f.cleanup();}
},30000);


test('provisional enrollment never escapes to ordinary callers and a newly admitted writer revokes its unfinished cut',async()=>{
 const f=await existingPi();let resume!:()=>void;const gate=new Promise<void>(resolve=>resume=resolve);try{
  const handoff=await normalPiHandoff(f),list=f.workspaces.list.bind(f.workspaces);let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  f.workspaces.list=async()=>{const result=await list();started();await gate;return result;};
  const enrollment=f.authority.enrollExisting('awangs',{producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot}).then(value=>({value}),error=>({error}));await ready;
  expect(()=>f.authority.verifyRoots([f.source])).toThrow();await expect(f.authority.capture()).rejects.toMatchObject({code:'writers_unknown'});
  await f.authority.runWriter('host','intervening-write',()=>writeFile(join(f.task.cwd,'note'),'ordinary work continues'));resume();expect(await enrollment).toHaveProperty('error');expect((await f.authority.qualification()).state).toBe('unknown');
 }finally{resume();await f.cleanup();}
},30000);

test('a local operation whose authority disappeared cannot be cleared by a later native receipt',async()=>{
 const f=await existingPi();let reopened:TrustedSourceAuthority|undefined,resume!:()=>void;const gate=new Promise<void>(resolve=>resume=resolve);try{
  const handoff=await normalPiHandoff(f),options={producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot};await f.authority.enrollExisting('awangs',options);
  let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve),operation=f.authority.runWriter('host','unsettled-across-restart',async()=>{started();await gate;});await ready;
  await f.authority.close();reopened=await f.open();f.workspaces.setBackupWriterFence(reopened.writerFence('host'));resume();await operation;
  await expect(reopened.requalify('awangs',options)).rejects.toMatchObject({code:'writers_unknown'});expect((await reopened.qualification()).state).toBe('unknown');
 }finally{resume();await reopened?.close();await f.cleanup();}
},30000);

test('an unenrolled Host can restart and later enroll from normal activity without discarding negative journal evidence',async()=>{
 const f=await existingPi();let reopened:TrustedSourceAuthority|undefined;try{
  const handoff=await normalPiHandoff(f);await f.authority.close();reopened=await f.open();f.workspaces.setBackupWriterFence(reopened.writerFence('host'));
  const result=await reopened.enrollExisting('awangs',{producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot});expect(result.checkpoint.manifest.coverage).toBe('complete');expect((await reopened.qualification()).state).toBe('qualified');
 }finally{await reopened?.close();await f.cleanup();}
},30000);


test.skipIf(!process.env.PI_COFFEE_TEST_CODEX_ROOT)('two synthetic scopes join Pi and Codex only when both actual native stores have handed off',async()=>{
 const p=await existingPi(),c=await codexFixture();let session:Awaited<ReturnType<CodexSessionFactory['create']>>|undefined,factory:CodexSessionFactory|undefined;
 try{
  const config=JSON.parse(await readFile(p.configuration,'utf8'));config.roots.push({id:'codex-source',path:c.root});await writeFile(p.configuration,JSON.stringify(config));
  const graph=JSON.parse(await readFile(p.graph,'utf8'));graph.roots.push({id:'codex-source',scope:'synthetic-two',engine:'codex'});await writeFile(p.graph,JSON.stringify(graph));c.store=new Workspaces(c.store.root,{gitCommandCustody:p.custody});c.store.setBackupWriterFence(p.fence);await c.store.list();
  const scopes=[...p.scopes,{scope:'synthetic-two',workspaces:c.store,codex:{home:c.home,sqliteHome:c.sql,version:'0.159.1'}}],piOnly=await normalPiHandoff(p);
  await expect(p.authority.enrollExisting('awangs',{producer:'host',handoff:piOnly,scopes,checkpointRoot:p.checkpointRoot})).rejects.toMatchObject({code:'writers_unknown'});
  const cliPath=await realpath(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex'));factory=new CodexSessionFactory({cwd:c.task.cwd,cliPath,codexHome:c.home,nativeCustody:p.custody,env:{HOME:c.root},sandbox:'danger-full-access'});const native=factory;
  session=await p.authority.runWriter('host','second-native',()=>native.create({sessionId:c.id,requireExisting:true}));await session.getHistory();await session.stop();session=undefined;await native.close();await expect.poll(async()=>(await p.custody.state()).state,{timeout:10000}).toBe('quiescent');
  const result=await p.authority.qualifyExisting('awangs',{producer:'host',handoff:await readNativeSourceHandoff({custody:p.custody,fence:p.physical}),scopes,checkpointRoot:p.checkpointRoot});
  expect(result.checkpoint.manifest.members.map(member=>[member.scope,member.engine]).sort()).toEqual([['awangs','pi'],['synthetic-two','codex']]);expect((await p.authority.qualification()).state).toBe('qualified');
 }finally{await session?.stop();await factory?.close();await p.cleanup();await rm(c.root,{recursive:true,force:true});}
},50000);


test.each(['missing','different'] as const)('native enrollment refuses %s Git descendant custody even with the right writer fence',async kind=>{
 const f=await existingPi();try{
  const handoff=await normalPiHandoff(f),workspaces=new Workspaces(f.workspaces.root,kind==='missing'?{}:{gitCommandCustody:new NativeWriterCustody(join(f.control,'other-custody'),{lock:f.lock})});workspaces.setBackupWriterFence(f.fence);await workspaces.list();
  await expect(f.authority.enrollExisting('awangs',{producer:'host',handoff,scopes:[{...f.scopes[0],workspaces}],checkpointRoot:f.checkpointRoot})).rejects.toThrow();expect((await f.authority.qualification()).state).toBe('unknown');
 }finally{await f.cleanup();}
},30000);

test.each(['maxBytes','maxFiles','captureTimeoutMs'] as const)('existing enrollment respects the configured %s resource limit',async limit=>{
 const f=await existingPi();try{
  const handoff=await normalPiHandoff(f),options={producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot,[limit]:1};
  await expect(f.authority.enrollExisting('awangs',options)).rejects.toMatchObject({code:limit==='captureTimeoutMs'?'capture_timeout':'resource_limit'});expect((await f.authority.qualification()).state).toBe('unknown');
 }finally{await f.cleanup();}
},30000);


test.each(['maxBytes','maxFiles','captureTimeoutMs'] as const)('later actual native captures retain configured %s and the preceding safe point',async limit=>{
 const f=await existingPi();try{
  const handoff=await normalPiHandoff(f),options={producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot},first=await f.authority.enrollExisting('awangs',options),coordinator=f.authority.createNativeCoordinator({...options,[limit]:1});
  const result=await coordinator.capture('awangs',f.task.id,'pi');expect(result.state).toBe('failed');expect(result.checkpointId).toBe(first.checkpoint.manifest.checkpointId);expect(result.captureAt).toBe(first.checkpoint.manifest.captureAt);expect((await coordinator.sealedCheckpoint('awangs',f.task.id))?.manifest.checkpointId).toBe(first.checkpoint.manifest.checkpointId);
 }finally{await f.cleanup();}
},30000);


test('current administrator authorization is rechecked after native materialization before enrollment commits',async()=>{
 let allowed=true;const f=await existingPi({authorize:async actor=>allowed&&actor==='awangs'});try{
  const handoff=await normalPiHandoff(f),list=f.workspaces.list.bind(f.workspaces);f.workspaces.list=async()=>{const value=await list();allowed=false;return value;};
  await expect(f.authority.enrollExisting('awangs',{producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot})).rejects.toThrow();expect((await f.authority.qualification()).state).toBe('unknown');const state=JSON.parse(await readFile(join(f.control,'authority','state.json'),'utf8'));expect(state.enrollment).toBeUndefined();
 }finally{await f.cleanup();}
},30000);
