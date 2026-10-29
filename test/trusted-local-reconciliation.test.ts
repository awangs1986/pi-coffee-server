import {SessionManager} from '@earendil-works/pi-coding-agent';
import {createHash} from 'node:crypto';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {test,expect} from 'vitest';
import {writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existingPi,normalPiHandoff,crashedLocalHost,reopen} from './trusted-native-enrollment-fixture.js';
import {TrustedSourceAuthority} from '../src/host/trusted-source-authority.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {Workspaces} from '../src/host/workspaces.js';
import {readNativeSourceHandoff} from '../src/host/native-source-handoff.js';


test.each(['qualified','bootstrap','restart-startup'] as const)('actual dead %s Host local operation is reconciled only after new complete native cut and durable receipt',async mode=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined;
 try{
  const handoff=await normalPiHandoff(f);if(mode!=='bootstrap')await f.authority.enrollExisting('awangs',{producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot});
  await crashedLocalHost(f,mode);const before=JSON.parse(await readFile(join(f.control,'authority','state.json'),'utf8'));expect(before.operations).toHaveLength(1);
  const current=await reopen(f);restarted=current.authority;expect((await restarted.qualification()).state).toBe('unknown');const result=await restarted.qualifyExisting('awangs',current.options);
  expect(result.checkpoint.manifest.coverage).toBe('complete');expect((await restarted.qualification()).state).toBe('qualified');expect(await readFile(join(f.task.cwd,'note'),'utf8')).toBe('partial durable work');expect((await readFile(join(f.control,'effects'),'utf8')).trim().split(String.fromCharCode(10))).toEqual(['once']);
  const state=JSON.parse(await readFile(join(f.control,'authority','state.json'),'utf8'));expect(state.operations).toEqual([]);expect(state.enrollment.reconciliation).toHaveProperty('digest');
  const receipts=await readdir(join(f.control,'authority','reconciliations'));expect(receipts).toHaveLength(1);const receipt=JSON.parse(await readFile(join(f.control,'authority','reconciliations',receipts[0]),'utf8'));
  expect(receipt.checkpointId).toBe(result.checkpoint.manifest.checkpointId);expect(receipt.operations.map((operation:{id:string})=>operation.id)).toEqual(['interrupted-local']);expect(receipt.operations[0].death.kind).toBe('process-exited');
 }finally{await restarted?.close();await f.cleanup();}
},40000);


test.each(['legacy','corrupt-owner','corrupt-checksum','delegated','missing-native','resource-limit','receipt-unavailable'] as const)('local recovery keeps the original unresolved record for %s',async failure=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined;try{
  const handoff=await normalPiHandoff(f);await f.authority.enrollExisting('awangs',{producer:'host',handoff,scopes:f.scopes,checkpointRoot:f.checkpointRoot});await crashedLocalHost(f,failure==='delegated'?'delegated':'qualified');
  const stateFile=join(f.control,'authority','state.json'),saved=JSON.parse(await readFile(stateFile,'utf8'));
  if(failure==='legacy'){delete saved.operations[0].localOwner;await writeFile(stateFile,JSON.stringify(saved));}
  if(failure==='corrupt-owner'){saved.operations[0].localOwner.identity.boot='11111111-1111-4111-8111-111111111111';await writeFile(stateFile,JSON.stringify(saved));}
  if(failure==='corrupt-checksum'){saved.operations[0].localOwner.checksum='0'.repeat(64);await writeFile(stateFile,JSON.stringify(saved));}
  if(failure==='missing-native')await rm(f.stored.getSessionFile()!);
  if(failure==='receipt-unavailable')await writeFile(join(f.control,'authority','reconciliations'),'not a directory');
  const current=await reopen(f);restarted=current.authority;await expect(restarted.qualifyExisting('awangs',{...current.options,...failure==='resource-limit'?{maxBytes:1}:{}})).rejects.toThrow();
  await restarted.runWriter('host','ordinary-after-refusal',()=>writeFile(join(f.task.cwd,'later'),'ordinary work continues'));expect((await restarted.qualification()).state).toBe('unknown');expect(JSON.parse(await readFile(stateFile,'utf8')).operations).toEqual(saved.operations);
 }finally{await restarted?.close();await f.cleanup();}
},40000);

