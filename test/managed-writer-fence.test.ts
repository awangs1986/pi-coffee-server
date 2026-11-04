import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {ManagedWriterFence} from '../src/host/managed-writer-fence.js';
import {ManagedLaunchPolicy} from '../src/host/managed-launch-policy.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';

it('new platform work atomically revokes and unlocks a managed cut before mutation, while unrestricted launches are refused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-cut-gate-')),broker=join(root,'broker'),data=join(root,'data');await mkdir(broker,{mode:0o700});await mkdir(data);const lock=join(broker,'group.lock'),custody=new ManagedNativeCustody(join(broker,'custody'),{lock,sourceParent:root,sources:[{path:data,destination:'/coffee/source'}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:'/coffee/source',PATH:'/usr/bin:/bin'},cwd:'/coffee/source'}),fence=new ManagedWriterFence({lock,custody});
 try{await expect(fence.lease()).rejects.toThrow();const launch=await custody.prepare({executable:process.execPath,args:['-e','']}),native=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'});await once(native,'exit');await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');
  const cut=await fence.lease();expect(acquireFileLease(lock,'shared')).toBeUndefined();cut.assertValid();const release=fence.beginWriter('platform');expect(()=>cut.assertValid()).toThrow();expect(cut.signal.aborted).toBe(true);const reader=acquireFileLease(lock,'shared');expect(reader).toBeDefined();reader!.release();expect(acquireFileLease(lock,'exclusive')).toBeUndefined();release();cut.release();const next=await fence.lease();next.assertValid();next.release();expect(()=>fence.beginWriter('unmanaged-native')).toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},15000);

it('enrollment blocks future legacy launches immediately and waits for natural or unknown native lifetimes',()=>{
 const gate=new ManagedLaunchPolicy(),active=gate.beginLegacyLifetime();expect(gate.requestProtectedOnly()).toMatchObject({admission:'draining',legacy:'active'});expect(()=>gate.beginLegacyLifetime()).toThrow();expect(()=>gate.assertProtectedOnly()).toThrow();active.naturalExit();expect(gate.assertProtectedOnly()).toMatchObject({admission:'protected-only',legacy:'drained'});
 const unknown=new ManagedLaunchPolicy(),lost=unknown.beginLegacyLifetime();lost.lostCustody();expect(unknown.requestProtectedOnly()).toMatchObject({admission:'draining',legacy:'unknown'});expect(()=>unknown.assertProtectedOnly()).toThrow();
});

it('publication retains its physical group authority until settling and refuses new writers before they can revoke it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'managed-publish-gate-')),broker=join(root,'broker'),data=join(root,'data');await mkdir(broker,{mode:0o700});await mkdir(data);const lock=join(broker,'group.lock'),custody=new ManagedNativeCustody(join(broker,'custody'),{lock,sourceParent:root,sources:[{path:data,destination:'/coffee/source'}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:'/coffee/source',PATH:'/usr/bin:/bin'},cwd:'/coffee/source'}),fence=new ManagedWriterFence({lock,custody});
 try{const launch=await custody.prepare({executable:process.execPath,args:['-e','']}),native=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'});await once(native,'exit');await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');const publication=await fence.publicationLease();expect(()=>fence.beginWriter('platform')).toThrow();expect(()=>fence.beginWriter('native')).toThrow();publication.assertValid();expect(acquireFileLease(lock,'shared')).toBeUndefined();fence.invalidate('Logical source change');expect(()=>publication.assertValid()).toThrow();expect(acquireFileLease(lock,'shared')).toBeUndefined();publication.release();const writer=fence.beginWriter('native');writer();
 }finally{await rm(root,{recursive:true,force:true});}
},15000);
