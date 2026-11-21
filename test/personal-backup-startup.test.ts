import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

it('starts the personal Host without broker, actor registry or source qualification profiles',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-personal-start-'));
 await mkdir(join(root,'agent'),{mode:0o700});
 const child=spawn(process.execPath,['dist/src/main.js','host'],{env:{PATH:process.env.PATH,HOME:root,PI_COFFEE_PERSONAL_BACKUP:'1',PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_AGENT_DIR:join(root,'agent'),PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:join(root,'sessions'),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_HOST_TOKEN:'personal-test',PI_COFFEE_EXTENSIONS:'off'},stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 try{
  await expect.poll(()=>stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child.exitCode!==null?stderr:undefined),{timeout:20000}).toMatch(/^\d+$/);
  const port=stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
  const response=await fetch(`http://127.0.0.1:${port}/api/backup`,{headers:{authorization:'Bearer personal-test','x-pi-coffee-actor':'awangs'}});
  expect(response.status).toBe(200);const status=await response.json();
  expect(status).toMatchObject({personal:true,canManage:true,repository:{configured:false}});
  expect(status.repository.activationUnavailable).toBeUndefined();
 }finally{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}await rm(root,{recursive:true,force:true});}
},30000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('backs up and restores a Pi task through the actual personal Host composition',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-personal-cycle-')),nativeDir=join(root,'sessions'),disk=join(root,'disk');
 for(const path of [join(root,'agent'),nativeDir,disk])await mkdir(path,{mode:0o700});
 // The site-specific writer probe is controlled by this synthetic operator.
 const probe=join(root,'stable-window'),ready=join(root,'window-ready'),hold=join(root,'hold-check'),entered=join(root,'checking');
 await writeFile(probe,`#!/bin/sh\nif test -f "${hold}"; then touch "${entered}"; while test -f "${hold}"; do sleep .05; done; fi\ntest -f "${ready}"\n`,{mode:0o700});
 const child=spawn(process.execPath,['dist/src/main.js','host'],{env:{PATH:process.env.PATH,HOME:root,PI_COFFEE_PERSONAL_BACKUP:'1',PI_COFFEE_CLAUDE_COMMAND:'/usr/bin/true',PI_COFFEE_BACKUP_CHECK_QUIESCENT:probe,PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_RESTIC_BINARY:process.env.PI_COFFEE_TEST_RESTIC,PI_COFFEE_AGENT_DIR:join(root,'agent'),PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:nativeDir,PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_HOST_TOKEN:'personal-test'},stdio:['ignore','pipe','pipe']});
 let stdout='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',()=>{});
 try{
  await expect.poll(()=>stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1],{timeout:20000}).toMatch(/^\d+$/);
  const port=stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
  const call=async(path:string,input:unknown)=>{const response=await fetch(`http://127.0.0.1:${port}/api/${path}`,{method:'POST',headers:{authorization:'Bearer personal-test','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify(input)});const data=await response.json();expect(response.status,JSON.stringify(data)).toBe(200);return data;};
  const created=await call('workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'personal-cycle'});
  const task=created.conversation??created;expect(task.cwd).toBeTypeOf('string');
  await writeFile(join(task.cwd,'attachment.txt'),'personal attachment');
  const native=SessionManager.create(task.cwd,nativeDir,{id:task.id});native.appendMessage({role:'user',content:'personal persisted history',timestamp:1});
  const capture=await call('backup',{action:'capture',taskId:task.id});expect(capture).toMatchObject({state:'protected'});
  await writeFile(join(root,'backup','unmanaged-writer-seen'),'legacy unmanaged writer marker');
  const recheck=(actor:string)=>fetch(`http://127.0.0.1:${port}/api/backup`,{method:'POST',headers:{authorization:'Bearer personal-test','x-pi-coffee-actor':actor,'content-type':'application/json'},body:JSON.stringify({action:'source-requalify'})});
  expect((await recheck('other')).status).toBe(403);
  expect((await recheck('awangs')).status).toBe(409);
  const old=await call('backup',{action:'status',scope:'__legacy_default__'});
  expect(old.tasks.find((t:{taskId:string})=>t.taskId===task.id)?.captureAt).toBe(capture.captureAt);
  await writeFile(ready,'stable');
  await writeFile(hold,'hold');const concurrent=recheck('awangs');
  await expect.poll(()=>readFile(entered,'utf8').then(()=>true,()=>false)).toBe(true);
  await call('workspace',{action:'archive',id:task.id});
  await rm(hold);
  expect((await concurrent).status).toBe(409);
  expect((await recheck('awangs')).status).toBe(200);
  const engines=await fetch(`http://127.0.0.1:${port}/api/engines`,{headers:{authorization:'Bearer personal-test'}});
  expect(engines.ok).toBe(true);
  // Merely refreshing the engine selector runs a supervised version probe.
  expect((await call('backup',{action:'status',scope:'__legacy_default__'})).source.known).toBe(true);
  await writeFile(join(task.cwd,'attachment.txt'),'after stable window');
  const fresh=await call('backup',{action:'capture',taskId:task.id});
  expect(fresh.state).toBe('protected');expect(fresh.checkpointId).not.toBe(capture.checkpointId);
  await call('backup',{action:'repository-configure',destination:disk});
  const recovery=await call('backup',{action:'repository-export'});await call('backup',{action:'repository-verify',recoveryPackage:recovery.recoveryPackage});
  const scheduled=await call('backup',{action:'schedule-configure',revision:'personal-v1',scopes:['__legacy_default__']});expect(scheduled.schedule.configured).toBe(true);
  const job=await call('backup',{action:'repository-backup',taskId:task.id});expect(job.state).toBe('succeeded');
  await call('workspace',{action:'delete',id:task.id,confirmation:task.id,includeLocalFiles:true});
  const preview=await call('backup',{action:'restore-preview',taskId:task.id,jobId:job.id});expect(preview.state).toBe('staged');
  expect((await call('backup',{action:'restore-confirm',id:preview.id,revision:preview.revision,digest:preview.digest})).state).toBe('completed');
  expect(await readFile(join(task.cwd,'attachment.txt'),'utf8')).toBe('after stable window');
  expect(SessionManager.open(native.getSessionFile()!).getSessionId()).toBe(task.id);
  expect(SessionManager.open(native.getSessionFile()!).buildSessionContext().messages).toHaveLength(1);
 }finally{if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'close');child.kill('SIGTERM');await closed;}await rm(root,{recursive:true,force:true});}
},120000);
