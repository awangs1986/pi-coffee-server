import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,stat,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';

async function json(path:string,value:unknown){await writeFile(path,JSON.stringify(value),{mode:0o600});}
async function identity(pid:number){const raw=await readFile('/proc/'+pid+'/stat','utf8');return {pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function stop(child:ChildProcess|undefined){if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'close');child.kill('SIGTERM');await ended;}}
async function fixture(manualListener=true){
 const root=await mkdtemp('/tmp/coffee-start-'),python=await realpath('/usr/bin/python3'),releaseRoot=await realpath(resolve('.'));
 const keyRoot=join(root,'key'),disk=join(root,'disk'),stateRoot=join(root,'startup');for(const path of [keyRoot,disk,stateRoot])await mkdir(path,{mode:0o700});
 const authorityFile=join(root,'authority.json'),sourcePolicy=join(root,'source-policy.json'),keyConfig=join(root,'key-config.json'),brokerProfile=join(root,'client.json'),profile=join(root,'startup.json'),socket=join(root,'key.sock'),backupRoot=join(root,'backup');
 const unrelated=await identity(process.pid),application={schema:1,revision:1,administrator:'awangs',scopes:['alice'],actors:{awangs:{role:'administrator',scopes:['alice']},alice:{role:'reader',scopes:['alice']}}};
 await json(authorityFile,{...application,hostClients:[unrelated]});await json(sourcePolicy,{...application,sourceProducers:[]});
 await json(keyConfig,{schema:1,trustModel:'host-root',socket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot:keyRoot,authorityFile,sourceSocket:join(root,'source.sock'),binary:process.env.PI_COFFEE_TEST_RESTIC??'/usr/bin/false',destination:disk,node:process.execPath,handler:join(releaseRoot,'dist/src/backup-key-worker.js')});
 await json(brokerProfile,{schema:1,socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'alice',authorityRevision:1});
 await json(profile,{schema:1,root:stateRoot,releaseRoot,node:process.execPath,python,keyConfig,sourcePolicy,brokerProfile,backupRoot,operator:{command:'status',options:{scope:'alice'}}});
 const env={PATH:process.env.PATH!,HOME:root,LANG:'C.UTF-8',PI_COFFEE_TEST_SENTINEL:'ordinary startup preserves this'};
 const listener=manualListener?spawn(python,[join(releaseRoot,'dist/src/host/backup-unix-peer.py'),'serve',keyConfig],{env,stdio:'ignore'}):undefined;
 if(manualListener)await expect.poll(()=>stat(socket).then(()=>true,()=>false),{timeout:10000}).toBe(true);
 const launch=(role='cli',overrides:NodeJS.ProcessEnv={})=>{const child=spawn(python,[join(releaseRoot,'src/host/ordinary-backup-start.py'),profile,role],{env:{...env,...overrides},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout!.on('data',value=>stdout+=value);child.stderr!.on('data',value=>stderr+=value);const result=once(child,'close').then(([code])=>({code,stdout,stderr}));return {child,result,output:()=>({stdout,stderr})};};
 return {root,socket,python,profile,sourcePolicy,authorityFile,brokerProfile,keyConfig,backupRoot,stateRoot,application,unrelated,listener,launch,stop:async()=>{await stop(listener);await rm(root,{recursive:true,force:true});}};
}

it('enrolls a fixed real CLI process, preserves application grants, and replaces only its dead startup slot',async()=>{
 const f=await fixture();try{
  const first=f.launch(),result=await first.result;expect(result,result.stderr).toMatchObject({code:0});expect(JSON.parse(result.stdout)).toMatchObject({qualification:{trustModel:'host-root',state:'qualified'}});
  const policy=JSON.parse(await readFile(f.authorityFile,'utf8'));expect(policy).toMatchObject(f.application);expect(policy.hostClients).toContainEqual(f.unrelated);expect(policy.hostClients.some((row:any)=>row.pid===first.child.pid)).toBe(true);
  const source=JSON.parse(await readFile(f.sourcePolicy,'utf8'));expect(source).toMatchObject(f.application);expect(source.sourceProducers).toHaveLength(1);expect(source.sourceProducers[0].listener.pid).toBe(f.listener!.pid);
  const second=f.launch();expect(await second.result).toMatchObject({code:0});const latest=JSON.parse(await readFile(f.authorityFile,'utf8'));expect(latest.hostClients).toHaveLength(2);expect(latest.hostClients).toContainEqual(f.unrelated);expect(latest.hostClients.some((row:any)=>row.pid===first.child.pid)).toBe(false);expect(latest.hostClients.some((row:any)=>row.pid===second.child.pid)).toBe(true);
 }finally{await f.stop();}
},30000);


it('starts the fixed key listener and recovers only its recorded stale socket after a process crash',async()=>{
 const f=await fixture(false);let key:ChildProcess|undefined;
 try{
  const first=f.launch('key');key=first.child;
  await expect.poll(()=>stat(f.socket).then(()=>true,()=>false),{timeout:5000}).toBe(true);
  expect(await f.launch().result).toMatchObject({code:0});
  const before=JSON.parse(await readFile(f.sourcePolicy,'utf8'));expect(before.sourceProducers[0].listener.pid).toBe(first.child.pid);
  const ended=once(key,'close');key.kill('SIGKILL');await ended;expect(await stat(f.socket).then(()=>true,()=>false)).toBe(true);
  const second=f.launch('key');key=second.child;
  await expect.poll(async()=>{const state=JSON.parse(await readFile(join(f.stateRoot,'state.json'),'utf8'));return state.listenerSocket?.pid;},{timeout:5000}).toBe(second.child.pid);
  expect(await f.launch().result).toMatchObject({code:0});const source=JSON.parse(await readFile(f.sourcePolicy,'utf8'));expect(source).toMatchObject(f.application);expect(source.sourceProducers).toHaveLength(1);expect(source.sourceProducers[0].listener.pid).toBe(second.child.pid);
 }finally{await stop(key);await f.stop();}
},25000);

it('keeps repository startup independent of a revoked source actor without changing that source authorization',async()=>{
 const f=await fixture();try{
  const source=JSON.parse(await readFile(f.sourcePolicy,'utf8'));source.revision=2;source.actors.awangs.role='reader';await json(f.sourcePolicy,source);
  const run=f.launch();expect(await run.result).toMatchObject({code:0});const after=JSON.parse(await readFile(f.sourcePolicy,'utf8'));expect(after.revision).toBe(2);expect(after.actors.awangs.role).toBe('reader');expect(JSON.parse((await f.launch().result).stdout)).toMatchObject({qualification:{state:'qualified'}});
 }finally{await f.stop();}
},15000);

it('launches actual Host and independent scheduler, preserves native environment, and refuses a duplicate live role',async()=>{
 const {BackupJobRunner}=await import('../src/host/backup-job-runner.js'),{BackupRepositoryClient}=await import('../src/host/backup-repository-client.js'),{BackupCoordinator}=await import('../src/host/backup.js');
 const f=await fixture();let host:ChildProcess|undefined,scheduler:ChildProcess|undefined;
 try{
  const repository=await BackupRepositoryClient.fromConfig(f.brokerProfile),runner=new BackupJobRunner({root:join(f.backupRoot,'schedule'),repository,coordinator:new BackupCoordinator({root:join(f.backupRoot,'checkpoints')})});await runner.configure({revision:'startup-fixture',scopes:['alice'],timeZone:'UTC',hour:23,minute:59});
  const environment={PI_COFFEE_WORKDIR:join(f.root,'work'),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_HOST_TOKEN:'synthetic-startup-token',PI_COFFEE_EXTENSIONS:'off'};
  const launched=f.launch('host',environment);host=launched.child;
  await expect.poll(()=>launched.output().stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1],{timeout:15000}).toBeTruthy();
  const port=launched.output().stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];expect((await fetch('http://127.0.0.1:'+port+'/healthz')).status).toBe(200);
  const env=await readFile('/proc/'+host.pid+'/environ','utf8');expect(env).toContain('HOME='+f.root+'\0');expect(env).toContain('PI_COFFEE_TEST_SENTINEL=ordinary startup preserves this\0');
  const flags=(value:string)=>value.match(/^NoNewPrivs:\s+(\d+)/m)?.[1];expect(flags(await readFile('/proc/'+host.pid+'/status','utf8'))).toBe(flags(await readFile('/proc/self/status','utf8')));
  const before=await readFile(f.authorityFile,'utf8');expect(await f.launch('host',environment).result).toMatchObject({code:1});expect(await readFile(f.authorityFile,'utf8')).toBe(before);
  const first=f.launch('scheduler');scheduler=first.child;await expect.poll(async()=>(await runner.status('alice')).workerState,{timeout:10000}).toBe('recent');
  await stop(host);host=undefined;expect(scheduler.exitCode).toBeNull();
  const oldScheduler=scheduler.pid;await stop(scheduler);const second=f.launch('scheduler');scheduler=second.child;
  await expect.poll(async()=>JSON.parse(await readFile(f.authorityFile,'utf8')).hostClients.some((row:any)=>row.pid===second.child.pid),{timeout:5000}).toBe(true);
  const after=JSON.parse(await readFile(f.authorityFile,'utf8'));expect(after).toMatchObject(f.application);expect(after.hostClients.some((row:any)=>row.pid===oldScheduler)).toBe(false);expect(after.hostClients).toContainEqual(f.unrelated);
 }finally{await stop(host);await stop(scheduler);await f.stop();}
},45000);

