import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename,stat,readdir,copyFile,open,chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';
const binary=process.env.PI_COFFEE_TEST_RESTIC;
it.skipIf(!binary)('requires an exported offline copy before enabling encrypted sealed-checkpoint backups',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-repository-'));let server:HostServer|undefined;try{
  const destination=join(root,'disk');await mkdir(destination,{mode:0o700});
  const source=join(root,'source');await mkdir(source,{mode:0o700});await writeFile(join(source,'draft'),'generation one');
  let now=Date.parse('2026-10-24T00:00:00Z');
  const fence=new WriterAdmissionFence({writerClasses:['fixture'],uncoveredWriters:[],probe:async()=>({known:true})});
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),now:()=>now,adapter:{version:'synthetic-v1',resolve:async()=>({groupId:'fixture',fence,members:[{scope:'awangs',taskId:'task',engine:'pi',nativeBindings:['synthetic']}],sources:[{id:'workspace',recoveryKey:'workspace',role:'workspace',path:source},{id:'native',recoveryKey:'native',role:'native',data:Buffer.from('synthetic session')},{id:'registry',recoveryKey:'registry',role:'registry',data:Buffer.from('{}')},{id:'task-data',recoveryKey:'task-data',role:'task-data',data:Buffer.from('{}')}],validate:async()=>{}})}});
  await coordinator.capture('awangs','task','pi');
  const repository=new BackupRepository({root:join(root,'runtime'),coordinator,now:()=>now});
  await repository.configure({destination,binary:binary!});
  await expect(repository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'offline_copy_required'});
  const stores=new Map<string,Workspaces>();for(const scope of ['awangs','bob']){const store=new Workspaces(join(root,'http',scope,'projects'));await store.createChatConversation('task');stores.set(scope,store);}
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Backup must not launch native');}};
  server=new HostServer({port:0,token:'synthetic-repository-http',requireUser:true,factory,backup:{coordinator,repository,binary,scopes:['bob']},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const call=async(user:string,body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:body?'POST':'GET',headers:{authorization:'Bearer synthetic-repository-http','x-pi-coffee-user':user,'x-pi-coffee-actor':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,cache:response.headers.get('cache-control'),data:await response.json()};};
  expect((await call('bob',{action:'repository-export'})).status).toBe(403);
  const exported=await call('awangs',{action:'repository-export'});expect(exported.cache).toBe('no-store');let copy=exported.data.recoveryPackage;

  expect((await stat(join(root,'runtime','password'))).mode&0o077).toBe(0);
  const wrong={...JSON.parse(copy),password:'x'.repeat(64)};
  await expect(repository.verifyRecoveryPackage(JSON.stringify(wrong))).rejects.toMatchObject({code:'recovery_verification_failed'});
  await rename(join(root,'runtime','password'),join(root,'runtime','password-hidden'));
  expect((await call('awangs',{action:'repository-verify',recoveryPackage:copy})).status).toBe(200);
  await rename(join(root,'runtime','password-hidden'),join(root,'runtime','password'));
  const firstResponse=await call('awangs',{action:'repository-backup',taskId:'task'});expect(firstResponse.status).toBe(200);const first=firstResponse.data;
  expect((await call('bob')).data.repository.points).toEqual([]);expect(JSON.stringify((await call('bob')).data)).not.toContain(first.snapshotId);
  expect(first.dataBlobs).toBeGreaterThan(0);
  expect(first).toMatchObject({state:'succeeded',verification:'repository-read',points:[{scope:'awangs',taskId:'task',captureAt:'2026-10-24T00:00:00.000Z'}]});
  now+=25*3600000;
  const unchanged=await repository.backup([{scope:'awangs',taskId:'task'}]);
  expect(unchanged.dataBlobs).toBe(0);
  expect((await repository.status('awangs')).points[0]).toMatchObject({captureAt:'2026-10-24T00:00:00.000Z',ageMs:25*3600000,stale:true});
  await writeFile(join(source,'draft'),'generation two');await coordinator.capture('awangs','task','pi');
  const changed=await repository.backup([{scope:'awangs',taskId:'task'}]);expect(changed.dataBlobs).toBeGreaterThan(0);const secondRestored=join(root,'second-restored');await repository.extract(changed.id,secondRestored,copy);expect(await readFile(join(secondRestored,(await readdir(secondRestored))[0],'objects','workspace','draft'),'utf8')).toBe('generation two');
  const restored=join(root,'restored');await repository.extract(first.id!,restored,copy);
  const entries=await import('node:fs/promises').then(fs=>fs.readdir(restored));
  expect(await readFile(join(restored,entries[0],'objects','workspace','draft'),'utf8')).toBe('generation one');
  expect(JSON.stringify(await repository.status('bob'))).not.toContain('task');
  expect(JSON.stringify(await repository.status('awangs'))).not.toContain(JSON.parse(copy).password);
  await server.close();server=undefined;
  const seals=await readdir(join(root,'checkpoints','sealed'));
  for(const id of seals)await writeFile(join(root,'checkpoints','sealed',id,'unsealed-extra'),'must never enter a backup');
  await expect(repository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'checkpoint_unavailable'});
  for(const id of seals)await rm(join(root,'checkpoints','sealed',id,'unsealed-extra'));
  // The independent worker has no Web process and consumes only the same sealed store.
  const cliArgs=['dist/src/backup-cli.js','run','--root',root,'--scope','awangs','--task','task'];
  // Keep the CLI runtime root layout identical to the Host layout.
  await rename(join(root,'runtime'),join(root,'repository-runtime'));
  const cliRepository=new BackupRepository({root:join(root,'repository-runtime'),coordinator,now:()=>now});
  const cli=spawn(process.execPath,cliArgs,{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:root}});let output='';cli.stdout.on('data',chunk=>output+=chunk);expect((await once(cli,'exit'))[0]).toBe(0);expect(JSON.parse(output).state).toBe('succeeded');
  const succeededBefore=(await cliRepository.jobs()).filter(job=>job.state==='succeeded').length;
  await writeFile(join(source,'large'),randomBytes(4*1024*1024));now+=1000;await coordinator.capture('awangs','task','pi');
  const failed=spawn('python3',['-c','import resource,os,sys; resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536)); os.execv(sys.argv[1],sys.argv[1:])',process.execPath,...cliArgs],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:root}});
  expect((await once(failed,'exit'))[0]).not.toBe(0);expect((await cliRepository.jobs()).filter(job=>job.state==='succeeded')).toHaveLength(succeededBefore);
  expect((await cliRepository.status('awangs')).jobs.some(job=>job.state==='failed')).toBe(true);
  // A controller death must not release a still-running detached Restic worker.
  await writeFile(join(source,'large'),randomBytes(32*1024*1024));now+=1000;await coordinator.capture('awangs','task','pi');
  const killed=spawn(process.execPath,cliArgs,{stdio:'ignore',env:{PATH:process.env.PATH,HOME:root}}),exit=once(killed,'exit');
  let supervisor=0;const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   try{const record=JSON.parse(await readFile(join(root,'repository-runtime','operation-lock','command.json'),'utf8'));if((await readdir(join(destination,'repository','locks'))).length){supervisor=record.pid;break;}}catch{/* Wait for actual native lock. */}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  expect(supervisor).toBeGreaterThan(0);process.kill(-supervisor,'SIGSTOP');killed.kill('SIGKILL');await exit;
  await expect(cliRepository.recoverInterruptedOperation()).rejects.toMatchObject({code:'repository_busy'});
  await expect(cliRepository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'repository_busy'});
  process.kill(-supervisor,'SIGKILL');
  // The orphan can briefly remain a zombie until the system subreaper reaps it.
  for(let tries=0;;tries++){try{await cliRepository.recoverInterruptedOperation();break;}catch(error){if(tries>100)throw error;await new Promise(resolve=>setTimeout(resolve,20));}}
  expect((await cliRepository.jobs()).filter(job=>job.state==='succeeded')).toHaveLength(succeededBefore);
  const dataRoot=join(destination,'repository','data');let pack='';for(const prefix of await readdir(dataRoot)){const files=await readdir(join(dataRoot,prefix));if(files.length){pack=join(dataRoot,prefix,files[0]);break;}}expect(pack).not.toBe('');const preservedPack=join(root,'preserved-encrypted-pack');
  await copyFile(pack,preservedPack);await chmod(pack,0o600);const corrupt=await open(pack,'r+');try{const byte=Buffer.alloc(1);await corrupt.read(byte,0,1,0);byte[0]^=0xff;await corrupt.write(byte,0,1,0);}finally{await corrupt.close();}
  await expect(cliRepository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'repository_failed'});expect((await cliRepository.jobs()).filter(job=>job.state==='succeeded')).toHaveLength(succeededBefore);
  await copyFile(preservedPack,pack);await chmod(pack,0o400);
  const oldRestored=join(root,'old-after-failures');await cliRepository.extract(first.id,oldRestored,copy);expect(await readFile(join(oldRestored,(await readdir(oldRestored))[0],'objects','workspace','draft'),'utf8')).toBe('generation one');
  // Continue target checks using the same runtime after independent CLI operations.
  await rename(join(root,'repository-runtime'),join(root,'runtime'));
  const oldCopy=copy;await repository.rotateRecoveryKey();
  await expect(repository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'offline_copy_required'});
  copy=await repository.exportRecoveryPackage();await repository.verifyRecoveryPackage(copy);
  await expect(BackupRepository.verifyOfflineRecoveryPackage(oldCopy,{destination,binary:binary!})).rejects.toMatchObject({code:'recovery_verification_failed'});
  await rename(join(root,'runtime'),join(root,'runtime-offline'));
  await BackupRepository.verifyOfflineRecoveryPackage(copy,{destination,binary:binary!});
  await rename(join(root,'runtime-offline'),join(root,'runtime'));
  const audit=await readFile(join(root,'runtime','audit.jsonl'),'utf8');expect(audit).toContain('recovery-rotation');expect(audit).toContain('recovery-key-revoked');expect(audit).not.toContain(JSON.parse(copy).password);expect(audit).not.toContain(JSON.parse(oldCopy).password);
  await rename(destination,destination+'-removed');
  await expect(repository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'destination_unavailable'});
  await expect(stat(destination)).rejects.toMatchObject({code:'ENOENT'});
  await mkdir(destination,{mode:0o700});await expect(repository.backup([{scope:'awangs',taskId:'task'}])).rejects.toMatchObject({code:'destination_changed'});
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
},180000);

