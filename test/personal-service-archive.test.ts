import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BackupCoordinator} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {createStateArchive,verifyStateArchive} from '../src/host/state-archive.js';

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('stores and reads a service archive with the same administrator repository key',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-service-archive-'));
 try{
  const source=join(root,'source'),disk=join(root,'disk'),stage=join(root,'stage');for(const path of [source,disk,stage])await mkdir(path,{mode:0o700});
  await writeFile(join(source,'config.ini'),'synthetic private configuration');
  const archive=join(stage,'archive');await createStateArchive({destination:archive,kind:'gitea',version:'1.27.3',roots:{gitea:source},assertQuiescent:async()=>{}});
  const repository=new BackupRepository({root:join(root,'repository'),coordinator:new BackupCoordinator({root:join(root,'checkpoints')})});
  await repository.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});const key=await repository.exportRecoveryPackage();await repository.verifyRecoveryPackage(key);
  const point=await repository.backupArchive('gitea',archive);expect(point.state).toBe('succeeded');expect(await repository.archivePoints('gitea')).toHaveLength(1);
  const target=join(root,'restored');await repository.extractArchive(point.id,target,key);
  expect((await verifyStateArchive(join(target,'archive'))).kind).toBe('gitea');expect(await readFile(join(target,'archive','gitea','config.ini'),'utf8')).toBe('synthetic private configuration');
  expect(JSON.stringify(await repository.archivePoints('gitea'))).not.toContain('synthetic private configuration');
  await writeFile(join(target,'archive','gitea','config.ini'),'corrupt');await expect(verifyStateArchive(join(target,'archive'))).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
},120000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('rebuilds the selected service catalog using only the disk and administrator key after runtime loss',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-offline-catalog-'));
 try{
  const disk=join(root,'disk'),source=join(root,'source'),stage=join(root,'stage');for(const path of [disk,source,stage])await mkdir(path,{mode:0o700});await writeFile(join(source,'login.json'),'synthetic OAuth bindings');
  const archive=join(stage,'archive');await createStateArchive({destination:archive,kind:'gitea',version:'1.27.3',roots:{login:source},assertQuiescent:async()=>{}});
  const runtime=join(root,'runtime'),repo=new BackupRepository({root:runtime,coordinator:new BackupCoordinator({root:join(root,'checkpoints')})});await repo.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});const key=await repo.exportRecoveryPackage();await repo.verifyRecoveryPackage(key);const saved=await repo.backupArchive('gitea',archive);
  await rm(runtime,{recursive:true});await rm(stage,{recursive:true});await rm(source,{recursive:true});
  const recovered=new BackupRepository({root:runtime,coordinator:new BackupCoordinator({root:join(root,'empty')})});
  await expect(recovered.openOfflineRecovery(JSON.stringify({...JSON.parse(key),password:'wrong'.repeat(16)}),{destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!})).rejects.toThrow();
  await expect(recovered.openOfflineRecovery(JSON.stringify({...JSON.parse(key),repositoryId:'0'.repeat(64)}),{destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!})).rejects.toMatchObject({code:'recovery_verification_failed'});
  await recovered.openOfflineRecovery(key,{destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});
  const catalog=await recovered.offlineSnapshots();expect(catalog).toHaveLength(1);expect(catalog[0]).toMatchObject({jobId:saved.id,kind:'service'});expect(await recovered.jobs()).toEqual([]);
  const imported=await recovered.importOfflineSnapshot(catalog[0].snapshotId);expect(imported).toMatchObject({id:saved.id,state:'succeeded',verification:'repository-read'});
  expect(await recovered.importOfflineSnapshot(catalog[0].snapshotId)).toEqual(imported);
  await recovered.extractArchive(saved.id,join(root,'extracted'));expect(await readFile(join(root,'extracted','archive','login','login.json'),'utf8')).toBe('synthetic OAuth bindings');
 }finally{await rm(root,{recursive:true,force:true});}
},120000);