it.each(['reader','revision','permissions','command'] as const)('refuses %s startup configuration without rewriting process or application authority',async fault=>{
 const {chmod}=await import('node:fs/promises'),f=await fixture();try{
  if(fault==='reader'||fault==='revision'){const policy=JSON.parse(await readFile(f.authorityFile,'utf8'));if(fault==='reader')policy.actors.awangs.role='reader';else policy.revision++;await json(f.authorityFile,policy);}
  if(fault==='permissions')await chmod(f.profile,0o644);
  if(fault==='command'){const profile=JSON.parse(await readFile(f.profile,'utf8'));profile.operator.command='/bin/sh';await json(f.profile,profile);}
  const before=await readFile(f.authorityFile,'utf8'),source=await readFile(f.sourcePolicy,'utf8');expect(await f.launch().result).toMatchObject({code:1});expect(await readFile(f.authorityFile,'utf8')).toBe(before);expect(await readFile(f.sourcePolicy,'utf8')).toBe(source);
 }finally{await f.stop();}
},15000);

async function crashPolicyCommit(f:Awaited<ReturnType<typeof fixture>>){
 const script=`import importlib.util,os,sys,signal\np=${JSON.stringify(resolve('src/host/ordinary-backup-start.py'))}\ns=importlib.util.spec_from_file_location('fixed_startup',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=os.replace\ndef replace(source,target):\n original(source,target)\n if str(target)==${JSON.stringify(f.authorityFile)}: os.kill(os.getpid(),signal.SIGKILL)\nos.replace=replace\nsys.argv=[p,${JSON.stringify(f.profile)},'cli']\nm.main()\n`;
 const child=spawn(f.python,['-c',script],{env:{PATH:process.env.PATH,HOME:f.root,LANG:'C.UTF-8'},stdio:'ignore'});const [,signal]=await once(child,'close');expect(signal).toBe('SIGKILL');expect(await stat(join(f.stateRoot,'transaction.json')).then(()=>true,()=>false)).toBe(true);
}