it('refuses missing destinations and unreviewed backends before creating a fallback repository',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-repository-refuse-'));try{
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'runtime'),coordinator});
  await expect(repository.configure({destination:join(root,'missing'),binary:'/bin/true'})).rejects.toMatchObject({code:'destination_unavailable'});
  await expect(stat(join(root,'missing'))).rejects.toMatchObject({code:'ENOENT'});
  await mkdir(join(root,'destination'),{mode:0o700});await expect(repository.configure({destination:join(root,'destination'),binary:'/bin/true'})).rejects.toMatchObject({code:'backend_untrusted'});
  expect(await repository.status('awangs')).toMatchObject({configured:false,enabled:false,jobs:[],points:[]});
 }finally{await rm(root,{recursive:true,force:true});}
});

it('standalone status works with no Web and does not disclose storage paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-repository-cli-'));try{
  const cli=spawn(process.execPath,['dist/src/backup-cli.js','status','--root',root,'--scope','bob'],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:root}});let stdout='';cli.stdout.on('data',chunk=>stdout+=chunk);expect((await once(cli,'exit'))[0]).toBe(0);expect(JSON.parse(stdout)).toMatchObject({configured:false,enabled:false,jobs:[],points:[]});expect(stdout).not.toContain(root);
 }finally{await rm(root,{recursive:true,force:true});}
});