test('a reconciled enrollment cannot lose its linked durable receipt and regain qualification on another restart',async()=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined;try{
  await normalPiHandoff(f);await crashedLocalHost(f,'bootstrap');const current=await reopen(f);restarted=current.authority;await restarted.qualifyExisting('awangs',current.options);
  const state=JSON.parse(await readFile(join(f.control,'authority','state.json'),'utf8'));await rm(join(f.control,'authority','reconciliations',state.enrollment.reconciliation.id+'.json'));expect((await restarted.qualification()).state).toBe('unknown');await restarted.close();
  const next=await reopen(f);restarted=next.authority;await expect(restarted.qualifyExisting('awangs',next.options)).rejects.toThrow();expect((await restarted.qualification()).state).toBe('unknown');
 }finally{await restarted?.close();await f.cleanup();}
},40000);


test('actual native deletion followed by Host restart captures the remaining task without requiring removed historical files',async()=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined,session:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 try{
  await normalPiHandoff(f);const remaining=await f.workspaces.createChatConversation('remaining-task');
  await f.authority.runWriter('host','seed-second-native',async()=>{SessionManager.create(remaining.cwd,f.sessions,{id:remaining.id}).appendMessage({role:'user',content:'Remaining native context',timestamp:2});});
  const factory=new RpcPiSessionFactory({cwd:remaining.cwd,sessionDir:f.sessions,agentDir:f.agent,nativeCustody:f.custody,writerFence:f.fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
  session=await factory.create({sessionId:remaining.id,requireExisting:true});await session.getHistory();await session.stop();session=undefined;await expect.poll(async()=>(await f.custody.state()).state,{timeout:10000}).toBe('quiescent');
  const first=await f.authority.enrollExisting('awangs',{producer:'host',handoff:await readNativeSourceHandoff({custody:f.custody,fence:f.physical}),scopes:f.scopes,checkpointRoot:f.checkpointRoot});expect(first.checkpoint.manifest.members).toHaveLength(2);
  await f.workspaces.archive(f.task.id,true);await f.workspaces.deleteWorkspace(f.task.id,f.task.id,()=>f.factory.delete(f.task.id),true);await expect(readFile(f.stored.getSessionFile()!)).rejects.toMatchObject({code:'ENOENT'});
  await f.authority.close();const current=await reopen(f);restarted=current.authority;const result=await restarted.qualifyExisting('awangs',current.options);
  expect(result.checkpoint.manifest.members.map(member=>member.taskId)).toEqual([remaining.id]);expect((await restarted.qualification()).state).toBe('qualified');
 }finally{await session?.stop();await restarted?.close();await f.cleanup();}
},40000);

const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const previousBoot='11111111-1111-4111-8111-111111111111';
async function simulatePreviousBoot(root:string){
 const retained=new Map<string,string>();
 for(const name of (await readdir(root)).filter(name=>name!=='group-lock.json')){
  const dir=join(root,name),command=JSON.parse(await readFile(join(dir,'command.json'),'utf8')),receipt=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));expect(command.schema).toBe(2);command.boot=previousBoot;const commandText=JSON.stringify(command);receipt.boot=previousBoot;receipt.commandDigest=digest(commandText);
  const observation=await readFile(join(dir,'history-observation.json'),'utf8').then(text=>JSON.parse(text),()=>undefined),close=await readFile(join(dir,'normal-close.json'),'utf8').then(text=>JSON.parse(text),()=>undefined);
  if(observation){observation.boot=previousBoot;observation.commandDigest=receipt.commandDigest;const text=JSON.stringify(observation);receipt.observationDigest=digest(text);retained.set(join(dir,'history-observation.json'),text);}
  if(close){close.boot=previousBoot;close.observationDigest=receipt.observationDigest;const text=JSON.stringify(close);receipt.closeDigest=digest(text);retained.set(join(dir,'normal-close.json'),text);}
  retained.set(join(dir,'command.json'),commandText);retained.set(join(dir,'state.json'),JSON.stringify(receipt));
 }
 for(const [file,text]of retained)await writeFile(file,text);return retained;
}