it('reconciles an actual interrupted policy transaction but never overwrites a newer application revocation',async()=>{
 const f=await fixture();try{
  await crashPolicyCommit(f);expect(await f.launch().result).toMatchObject({code:0});expect(await stat(join(f.stateRoot,'transaction.json')).then(()=>true,()=>false)).toBe(false);expect(JSON.parse(await readFile(f.authorityFile,'utf8')).hostClients).toContainEqual(f.unrelated);
  await crashPolicyCommit(f);const policy=JSON.parse(await readFile(f.authorityFile,'utf8'));policy.revision=2;policy.actors.awangs.role='reader';await json(f.authorityFile,policy);const before=await readFile(f.authorityFile,'utf8');expect(await f.launch().result).toMatchObject({code:1});expect(await readFile(f.authorityFile,'utf8')).toBe(before);expect(await stat(join(f.stateRoot,'transaction.json')).then(()=>true,()=>false)).toBe(true);
 }finally{await f.stop();}
},20000);

it('rejects a same-UID socket impostor before changing backend authorization',async()=>{
 const {createServer}=await import('node:net'),{chmod}=await import('node:fs/promises'),f=await fixture();let server:ReturnType<typeof createServer>|undefined;
 try{
  await stop(f.listener);server=createServer(connection=>{connection.on('error',()=>{});connection.end();});server.listen(f.socket);await once(server,'listening');await chmod(f.socket,0o660);
  const before=await readFile(f.authorityFile,'utf8'),run=await f.launch().result;expect(run).toMatchObject({code:1});expect(await readFile(f.authorityFile,'utf8')).toBe(before);expect(run.stderr).toContain('startup_listener_mismatch');
 }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await f.stop();}
},15000);

