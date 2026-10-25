import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ManagedLaunchPolicy,LegacyAdmissionFence} from '../src/host/managed-launch-policy.js';
import {AdmissionNativeCustody} from '../src/host/native-custody.js';
import {startManagedAdmissionControl} from '../src/host/managed-source-authority.js';
import {acquireLegacyColdCut,isLegacyColdCut} from '../src/host/legacy-cold-cut.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';
it('authenticated live legacy control retains actual kernel exclusivity and revokes the remote cold cut if its full logical authority is invalidated',async()=>{
 const root=await mkdtemp(join(tmpdir(),'legacy-cold-control-')),control=join(root,'control'),cuts=join(root,'cuts');await mkdir(control,{mode:0o700});const policy=new ManagedLaunchPolicy(),custody=new AdmissionNativeCustody(join(root,'custody'),policy),fence=new LegacyAdmissionFence(policy,{writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:(await custody.state()).state==='quiescent'})}),setup=await custody.prepare({executable:process.execPath,args:['-e','']}),child=spawn(process.execPath,[setup.cliPath],{env:{PATH:process.env.PATH,...setup.env},stdio:'ignore'});await once(child,'exit');await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');const socket=join(control,'admission.sock'),server=await startManagedAdmissionControl({socket,allowedUid:process.getuid!(),policy,custody,writerFence:fence,coldCutRoot:cuts});let lease:Awaited<ReturnType<typeof acquireLegacyColdCut>>|undefined;
 try{lease=await acquireLegacyColdCut(socket,process.getuid!());expect(isLegacyColdCut(lease)).toBe(true);lease.assertValid();expect(acquireFileLease(join(cuts,'cold-export.lock'),'shared')).toBeUndefined();expect(()=>fence.beginWriter('platform')).toThrow();await expect(custody.prepare({executable:process.execPath})).rejects.toThrow();fence.invalidate('Synthetic loss of source authority');await expect.poll(()=>{try{lease!.assertValid();return true;}catch{return false;}},{timeout:5000}).toBe(false);lease.release();await expect.poll(()=>{const available=acquireFileLease(join(cuts,'cold-export.lock'),'shared');if(!available)return false;available.release();return true;}).toBe(true);
 }finally{lease?.release();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},15000);
