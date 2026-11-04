import {it,expect} from 'vitest';
import {readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {existingPi,normalPiHandoff} from './trusted-native-enrollment-fixture.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';

it('qualifies an intact empty restore destination after last native loss without qualifying source or clearing its journal',async()=>{
 const f=await existingPi();let reopened:Awaited<ReturnType<typeof f.open>>|undefined;
 try{
  await f.authority.enrollExisting('awangs',{producer:'host',handoff:await normalPiHandoff(f),scopes:f.scopes,checkpointRoot:f.checkpointRoot});
  await f.authority.close();await rm(f.stored.getSessionFile()!);
  const custody=new NativeWriterCustody(f.custody.root,{lock:f.lock}),physical=new PhysicalWriterFence({lock:f.lock,custody});reopened=await f.open(physical);
  const before=await readFile(join(f.control,'authority','state.json'),'utf8');
  const lease=await reopened.destinationLease({actor:'awangs',scope:'awangs',operationId:'11111111-1111-4111-8111-111111111111',revision:1,mode:'missing-only',digest:'a'.repeat(64)},[f.source]);
  try{lease.assertValid();expect(lease.publicationFd).toBeTypeOf('number');expect((await reopened.qualification()).state).toBe('unknown');await expect(reopened.capture()).rejects.toMatchObject({code:'writers_unknown'});}finally{lease.release();}
  expect(await readFile(join(f.control,'authority','state.json'),'utf8')).toBe(before);
 }finally{await reopened?.close();await f.cleanup();}
},30000);

import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {TrustedSourceAuthority} from '../src/host/trusted-source-authority.js';

it('a genuinely fresh destination publishes under actual EX without fabricated native history, but a lost allocation marker refuses',async()=>{
 const root=await mkdtemp(join(tmpdir(),'fresh-destination-')),source=join(root,'source'),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),physical=new PhysicalWriterFence({lock,custody}),configuration=join(root,'configuration.json'),graph=join(root,'graph.json');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'fresh',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'source',path:source}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});await writeFile(graph,JSON.stringify({schema:1,groupId:'fresh',roots:[{id:'source',scope:'awangs',engine:'pi'}]}),{mode:0o600});
 const authority=await TrustedSourceAuthority.open({root:join(root,'authority'),configuration,graph,fence:physical,authorize:async actor=>actor==='awangs'}),context={actor:'awangs',scope:'awangs',operationId:'22222222-2222-4222-8222-222222222222',revision:1,mode:'missing-only' as const,digest:'b'.repeat(64)};
 try{await authority.enrollFresh('awangs',[{id:'host',pid:process.pid}]);expect((await custody.state()).state).toBe('unknown');const cut=await authority.destinationLease(context,[source]);try{cut.assertValid();expect(cut.publicationFd).toBeTypeOf('number');await expect(authority.capture()).rejects.toMatchObject({code:'writers_unknown'});}finally{cut.release();}
  await expect(physical.destinationLease({} as import('../src/host/trusted-source-authority.js').FreshDestinationToken,true)).rejects.toThrow();
  const marker=join(custody.root,'allocation.json'),original=await readFile(marker,'utf8');await writeFile(marker,original.replace('false','true'));await expect(authority.destinationLease(context,[source])).rejects.toThrow();await writeFile(marker,original);
  await custody.prepare({executable:process.execPath,args:['-e','process.exit(0)']});
  for(const name of await readdir(custody.root))if(!['group-lock.json','allocation.json'].includes(name))await rm(join(custody.root,name),{recursive:true});
  await expect(authority.destinationLease(context,[source])).rejects.toThrow();
  await rm(marker);await expect(authority.destinationLease(context,[source])).rejects.toThrow();
 }finally{await authority.close();await rm(root,{recursive:true,force:true});}
});

import {readdir} from 'node:fs/promises';
import {crashedLocalHost} from './trusted-native-enrollment-fixture.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';

