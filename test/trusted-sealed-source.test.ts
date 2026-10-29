import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {backupPeerFrames} from '../src/host/backup-peer-client.js';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';
import {TrustedSealedCheckpointSource,type SealedSourceAudit} from '../src/host/trusted-sealed-source.js';

async function identity(pid:number){const raw=await readFile('/proc/'+pid+'/stat','utf8');return {pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function fixture(audit?:(event:SealedSourceAudit)=>Promise<void>,mixed=false,limits:{maxConcurrent?:number;timeoutMs?:number;maxBytes?:number}={}){
 const root=await mkdtemp(join(tmpdir(),'sealed-export-')),ipc=await mkdtemp('/tmp/sealed-ipc-'),live=join(root,'live'),disk=join(root,'disk'),privateRoot=join(root,'private');for(const path of [live,disk,privateRoot])await mkdir(path,{mode:0o700});
 const keyPolicy=join(root,'key-policy.json'),sourcePolicy=join(root,'source-policy.json'),keyConfig=join(root,'key.json'),socket=join(ipc,'key.sock'),sourceSocket=join(ipc,'source.sock');
 const policy={schema:1,revision:7,administrator:'awangs',scopes:['awangs','bob'],actors:{awangs:{role:'administrator',scopes:['awangs','bob']},bob:{role:'reader',scopes:['bob']}},hostClients:[await identity(process.pid)]};await writeFile(keyPolicy,JSON.stringify(policy),{mode:0o600});
 const command=[process.execPath,resolve('dist/src/backup-key-worker.js'),keyConfig];await writeFile(keyConfig,JSON.stringify({schema:1,trustModel:'host-root',socket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot,authorityFile:keyPolicy,sourceSocket,binary:process.env.PI_COFFEE_TEST_RESTIC!,destination:disk,node:command[0],handler:command[1],responseLimit:64*1024*1024}),{mode:0o600});
 const worker=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',keyConfig],{stdio:['ignore','ignore','pipe']});await expect.poll(()=>stat(socket).then(()=>true,()=>false)).toBe(true);
 const grant={...policy,sourceProducers:[{listener:await identity(worker.pid!),workerCommand:command}]};await writeFile(sourcePolicy,JSON.stringify(grant),{mode:0o600});let now=Date.parse('2026-10-29T08:00:00Z');const fence=new WriterAdmissionFence({writerClasses:['synthetic'],uncoveredWriters:[],probe:async()=>({known:true})});
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>now,adapter:{version:'synthetic-source-export-v1',resolve:async()=>({groupId:'synthetic',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['fixture-native']},...mixed?[{scope:'bob',taskId:'related',engine:'codex' as const,nativeBindings:['fixture-related']}]:[]],sources:[{id:'workspace',role:'workspace',recoveryKey:'workspace',path:live},{id:'native',role:'native',recoveryKey:'native',data:Buffer.from('synthetic history')},{id:'registry',role:'registry',recoveryKey:'registry',data:Buffer.from('{}')},{id:'task-data',role:'task-data',recoveryKey:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
 await writeFile(join(live,'draft'),'original sealed bytes');await coordinator.capture('awangs','task','pi');const first=(await coordinator.sealedCheckpoint('awangs','task'))!;now+=60000;await fence.runWriter('synthetic',()=>writeFile(join(live,'draft'),'newer sealed bytes'));await coordinator.capture('awangs','task','pi');const second=(await coordinator.sealedCheckpoint('awangs','task'))!;
 const source=new TrustedSealedCheckpointSource({socket:sourceSocket,policyFile:sourcePolicy,coordinator:new BackupCoordinator({root:join(root,'checkpoints')}),audit,...limits});await source.listen();await chmod(sourceSocket,0o600);
 const client=new BackupRepositoryClient({socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'awangs',authorityRevision:7});
 return {root,ipc,live,disk,privateRoot,keyPolicy,sourcePolicy,grant,worker,source,sourceSocket,client,first,second,fence,close:async()=>{await source.close();if(worker.exitCode===null&&worker.signalCode===null){worker.kill('SIGTERM');await once(worker,'exit');}await rm(root,{recursive:true,force:true});await rm(ipc,{recursive:true,force:true});}};
}
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('a delegated transient key worker exports the exact older seal through real IPC and Restic despite newer or busy live source',async()=>{
 const f=await fixture();const release=f.fence.beginWriter('synthetic');try{
  expect(f.first.manifest.checkpointId).not.toBe(f.second.manifest.checkpointId);await writeFile(join(f.live,'draft'),'active live changes');await f.client.configure();await f.client.verifyRecoveryPackage(await f.client.exportRecoveryPackage());
  const job=await f.client.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}]);expect(job.state).toBe('succeeded');expect(job.points[0].checkpointId).toBe(f.first.manifest.checkpointId);
  const restored=join(f.root,'restored');await f.client.extract(job.id,restored);expect(await readFile(join(restored,f.first.manifest.checkpointId,'objects','workspace','draft'),'utf8')).toBe('original sealed bytes');
 }finally{release();await f.close();}
},150000);

const actual=it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC);
async function activate(f:Awaited<ReturnType<typeof fixture>>){await f.client.configure();await f.client.verifyRecoveryPackage(await f.client.exportRecoveryPackage());}
actual('same-UID direct callers cannot impersonate the delegated key producer by claiming the administrator',async()=>{
 const events:SealedSourceAudit[]=[],f=await fixture(async event=>{events.push(event);});try{
  const frames=[];for await(const frame of backupPeerFrames({socket:f.sourceSocket,serviceUid:process.getuid!(),request:{schema:1,id:randomUUID(),operation:'export-checkpoint',context:{actor:'awangs',dataScope:'awangs',authorityRevision:7},scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}}))frames.push(frame);
  expect(frames).toEqual([{schema:1,error:{code:'source_producer_not_enrolled'}}]);expect(events.some(event=>event.event==='started')).toBe(false);
 }finally{await f.close();}
},30000);
actual('current producer, actor, revision and complete member grants gate actual key-worker exports',async()=>{
 const events:SealedSourceAudit[]=[],f=await fixture(async event=>{events.push(event);},true);try{
  await activate(f);
  const cases=[
   {code:'source_producer_not_enrolled',change:async(p:typeof f.grant)=>{p.sourceProducers[0].listener=await identity(process.pid);}},
   {code:'source_producer_not_enrolled',change:async(p:typeof f.grant)=>{p.sourceProducers[0].listener.birth='0';}},
   {code:'source_producer_not_enrolled',change:async(p:typeof f.grant)=>{p.sourceProducers[0].listener.boot='00000000-0000-0000-0000-000000000000';}},
   {code:'source_producer_not_enrolled',change:async(p:typeof f.grant)=>{p.sourceProducers[0].workerCommand[1]+='.wrong';}},
   {code:'source_authority_stale',change:async(p:typeof f.grant)=>{p.revision++;}},
   {code:'source_administrator_required',change:async(p:typeof f.grant)=>{p.actors.awangs.role='reader';}},
   {code:'source_scope_denied',change:async(p:typeof f.grant)=>{p.actors.awangs.scopes=['bob'];}},
   {code:'source_scope_denied',change:async(p:typeof f.grant)=>{p.actors.awangs.scopes=['awangs'];}},
  ];
  for(const candidate of cases){events.length=0;const policy=structuredClone(f.grant);await candidate.change(policy);await writeFile(f.sourcePolicy,JSON.stringify(policy));
   await expect(f.client.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}])).rejects.toThrow('source_transfer_invalid');
   expect(events.at(-1)?.code).toBe(candidate.code);expect(events.some(event=>event.event==='completed')).toBe(false);
  }
  expect(await f.client.jobs()).toEqual([]);
 }finally{await f.close();}
},150000);
actual('missing ID, wrong task, wrong member scope and damaged named old points never fall forward to the newer seal',async()=>{
 const events:SealedSourceAudit[]=[],f=await fixture(async event=>{events.push(event);});try{
  await activate(f);
  for(const selection of [
   {scope:'awangs',taskId:'task',expectedCheckpointId:randomUUID()},
   {scope:'awangs',taskId:'missing',expectedCheckpointId:f.first.manifest.checkpointId},
   {scope:'bob',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}
  ]){events.length=0;await expect(f.client.backup([selection])).rejects.toThrow('source_transfer_invalid');expect(events.at(-1)?.code).toBe('source_checkpoint_unavailable');}
  await chmod(join(f.first.directory,'objects','workspace','draft'),0o600);await writeFile(join(f.first.directory,'objects','workspace','draft'),'damaged');
  await expect(f.client.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}])).rejects.toThrow('source_transfer_invalid');
  expect(events.some(event=>event.event==='completed')).toBe(false);expect(await f.client.jobs()).toEqual([]);
 }finally{await f.close();}
},90000);
actual.each(['actor-revoked','parent-died','source-closed'] as const)('a stream interrupted after its first actual chunk (%s) cannot publish a successful repository point',async failure=>{
 const events:SealedSourceAudit[]=[];let interrupted=false;const f=await fixture(async event=>{events.push(event);if(event.event==='progress'&&!interrupted){interrupted=true;
  if(failure==='actor-revoked'){const p=structuredClone(f.grant);p.actors.awangs.role='reader';await writeFile(f.sourcePolicy,JSON.stringify(p));}
  else if(failure==='parent-died'){f.worker.kill('SIGTERM');await once(f.worker,'exit');}
  else await f.source.close();
 }});try{await activate(f);await expect(f.client.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}])).rejects.toThrow();expect(interrupted).toBe(true);expect(events.some(event=>event.event==='completed')).toBe(false);
  if(failure!=='parent-died')expect(await f.client.jobs()).toEqual([]);
  else {const worker=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',join(f.root,'key.json')],{stdio:'ignore'});try{await expect.poll(()=>stat(join(f.ipc,'key.sock')).then(()=>true,()=>false)).toBe(true);expect(await f.client.jobs()).toEqual([]);}finally{worker.kill('SIGTERM');await once(worker,'exit');}}
 }finally{await f.close();}
},90000);
actual('explicitly enrolled CLI run carries --checkpoint-id and restores that older point; missing ID fails before submission',async()=>{
 const f=await fixture();try{
  await activate(f);const profile=join(f.root,'cli-profile.json'),gate=join(f.root,'cli-gate'),preload=join(f.root,'enrollment-gate.mjs');
  await writeFile(profile,JSON.stringify({schema:1,socket:join(f.ipc,'key.sock'),serviceUid:process.getuid!(),actor:'awangs',dataScope:'awangs',authorityRevision:7}),{mode:0o600});
  await writeFile(preload,"import {access} from 'node:fs/promises';import {setTimeout} from 'node:timers/promises';const deadline=Date.now()+10000;while(!(await access("+JSON.stringify(gate)+").then(()=>true,()=>false))){if(Date.now()>deadline)throw Error('enrollment gate timeout');await setTimeout(10);}");
  const run=async(exact:boolean)=>{await rm(gate,{force:true});const child=spawn(process.execPath,['--import',preload,resolve('dist/src/backup-cli.js'),'run','--root',f.root,'--broker-profile',profile,'--scope','awangs','--task','task',...exact?['--checkpoint-id',f.first.manifest.checkpointId]:[]],{stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);const exited=once(child,'exit');
   const policy=JSON.parse(await readFile(f.keyPolicy,'utf8'));policy.hostClients.push(await identity(child.pid!));await writeFile(f.keyPolicy,JSON.stringify(policy));await writeFile(gate,'enrolled');const [code]=await exited;return {code,output,errors};
  };
  expect(await run(false)).toEqual({code:1,output:'',errors:'{"error":"invalid_cli_request"}\n'});expect(await f.client.jobs()).toEqual([]);
  const result=await run(true);expect(result.errors).toBe('');expect(result.code).toBe(0);const job=JSON.parse(result.output);expect(job.state).toBe('succeeded');expect(job.points[0].checkpointId).toBe(f.first.manifest.checkpointId);
  const restored=join(f.root,'cli-restore');await f.client.extract(job.id,restored);expect(await readFile(join(restored,f.first.manifest.checkpointId,'objects','workspace','draft'),'utf8')).toBe('original sealed bytes');
 }finally{await f.close();}
},90000);

actual('idle connections have a bounded deadline, excess concurrency is rejected, and close releases pending readers',async()=>{
 const f=await fixture(undefined,false,{maxConcurrent:1,timeoutMs:500});try{
  const idle=createConnection(f.sourceSocket);idle.on('error',()=>undefined);await once(idle,'connect');idle.write('{');const ended=new Promise<void>(resolve=>idle.once('close',()=>resolve()));
  const second=createConnection(f.sourceSocket);let response='';second.setEncoding('utf8');second.on('data',data=>response+=data);await once(second,'close');expect(JSON.parse(response)).toEqual({schema:1,error:{code:'source_busy'}});await ended;
  const next=createConnection(f.sourceSocket);next.on('error',()=>undefined);await once(next,'connect');next.write('{');const closed=new Promise<void>(resolve=>next.once('close',()=>resolve()));await f.source.close();await closed;expect(await stat(f.sourceSocket).then(()=>true,()=>false)).toBe(false);
 }finally{await f.close();}
},30000);
actual('configured point byte limit refuses a genuine sealed point before streaming any content',async()=>{
 const events:SealedSourceAudit[]=[],f=await fixture(async event=>{events.push(event);},false,{maxBytes:1});try{await activate(f);await expect(f.client.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:f.first.manifest.checkpointId}])).rejects.toThrow('source_transfer_invalid');expect(events).toEqual([{event:'refused',code:'source_transfer_limit'}]);expect(await f.client.jobs()).toEqual([]);}finally{await f.close();}
},30000);