it('preserves an unknown replacement socket after the recorded key process dies',async()=>{
 const {createServer,createConnection}=await import('node:net'),{chmod}=await import('node:fs/promises'),f=await fixture(false);let key:ChildProcess|undefined,server:ReturnType<typeof createServer>|undefined;
 try{
  const first=f.launch('key');key=first.child;await expect.poll(async()=>{const state=await readFile(join(f.stateRoot,'state.json'),'utf8').then(JSON.parse,()=>({}));return state.listenerSocket?.pid;},{timeout:5000}).toBe(key.pid);
  const ended=once(key,'close');key.kill('SIGKILL');await ended;await rm(f.socket);server=createServer(connection=>{connection.on('error',()=>{});connection.end('unrelated fixture alive');});server.listen(f.socket);await once(server,'listening');await chmod(f.socket,0o660);
  const before=await readFile(f.sourcePolicy,'utf8'),run=await f.launch('key').result;expect(run).toMatchObject({code:1});expect(run.stderr).toContain('startup_socket_unowned');expect(await readFile(f.sourcePolicy,'utf8')).toBe(before);
  const client=createConnection(f.socket);let reply='';client.on('data',chunk=>reply+=chunk);await once(client,'end');expect(reply).toBe('unrelated fixture alive');
 }finally{await stop(key);if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));await f.stop();}
},15000);


it('keeps ordinary Host startup and task creation available during a key service outage',async()=>{
 const f=await fixture();let host:ChildProcess|undefined;
 try{
  expect(await f.launch().result).toMatchObject({code:0});await stop(f.listener);
  const launched=f.launch('host',{PI_COFFEE_WORKDIR:join(f.root,'work'),PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_HOST_TOKEN:'synthetic-startup-token',PI_COFFEE_EXTENSIONS:'off'});host=launched.child;
  await expect.poll(()=>launched.output().stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1],{timeout:8000}).toBeTruthy();
  const port=launched.output().stdout.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
  const response=await fetch('http://127.0.0.1:'+port+'/api/workspace',{method:'POST',headers:{authorization:'Bearer synthetic-startup-token','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify({action:'conversation',workspaceKind:'chat',engine:'pi',id:'offline-backup-task'})});expect(response.status).toBe(200);
  expect(JSON.parse(await readFile(f.sourcePolicy,'utf8'))).toMatchObject(f.application);
 }finally{await stop(host);await f.stop();}
},20000);


it.each(['before-link','after-link'] as const)('recovers a key process crash %s without exposing an unowned public socket',async phase=>{
 const f=await fixture(false);let key:ChildProcess|undefined;
 try{
  const original=JSON.parse(await readFile(f.profile,'utf8')),keyConfig=JSON.parse(await readFile(f.keyConfig,'utf8')),release=join(f.root,'fault-release');await mkdir(join(release,'dist/src/host'),{recursive:true,mode:0o700});
  const listenerPath=join(release,'dist/src/host/backup-unix-peer.py');let listener=await readFile(join(original.releaseRoot,'dist/src/host/backup-unix-peer.py'),'utf8');
  const crash="os.kill(os.getpid(), signal.SIGKILL)";listener=listener.replace('        os.link(temporary, target)',phase==='before-link'?'        '+crash+'\n        os.link(temporary, target)':'        os.link(temporary, target)\n        '+crash);await writeFile(listenerPath,listener,{mode:0o600});
  await copyFile(join(original.releaseRoot,'dist/src/backup-key-worker.js'),join(release,'dist/src/backup-key-worker.js'));
  await copyFile(join(original.releaseRoot,'dist/src/host/ordinary-backup-start.py'),join(release,'dist/src/host/ordinary-backup-start.py'));
  await json(f.profile,{...original,releaseRoot:release});await json(f.keyConfig,{...keyConfig,handler:join(release,'dist/src/backup-key-worker.js')});
  const crashed=f.launch('key');key=crashed.child;await crashed.result;expect(key.signalCode).toBe('SIGKILL');expect(await stat(f.socket).then(()=>true,()=>false)).toBe(phase==='after-link');
  const pending=JSON.parse(await readFile(join(f.stateRoot,'state.json'),'utf8'));expect(pending.listenerSocket.temporary).toBeDefined();expect(await stat(pending.listenerSocket.temporary).then(()=>true,()=>false)).toBe(true);
  await json(f.profile,original);await json(f.keyConfig,keyConfig);const restarted=f.launch('key');key=restarted.child;
  await expect.poll(async()=>{const state=JSON.parse(await readFile(join(f.stateRoot,'state.json'),'utf8'));return state.listenerSocket?.pid;},{timeout:5000}).toBe(key.pid);
  expect(await f.launch().result).toMatchObject({code:0});expect(await stat(pending.listenerSocket.temporary).then(()=>true,()=>false)).toBe(false);
 }finally{await stop(key);await f.stop();}
},20000);
