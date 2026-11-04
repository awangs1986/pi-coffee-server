import {it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence,isPhysicalPublicationLease} from '../src/host/physical-writer-fence.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';

async function fixture(){const root=await mkdtemp(join(tmpdir(),'physical-cut-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});return {root,lock,custody,fence};}
async function launch(custody:NativeWriterCustody,code=''){const prepared=await custody.prepare({executable:process.execPath,args:['-e',code]}),child=spawn(process.execPath,[prepared.cliPath],{env:{...process.env,...prepared.env},stdio:'ignore'});return {prepared,child,exited:once(child,'exit')};}

it('ordinary writer admission revokes capture before a native side effect and preserves exact physical publication capability',async()=>{
 const f=await fixture();try{
  await expect(f.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});const warm=await launch(f.custody);expect((await warm.exited)[0]).toBe(0);const cut=await f.fence.lease();cut.assertValid();
  const release=f.fence.beginWriter('native');expect(cut.signal.aborted).toBe(true);expect(()=>cut.assertValid()).toThrow();const marker=join(f.root,'ordinary-write'),native=await launch(f.custody,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'unchanged tool command')`);expect((await native.exited)[0]).toBe(0);release();expect(await readFile(marker,'utf8')).toBe('unchanged tool command');cut.release();
  const publication=await f.fence.publicationLease();expect(isPhysicalPublicationLease(publication)).toBe(true);expect(()=>f.fence.beginWriter('native')).toThrow();expect(acquireFileLease(f.lock,'shared')).toBeUndefined();
  const peer=new PhysicalWriterFence({lock:f.lock,custody:f.custody});await expect(peer.runRecoveryPublication({operationId:'operation',digest:'digest',lease:publication},async()=>{})).rejects.toMatchObject({code:'recovery_publication_required'});await expect(f.fence.runRecoveryPublication({operationId:'operation',digest:'digest',lease:{...publication}},async()=>{})).rejects.toMatchObject({code:'recovery_publication_required'});
  await f.fence.runRecoveryPublication({operationId:'operation',digest:'digest',lease:publication},async()=>writeFile(marker,'approved publication'));f.fence.invalidate('source revision changed');expect(()=>publication.assertValid()).toThrow();expect(acquireFileLease(f.lock,'shared')).toBeUndefined();publication.release();expect(isPhysicalPublicationLease(publication)).toBe(false);const next=f.fence.beginWriter('platform');next();
  // Unknown writer types remain executable; their coverage is unknown, never a
  // permissions restriction or implicit enrollment in this source group.
  const unsupported=f.fence.beginWriter('external-delegation');unsupported();await expect(f.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});
 }finally{await rm(f.root,{recursive:true,force:true});}
},15000);

it('prepared launch, lost custodian and a reboot receipt remain unknown even when the kernel lock is obtainable',async()=>{
 const f=await fixture();let child:ReturnType<typeof spawn>|undefined;const release=join(f.root,'release'),stopped=join(f.root,'stopped');try{
  const native=await launch(f.custody,`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(join(f.root,'supervisor'))},String(process.ppid));const end=Date.now()+5000;const timer=setInterval(()=>{if(Date.now()>end||fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);fs.writeFileSync(${JSON.stringify(stopped)},'done');}},20);`);child=native.child;
  await expect.poll(async()=>Number(await readFile(join(f.root,'supervisor'),'utf8').catch(()=>0))).toBeGreaterThan(1);process.kill(Number(await readFile(join(f.root,'supervisor'),'utf8')),'SIGKILL');await native.exited;expect(await f.custody.state()).toMatchObject({state:'unknown'});const raw=acquireFileLease(f.lock,'exclusive');expect(raw).toBeDefined();raw!.release();await expect(f.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});await writeFile(release,'done');await expect.poll(async()=>readFile(stopped,'utf8').catch(()=>''),{timeout:6000}).toBe('done');expect(await f.custody.state()).toMatchObject({state:'unknown'});
 }finally{await writeFile(release,'done');if(child?.exitCode===null)await once(child,'exit');await rm(f.root,{recursive:true,force:true});}
 const prepared=await fixture();try{await prepared.custody.prepare({executable:'/bin/true'});expect(await prepared.custody.state()).toMatchObject({state:'unknown'});await expect(prepared.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});}finally{await rm(prepared.root,{recursive:true,force:true});}
 const reboot=await fixture();try{const native=await launch(reboot.custody);await native.exited;const path=join(native.prepared.env.PI_COFFEE_CUSTODY_DIR,'state.json'),receipt=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify({...receipt,boot:'prior-boot'}));await expect(reboot.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});}finally{await rm(reboot.root,{recursive:true,force:true});}
},20000);

it('a different lock or a replaced lock inode cannot be presented as the original source cut',async()=>{
 const f=await fixture();try{expect(()=>new PhysicalWriterFence({lock:join(f.root,'other.lock'),custody:f.custody})).toThrow('Source group lock mismatch');const native=await launch(f.custody);await native.exited;await rename(f.lock,f.lock+'.old');await writeFile(f.lock,'',{mode:0o600});expect(await f.custody.state()).toMatchObject({state:'unknown'});await expect(f.fence.lease()).rejects.toThrow();expect(()=>f.fence.beginWriter('native')).toThrow();await expect(f.custody.prepare({executable:'/bin/true'})).rejects.toThrow();}finally{await rm(f.root,{recursive:true,force:true});}
});
