import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {TrustedSourceAuthority,trustedSourcePhysicalFence} from '../src/host/trusted-source-authority.js';
import {BackupCoordinator} from '../src/host/backup.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'trusted-source-')),control=join(root,'control'),source=join(root,'source');await mkdir(control,{mode:0o700});
 const config=join(control,'configuration.json'),graph=join(control,'graph.json');
 await writeFile(config,JSON.stringify({schema:1,groupId:'shared-native',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'task-data',path:source}],producers:[{id:'host',kind:'host'},{id:'runner',kind:'delegation-broker'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'shared-native',roots:[{id:'task-data',scope:'awangs',engine:'pi'}]}),{mode:0o600});
 const lock=join(control,'group.lock'),custody=new NativeWriterCustody(join(control,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});
 const open=()=>TrustedSourceAuthority.open({root:join(control,'enrollment'),configuration:config,graph,fence,authorize:async actor=>actor==='awangs'});
 const authority=await open();
 const native=async()=>{const launch=await custody.prepare({executable:process.execPath,args:['-e','process.exit(0)']});const child=spawn(process.execPath,[launch.cliPath],{env:{...process.env,...launch.env},stdio:'ignore'});expect((await once(child,'exit'))[0]).toBe(0);};
 return {root,source,config,graph,authority,open,native,fence,custody,cleanup:async()=>{await authority.close();await rm(root,{recursive:true,force:true});}};
}

test('fresh enrolled ordinary writers produce an initial and later cold cut without restricting execution',async()=>{
 const f=await fixture();try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);
  await expect(f.authority.capture()).rejects.toThrow(); // an empty custody directory is not proof
  await f.authority.runWriter('host','initial-native',async()=>{await f.native();await writeFile(join(f.source,'note'),'first');});
  const first=await f.authority.capture();expect(first.evidence.assumptions).toEqual(['trusted-source-root','all-source-producers-use-admission-v1']);expect(await readFile(join(f.source,'note'),'utf8')).toBe('first');
  const writing=f.authority.runWriter('host','later-write',async()=>{expect(()=>first.lease.assertValid()).toThrow();await writeFile(join(f.source,'note'),'second');});
  expect(first.lease.signal.aborted).toBe(true);await writing;
  first.lease.release();const second=await f.authority.capture();expect(second.evidence.revision).toBeGreaterThan(first.evidence.revision);second.lease.assertValid();second.lease.release();
  expect(await readFile(join(f.source,'note'),'utf8')).toBe('second');
 }finally{await f.cleanup();}
},15000);

test('a delegated delayed writer stays admitted through its callback and an interrupted delegation stays unknown after authority restart',async()=>{
 const f=await fixture();let reopened:TrustedSourceAuthority|undefined;
 try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);
  let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve),release=join(f.root,'release-worker');
  const delegated=f.authority.runDelegated('runner','delayed-callback',async()=>{
   // This actual writer is outside native custody. The registered producer's
   // callback covers its lifetime, including after its short launcher exits.
   const worker=spawn(process.execPath,['-e',`const fs=require('node:fs');process.stdout.write('ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){fs.writeFileSync(${JSON.stringify(join(f.source,'remote-result'))},'complete');clearInterval(t);}},10);setTimeout(()=>process.exit(1),5000).unref();`],{stdio:['ignore','pipe','ignore']});
   const done=once(worker,'exit');await once(worker.stdout!,'data');const launcher=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore'});expect((await once(launcher,'exit'))[0]).toBe(0);started();expect((await done)[0]).toBe(0);
  });
  await ready;expect((await f.authority.qualification()).state).toBe('active');await expect(f.authority.capture()).rejects.toMatchObject({code:'writers_active'});await writeFile(release,'finish');await delegated;
  const first=await f.authority.capture();expect(await readFile(join(f.source,'remote-result'),'utf8')).toBe('complete');first.lease.release();
  let secondStarted!:()=>void,resume!:()=>void;const secondReady=new Promise<void>(resolve=>secondStarted=resolve),late=new Promise<void>(resolve=>resume=resolve);
  const interrupted=f.authority.runDelegated('runner','interrupted-callback',async()=>{secondStarted();await late;await writeFile(join(f.source,'remote-result'),'late');}).catch(error=>error);
  await secondReady;await f.authority.close();reopened=await f.open();expect((await reopened.qualification()).state).toBe('unknown');await expect(reopened.capture()).rejects.toThrow();
  resume();expect(await interrupted).toBeUndefined();expect(await readFile(join(f.source,'remote-result'),'utf8')).toBe('late');expect((await reopened.qualification()).state).toBe('unknown');await expect(reopened.capture()).rejects.toThrow();
 }finally{await reopened?.close();await f.cleanup();}
},15000);

