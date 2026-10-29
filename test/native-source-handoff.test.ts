import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {readNativeSourceHandoff,verifyNativeSourceHandoff} from '../src/host/native-source-handoff.js';

it('passively recovers a real Pi history and completed lifecycle witness after same-boot Host restart',async()=>{
 const root=await mkdtemp(join(tmpdir(),'native-handoff-')),sessionDir=join(root,'sessions'),agentDir=join(root,'agent');await mkdir(sessionDir);await mkdir(agentDir);
 SessionManager.create(root,sessionDir,{id:'original-pi'}).appendMessage({role:'user',content:'Original Pi history',timestamp:1});
 const lock=join(root,'group.lock'),custodyRoot=join(root,'custody'),custody=new NativeWriterCustody(custodyRoot,{lock}),fence=new PhysicalWriterFence({lock,custody}),factory=new RpcPiSessionFactory({cwd:root,sessionDir,agentDir,nativeCustody:custody,writerFence:fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
 let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{
  await expect(readNativeSourceHandoff({custody,fence})).rejects.toThrow();
  session=await factory.create({sessionId:'original-pi',requireExisting:true});expect(JSON.stringify(await session.getHistory())).toContain('Original Pi history');
  await expect(readNativeSourceHandoff({custody,fence})).rejects.toThrow();
  await session.stop();session=undefined;await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');
  const reopened=new NativeWriterCustody(custodyRoot,{lock}),newFence=new PhysicalWriterFence({lock,custody:reopened});
  const token=await readNativeSourceHandoff({custody:reopened,fence:newFence}),lease=await newFence.lease();
  const stores=[{scope:'synthetic',engine:'pi' as const,roots:[sessionDir,agentDir],bindings:['original-pi']}];
  try{
   const proof=await verifyNativeSourceHandoff(token,{fence:newFence,lease,stores});expect(proof.observations).toEqual([{engine:'pi',roots:[sessionDir,agentDir],bindings:['original-pi']}]);
   await expect(verifyNativeSourceHandoff(token,{fence:newFence,lease:{...lease},stores})).rejects.toThrow();
   await expect(verifyNativeSourceHandoff(token,{fence:newFence,lease,stores:[{...stores[0],bindings:['unobserved']}]})).rejects.toThrow();
   await expect(verifyNativeSourceHandoff({} as typeof token,{fence:newFence,lease,stores})).rejects.toThrow();
  }finally{lease.release();}
  await expect(verifyNativeSourceHandoff(token,{fence:newFence,lease,stores})).rejects.toThrow();
  const otherLease=await fence.lease();try{await expect(verifyNativeSourceHandoff(token,{fence:newFence,lease:otherLease,stores})).rejects.toThrow();}finally{otherLease.release();}
 }finally{await session?.stop();await rm(root,{recursive:true,force:true});}
},30000);

import {realpath,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {codexFixture} from './codex-recovery-fixture.js';

it.skipIf(!process.env.PI_COFFEE_TEST_CODEX_ROOT)('real Codex resumed history binds configured sqlite root and completed server custody',async()=>{
 const f=await codexFixture(),lock=join(f.root,'group.lock'),custody=new NativeWriterCustody(join(f.root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),cliPath=await realpath(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex'));
 const rolloutLines=(await readFile(f.rollout,'utf8')).split('\n'),header=JSON.parse(rolloutLines[0]);header.payload.base_instructions.text='Synthetic instructions '.repeat(4000);rolloutLines[0]=JSON.stringify(header);await writeFile(f.rollout,rolloutLines.join('\n'));
 const factory=new CodexSessionFactory({cwd:f.task.cwd,cliPath,codexHome:f.home,nativeCustody:custody,env:{HOME:f.root},sandbox:'danger-full-access'});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{
  session=await factory.create({sessionId:f.id,requireExisting:true});expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;
  await expect(readNativeSourceHandoff({custody,fence})).rejects.toThrow();await factory.close();await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');
  const token=await readNativeSourceHandoff({custody,fence}),lease=await fence.lease(),stores=[{scope:'alice',engine:'codex' as const,roots:[f.home,f.sql],bindings:[f.id]}];
  try{expect((await verifyNativeSourceHandoff(token,{fence,lease,stores})).observations).toEqual([{engine:'codex',roots:[f.home,f.sql],bindings:[f.id]}]);
   // Same store shared by scopes needs one real observed binding, not reopening
   // each archived task. The recovery adapters verify the entire graph separately.
   await expect(verifyNativeSourceHandoff(token,{fence,lease,stores:[...stores,{...stores[0],scope:'bob',bindings:['archived-other-binding']}]})).resolves.toMatchObject({schema:1});
   await expect(verifyNativeSourceHandoff(token,{fence,lease,stores:[{...stores[0],roots:[f.home,f.home]}]})).rejects.toThrow();
  }finally{lease.release();}
 }finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it('a completed no-op custody launch and native constructor cannot establish a source witness',async()=>{
 const root=await mkdtemp(join(tmpdir(),'handoff-noop-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});
 try{
  new RpcPiSessionFactory({cwd:root,nativeCustody:custody,writerFence:fence});new CodexSessionFactory({cwd:root,nativeCustody:custody});
  const launch=await custody.prepare({executable:'/bin/true',engine:'pi'}),child=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'});await once(child,'exit');expect(await custody.state()).toEqual({state:'quiescent'});
  await expect(readNativeSourceHandoff({custody,fence})).rejects.toThrow('not observed');
 }finally{await rm(root,{recursive:true,force:true});}
});

async function observedPi(){
 const root=await mkdtemp(join(tmpdir(),'handoff-edge-')),sessionDir=join(root,'sessions'),agentDir=join(root,'agent');await mkdir(sessionDir);await mkdir(agentDir);SessionManager.create(root,sessionDir,{id:'pi-binding'}).appendMessage({role:'user',content:'Synthetic history',timestamp:1});
 const lock=join(root,'group.lock'),custodyRoot=join(root,'custody'),custody=new NativeWriterCustody(custodyRoot,{lock}),fence=new PhysicalWriterFence({lock,custody}),factory=new RpcPiSessionFactory({cwd:root,sessionDir,agentDir,nativeCustody:custody,writerFence:fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
 const session=await factory.create({sessionId:'pi-binding',requireExisting:true});return {root,sessionDir,agentDir,lock,custodyRoot,custody,fence,session};
}
it('real Pi identity and close without a history read is insufficient',async()=>{
 const f=await observedPi();try{await f.session.getState();await f.session.stop();await expect.poll(async()=>(await f.custody.state()).state).toBe('quiescent');await expect(readNativeSourceHandoff(f)).rejects.toThrow('not observed');}finally{await f.session.stop();await rm(f.root,{recursive:true,force:true});}
},20000);

it.each(['observation','receipt','command','close','old-boot','store-replaced'] as const)('rejects %s change after completed real Pi lifecycle',async(kind)=>{
 const f=await observedPi();try{await f.session.getHistory();await f.session.stop();await expect.poll(async()=>(await f.custody.state()).state).toBe('quiescent');const token=await readNativeSourceHandoff(f),lease=await f.fence.lease();
  try{const dir=join(f.custodyRoot,(await readdir(f.custodyRoot)).find(x=>x!=='group-lock.json')!);
   if(kind==='store-replaced'){await rm(f.agentDir,{recursive:true});await mkdir(f.agentDir);}
   else{const file=join(dir,kind==='observation'?'history-observation.json':kind==='command'?'command.json':kind==='close'?'normal-close.json':'state.json'),value=JSON.parse(await readFile(file,'utf8'));if(kind==='old-boot')value.boot='different-boot';else value.tampered=true;await writeFile(file,JSON.stringify(value));}
   await expect(verifyNativeSourceHandoff(token,{fence:f.fence,lease,stores:[{scope:'fixture',engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:['pi-binding']}]})).rejects.toThrow();
  }finally{lease.release();}
 }finally{await f.session.stop();await rm(f.root,{recursive:true,force:true});}
},20000);

it.each(['SIGKILL','SIGTERM'] as const)('native %s without adapter close cannot yield a lifecycle witness',async(signal)=>{
 const f=await observedPi();try{await f.session.getHistory();const dir=join(f.custodyRoot,(await readdir(f.custodyRoot)).find(x=>x!=='group-lock.json')!),receipt=JSON.parse(await readFile(join(dir,'state.json'),'utf8')),children=(await readFile(`/proc/${receipt.pid}/task/${receipt.pid}/children`,'utf8')).trim().split(/\s+/).map(Number);expect(children).toHaveLength(1);process.kill(children[0],signal);
  await expect.poll(async()=>(await f.custody.state()).state,{timeout:10000}).toBe('quiescent');await expect(readNativeSourceHandoff(f)).rejects.toThrow();
 }finally{await f.session.stop();await rm(f.root,{recursive:true,force:true});}
},20000);

it('deleting a historical native binding does not poison passive handoff for the remaining inventory',async()=>{
 const f=await observedPi();let remaining:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 try{await f.session.getHistory();await f.session.stop();await expect.poll(async()=>(await f.custody.state()).state).toBe('quiescent');
  const oldFile=(await readdir(f.sessionDir)).find(name=>name.endsWith('.jsonl'))!;
  SessionManager.create(f.root,f.sessionDir,{id:'remaining-pi'}).appendMessage({role:'user',content:'Remaining task history',timestamp:2});
  const factory=new RpcPiSessionFactory({cwd:f.root,sessionDir:f.sessionDir,agentDir:f.agentDir,nativeCustody:f.custody,writerFence:f.fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
  remaining=await factory.create({sessionId:'remaining-pi',requireExisting:true});await remaining.getHistory();await remaining.stop();remaining=undefined;await expect.poll(async()=>(await f.custody.state()).state).toBe('quiescent');
  // The authority's separate test exercises the actual Workspaces delete lane.
  // Here the public handoff seam receives the resulting current inventory.
  await rm(join(f.sessionDir,oldFile));const custody=new NativeWriterCustody(f.custodyRoot,{lock:f.lock}),fence=new PhysicalWriterFence({lock:f.lock,custody}),token=await readNativeSourceHandoff({custody,fence}),lease=await fence.lease();
  try{expect((await verifyNativeSourceHandoff(token,{fence,lease,stores:[{scope:'fixture',engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:['remaining-pi']}]})).observations).toEqual([{engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:['remaining-pi']}]);
   await expect(verifyNativeSourceHandoff(token,{fence,lease,stores:[{scope:'fixture',engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:['pi-binding']}]})).rejects.toThrow();
  }finally{lease.release();}
 }finally{await remaining?.stop();await f.session.stop();await rm(f.root,{recursive:true,force:true});}
},30000);

import {createHash} from 'node:crypto';
it('SIMULATED previous boot: old native observations cannot qualify a source until a real current-boot lifecycle completes',async()=>{
 const f=await observedPi();let next:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 const digest=(text:string)=>createHash('sha256').update(text).digest('hex'),previousBoot='11111111-1111-4111-8111-111111111111';
 try{await f.session.getHistory();await f.session.stop();await expect.poll(async()=>(await f.custody.state()).state).toBe('quiescent');
  const dir=join(f.custodyRoot,(await readdir(f.custodyRoot)).find(name=>name!=='group-lock.json')!),command=JSON.parse(await readFile(join(dir,'command.json'),'utf8')),observation=JSON.parse(await readFile(join(dir,'history-observation.json'),'utf8')),close=JSON.parse(await readFile(join(dir,'normal-close.json'),'utf8')),receipt=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));
  // Explicit synthetic previous-boot ledger. The real kernel boot reader and
  // production options are unchanged; this is not a real machine reboot test.
  command.boot=previousBoot;const commandText=JSON.stringify(command);observation.boot=previousBoot;observation.commandDigest=digest(commandText);const observationText=JSON.stringify(observation);close.boot=previousBoot;close.observationDigest=digest(observationText);const closeText=JSON.stringify(close);
  const receiptText=JSON.stringify({...receipt,boot:previousBoot,commandDigest:digest(commandText),observationDigest:digest(observationText),closeDigest:digest(closeText)});
  for(const [name,text] of [['command.json',commandText],['history-observation.json',observationText],['normal-close.json',closeText],['state.json',receiptText]])await writeFile(join(dir,name),text);
  expect(await f.custody.state()).toEqual({state:'quiescent'});await expect(readNativeSourceHandoff(f)).rejects.toThrow();
  const factory=new RpcPiSessionFactory({cwd:f.root,sessionDir:f.sessionDir,agentDir:f.agentDir,nativeCustody:f.custody,writerFence:f.fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
  next=await factory.create({sessionId:'pi-binding',requireExisting:true});await next.getHistory();await next.stop();next=undefined;await expect.poll(async()=>(await f.custody.state()).state).toBe('quiescent');
  const token=await readNativeSourceHandoff(f),lease=await f.fence.lease();try{const proof=await verifyNativeSourceHandoff(token,{fence:f.fence,lease,stores:[{scope:'fixture',engine:'pi',roots:[f.sessionDir,f.agentDir],bindings:['pi-binding']}]});expect(proof.kernelBoot).toBe((await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim());expect(proof.priorBootReceiptDigest).toMatch(/^[a-f0-9]{64}$/);}finally{lease.release();}
  expect(await readFile(join(dir,'state.json'),'utf8')).toBe(receiptText);
 }finally{await next?.stop();await f.session.stop();await rm(f.root,{recursive:true,force:true});}
},30000);
