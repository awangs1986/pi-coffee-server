import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';
import {TrustedSealedCheckpointSource,type SealedSourceAudit} from '../src/host/trusted-sealed-source.js';

async function identity(pid:number){const raw=await readFile('/proc/'+pid+'/stat','utf8');return {pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function fixture(audit?:(event:SealedSourceAudit)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'sealed-export-')),ipc=await mkdtemp('/tmp/sealed-ipc-'),live=join(root,'live'),disk=join(root,'disk'),privateRoot=join(root,'private');for(const path of [live,disk,privateRoot])await mkdir(path,{mode:0o700});
 const keyPolicy=join(root,'key-policy.json'),sourcePolicy=join(root,'source-policy.json'),keyConfig=join(root,'key.json'),socket=join(ipc,'key.sock'),sourceSocket=join(ipc,'source.sock');
 const policy={schema:1,revision:7,administrator:'awangs',scopes:['awangs','bob'],actors:{awangs:{role:'administrator',scopes:['awangs','bob']},bob:{role:'reader',scopes:['bob']}},hostClients:[await identity(process.pid)]};await writeFile(keyPolicy,JSON.stringify(policy),{mode:0o600});
 const command=[process.execPath,resolve('dist/src/backup-key-worker.js'),keyConfig];await writeFile(keyConfig,JSON.stringify({schema:1,trustModel:'host-root',socket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot,authorityFile:keyPolicy,sourceSocket,binary:process.env.PI_COFFEE_TEST_RESTIC!,destination:disk,node:command[0],handler:command[1],responseLimit:64*1024*1024}),{mode:0o600});
 const worker=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',keyConfig],{stdio:['ignore','ignore','pipe']});await expect.poll(()=>stat(socket).then(()=>true,()=>false)).toBe(true);
 const grant={...policy,sourceProducers:[{listener:await identity(worker.pid!),workerCommand:command}]};await writeFile(sourcePolicy,JSON.stringify(grant),{mode:0o600});let now=Date.parse('2026-10-29T08:00:00Z');const fence=new WriterAdmissionFence({writerClasses:['synthetic'],uncoveredWriters:[],probe:async()=>({known:true})});
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>now,adapter:{version:'synthetic-source-export-v1',resolve:async()=>({groupId:'synthetic',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['fixture-native']}],sources:[{id:'workspace',role:'workspace',recoveryKey:'workspace',path:live},{id:'native',role:'native',recoveryKey:'native',data:Buffer.from('synthetic history')},{id:'registry',role:'registry',recoveryKey:'registry',data:Buffer.from('{}')},{id:'task-data',role:'task-data',recoveryKey:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
 await writeFile(join(live,'draft'),'original sealed bytes');await coordinator.capture('awangs','task','pi');const first=(await coordinator.sealedCheckpoint('awangs','task'))!;now+=60000;await fence.runWriter('synthetic',()=>writeFile(join(live,'draft'),'newer sealed bytes'));await coordinator.capture('awangs','task','pi');const second=(await coordinator.sealedCheckpoint('awangs','task'))!;
 const source=new TrustedSealedCheckpointSource({socket:sourceSocket,policyFile:sourcePolicy,coordinator:new BackupCoordinator({root:join(root,'checkpoints')}),audit});await source.listen();await chmod(sourceSocket,0o600);
 const client=new BackupRepositoryClient({socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'awangs',authorityRevision:7});
 return {root,ipc,live,disk,privateRoot,keyPolicy,sourcePolicy,grant,worker,source,sourceSocket,client,first,second,fence,close:async()=>{await source.close();if(worker.exitCode===null){worker.kill('SIGTERM');await once(worker,'exit');}await rm(root,{recursive:true,force:true});await rm(ipc,{recursive:true,force:true});}};
}
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('a delegated transient key worker exports the exact older seal through real IPC and Restic despite newer or busy live source',async()=>{
 const f=await fixture();const release=f.fence.beginWriter('synthetic');try{
  expect(f.first.manifest.checkpointId).not.toBe(f.second.manifest.checkpointId);await writeFile(join(f.live,'draft'),'active live changes');await f.client.configure();await f.client.verifyRecoveryPackage(await f.client.exportRecoveryPackage());
  const job=await f.client.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}]);expect(job.state).toBe('succeeded');expect(job.points[0].checkpointId).toBe(f.first.manifest.checkpointId);
  const restored=join(f.root,'restored');await f.client.extract(job.id,restored);expect(await readFile(join(restored,f.first.manifest.checkpointId,'objects','workspace','draft'),'utf8')).toBe('original sealed bytes');
 }finally{release();await f.close();}
},150000);
