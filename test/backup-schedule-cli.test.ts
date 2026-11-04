import {it,expect} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,stat,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

it('uses a private broker profile for independent CLI status and scheduling without creating a local key repository',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-schedule-cli-'));let service:ChildProcess|undefined,daemon:ChildProcess|undefined;
 try{
  const socket=join(root,'broker.sock'),privateRoot=join(root,'service-private'),authority=join(root,'authority.json'),config=join(root,'service.json'),profile=join(root,'client.json'),sourceRoot=join(root,'source');
  await mkdir(privateRoot,{mode:0o700});await mkdir(sourceRoot,{mode:0o700});
  await writeFile(authority,JSON.stringify({schema:1,revision:3,administrator:'awangs',scopes:['alice'],actors:{awangs:{role:'administrator',scopes:['alice']}}}),{mode:0o600});
  await writeFile(config,JSON.stringify({schema:1,socket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot,authorityFile:authority,sourceSocket:join(root,'source.sock'),binary:'/configured/pinned/restic',destination:join(root,'fixed-destination'),handler:resolve('dist/src/backup-key-worker.js'),node:process.execPath}),{mode:0o600});
  await writeFile(profile,JSON.stringify({schema:1,socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'alice',authorityRevision:3}),{mode:0o600});
  service=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',config],{stdio:['ignore','ignore','pipe']});let error='';service.stderr!.on('data',chunk=>error+=chunk);await expect.poll(async()=>{if(service!.exitCode!==null)throw Error(error);return stat(socket).then(()=>true,()=>false);},{timeout:5000}).toBe(true);
  const cli=async(command:string,...args:string[])=>{const child=spawn(process.execPath,[resolve('dist/src/backup-cli.js'),command,'--root',sourceRoot,'--broker-profile',profile,...args],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:sourceRoot}});let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const [code]=await once(child,'exit');return {code,stdout,stderr,data:JSON.parse(stdout||stderr)};};
  const status=await cli('status','--scope','alice');expect(status.code).toBe(0);expect(status.data).toMatchObject({configured:false,qualification:{state:'unavailable',reason:'service_identity_not_separate'}});
  const policy=join(root,'policy.json');await writeFile(policy,JSON.stringify({revision:'cli-v1',scopes:['alice'],timeZone:'UTC',hour:0}),{mode:0o600});
  expect((await cli('schedule-configure','--policy',policy)).data).toEqual({configured:true});
  expect((await cli('schedule-tick')).data).toMatchObject({dispatched:true,run:{state:'failed'}});
  const schedule=await cli('schedule-status','--scope','alice');expect(schedule.data).toMatchObject({configured:true,workerState:'recent',coverage:{state:'unknown',repositoryAvailable:false}});expect(schedule.data.alerts.some((alert:any)=>alert.kind==='repository-unavailable')).toBe(true);
  await expect(stat(join(sourceRoot,'repository-runtime'))).rejects.toMatchObject({code:'ENOENT'});
  expect(JSON.stringify(schedule.data)).not.toContain(privateRoot);
  daemon=spawn(process.execPath,[resolve('dist/src/backup-cli.js'),'schedule-daemon','--root',sourceRoot,'--broker-profile',profile],{stdio:'ignore',env:{PATH:process.env.PATH,HOME:sourceRoot}});
  await expect.poll(async()=>{if(daemon!.exitCode!==null)throw Error('Daemon exited before observation');return (await cli('schedule-status','--scope','alice')).data.lastCheckedAt;},{timeout:5000}).not.toBe(schedule.data.lastCheckedAt);
  const daemonExit=once(daemon,'exit');daemon.kill('SIGTERM');expect((await daemonExit)[0]).toBe(0);

 }finally{if(daemon&&daemon.exitCode===null&&daemon.signalCode===null){const exited=once(daemon,'exit');daemon.kill('SIGKILL');await exited;}if(service&&service.exitCode===null){const exited=once(service,'exit');service.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
},30000);
