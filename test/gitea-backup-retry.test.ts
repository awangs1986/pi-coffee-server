import {expect,it} from 'vitest';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {BackupRepository} from '../src/host/backup-repository.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {GiteaBackupJob} from '../src/host/gitea-backup.js';
import {giteaBackupFixture} from './gitea-backup-fixture.js';

it.skipIf(!process.env.PI_COFFEE_TEST_GITEA || !process.env.PI_COFFEE_TEST_RESTIC)('recovers the service it stopped across new worker attempts, and preserves an operator stop',async()=>{
 const f=await giteaBackupFixture();
 try{
  const disk=join(f.root,'disk'),profile=join(f.root,'profile.json'),wrapper=join(f.root,'start.py');
  await mkdir(disk,{mode:0o700});
  const repo=new BackupRepository({root:join(f.root,'repo'),coordinator:new BackupCoordinator({root:join(f.root,'points')})});
  await repo.configure({destination:disk,binary:process.env.PI_COFFEE_TEST_RESTIC!});
  await repo.verifyRecoveryPackage(await repo.exportRecoveryPackage());
  const marker=join(f.root,'start-mode');
  await writeFile(wrapper,`import pathlib,sys,subprocess
mode=pathlib.Path(${JSON.stringify(marker)}).read_text()
if mode=='fail':sys.exit(1)
if mode=='silent':sys.exit(0)
subprocess.run([sys.executable,${JSON.stringify(f.control)},'start'],check=True)
sys.exit(1 if mode=='lost-response' else 0)
`);
  await writeFile(profile,JSON.stringify({schema:1,version:'1.27.3',binary:f.binary,workPath:f.work,appIni:f.config,roots:{gitea:f.work},coffee:{configurationFiles:[f.config],bindings:[{accountId:'1',scope:'__legacy_default__',projects:f.work}]},checkStopped:['/usr/bin/python3',f.control,'check'],stop:['/usr/bin/python3',f.control,'stop'],start:['/usr/bin/python3',wrapper],url:`http://127.0.0.1:${f.port}/`,allowServicePause:true}),{mode:0o600});
  const job=()=>new GiteaBackupJob({root:join(f.root,'jobs'),profile,repository:repo});
  const day=randomUUID();
  await writeFile(marker,'fail');
  await expect(job().backup(randomUUID(),day)).rejects.toBeDefined();
  await writeFile(marker,'silent');
  await expect(job().backup(randomUUID(),day)).rejects.toBeDefined();
  await writeFile(marker,'lost-response');
  expect((await job().backup(randomUUID(),day)).state).toBe('succeeded');
  await f.ready();
  expect((await repo.archivePoints('gitea')).filter(p=>p.state==='succeeded')).toHaveLength(1);
  await f.run('stop');
  expect((await job().backup(randomUUID(),day)).state).toBe('succeeded');
  await f.run('check');
 }finally{await f.close();}
},120000);