test.each(['configuration','graph','root'] as const)('%s drift revokes an issued cut and prevents requalification without disabling ordinary work',async drift=>{
 const f=await fixture();try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);
  const before=await f.authority.capture();
  if(drift==='root'){await rename(f.source,f.source+'-retained');await mkdir(f.source,{mode:0o700});}
  else await writeFile(drift==='graph'?f.graph:f.config,'{}',{mode:0o600});
  expect(()=>before.lease.assertValid()).toThrow();before.lease.release();expect((await f.authority.qualification()).state).toBe('unknown');await expect(f.authority.capture()).rejects.toThrow();
  await f.authority.runWriter('host','normal-operation',async()=>{await writeFile(join(f.source,'note'),'allowed');});expect(await readFile(join(f.source,'note'),'utf8')).toBe('allowed');
 }finally{await f.cleanup();}
});

test('an unregistered producer runs but permanently invalidates coverage, including after restart',async()=>{
 const f=await fixture();let reopened:TrustedSourceAuthority|undefined;try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);const before=await f.authority.capture();
  await f.authority.runWriter('unknown-service','untracked-write',async()=>{expect(()=>before.lease.assertValid()).toThrow();expect((await f.authority.qualification()).state).toBe('unknown');await writeFile(join(f.source,'note'),'not blocked');});before.lease.release();
  expect(await readFile(join(f.source,'note'),'utf8')).toBe('not blocked');await expect(f.authority.capture()).rejects.toThrow();await f.authority.close();reopened=await f.open();expect((await reopened.qualification()).state).toBe('unknown');await expect(reopened.capture()).rejects.toThrow();
 }finally{await reopened?.close();await f.cleanup();}
});

test('enrollment refuses existing roots, unauthorized actors and caller-supplied proof flags',async()=>{
 const f=await fixture();try{
  await expect(f.authority.enrollFresh('other-user',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}])).rejects.toThrow();
  const original=await readFile(f.config,'utf8');await writeFile(f.config,JSON.stringify({...JSON.parse(original),known:true}),{mode:0o600});await expect(f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}])).rejects.toThrow();
  await writeFile(f.config,original,{mode:0o600});await mkdir(f.source,{mode:0o700});await writeFile(join(f.source,'existing'),'preserve');
  await expect(f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}])).rejects.toThrow();expect(await readFile(join(f.source,'existing'),'utf8')).toBe('preserve');await expect(f.authority.capture()).rejects.toThrow();
 }finally{await f.cleanup();}
});

test('a competing authority cannot claim the same enrollment and an uncertain delegated operation is not forgotten',async()=>{
 const f=await fixture();let reopened:TrustedSourceAuthority|undefined;try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);await expect(f.open()).rejects.toThrow();
  await expect(f.authority.runDelegated('runner','uncertain-write',async()=>{await writeFile(join(f.source,'note'),'partial');throw Error('operation completion uncertain');})).rejects.toThrow('completion uncertain');
  expect((await f.authority.qualification()).state).toBe('unknown');await expect(f.authority.capture()).rejects.toThrow();await f.authority.close();reopened=await f.open();await expect(reopened.capture()).rejects.toThrow();expect(await readFile(join(f.source,'note'),'utf8')).toBe('partial');
 }finally{await reopened?.close();await f.cleanup();}
});

