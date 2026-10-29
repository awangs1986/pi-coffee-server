import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,readdir} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {LEGACY_BACKUP_SCOPE} from '../src/host/backup.js';
import {WebSocket} from 'ws';
import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';
import {randomUUID} from 'node:crypto';
async function identity(pid:number){const raw=await readFile('/proc/'+pid+'/stat','utf8');return {pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function fixture(seed=false,existing=false,wrongRoots=false){
 const root=await mkdtemp('/tmp/ordinary-main-'),data=join(root,'data'),control=join(root,'control'),disk=join(root,'disk'),keys=join(root,'keys');for(const dir of [control,disk,keys])await mkdir(dir,{mode:0o700});
 if(existing){await mkdir(data,{mode:0o700});await writeFile(join(data,'preserve'),'existing synthetic source');}
 const keySocket=join(root,'key.sock'),sourceSocket=join(root,'source.sock'),keyConfig=join(control,'key.json'),keyPolicy=join(control,'key-policy.json'),sourcePolicy=join(control,'source-policy.json'),profile=join(control,'ordinary.json'),client=join(control,'client.json'),gate=join(control,'start'),preload=join(control,'gate.mjs');
 const policy={schema:1,revision:1,administrator:'awangs',scopes:[LEGACY_BACKUP_SCOPE],actors:{awangs:{role:'administrator',scopes:[LEGACY_BACKUP_SCOPE]}},hostClients:[] as Awaited<ReturnType<typeof identity>>[]};
 await writeFile(keyPolicy,JSON.stringify(policy),{mode:0o600});const command=[process.execPath,resolve('dist/src/backup-key-worker.js'),keyConfig];
 await writeFile(keyConfig,JSON.stringify({schema:1,trustModel:'host-root',socket:keySocket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot:keys,authorityFile:keyPolicy,sourceSocket,binary:process.env.PI_COFFEE_TEST_RESTIC,destination:disk,node:command[0],handler:command[1]}),{mode:0o600});
 const key=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',keyConfig],{stdio:'ignore'});await expect.poll(()=>stat(keySocket).then(()=>true,()=>false)).toBe(true);
 await writeFile(sourcePolicy,JSON.stringify({...policy,sourceProducers:[{listener:await identity(key.pid!),workerCommand:command}]}),{mode:0o600});
 const configuration=join(control,'source-configuration.json'),graph=join(control,'source-graph.json');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'ordinary-shared',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'domain',path:wrongRoots?join(root,'unrelated'):data}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'ordinary-shared',roots:[{id:'domain',scope:LEGACY_BACKUP_SCOPE,engine:'shared'}]}),{mode:0o600});
 await writeFile(profile,JSON.stringify({schema:1,root:join(control,'authority'),configuration,graph,sourceSocket,sourcePolicy,enrollment:{mode:'fresh',actor:'awangs'}}),{mode:0o600});
 await writeFile(client,JSON.stringify({schema:1,socket:keySocket,serviceUid:process.getuid!(),actor:'awangs',dataScope:LEGACY_BACKUP_SCOPE,authorityRevision:1}),{mode:0o600});
 await writeFile(preload,"import {access} from 'node:fs/promises';import {setTimeout} from 'node:timers/promises';const deadline=Date.now()+10000;while(!(await access("+JSON.stringify(gate)+").then(()=>true,()=>false))){if(Date.now()>deadline)throw Error('gate timeout');await setTimeout(10);}");
 const seedExtension=join(control,'seed.mjs');if(seed)await writeFile(seedExtension,"export default pi=>pi.registerCommand('fixture-seed',{handler:async(text,ctx)=>{ctx.sessionManager.appendMessage({role:'user',content:text,timestamp:Date.now()});const leaf=ctx.sessionManager.appendCustomEntry('fixture-seed',{});ctx.sessionManager.appendCustomEntry('fixture-end',{});await ctx.navigateTree(leaf,{summarize:false});}});",{mode:0o400});
 const child=spawn(process.execPath,['--import',preload,resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_WORKDIR:join(data,'work'),PI_COFFEE_SESSION_DIR:join(data,'sessions'),PI_COFFEE_AGENT_DIR:join(data,'pi'),PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_ORDINARY_SOURCE_PROFILE:profile,PI_COFFEE_BACKUP_BROKER_CLIENT:client,PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'127.0.0.1',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_EXTENSIONS:[resolve('node_modules/pi-coffee-harness'),...seed?[seedExtension]:[]].join(':'),PI_COFFEE_IDLE_TIMEOUT_MS:'100'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 policy.hostClients=[await identity(child.pid!),await identity(process.pid)];await writeFile(keyPolicy,JSON.stringify(policy));await writeFile(gate,'enrolled');
 const stop=async()=>{for(const process of [child,key])if(process.exitCode===null&&process.signalCode===null){const done=once(process,'exit');process.kill('SIGTERM');await done;}await rm(root,{recursive:true,force:true});};
 try{await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child.exitCode!==null?output:''),{timeout:15000}).toMatch(/^\d+$/);}catch(error){await stop();throw error;}
 const base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
 const post=async(path:string,body:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {root,data,control,sourceSocket,post,base,stop,client:new BackupRepositoryClient({socket:keySocket,serviceUid:process.getuid!(),actor:'awangs',dataScope:LEGACY_BACKUP_SCOPE,authorityRevision:1}),output:()=>output};
}
async function seedNative(f:Awaited<ReturnType<typeof fixture>>,name:string){let socket:WebSocket|undefined;try{const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'native-pi-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'opened'});socket.send(JSON.stringify({v:1,type:'rename_session',requestId:'name',name}));await expect.poll(()=>frames.find(frame=>frame.requestId==='name'),{timeout:10000}).toMatchObject({type:'ack'});socket.send(JSON.stringify({v:1,type:'get_commands'}));await expect.poll(()=>frames.find(frame=>frame.type==='commands'),{timeout:10000}).toBeDefined();expect(JSON.stringify(frames.find(frame=>frame.type==='commands'))).toContain('fixture-seed');const seedRequest='seed-'+name.replaceAll(' ','-');socket.send(JSON.stringify({v:1,type:'prompt',requestId:seedRequest,text:'/fixture-seed '+name}));await expect.poll(()=>frames.find(frame=>frame.requestId===seedRequest),{timeout:10000}).toMatchObject({type:'ack'});await expect.poll(async()=> (await readdir(join(f.data,'sessions'))).filter(name=>name.endsWith('.jsonl')),{timeout:5000}).not.toEqual([]);const done=once(socket,'close');socket.close();await done;socket=undefined;}finally{socket?.terminate();}}
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('actual ordinary Host opens named source and configures independent backup while an unstarted native source stays unqualified',async()=>{
 const f=await fixture();try{
  expect(await stat(f.sourceSocket).then(info=>info.isSocket(),()=>false)).toBe(true);
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const task=await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'ordinary-task'});expect(task.status).toBe(200);
  expect(await f.post('/api/backup',{action:'capture',taskId:'ordinary-task'})).toMatchObject({status:200,body:{state:'unavailable',checkpointId:null}});
 }finally{await f.stop();}
},45000);
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('actual Pi lifecycle with local synthetic history makes first and later ordinary cuts without a model turn',async()=>{
 const f=await fixture(true);let socket:WebSocket|undefined;try{
  const task=await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'native-pi-task'});expect(task.status).toBe(200);
  const rename=(name:string)=>seedNative(f,name);
  await rename('first native metadata');let first:any;await expect.poll(async()=>{first=await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'});return first;},{timeout:15000,interval:500}).toMatchObject({status:200,body:{state:'protected'}});
  await rename('second native metadata');let second:any;await expect.poll(async()=>{second=await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'});return second.body.checkpointId!==first.body.checkpointId?second:null;},{timeout:15000,interval:500}).toMatchObject({status:200,body:{state:'protected'}});
  expect(first.body.captureAt).not.toBe(second.body.captureAt);
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const recovery=await f.post('/api/backup',{action:'repository-export'});expect(recovery.status).toBe(200);expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:recovery.body.recoveryPackage})).status).toBe(200);
  expect((await f.post('/api/backup',{action:'repository-backup',taskId:'native-pi-task',checkpointId:randomUUID()})).status).toBe(409);
  const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'native-pi-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'opened'});
  expect((await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state).toBe('unavailable');
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'native-pi-task',checkpointId:first.body.checkpointId});expect(saved.status).toBe(200);expect(saved.body).toMatchObject({state:'succeeded',points:[{checkpointId:first.body.checkpointId,captureAt:first.body.captureAt}]});
  const restored=join(f.root,'restored');await f.client.extract(saved.body.id,restored);const point=join(restored,first.body.checkpointId),manifest=JSON.parse(await readFile(join(point,'manifest.json'),'utf8')),native=manifest.sources.find((source:any)=>source.recoveryKey.startsWith('native-session/'));
  const history=await readFile(join(point,'objects',native.id),'utf8');expect(history).toContain('first native metadata');expect(history).not.toContain('second native metadata');
  const request=await f.post('/api/backup',{action:'restore-request',taskId:'native-pi-task',jobId:saved.body.id});expect(request.status).toBe(200);
  const plan=await f.post('/api/backup',{action:'restore-plan',id:request.body.id,revision:request.body.revision});expect(plan).toEqual({status:409,body:{error:'Native source custody unavailable'}});expect((await f.client.recoveryPins()).some(pin=>pin.jobId===saved.body.id)).toBe(true);

 }finally{socket?.terminate();await f.stop();}
},90000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('existing unenrolled roots stay unknown without disabling ordinary task creation or independent repository readiness',async()=>{
 const f=await fixture(false,true);try{
  expect(await readFile(join(f.data,'preserve'),'utf8')).toBe('existing synthetic source');
  expect((await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'existing-task'})).status).toBe(200);
  expect(await f.post('/api/backup',{action:'capture',taskId:'existing-task'})).toMatchObject({status:200,body:{state:'unavailable',checkpointId:null}});
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  expect(await readFile(join(f.data,'preserve'),'utf8')).toBe('existing synthetic source');
 }finally{await f.stop();}
},30000);
it('invalid ordinary source profile cannot introduce a request-style known flag or leave a listener running',async()=>{
 const root=await mkdtemp('/tmp/ordinary-invalid-'),profile=join(root,'profile.json');let child:ReturnType<typeof spawn>|undefined;try{
  await writeFile(profile,JSON.stringify({schema:1,root:join(root,'authority'),configuration:join(root,'configuration.json'),graph:join(root,'graph.json'),sourceSocket:join(root,'source.sock'),sourcePolicy:join(root,'policy.json'),enrollment:{mode:'none'},known:true}),{mode:0o600});
  child=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_ORDINARY_SOURCE_PROFILE:profile,PI_COFFEE_HOST_PORT:'0',PI_COFFEE_TRANSFER_PORT:'0'},stdio:['ignore','pipe','pipe']});let output='';child.stdout!.on('data',chunk=>output+=chunk);child.stderr!.on('data',chunk=>output+=chunk);
  const exited=once(child,'exit');expect((await exited)[0]).toBe(1);expect(output).toContain('private explicit source profile');expect(output).not.toContain('Host ws://');expect(output).not.toContain('Transfer http://');expect(await stat(join(root,'work')).then(()=>true,()=>false)).toBe(false);
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(root,{recursive:true,force:true});}
},10000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('an enrolled unrelated directory cannot qualify the actual Host native and workspace roots',async()=>{
 const f=await fixture(true,false,true);try{
  expect((await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'native-pi-task'})).status).toBe(200);
  await seedNative(f,'unrelated root test');
  await expect.poll(async()=>{const raw=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));return raw.operations;},{timeout:10000}).toEqual([]);
  expect(await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).toMatchObject({status:200,body:{state:'unavailable',checkpointId:null}});
  expect((await f.post('/api/workspace',{action:'archive',id:'native-pi-task'})).status).toBe(200);
 }finally{await f.stop();}
},30000);