test('SIMULATED previous boot local admission requires a real current native lifecycle and keeps the complete old custody evidence',async()=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined,session:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 try{
  await normalPiHandoff(f);await crashedLocalHost(f,'bootstrap');const prior=await simulatePreviousBoot(f.custody.root),stateFile=join(f.control,'authority','state.json'),state=JSON.parse(await readFile(stateFile,'utf8')),operation=state.operations[0],owner=operation.localOwner;
  // Explicit synthetic persisted prior-boot admission, not a production kernel
  // override and not an actual machine reboot. The real kernel reader is intact.
  owner.identity.boot=previousBoot;owner.checksum=digest(JSON.stringify([operation.id,operation.producer,operation.kind,owner.origin,owner.enrollmentId,owner.configurationDigest,owner.graphDigest,owner.identity.pid,owner.identity.uid,owner.identity.boot,owner.identity.birth]));await writeFile(stateFile,JSON.stringify(state));
  const custody=new NativeWriterCustody(f.custody.root,{lock:f.lock}),physical=new PhysicalWriterFence({lock:f.lock,custody});restarted=await f.open(physical);const workspaces=new Workspaces(f.workspaces.root,{gitCommandCustody:custody}),fence=restarted.writerFence('host');workspaces.setBackupWriterFence(fence);await workspaces.list();
  await expect(readNativeSourceHandoff({custody,fence:physical})).rejects.toThrow();expect((await restarted.qualification()).state).toBe('unknown');
  const factory=new RpcPiSessionFactory({cwd:f.task.cwd,sessionDir:f.sessions,agentDir:f.agent,nativeCustody:custody,writerFence:fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
  session=await factory.create({sessionId:f.task.id,requireExisting:true});await session.getHistory();await session.stop();session=undefined;await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');
  const result=await restarted.qualifyExisting('awangs',{producer:'host',handoff:await readNativeSourceHandoff({custody,fence:physical}),scopes:[{...f.scopes[0],workspaces}],checkpointRoot:f.checkpointRoot});expect(result.checkpoint.manifest.coverage).toBe('complete');
  const after=JSON.parse(await readFile(stateFile,'utf8')),receipt=JSON.parse(await readFile(join(f.control,'authority','reconciliations',after.enrollment.reconciliation.id+'.json'),'utf8'));
  expect(receipt.operations[0].death.kind).toBe('boot-changed');expect(receipt.handoffKernelBoot).toBe((await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim());expect(receipt.priorBootReceiptDigest).toMatch(/^[a-f0-9]{64}$/);expect(after.operations).toEqual([]);
  for(const [file,text]of prior)expect(await readFile(file,'utf8')).toBe(text);
 }finally{await session?.stop();await restarted?.close();await f.cleanup();}
},40000);


test('repeated prequalification crashes retain and reconcile each separately owned local operation',async()=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined;try{
  await normalPiHandoff(f);await crashedLocalHost(f,'bootstrap');await crashedLocalHost(f,'restart-startup','interrupted-local-second');
  const current=await reopen(f);restarted=current.authority;await restarted.qualifyExisting('awangs',current.options);const state=JSON.parse(await readFile(join(f.control,'authority','state.json'),'utf8')),receipt=JSON.parse(await readFile(join(f.control,'authority','reconciliations',state.enrollment.reconciliation.id+'.json'),'utf8'));
  expect(receipt.operations.map((operation:{id:string})=>operation.id)).toEqual(['interrupted-local','interrupted-local-second']);expect(state.operations).toEqual([]);expect((await restarted.qualification()).state).toBe('qualified');
 }finally{await restarted?.close();await f.cleanup();}
},40000);

test('a writer during local reconciliation preserves the old pending operation and a later retry captures the new ordinary work',async()=>{
 const f=await existingPi();let restarted:TrustedSourceAuthority|undefined,resume!:()=>void;const gate=new Promise<void>(resolve=>resume=resolve);try{
  await normalPiHandoff(f);await crashedLocalHost(f,'bootstrap');const current=await reopen(f);restarted=current.authority;const workspaces=current.options.scopes[0].workspaces,list=workspaces.list.bind(workspaces);let started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  workspaces.list=async()=>{const result=await list();started();await gate;return result;};const attempting=restarted.qualifyExisting('awangs',current.options).then(value=>({value}),error=>({error}));await ready;
  await restarted.runWriter('host','new-work',()=>writeFile(join(f.task.cwd,'note'),'new work wins'));resume();expect(await attempting).toHaveProperty('error');const before=JSON.parse(await readFile(join(f.control,'authority','state.json'),'utf8'));expect(before.operations.map((operation:{id:string})=>operation.id)).toEqual(['interrupted-local']);
  const result=await restarted.qualifyExisting('awangs',current.options),workspace=result.checkpoint.manifest.sources.find(source=>source.recoveryKey==='workspace')!;expect(await readFile(join(result.checkpoint.directory,'objects',workspace.id,'note'),'utf8')).toBe('new work wins');expect((await restarted.qualification()).state).toBe('qualified');
 }finally{resume();await restarted?.close();await f.cleanup();}
},40000);
