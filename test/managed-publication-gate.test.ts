import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ManagedPublicationGate} from '../src/host/managed-publication-gate.js';
import {ManagedNativeCustody} from '../src/host/managed-native.js';
import {ManagedWriterFence} from '../src/host/managed-writer-fence.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';
import {durableJson} from '../src/host/restore-files.js';
import {restorePlanDigest,type RestorePlan} from '../src/host/restore.js';

function approvedPlan():RestorePlan{const plan:RestorePlan={schemaVersion:1,id:randomUUID(),scope:'synthetic-alice',taskId:'task',jobId:randomUUID(),requestedBy:'synthetic-alice',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),state:'approved',phase:'prepared',approvedBy:'synthetic-alice',approvedRevision:1,plan:{conversation:{id:'task',cwd:'/synthetic/task',workspaceKind:'chat',branch:'main',createdAt:new Date().toISOString()},actions:[],expectedRegistry:null,registryDigest:'registry',registryIdentity:{dev:1,ino:2,uid:process.getuid!()},checkpointDirectory:'/synthetic/sealed',warnings:[]}};plan.digest=restorePlanDigest(plan);plan.approvalDigest=plan.digest;return plan;}

it('actual process death releases the kernel lock but a fresh source Host still blocks every writer and native adoption until the same approved job completes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'publication-restart-')),data=join(root,'data'),authority=join(root,'authority'),restoreRoot=join(authority,'restore');await mkdir(data,{mode:0o700});await mkdir(restoreRoot,{recursive:true,mode:0o700});const lock=join(authority,'group.lock'),options={path:join(authority,'publication.json'),groupId:'real-shared-source',restoreRoot};
 const custody=new ManagedNativeCustody(join(authority,'custody'),{sourceParent:root,lock,sources:[{path:data,destination:'/coffee/source'}],runtimeRoots:[dirname(dirname(process.execPath))],environment:{HOME:'/coffee/source',PATH:'/usr/bin:/bin'},cwd:'/coffee/source'});
 const setup=await custody.prepare({executable:process.execPath,args:['-e','']}),native=spawn(process.execPath,[setup.cliPath],{env:{PATH:process.env.PATH,...setup.env},stdio:'ignore'});await once(native,'exit');await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');const plan=approvedPlan(),planPath=join(restoreRoot,plan.id+'.json');await durableJson(planPath,plan);
 const script=`import {ManagedPublicationGate} from ${JSON.stringify(new URL('../dist/src/host/managed-publication-gate.js',import.meta.url).href)};import {acquireFileLease} from ${JSON.stringify(new URL('../dist/src/host/linux-file-lease.js',import.meta.url).href)};import{writeFileSync}from'node:fs';const gate=new ManagedPublicationGate(${JSON.stringify(options)});await gate.withApprovedPublication(${JSON.stringify(plan.id)},async()=>{const lease=acquireFileLease(${JSON.stringify(lock)},'exclusive');if(!lease)process.exit(90);writeFileSync(${JSON.stringify(join(data,'native-partial'))},'first irreversible bytes');process.exit(42);});`;
 try{const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',b=>error+=String(b));const [code]=await once(child,'exit');expect(code,error).toBe(42);const released=acquireFileLease(lock,'shared');expect(released).toBeDefined();released!.release();expect(await readFile(join(data,'native-partial'),'utf8')).toBe('first irreversible bytes');
  const restarted=new ManagedPublicationGate(options),fence=new ManagedWriterFence({lock,custody,publicationGate:restarted}),guardedCustody=new ManagedNativeCustody(join(authority,'guarded-custody'),custody.profile,{publication:restarted});expect(()=>fence.beginWriter('platform')).toThrow();expect(()=>fence.beginWriter('native')).toThrow();await expect(fence.lease()).rejects.toThrow();await expect(fence.publicationLease()).rejects.toThrow();await expect(guardedCustody.prepare({executable:process.execPath})).rejects.toThrow();
  const qualification=await guardedCustody.prepareSourceQualification(),probe=spawn(process.execPath,[qualification.cliPath],{env:{PATH:process.env.PATH,...qualification.env},stdio:'ignore'});expect((await once(probe,'exit'))[0]).toBe(0);await expect.poll(async()=>(await guardedCustody.state()).state).toBe('quiescent');
  const wrong=approvedPlan();await durableJson(join(restoreRoot,wrong.id+'.json'),wrong);await expect(restarted.withApprovedPublication(wrong.id,async()=>{})).rejects.toThrow();await restarted.withApprovedPublication(plan.id,async()=>{const lease=await fence.publicationLease();try{lease.assertValid();expect(()=>fence.beginWriter('native')).toThrow();await writeFile(join(data,'native-partial'),'reconciled complete bytes');plan.phase='complete';plan.state='completed';await durableJson(planPath,plan);}finally{lease.release();}});const release=fence.beginWriter('platform');release();expect(await readFile(join(data,'native-partial'),'utf8')).toBe('reconciled complete bytes');new ManagedPublicationGate(options).assertAdmission();
 }finally{await rm(root,{recursive:true,force:true});}
},15000);

it('restart recovers a durable publishing intent even with no gate record and refuses changed approval or a lost live gate',async()=>{
 const root=await mkdtemp(join(tmpdir(),'publication-intent-')),restoreRoot=join(root,'restore');await mkdir(restoreRoot,{mode:0o700});const plan=approvedPlan();plan.state='publishing';const path=join(restoreRoot,plan.id+'.json');await durableJson(path,plan);const options={path:join(root,'gate.json'),groupId:'shared',restoreRoot};
 try{const gate=new ManagedPublicationGate(options);expect(()=>gate.assertAdmission()).toThrow();await unlink(options.path);expect(()=>gate.assertAdmission()).toThrow();const recovered=new ManagedPublicationGate(options);expect(()=>recovered.assertAdmission()).toThrow();plan.revision++;await durableJson(path,plan);expect(()=>new ManagedPublicationGate(options)).toThrow();}finally{await rm(root,{recursive:true,force:true});}
});