test('a settled local request error releases logical admission while actual custody descendants continue to block capture',async()=>{
 const f=await fixture(),release=join(f.root,'release-child');let child:ReturnType<typeof spawn>|undefined,exited:Promise<unknown>|undefined;
 try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);
  await expect(f.authority.runWriter('host','ordinary-error',async()=>{throw Error('preflight refused');})).rejects.toThrow('preflight refused');
  const idle=await f.authority.capture();idle.lease.assertValid();idle.lease.release();
  await expect(f.authority.runWriter('host','failed-request-with-child',async()=>{
   const launch=await f.custody.prepare({executable:process.execPath,args:['-e',`const fs=require('node:fs');process.stdout.write('ready');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){fs.writeFileSync(${JSON.stringify(join(f.source,'late'))},'done');clearInterval(t);}},10);setTimeout(()=>process.exit(1),5000).unref();`]});
   child=spawn(process.execPath,[launch.cliPath],{env:{...process.env,...launch.env},stdio:['ignore','pipe','ignore']});exited=once(child,'exit');await once(child.stdout!,'data');throw Error('local request failed');
  })).rejects.toThrow('local request failed');
  await expect(f.authority.capture()).rejects.toMatchObject({code:'writers_active'});await writeFile(release,'finish');await exited;
  const settled=await f.authority.capture();expect(await readFile(join(f.source,'late'),'utf8')).toBe('done');settled.lease.release();
 }finally{await writeFile(release,'finish');await exited;await f.cleanup();}
},15000);

test('an external writer observation invalidates before persistence and cannot be cleared by restart or a clean scan',async()=>{
 const f=await fixture();let reopened:TrustedSourceAuthority|undefined;try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);const before=await f.authority.capture();
  const invalidating=f.authority.invalidateCoverage('untracked-delegation');expect(before.lease.signal.aborted).toBe(true);await invalidating;before.lease.release();
  await f.authority.runWriter('host','ordinary-after-observation',async()=>{await writeFile(join(f.source,'note'),'running');});expect((await f.authority.qualification()).state).toBe('unknown');
  await f.authority.close();reopened=await f.open();await expect(reopened.capture()).rejects.toThrow();
 }finally{await reopened?.close();await f.cleanup();}
});

test('lost backup metadata does not block ordinary work or revive prior coverage after reopening old records',async()=>{
 const f=await fixture();let reopened:TrustedSourceAuthority|undefined;try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);const before=await f.authority.capture();
  const ledger=join(f.root,'control','enrollment');await rename(ledger,ledger+'-retained');await mkdir(ledger,{mode:0o700});
  await f.authority.runWriter('host','metadata-unavailable',async()=>{await writeFile(join(f.source,'note'),'native work succeeds');});expect(await readFile(join(f.source,'note'),'utf8')).toBe('native work succeeds');expect(()=>before.lease.assertValid()).toThrow();before.lease.release();
  expect((await f.authority.qualification()).state).toBe('unknown');await f.authority.close();await rename(ledger,ledger+'-replacement');await rename(ledger+'-retained',ledger);
  reopened=await f.open();expect((await reopened.qualification()).state).toBe('unknown');await expect(reopened.capture()).rejects.toThrow();
 }finally{await reopened?.close();await f.cleanup();}
});

