import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'trusted-key-')),socket=join(root,'broker.sock'),privateRoot=join(root,'private'),destination=join(root,'disk'),authorityFile=join(root,'policy.json'),config=join(root,'service.json');for(const path of [privateRoot,destination])await mkdir(path,{mode:0o700});
 const raw=await readFile(`/proc/${process.pid}/stat`,'utf8'),identity={pid:process.pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};
 const policy={schema:1,revision:7,administrator:'awangs',scopes:['awangs','bob'],actors:{awangs:{role:'administrator',scopes:['awangs','bob']},bob:{role:'reader',scopes:['bob']}},hostClients:[identity]};
 await writeFile(authorityFile,JSON.stringify(policy),{mode:0o600});await writeFile(config,JSON.stringify({schema:1,trustModel:'host-root',socket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot,authorityFile,sourceSocket:join(root,'source.sock'),binary:process.env.PI_COFFEE_TEST_RESTIC!,destination,handler:resolve('dist/src/backup-key-worker.js'),node:process.execPath}),{mode:0o600});
 const worker=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',config],{stdio:['ignore','ignore','pipe'],env:{...process.env}});let error='';worker.stderr!.on('data',chunk=>error+=chunk);await expect.poll(async()=>{if(worker.exitCode!==null)throw Error('Worker exited: '+error);return stat(socket).then(()=>true,()=>false);}).toBe(true);
 const client=(actor='awangs',dataScope='awangs',revision=7)=>new BackupRepositoryClient({socket,serviceUid:process.getuid!(),actor,dataScope,authorityRevision:revision});
 return {root,socket,privateRoot,destination,authorityFile,policy,config,client,close:async()=>{worker.kill('SIGTERM');await once(worker,'exit');await rm(root,{recursive:true,force:true});}};
}
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('an independently enrolled Host configures and verifies encrypted storage without a managed source or restricted native runtime',async()=>{
 const hostProtection=(await readFile('/proc/self/status','utf8')).match(/^NoNewPrivs:.*$/m)?.[0];const f=await fixture();try{
  const admin=f.client();expect(await admin.qualification()).toMatchObject({state:'qualified',trustModel:'host-root',sourceConsistency:'per-checkpoint'});
  await admin.configure();const before=await admin.status();expect(before).toMatchObject({configured:true,enabled:false});
  const recovery=await admin.exportRecoveryPackage();expect(recovery.length).toBeGreaterThan(100);await admin.verifyRecoveryPackage(recovery);const after=await admin.status();expect(after).toMatchObject({configured:true,enabled:true});
  const parsed=JSON.parse(recovery);expect(typeof parsed.password).toBe('string');expect(parsed.password.length).toBeGreaterThan(32);const audit=await readFile(join(f.privateRoot,'broker-audit.jsonl'),'utf8');for(const secret of [parsed.password,parsed.secret,parsed.key].filter(value=>typeof value==='string')){expect(JSON.stringify(after)).not.toContain(secret);expect(audit).not.toContain(secret);}expect(audit).not.toContain(recovery);
  await expect(f.client('bob','bob').exportRecoveryPackage()).rejects.toMatchObject({code:'administrator_required'});await expect(f.client('bob','bob').status('awangs')).rejects.toMatchObject({code:'scope_denied'});
  await expect(f.client('awangs','awangs',6).configure()).rejects.toMatchObject({code:'authority_stale'});expect((await readFile('/proc/self/status','utf8')).match(/^NoNewPrivs:.*$/m)?.[0]).toBe(hostProtection);
 }finally{await f.close();}
},120000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('same-UID model peers cannot impersonate the enrolled Host, and live enrollment and actor revocation are rechecked',async()=>{
 const f=await fixture();try{
  const request={schema:1,id:'11111111-1111-4111-8111-111111111111',operation:'configure',context:{actor:'awangs',dataScope:'awangs',authorityRevision:7}};
  const child=spawn(process.execPath,['--input-type=module','-e',`import {createConnection} from 'node:net';const c=createConnection(${JSON.stringify(f.socket)});c.on('connect',()=>c.write(${JSON.stringify(JSON.stringify(request)+'\n')}));c.on('data',x=>process.stdout.write(x));c.on('end',()=>c.end());`],{stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});let output='';child.stdout.on('data',chunk=>output+=chunk);expect((await once(child,'exit'))[0]).toBe(0);expect(JSON.parse(output)).toMatchObject({ok:false,error:{code:'host_process_not_enrolled'}});
  await expect(stat(join(f.privateRoot,'repository-runtime','password'))).rejects.toMatchObject({code:'ENOENT'});
  const forged=spawn(process.execPath,[resolve('dist/src/backup-key-worker.js'),f.config],{stdio:['pipe','pipe','ignore'],env:{PATH:'/usr/bin:/bin'}});let forgedOutput='';forged.stdout.on('data',chunk=>forgedOutput+=chunk);forged.stdin.end(JSON.stringify({...request,operation:'qualification',_peer:{pid:process.pid,uid:process.getuid!(),gid:process.getgid!()}}));await once(forged,'exit');expect(JSON.parse(forgedOutput).error.code).toBe('host_process_not_enrolled');

  await writeFile(f.authorityFile,JSON.stringify({...f.policy,hostClients:[{...f.policy.hostClients[0],birth:'0'}]}),{mode:0o600});await expect(f.client().status()).rejects.toMatchObject({code:'host_process_not_enrolled'});
  await writeFile(f.authorityFile,JSON.stringify({...f.policy,hostClients:[]}),{mode:0o600});await expect(f.client().status()).rejects.toMatchObject({code:'host_enrollment_unavailable'});
  await writeFile(f.authorityFile,JSON.stringify(f.policy),{mode:0o600});await f.client().configure();
  await writeFile(f.authorityFile,JSON.stringify({...f.policy,actors:{...f.policy.actors,awangs:{role:'reader',scopes:['awangs','bob']}}}),{mode:0o600});expect(await f.client().status()).toMatchObject({configured:true});await expect(f.client().exportRecoveryPackage()).rejects.toMatchObject({code:'administrator_required'});
 }finally{await f.close();}
},20000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('ingests only an exact synthetic sealed point and restores or pins that existing point while its live source is unavailable',async()=>{
 const {BackupCoordinator,WriterAdmissionFence}=await import('../src/host/backup.js'),{emitSealedCheckpoint}=await import('../src/host/backup-checkpoint-stream.js'),{createServer}=await import('node:net');
 const f=await fixture(),live=join(f.root,'live');await mkdir(live,{mode:0o700});await writeFile(join(live,'draft'),'sealed fixture generation');
 const fence=new WriterAdmissionFence({writerClasses:['synthetic'],uncoveredWriters:[],probe:async()=>({known:true})}),coordinator=new BackupCoordinator({root:join(f.root,'checkpoints'),adapter:{version:'synthetic-sealed-transport-v1',resolve:async()=>({groupId:'synthetic',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['synthetic-native']}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:live},{id:'native',recoveryKey:'native',role:'native',data:Buffer.from('synthetic native history')},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
 await coordinator.capture('awangs','task','pi');const point=(await coordinator.sealedCheckpoint('awangs','task'))!;expect(point).toBeDefined();let requests=0;const source=createServer(socket=>{socket.on('error',()=>undefined);let buffer='';socket.on('data',chunk=>{buffer+=chunk;if(!buffer.includes('\n'))return;socket.removeAllListeners('data');void (async()=>{const request=JSON.parse(buffer);requests++;if(request.operation!=='export-checkpoint'||request.scope!=='awangs'||request.taskId!=='task')throw Error('Not a named checkpoint export');await emitSealedCheckpoint(point.directory,async frame=>{socket.write(JSON.stringify(frame)+'\n');});socket.end();})().catch(()=>socket.destroy());});});source.listen(join(f.root,'source.sock'));await once(source,'listening');await import('node:fs/promises').then(fs=>fs.chmod(join(f.root,'source.sock'),0o600));let sourceClosed=false;const release=fence.beginWriter('synthetic');
 try{
  await writeFile(join(live,'draft'),'live changed after sealing');const admin=f.client();await admin.configure();await admin.verifyRecoveryPackage(await admin.exportRecoveryPackage());expect(requests).toBe(0);
  await expect(admin.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'invalid_selection'});expect(requests).toBe(0);
  await expect(admin.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:'11111111-1111-4111-8111-111111111111'}])).rejects.toMatchObject({code:'source_transfer_invalid'});
  const job=await admin.backup([{scope:'awangs',taskId:'task',expectedCheckpointId:point.manifest.checkpointId}]);expect(job.state).toBe('succeeded');expect(job.points[0].checkpointId).toBe(point.manifest.checkpointId);
  await new Promise<void>(ok=>source.close(()=>ok()));sourceClosed=true;
  const pin=await admin.pinRecoveryJob(job.id,{operationId:'22222222-2222-4222-8222-222222222222',revision:1,ttlMs:60000});await admin.withRecoveryPins([pin.id],async lease=>{lease.assertHeld();const destination=join(f.root,'restored');await admin.extract(job.id,destination);expect(await readFile(join(destination,point.manifest.checkpointId,'objects','workspace','draft'),'utf8')).toBe('sealed fixture generation');lease.assertHeld();});
  try{await expect(admin.withRecoveryPins([pin.id],async lease=>{await writeFile(f.authorityFile,JSON.stringify({...f.policy,actors:{...f.policy.actors,awangs:{role:'reader',scopes:['awangs','bob']}}}),{mode:0o600});await expect.poll(()=>{try{lease.assertHeld();return '';}catch(error){return (error as {code:string}).code;}},{timeout:5000}).toBe('administrator_required');})).rejects.toMatchObject({code:'administrator_required'});}finally{await writeFile(f.authorityFile,JSON.stringify(f.policy),{mode:0o600});}await admin.releaseRecoveryPin(pin.id,pin.operationId,pin.revision);
  expect(await f.client('bob','bob').recoveryPoints()).toEqual({points:[]});expect((await admin.status()).enabled).toBe(true);
 }finally{release();if(!sourceClosed)await new Promise<void>(ok=>source.close(()=>ok()));await f.close();}
},180000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('the enrolled socket interface rejects duplicate fields, forged peers and request-selected trust modes, then closes the request',async()=>{
 const {createConnection}=await import('node:net');const f=await fixture();
 const raw=(value:string)=>new Promise<any>((resolve,reject)=>{const socket=createConnection(f.socket);let data='';const timer=setTimeout(()=>{socket.destroy();reject(Error('Response did not close'));},3000);socket.on('connect',()=>socket.write(value+'\n'));socket.on('error',error=>{clearTimeout(timer);reject(error);});socket.on('data',chunk=>data+=chunk);socket.on('end',()=>{clearTimeout(timer);socket.end();resolve(JSON.parse(data));});});
 try{
  const request={schema:1,id:'11111111-1111-4111-8111-111111111111',operation:'qualification',context:{actor:'awangs',dataScope:'awangs',authorityRevision:7}};
  expect((await raw(JSON.stringify(request).replace('"schema":1','"schema":1,"schema":1'))).error.code).toBe('invalid_request');
  expect((await raw(JSON.stringify({...request,_peer:{uid:0,pid:process.pid}}))).error.code).toBe('invalid_request');
  expect((await raw(JSON.stringify({...request,trustModel:'host-root',hostClients:f.policy.hostClients}))).error.code).toBe('invalid_request');
  expect(await f.client().qualification()).toMatchObject({state:'qualified',trustModel:'host-root'});
 }finally{await f.close();}
},15000);