it('retains the exact dead local journal while destination publication is possible and refuses delegated or revoked authority',async()=>{
 let allowed=true;const f=await existingPi({authorize:async actor=>allowed&&actor==='awangs'});let authority:TrustedSourceAuthority|undefined;
 try{
  await normalPiHandoff(f);await crashedLocalHost(f,'qualified');
  const custody=new NativeWriterCustody(f.custody.root,{lock:f.lock}),physical=new PhysicalWriterFence({lock:f.lock,custody});authority=await f.open(physical);await rm(f.stored.getSessionFile()!);
  const statePath=join(f.control,'authority','state.json'),before=await readFile(statePath,'utf8'),context={actor:'awangs',scope:'awangs',operationId:'33333333-3333-4333-8333-333333333333',revision:1,mode:'missing-only' as const,digest:'c'.repeat(64)};
  const lease=await authority.destinationLease(context,[f.source]);try{expect(acquireFileLease(f.lock,'shared')).toBeUndefined();lease.assertValid();}finally{lease.release();}
  expect(await readFile(statePath,'utf8')).toBe(before);expect(JSON.parse(before).operations).toHaveLength(1);expect((await authority.qualification()).state).toBe('unknown');
  const receipts=await readdir(join(f.control,'authority','destinations'));expect(receipts).toHaveLength(1);const receipt=JSON.parse(await readFile(join(f.control,'authority','destinations',receipts[0]),'utf8'));expect(receipt).toMatchObject({...context,resolutions:[{id:'interrupted-local',death:{kind:'process-exited'}}]});
  allowed=false;await expect(authority.destinationLease(context,[f.source])).rejects.toThrow();allowed=true;
  await expect(authority.destinationLease({...context,scope:'bob'},[f.source])).rejects.toThrow();
  await authority.invalidateCoverage('untracked-delegation');await expect(authority.destinationLease(context,[f.source])).rejects.toThrow();
 }finally{await authority?.close();await f.cleanup();}
},30000);

import {rename} from 'node:fs/promises';
it.each(['live-local','opaque-delegation','configuration-drift','root-replaced','final-authorization'] as const)('destination refuses %s without clearing source operations or leaking its cut',async kind=>{
 let calls=0,revoke=false;const f=await existingPi({authorize:async actor=>actor==='awangs'&&(!revoke||++calls<2)});let release:(()=>void)|undefined,job:Promise<unknown>|undefined;
 try{
  await f.authority.enrollExisting('awangs',{producer:'host',handoff:await normalPiHandoff(f),scopes:f.scopes,checkpointRoot:f.checkpointRoot});await rm(f.stored.getSessionFile()!);
  const context={actor:'awangs',scope:'awangs',operationId:'44444444-4444-4444-8444-444444444444',revision:1,mode:'missing-only' as const,digest:'d'.repeat(64)};
  if(kind==='live-local'){let ready!:()=>void;const entered=new Promise<void>(resolve=>ready=resolve);job=f.authority.runWriter('host','still-live',async()=>{ready();await new Promise<void>(resolve=>release=resolve);});await entered;}
  if(kind==='opaque-delegation')await f.authority.runDelegated('host','acceptance-lost',async()=>{throw Error('Synthetic remote acceptance loss');}).catch(()=>{});
  if(kind==='configuration-drift'){const value=JSON.parse(await readFile(f.configuration,'utf8'));value.groupId='changed';await writeFile(f.configuration,JSON.stringify(value));}
  if(kind==='root-replaced'){await rename(f.source,f.source+'-old');await mkdir(f.source,{mode:0o700});}
  if(kind==='final-authorization')revoke=true;
  const before=await readFile(join(f.control,'authority','state.json'),'utf8');await expect(f.authority.destinationLease(context,[f.source])).rejects.toThrow();expect(await readFile(join(f.control,'authority','state.json'),'utf8')).toBe(before);
  if(kind==='final-authorization'){expect(calls).toBe(2);const cut=acquireFileLease(f.lock,'exclusive');expect(cut).toBeDefined();cut?.release();await expect(readdir(join(f.control,'authority','destinations'))).rejects.toMatchObject({code:'ENOENT'});}
 }finally{release?.();await job;if(kind==='root-replaced'){await rm(f.source,{recursive:true});await rename(f.source+'-old',f.source);}await f.cleanup();}
},30000);
