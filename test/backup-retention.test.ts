import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';
import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';
import {spawn,type ChildProcess} from 'node:child_process';import {once} from 'node:events';
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {resolve} from 'node:path';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('previews exact deletions, protects live expired pins and other scope last points, then restores retained incremental snapshots',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-retention-'));let now=Date.parse('2026-10-25T08:00:00Z');let service:ChildProcess|undefined;let host:HostServer|undefined;
 try{
  const source=join(root,'source');await mkdir(source,{mode:0o700});const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})});
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>now,adapter:{version:'retention-fixture-v1',resolve:async(scope,id)=>({groupId:'fixture-'+scope,fence,members:[{scope,taskId:id,engine:'pi',nativeBindings:[id]}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:source},{id:'native',recoveryKey:'native',role:'native',data:Buffer.from('ordinary history')},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
  const repository=new BackupRepository({root:join(root,'repository-runtime'),coordinator,now:()=>now});const disk=join(root,'disk');await mkdir(disk,{mode:0o700});await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});const recovery=await repository.exportRecoveryPackage();await repository.verifyRecoveryPackage(recovery);
  const save=async(scope:string,text:string)=>{await writeFile(join(source,'draft'),text);await coordinator.capture(scope,'task','pi');return repository.backup([{scope,taskId:'task'}]);};
  const first=await save('alice','generation one');const operationId='11111111-1111-4111-8111-111111111111';
  const pin=await repository.pinRecoveryJob(first.id,{operationId,revision:1,ttlMs:3600000});
  now+=60000;const second=await save('alice','generation two');
  now=Date.parse('2025-01-01T08:00:00Z');const bob=await save('bob','other account unique point');
  now=Date.parse('2026-10-25T08:02:00Z');const latest=await save('alice','generation three');

  const store=new Workspaces(join(root,'projects'));await store.list();const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No models');}};host=new HostServer({port:0,token:'private',requireUser:true,factory,backup:{coordinator,repository,scopes:['alice','bob']},scopeForUser:()=>({factory,workspaces:store})});await host.start();
  const previewResponse=await fetch(`http://127.0.0.1:${host.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer private','x-pi-coffee-user':'alice','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify({action:'retention-preview',scopes:['alice','bob']})});expect(previewResponse.status).toBe(200);
  let preview=await previewResponse.json();expect(preview.remove.map(row=>row.snapshotId)).toEqual([second.snapshotId]);expect(preview.keep.map(row=>row.snapshotId)).toEqual(expect.arrayContaining([first.snapshotId,bob.snapshotId,latest.snapshotId]));
  const changed=await repository.pinRecoveryJob(second.id,{operationId:'22222222-2222-4222-8222-222222222222',revision:1,ttlMs:3600000});
  await expect(repository.executeRetention(preview.id,preview.revision,preview.digest)).rejects.toMatchObject({code:'retention_plan_stale'});
  await repository.releaseRecoveryPin(changed.id,changed.operationId,changed.revision);
  const socket=join(root,'pin.sock'),serviceConfig=join(root,'pin-config.json');await writeFile(serviceConfig,JSON.stringify({schema:1,socket,serviceUid:process.getuid!(),hostUid:process.getuid!(),privateRoot:root,node:process.execPath,handler:resolve('test/fixtures/retention-pin-worker.mjs'),fixtureClock:now}),{mode:0o600});
  service=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',serviceConfig],{stdio:'ignore'});await expect.poll(()=>import('node:fs/promises').then(fs=>fs.stat(socket)).then(()=>true,()=>false),{timeout:5000}).toBe(true);
  const client=new BackupRepositoryClient({socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'alice',authorityRevision:7});
  await client.withRecoveryPins([pin.id],async lease=>{
   now+=25*3600000;lease.assertHeld();await repository.releaseRecoveryPin(pin.id,pin.operationId,pin.revision);preview=await repository.previewRetention({scopes:['alice','bob']});expect(preview.keep.find(row=>row.snapshotId===first.snapshotId)!.reasons).toContainEqual({kind:'active-pin',pinId:pin.id});
   const executed=await fetch(`http://127.0.0.1:${host!.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer private','x-pi-coffee-user':'alice','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify({action:'retention-execute',id:preview.id,revision:preview.revision,digest:preview.digest})});expect(executed.status).toBe(200);const completed=await executed.json();expect(completed.state).toBe('completed');expect(completed.deletedSnapshotIds).toEqual([second.snapshotId]);lease.assertHeld();
  });
  const restored=join(root,'restored-old');await repository.extract(first.id,restored,recovery);expect(await readFile(join(restored,(await readdir(restored))[0],'objects','workspace','draft'),'utf8')).toBe('generation one');
  const restoredBob=join(root,'restored-bob');await repository.extract(bob.id,restoredBob,recovery);expect(await readFile(join(restoredBob,(await readdir(restoredBob))[0],'objects','workspace','draft'),'utf8')).toBe('other account unique point');
  const repeated=await repository.executeRetention(preview.id,preview.revision,preview.digest);expect(repeated.state).toBe('completed');
  await expect(repository.extract(second.id,join(root,'removed'))).rejects.toMatchObject({code:'unknown_snapshot'});
  await expect.poll(async()=>{const next=await repository.previewRetention({scopes:['alice','bob']});return next.remove.some(row=>row.snapshotId===first.snapshotId);},{timeout:5000}).toBe(true);
  const after=await repository.previewRetention({scopes:['alice','bob']});expect(after.remove.map(row=>row.snapshotId)).toEqual([first.snapshotId]);expect((await repository.status('alice')).points[0].checkpointId).toBe(latest.points[0].checkpointId);
  const cli=spawn(process.execPath,[resolve('dist/src/backup-cli.js'),'retention-preview','--root',root,'--scopes','["alice","bob"]'],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:root}});let stdout='',stderr='';cli.stdout.on('data',chunk=>stdout+=chunk);cli.stderr.on('data',chunk=>stderr+=chunk);expect((await once(cli,'exit'))[0],stderr).toBe(0);expect(JSON.parse(stdout).remove.map((row:any)=>row.snapshotId)).toEqual([first.snapshotId]);

 }finally{await host?.close();if(service&&service.exitCode===null&&service.signalCode===null){const exited=once(service,'exit');service.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
},180000);