test('the coordinator uses evidence-bound physical cuts and synchronous platform admission while publication keeps its actual exclusion',async()=>{
 const f=await fixture();try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);const fence=f.authority.writerFence('host');expect(trustedSourcePhysicalFence(fence)).toBe(f.fence);
  await fence.runWriter('native',f.native);await fence.runWriter('platform',()=>writeFile(join(f.source,'note'),'first'));
  const coordinator=new BackupCoordinator({root:join(f.root,'checkpoints'),adapter:{version:'synthetic-native-v1',resolve:async()=>({groupId:'shared-native',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['task']}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:f.source},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'native',recoveryKey:'native-session/task',role:'native',data:Buffer.from('synthetic')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
  expect((await coordinator.capture('awangs','task','pi')).state).toBe('protected');const first=(await coordinator.sealedCheckpoint('awangs','task'))!;expect(await readFile(join(first.directory,'objects','workspace','note'),'utf8')).toBe('first');
  const capture=await fence.lease(),end=fence.beginWriter('platform');expect(capture.signal.aborted).toBe(true);await writeFile(join(f.source,'note'),'second');end();capture.release();
  expect((await coordinator.capture('awangs','task','pi')).state).toBe('protected');const second=(await coordinator.sealedCheckpoint('awangs','task'))!;expect(second.manifest.checkpointId).not.toBe(first.manifest.checkpointId);expect(await readFile(join(second.directory,'objects','workspace','note'),'utf8')).toBe('second');
  const publication=await fence.publicationLease();await expect(f.authority.runWriter('host','during-publication',async()=>writeFile(join(f.source,'forbidden'),'no'))).rejects.toMatchObject({code:'writers_active'});await fence.runRecoveryPublication({operationId:'approved',digest:'digest',lease:publication},async()=>writeFile(join(f.source,'recovered'),'approved'));expect(await readFile(join(f.source,'recovered'),'utf8')).toBe('approved');publication.release();
  await writeFile(f.graph,'{}',{mode:0o600});expect((await coordinator.capture('awangs','task','pi')).state).not.toBe('protected');expect((await coordinator.sealedCheckpoint('awangs','task'))?.manifest.checkpointId).toBe(second.manifest.checkpointId);
 }finally{await f.cleanup();}
},15000);

test('a source enrollment covers only its real canonical roots and descendants, not unrelated or symlinked Host data',async()=>{
 const f=await fixture();try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);await f.authority.runWriter('host','bootstrap',f.native);await mkdir(join(f.source,'workspace'),{mode:0o700});
  expect(f.authority.verifyRoots([f.source,join(f.source,'workspace')]).groupId).toBe('shared-native');expect(()=>f.authority.verifyRoots([f.root])).toThrow();
  await symlink(f.root,join(f.source,'outside'));expect(()=>f.authority.verifyRoots([join(f.source,'outside')])).toThrow();
  await rename(f.source,f.source+'-retained');await mkdir(f.source,{mode:0o700});expect(()=>f.authority.verifyRoots([f.source])).toThrow();
 }finally{await f.cleanup();}
});

test.each([{scope:'__legacy_default__',accepted:true},{scope:'gitea-2',accepted:true},{scope:'owner.with-dot',accepted:true},{scope:'UpperCase',accepted:false}])('source graph preserves canonical scope $scope without remapping',async({scope,accepted})=>{
 const f=await fixture();try{
  await writeFile(f.graph,JSON.stringify({schema:1,groupId:'shared-native',roots:[{id:'task-data',scope,engine:'pi'}]}),{mode:0o600});
  const enrollment=f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:process.pid}]);
  if(accepted){await enrollment;expect(f.authority.verifyRoots([f.source]).groupId).toBe('shared-native');expect(JSON.parse(await readFile(f.graph,'utf8')).roots[0].scope).toBe(scope);}else await expect(enrollment).rejects.toThrow();
 }finally{await f.cleanup();}
});

test('producer identity loss disables capture while ordinary execution remains available',async()=>{
 const f=await fixture(),producer=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});await once(producer,'spawn');
 try{
  await f.authority.enrollFresh('awangs',[{id:'host',pid:process.pid},{id:'runner',pid:producer.pid!}]);await f.authority.runWriter('host','bootstrap',f.native);
  producer.kill();await once(producer,'exit');
  await f.authority.runDelegated('runner','changed-service',async()=>{await writeFile(join(f.source,'ordinary-operation'),'still available');});
  expect(await readFile(join(f.source,'ordinary-operation'),'utf8')).toBe('still available');expect((await f.authority.qualification()).state).toBe('unknown');await expect(f.authority.capture()).rejects.toThrow();
 }finally{if(producer.exitCode===null&&producer.signalCode===null){producer.kill();await once(producer,'exit');}await f.cleanup();}
},15000);
