import {it,expect} from 'vitest';
import {spawn,execFileSync} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,readdir,realpath} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {LEGACY_BACKUP_SCOPE} from '../src/host/backup.js';
import {WebSocket} from 'ws';
import {createServer} from 'node:net';
import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';
import {randomUUID,createHash} from 'node:crypto';
import {codexFixture} from './codex-recovery-fixture.js';
import {Workspaces} from '../src/host/workspaces.js';
import {SessionManager} from '@earendil-works/pi-coding-agent';
async function identity(pid:number){const raw=await readFile('/proc/'+pid+'/stat','utf8');return {pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function fixture(seed=false,existing=false,wrongRoots=false,enrollmentMode:'fresh'|'existing'='fresh',codex=false,coldPi=false,extraEnv:Record<string,string>={},neighbor=false,scheduled=false){
 const native=codex?await codexFixture():undefined;
 const root=await mkdtemp('/tmp/ordinary-main-'),data=native?.root??join(root,'data'),control=join(root,'control'),disk=join(root,'disk'),keys=join(root,'keys');for(const dir of [control,disk,keys])await mkdir(dir,{mode:0o700});
 if(existing){await mkdir(data,{mode:0o700,recursive:true});await writeFile(join(data,'preserve'),'existing synthetic source');}
 if(coldPi){const store=new Workspaces(join(data,'work','projects'));for(const id of ['native-pi-task',...neighbor?['native-pi-neighbor']:[]]){const task=await store.createChatConversation(id,'pi'),session=SessionManager.create(task.cwd,join(data,'sessions'));session.appendMessage({role:'user',content:id==='native-pi-task'?'Cold synthetic Pi history':'Surviving Pi neighbor',timestamp:1});await store.setNativeBinding(task.id,{state:'bound',id:session.getSessionId()});}}
 if(native&&neighbor){const task=await native.store.createChatConversation('codex-neighbor','codex'),id=randomUUID(),rollout=join(native.home,'sessions','2026','10','25','rollout-2026-10-25T12-00-00-'+id+'.jsonl');await native.store.setNativeBinding(task.id,{state:'bound',id});await writeFile(rollout,(await readFile(native.rollout,'utf8')).replaceAll(native.id,id).replaceAll(native.task.cwd,task.cwd).replaceAll('The ordinary question','Surviving Codex neighbor question').replaceAll('The ordinary answer','Surviving Codex neighbor answer'));execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row;row=dict(c.execute('SELECT * FROM threads WHERE id=?',(sys.argv[2],)).fetchone());row.update(id=sys.argv[3],rollout_path=sys.argv[4],cwd=sys.argv[5]);c.execute('INSERT INTO threads ('+','.join(row)+') VALUES ('+','.join('?' for _ in row)+')',list(row.values()));c.commit();c.close()",join(native.sql,'state_5.sqlite'),native.id,id,rollout,task.cwd]);}
 if(scheduled){const reserved=createServer();reserved.listen(0,'127.0.0.1');await once(reserved,'listening');const port=(reserved.address() as import('node:net').AddressInfo).port;await new Promise<void>((done,error)=>reserved.close(reason=>reason?error(reason):done()));const tokenFile=join(control,'inventory-token');await writeFile(tokenFile,'fixture',{mode:0o600});extraEnv={...extraEnv,PI_COFFEE_HOST_PORT:String(port),PI_COFFEE_BACKUP_INVENTORY_URL:'http://127.0.0.1:'+port,PI_COFFEE_BACKUP_INVENTORY_TOKEN_FILE:tokenFile};}
 const keySocket=join(root,'key.sock'),sourceSocket=join(root,'source.sock'),keyConfig=join(control,'key.json'),keyPolicy=join(control,'key-policy.json'),sourcePolicy=join(control,'source-policy.json'),profile=join(control,'ordinary.json'),client=join(control,'client.json'),gate=join(control,'start'),preload=join(control,'gate.mjs');
 const policy={schema:1,revision:1,administrator:'awangs',scopes:[LEGACY_BACKUP_SCOPE],actors:{awangs:{role:'administrator',scopes:[LEGACY_BACKUP_SCOPE]}},hostClients:[] as Awaited<ReturnType<typeof identity>>[]};
 await writeFile(keyPolicy,JSON.stringify(policy),{mode:0o600});const command=[process.execPath,resolve('dist/src/backup-key-worker.js'),keyConfig];
 await writeFile(keyConfig,JSON.stringify({schema:1,trustModel:'host-root',socket:keySocket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot:keys,authorityFile:keyPolicy,sourceSocket,binary:process.env.PI_COFFEE_TEST_RESTIC,destination:disk,node:command[0],handler:command[1]}),{mode:0o600});
 const key=spawn(await realpath('/usr/bin/python3'),[resolve('dist/src/host/backup-unix-peer.py'),'serve',keyConfig],{stdio:'ignore'});await expect.poll(()=>stat(keySocket).then(()=>true,()=>false)).toBe(true);
 await writeFile(sourcePolicy,JSON.stringify({...policy,sourceProducers:[{listener:await identity(key.pid!),workerCommand:command}]}),{mode:0o600});
 const configuration=join(control,'source-configuration.json'),graph=join(control,'source-graph.json');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'ordinary-shared',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'domain',path:wrongRoots?join(root,'unrelated'):data}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'ordinary-shared',roots:[{id:'domain',scope:LEGACY_BACKUP_SCOPE,engine:'shared'}]}),{mode:0o600});
 await writeFile(profile,JSON.stringify({schema:1,root:join(control,'authority'),configuration,graph,sourceSocket,sourcePolicy,enrollment:{mode:enrollmentMode,actor:'awangs'}}),{mode:0o600});
 await writeFile(client,JSON.stringify({schema:1,socket:keySocket,serviceUid:process.getuid!(),actor:'awangs',dataScope:LEGACY_BACKUP_SCOPE,authorityRevision:1}),{mode:0o600});
 await writeFile(preload,"import {access} from 'node:fs/promises';import {setTimeout} from 'node:timers/promises';const deadline=Date.now()+10000;while(!(await access("+JSON.stringify(gate)+").then(()=>true,()=>false))){if(Date.now()>deadline)throw Error('gate timeout');await setTimeout(10);}");
 const seedExtension=join(control,'seed.mjs');if(seed)await writeFile(seedExtension,"export default pi=>pi.registerCommand('fixture-seed',{handler:async(text,ctx)=>{ctx.sessionManager.appendMessage({role:'user',content:text,timestamp:Date.now()});const leaf=ctx.sessionManager.appendCustomEntry('fixture-seed',{});ctx.sessionManager.appendCustomEntry('fixture-end',{});await ctx.navigateTree(leaf,{summarize:false});}});",{mode:0o400});
 let child:ReturnType<typeof spawn>,output='',base='';
 const launch=async()=>{output='';await rm(gate,{force:true});child=spawn(process.execPath,['--import',preload,resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_WORKDIR:native?join(data,'alice'):join(data,'work'),...(native?{PI_COFFEE_CODEX_COMMAND:join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex'),PI_COFFEE_CODEX_HOME:native.home,CODEX_SQLITE_HOME:native.sql}:{}),PI_COFFEE_SESSION_DIR:join(data,'sessions'),PI_COFFEE_AGENT_DIR:join(data,'pi'),PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_ORDINARY_SOURCE_PROFILE:profile,PI_COFFEE_BACKUP_BROKER_CLIENT:client,PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'127.0.0.1',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_EXTENSIONS:[resolve('node_modules/pi-coffee-harness'),...seed?[seedExtension]:[]].join(':'),PI_COFFEE_IDLE_TIMEOUT_MS:'100',...extraEnv},stdio:['ignore','pipe','pipe']});child.stdout!.on('data',chunk=>output+=chunk);child.stderr!.on('data',chunk=>output+=chunk);
 policy.hostClients=[await identity(child.pid!),await identity(process.pid)];await writeFile(keyPolicy,JSON.stringify(policy));await writeFile(gate,'enrolled');
 try{await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child.exitCode!==null?output:''),{timeout:15000}).toMatch(/^\d+$/);}catch(error){await stop();throw error;}
 base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
 };
 const stopProcess=async(process:ReturnType<typeof spawn>)=>{if(process.exitCode===null&&process.signalCode===null){const done=once(process,'exit');let forced=false;const timer=setTimeout(()=>{forced=true;process.kill('SIGKILL');},15000);process.kill('SIGTERM');try{await done;if(forced)throw Error('Synthetic Host did not shut down within its test budget');}finally{clearTimeout(timer);}}};
 const stop=async()=>{if(child)await stopProcess(child);await stopProcess(key);await rm(root,{recursive:true,force:true});if(native)await rm(native.root,{recursive:true,force:true});};
 await launch();
 const restart=async(beforeStart?:()=>Promise<void>)=>{await stopProcess(child);await beforeStart?.();await launch();};
 const crashRestart=async()=>{const done=once(child,'exit');child.kill('SIGKILL');await done;await launch();};
 const post=async(path:string,body:unknown)=>{const response=await fetch(base+path,{method:'POST',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {root,data,control,sourceSocket,post,get base(){return base;},stop,restart,crashRestart,native,client:new BackupRepositoryClient({socket:keySocket,serviceUid:process.getuid!(),actor:'awangs',dataScope:LEGACY_BACKUP_SCOPE,authorityRevision:1}),output:()=>output};
}
async function captureReady(f:Awaited<ReturnType<typeof fixture>>,taskId:string){
 const observations:{status:number;state?:string;error?:string}[]=[];
 await expect.poll(async()=>{const response=await f.post('/api/backup',{action:'capture',taskId});observations.push({status:response.status,state:response.body.state,error:response.body.error});return response;},{timeout:15000,interval:500}).toMatchObject({status:200,body:{state:'protected'}});
 const busy=['Capture already running for this task','Another low-priority capture is running'];
 expect(observations.filter(row=>row.status===409?!busy.includes(row.error??''):row.status!==200||!['protected','capturing','waiting','unavailable'].includes(row.state??''))).toEqual([]);
 console.info('Synthetic capture readiness',JSON.stringify(observations.map(row=>row.status+'/'+(row.state??'capture_busy'))));
}
async function codexNeighborSnapshot(f:Awaited<ReturnType<typeof fixture>>){
 const native=f.native!,task=(await new Workspaces(join(f.data,'alice','projects')).lookup('codex-neighbor'))!;
 const row=JSON.parse(execFileSync('/usr/bin/python3',['-c',"import sqlite3,json,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;print(json.dumps(dict(c.execute('SELECT id,rollout_path,cwd,title,model_provider,cli_version,history_mode FROM threads WHERE id=?',(sys.argv[2],)).fetchone())));c.close()",join(native.sql,'state_5.sqlite'),task.nativeBinding!.id!],{encoding:'utf8'}));
 return {row,history:await readFile(row.rollout_path,'utf8')};
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
  expect((await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state).toBe('waiting');
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'native-pi-task',checkpointId:first.body.checkpointId});expect(saved.status).toBe(200);expect(saved.body).toMatchObject({state:'succeeded',points:[{checkpointId:first.body.checkpointId,captureAt:first.body.captureAt}]});
  const restored=join(f.root,'restored');await f.client.extract(saved.body.id,restored);const point=join(restored,first.body.checkpointId),manifest=JSON.parse(await readFile(join(point,'manifest.json'),'utf8')),native=manifest.sources.find((source:any)=>source.recoveryKey.startsWith('native-session/'));
  const history=await readFile(join(point,'objects',native.id),'utf8');expect(history).toContain('first native metadata');expect(history).not.toContain('second native metadata');
  const request=await f.post('/api/backup',{action:'restore-request',taskId:'native-pi-task',jobId:saved.body.id});expect(request.status).toBe(200);
  const plan=await f.post('/api/backup',{action:'restore-plan',id:request.body.id,revision:request.body.revision});expect(plan).toEqual({status:409,body:{error:'Trusted source ownership or writer coverage is unqualified'}});expect((await f.client.recoveryPins()).some(pin=>pin.jobId===saved.body.id)).toBe(true);

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

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('explicit existing-source mode waits for actual Pi history lifecycle then qualifies through ordinary main',async()=>{
 const f=await fixture(true,true,false,'existing');try{
  expect((await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'native-pi-task'})).status).toBe(200);
  expect((await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state).toBe('unavailable');
  await seedNative(f,'existing-source native evidence');
  await expect.poll(async()=> (await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state,{timeout:15000,interval:500}).toBe('protected');
  expect(await readFile(join(f.data,'preserve'),'utf8')).toBe('existing synthetic source');
  const state=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));expect(state.enrollment.initialCheckpoint).toMatch(/^[a-f0-9-]{36}$/);expect(state.enrollment.handoffDigest).toMatch(/^[a-f0-9]{64}$/);
 }finally{await f.stop();}
},45000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC||!process.env.PI_COFFEE_TEST_CODEX_ROOT)('actual ordinary main qualifies existing Codex history and requalifies a same-boot Host restart without a model turn',async()=>{
 const f=await fixture(false,true,false,'existing',true);let socket:WebSocket|undefined;try{
  await captureReady(f,'codex-task');
  const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'codex-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:20000}).toMatchObject({type:'opened'});
  await expect.poll(()=>JSON.stringify(frames.find(frame=>frame.type==='history')?.entries),{timeout:10000}).toContain('The ordinary answer');
  const closed=once(socket,'close');socket.close();await closed;socket=undefined;
  let first:any;await expect.poll(async()=>{first=await f.post('/api/backup',{action:'capture',taskId:'codex-task'});return first.body.state;},{timeout:20000,interval:500}).toBe('protected');
  const state=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));expect(state.enrollment.handoffDigest).toMatch(/^[a-f0-9]{64}$/);
  await f.restart();let second:any;await expect.poll(async()=>{second=await f.post('/api/backup',{action:'capture',taskId:'codex-task'});return second.body.state;},{timeout:15000,interval:500}).toBe('protected');expect(second.body.checkpointId).not.toBe(first.body.checkpointId);
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);const exported=await f.post('/api/backup',{action:'repository-export'});expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:exported.body.recoveryPackage})).status).toBe(200);
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'codex-task',checkpointId:first.body.checkpointId});expect(saved.status).toBe(200);expect(saved.body).toMatchObject({state:'succeeded',points:[{checkpointId:first.body.checkpointId}]});
  const restored=join(f.root,'codex-restored');await f.client.extract(saved.body.id,restored);const point=join(restored,first.body.checkpointId),manifest=JSON.parse(await readFile(join(point,'manifest.json'),'utf8'));const history=await Promise.all(manifest.sources.filter((source:any)=>source.recoveryKey.startsWith('codex/rollout/')).map((source:any)=>readFile(join(point,'objects',source.id)).then(data=>data.toString('utf8'))));expect(history.some(text=>text.includes('The ordinary question')&&text.includes('The ordinary answer'))).toBe(true);
 }finally{socket?.terminate();await f.stop();}
},90000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('a cold existing Pi source obtains its first checkpoint without any viewer, prompt or manual native open',async()=>{
 const f=await fixture(false,true,false,'existing',false,true);try{
  await expect.poll(async()=> (await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state,{timeout:20000,interval:1000}).toBe('protected');
  const state=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));expect(state.enrollment.handoffDigest).toMatch(/^[a-f0-9]{64}$/);expect(await readFile(join(f.data,'preserve'),'utf8')).toBe('existing synthetic source');
 }finally{await f.stop();}
},45000);
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC||!process.env.PI_COFFEE_TEST_CODEX_ROOT)('a cold existing Codex source obtains its first checkpoint without any viewer, prompt or manual native open',async()=>{
 const f=await fixture(false,true,false,'existing',true);try{
  await expect.poll(async()=> (await f.post('/api/backup',{action:'capture',taskId:'codex-task'})).body.state,{timeout:20000,interval:1000}).toBe('protected');
  const state=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));expect(state.enrollment.handoffDigest).toMatch(/^[a-f0-9]{64}$/);expect(await readFile(join(f.data,'preserve'),'utf8')).toBe('existing synthetic source');
 }finally{await f.stop();}
},45000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('SIMULATED prior-boot receipts: actual ordinary startup performs a new owned Pi audit and preserves old custody evidence',async()=>{
 const f=await fixture(false,true,false,'existing',false,true),preserved=new Map<string,string>();try{
  await captureReady(f,'native-pi-task');
  await f.restart(async()=>{
   const root=join(f.control,'authority','custody'),boot='11111111-1111-4111-8111-111111111111',hash=(value:string)=>createHash('sha256').update(value).digest('hex');
   for(const entry of (await readdir(root)).filter(name=>name!=='group-lock.json')){
    const dir=join(root,entry),command=JSON.parse(await readFile(join(dir,'command.json'),'utf8')),receipt=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));expect(command.schema).toBe(2);expect(receipt.state).toBe('quiescent');command.boot=boot;const commandText=JSON.stringify(command);receipt.boot=boot;receipt.commandDigest=hash(commandText);await writeFile(join(dir,'command.json'),commandText);
    const observation=await readFile(join(dir,'history-observation.json'),'utf8').then(text=>JSON.parse(text),()=>undefined);if(observation){observation.boot=boot;observation.commandDigest=hash(commandText);const text=JSON.stringify(observation);receipt.observationDigest=hash(text);await writeFile(join(dir,'history-observation.json'),text);const close=await readFile(join(dir,'normal-close.json'),'utf8').then(JSON.parse,error=>{if(error.code==='ENOENT')return undefined;throw error;});if(close){close.boot=boot;close.observationDigest=hash(text);const closeText=JSON.stringify(close);receipt.closeDigest=hash(closeText);await writeFile(join(dir,'normal-close.json'),closeText);}else expect(receipt.nativeStatus).toBe(0);}
    const path=join(dir,'state.json'),text=JSON.stringify(receipt);await writeFile(path,text);preserved.set(path,text);
   }
  });
  await captureReady(f,'native-pi-task');for(const [path,text]of preserved)expect(await readFile(path,'utf8')).toBe(text);
  const root=join(f.control,'authority','custody'),currentBoot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();const receipts=await Promise.all((await readdir(root)).filter(name=>name!=='group-lock.json').map(name=>readFile(join(root,name,'state.json'),'utf8').then(JSON.parse)));expect(receipts.some(row=>row.boot===currentBoot&&row.state==='quiescent'&&row.observationDigest)).toBe(true);
 }finally{await f.stop();}
},60000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('ordinary Host restart refuses source requalification after administrator downgrade while task operations and repository readiness continue',async()=>{
 const f=await fixture(true,true,false,'existing');try{
  expect((await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'native-pi-task'})).status).toBe(200);await seedNative(f,'before source role downgrade');
  await expect.poll(async()=> (await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state,{timeout:15000,interval:500}).toBe('protected');
  await f.restart(async()=>{const file=join(f.control,'source-policy.json'),policy=JSON.parse(await readFile(file,'utf8'));policy.actors.awangs.role='reader';await writeFile(file,JSON.stringify(policy));});
  expect((await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state).toBe('unavailable');
  const state=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));expect(state.issues).toContain('authority-reopened');
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);expect((await f.post('/api/workspace',{action:'archive',id:'native-pi-task'})).status).toBe(200);
 }finally{await f.stop();}
},45000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('ordinary main honors the configured file budget for initial existing-source sealing after a successful native audit',async()=>{
 const f=await fixture(false,true,false,'existing',false,true,{PI_COFFEE_BACKUP_MAX_FILES:'1'});try{
  expect((await f.post('/api/backup',{action:'capture',taskId:'native-pi-task'})).body.state).toBe('unavailable');
  const root=join(f.control,'authority','custody'),receipts=await Promise.all((await readdir(root)).filter(name=>name!=='group-lock.json').map(name=>readFile(join(root,name,'state.json'),'utf8').then(JSON.parse)));expect(receipts.some(row=>row.state==='quiescent'&&row.observationDigest)).toBe(true);
  const state=JSON.parse(await readFile(join(f.control,'authority','enrollment','state.json'),'utf8'));expect(state.enrollment).toBeUndefined();expect(await readdir(join(f.root,'backup','checkpoints','sealed')).catch(()=>[])).toEqual([]);
  expect((await f.post('/api/workspace',{action:'archive',id:'native-pi-task'})).status).toBe(200);
 }finally{await f.stop();}
},45000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('actual ordinary Host SIGKILL restart reclaims only its owned stale source socket and requalifies existing Pi data',async()=>{
 const f=await fixture(false,true,false,'existing',false,true);try{
  await captureReady(f,'native-pi-task');const ownerFile=join(f.root,'.source.sock.authority','owner.json'),before=JSON.parse(await readFile(ownerFile,'utf8'));
  await f.crashRestart();const after=JSON.parse(await readFile(ownerFile,'utf8'));expect(after.owner.pid).not.toBe(before.owner.pid);expect((await stat(f.sourceSocket)).isSocket()).toBe(true);
  await captureReady(f,'native-pi-task');expect(await readFile(join(f.data,'preserve'),'utf8')).toBe('existing synthetic source');
 }finally{await f.stop();}
},45000);


it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC).each([true,false])('ordinary main publishes a missing Pi task with original native history (surviving neighbor: %s)',async(neighbor)=>{
 const f=await fixture(false,true,false,'existing',false,true,{},neighbor);let socket:WebSocket|undefined;
 try{
  await captureReady(f,'native-pi-task');
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const exported=await f.post('/api/backup',{action:'repository-export'});expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:exported.body.recoveryPackage})).status).toBe(200);
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'native-pi-task'});expect(saved).toMatchObject({status:200,body:{state:'succeeded'}});
  const files=(await readdir(join(f.data,'sessions'))).filter(name=>name.endsWith('.jsonl'));expect(files).toHaveLength(neighbor?2:1);
  const original=(await new Workspaces(join(f.data,'work','projects')).lookup('native-pi-task'))!.nativeBinding!.id!;const lostFile=files.find(name=>SessionManager.open(join(f.data,'sessions',name)).getSessionId()===original)!;
  const neighborFile=neighbor?files.find(name=>name!==lostFile):undefined,neighborBytes=neighborFile?await readFile(join(f.data,'sessions',neighborFile)):undefined;
  await f.restart(async()=>{const store=new Workspaces(join(f.data,'work','projects'));await store.archive('native-pi-task',true);await store.deleteWorkspace('native-pi-task','native-pi-task',()=>rm(join(f.data,'sessions',lostFile)),true);});
  if(neighbor)await captureReady(f,'native-pi-neighbor');
  const requested=await f.post('/api/backup',{action:'restore-request',taskId:'native-pi-task',jobId:saved.body.id});expect(requested.status).toBe(200);
  const planned=await f.post('/api/backup',{action:'restore-plan',id:requested.body.id,revision:requested.body.revision});expect(planned,JSON.stringify(planned)).toMatchObject({status:200,body:{state:'staged'}});
  const approval={id:planned.body.id,revision:planned.body.revision,digest:planned.body.digest};
  expect((await f.post('/api/backup',{action:'restore-publish',...approval})).status).toBe(409);
  expect(await f.post('/api/backup',{action:'restore-approve',...approval})).toMatchObject({status:200,body:{state:'approved'}});
  const published=await f.post('/api/backup',{action:'restore-publish',...approval});expect(published).toMatchObject({status:200,body:{state:'completed'}});
  expect(await f.post('/api/backup',{action:'restore-publish',...approval})).toMatchObject({status:200,body:{state:'completed'}});
  // Recovery must regain a real cold source cut before a viewer opens native history.
  await captureReady(f,'native-pi-task');
  if(neighborFile)expect(await readFile(join(f.data,'sessions',neighborFile))).toEqual(neighborBytes);
  const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'native-pi-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'opened'});
  await expect.poll(()=>JSON.stringify(frames.find(frame=>frame.type==='history')?.entries),{timeout:10000}).toContain('Cold synthetic Pi history');expect(frames.filter(frame=>frame.type==='error')).toEqual([]);
  const restoredFiles=(await readdir(join(f.data,'sessions'))).filter(name=>name.endsWith('.jsonl'));expect(restoredFiles).toHaveLength(neighbor?2:1);expect(SessionManager.open(join(f.data,'sessions',lostFile)).getSessionId()).toBe(original);
 }finally{socket?.terminate();await f.stop();}
},90000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC||!process.env.PI_COFFEE_TEST_CODEX_ROOT).each([true,false])('ordinary main publishes a missing Codex task with original native history (surviving neighbor: %s)',async(neighbor)=>{
 const f=await fixture(false,true,false,'existing',true,false,{},neighbor);let socket:WebSocket|undefined;
 try{
  await captureReady(f,'codex-task');
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const exported=await f.post('/api/backup',{action:'repository-export'});expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:exported.body.recoveryPackage})).status).toBe(200);
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'codex-task'});expect(saved).toMatchObject({status:200,body:{state:'succeeded'}});
  const original=f.native!.id,neighborBefore=neighbor?await codexNeighborSnapshot(f):undefined;
  await f.restart(async()=>{const store=new Workspaces(join(f.data,'alice','projects'));await store.archive('codex-task',true);await store.deleteWorkspace('codex-task','codex-task',()=>rm(f.native!.rollout),true);execFileSync('/usr/bin/python3',['-c',"import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('DELETE FROM threads WHERE id=?',(sys.argv[2],));c.commit();c.close()",join(f.native!.sql,'state_5.sqlite'),original]);});
  if(neighbor)await captureReady(f,'codex-neighbor');
  const requested=await f.post('/api/backup',{action:'restore-request',taskId:'codex-task',jobId:saved.body.id});expect(requested.status).toBe(200);
  const planned=await f.post('/api/backup',{action:'restore-plan',id:requested.body.id,revision:requested.body.revision});expect(planned,JSON.stringify(planned)).toMatchObject({status:200,body:{state:'staged'}});
  const approval={id:planned.body.id,revision:planned.body.revision,digest:planned.body.digest};
  expect((await f.post('/api/backup',{action:'restore-publish',...approval})).status).toBe(409);
  expect(await f.post('/api/backup',{action:'restore-approve',...approval})).toMatchObject({status:200,body:{state:'approved'}});
  const published=await f.post('/api/backup',{action:'restore-publish',...approval});expect(published).toMatchObject({status:200,body:{state:'completed'}});
  expect(await f.post('/api/backup',{action:'restore-publish',...approval})).toMatchObject({status:200,body:{state:'completed'}});
  // Recovery must regain a real cold source cut before a viewer opens native history.
  await captureReady(f,'codex-task');
  if(neighbor)expect(await codexNeighborSnapshot(f)).toEqual(neighborBefore);
  const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'codex-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'opened'});
  await expect.poll(()=>JSON.stringify(frames.find(frame=>frame.type==='history')?.entries),{timeout:10000}).toContain('The ordinary answer');expect(JSON.stringify(frames.find(frame=>frame.type==='history')?.entries)).toContain('The ordinary question');expect(frames.filter(frame=>frame.type==='error')).toEqual([]);
  const restored=(await new Workspaces(join(f.data,'alice','projects')).lookup('codex-task'))!;expect(restored.nativeBinding!.id).toBe(original);expect(JSON.parse((await readFile(f.native!.rollout,'utf8')).split('\n')[0]).payload.id).toBe(original);
 }finally{socket?.terminate();await f.stop();}
},90000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('ordinary main publishes a missing Pi task into an explicitly fresh empty source with original native history',async()=>{
 const f=await fixture(false,true,false,'existing',false,true);let socket:WebSocket|undefined;
 try{
  await captureReady(f,'native-pi-task');
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const exported=await f.post('/api/backup',{action:'repository-export'});expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:exported.body.recoveryPackage})).status).toBe(200);
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'native-pi-task'});expect(saved).toMatchObject({status:200,body:{state:'succeeded'}});
  const files=(await readdir(join(f.data,'sessions'))).filter(name=>name.endsWith('.jsonl'));expect(files).toHaveLength(1);
  const original=(await new Workspaces(join(f.data,'work','projects')).lookup('native-pi-task'))!.nativeBinding!.id!;const lostFile=files.find(name=>SessionManager.open(join(f.data,'sessions',name)).getSessionId()===original)!;
  await f.restart(async()=>{await rm(f.data,{recursive:true});const profile=join(f.control,'ordinary.json'),value=JSON.parse(await readFile(profile,'utf8'));value.root=join(f.control,'fresh-authority');value.enrollment.mode='fresh';await writeFile(profile,JSON.stringify(value));});
  const requested=await f.post('/api/backup',{action:'restore-request',taskId:'native-pi-task',jobId:saved.body.id});expect(requested.status).toBe(200);
  const planned=await f.post('/api/backup',{action:'restore-plan',id:requested.body.id,revision:requested.body.revision});expect(planned,JSON.stringify(planned)).toMatchObject({status:200,body:{state:'staged'}});
  const approval={id:planned.body.id,revision:planned.body.revision,digest:planned.body.digest};
  expect((await f.post('/api/backup',{action:'restore-publish',...approval})).status).toBe(409);
  expect(await f.post('/api/backup',{action:'restore-approve',...approval})).toMatchObject({status:200,body:{state:'approved'}});
  const published=await f.post('/api/backup',{action:'restore-publish',...approval});expect(published).toMatchObject({status:200,body:{state:'completed'}});
  expect(await f.post('/api/backup',{action:'restore-publish',...approval})).toMatchObject({status:200,body:{state:'completed'}});
  // Recovery must regain a real cold source cut before a viewer opens native history.
  await captureReady(f,'native-pi-task');
  const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'native-pi-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'opened'});
  await expect.poll(()=>JSON.stringify(frames.find(frame=>frame.type==='history')?.entries),{timeout:10000}).toContain('Cold synthetic Pi history');expect(frames.filter(frame=>frame.type==='error')).toEqual([]);
  const restoredFiles=(await readdir(join(f.data,'sessions'))).filter(name=>name.endsWith('.jsonl'));expect(restoredFiles).toHaveLength(1);expect(SessionManager.open(join(f.data,'sessions',lostFile)).getSessionId()).toBe(original);
 }catch(error){console.error('Synthetic Host diagnostics',f.output());throw error;}finally{socket?.terminate();await f.stop();}
},90000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('ordinary fixed scheduler automatically saves a due daily point through the independent broker and verifies repository bytes',async()=>{
 const f=await fixture(false,true,false,'existing',false,true,{},false,true);let scheduler:ReturnType<typeof spawn>|undefined;let output='';
 try{
  await captureReady(f,'native-pi-task');
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const exported=await f.post('/api/backup',{action:'repository-export'});expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:exported.body.recoveryPackage})).status).toBe(200);
  expect(await f.client.jobs()).toEqual([]);
  const now=new Date(),configured=await f.post('/api/backup',{action:'schedule-configure',revision:'ordinary-daily-fixture',scopes:[LEGACY_BACKUP_SCOPE],timeZone:'UTC',hour:now.getUTCHours(),minute:now.getUTCMinutes()});expect(configured,JSON.stringify(configured)).toMatchObject({status:200,body:{schedule:{configured:true}}});
  const startupRoot=join(f.control,'startup'),profile=join(f.control,'startup.json');await mkdir(startupRoot,{mode:0o700});const python=await realpath('/usr/bin/python3');await writeFile(profile,JSON.stringify({schema:1,root:startupRoot,releaseRoot:await realpath(resolve('.')),node:process.execPath,python,keyConfig:join(f.control,'key.json'),sourcePolicy:join(f.control,'source-policy.json'),brokerProfile:join(f.control,'client.json'),backupRoot:join(f.root,'backup')}),{mode:0o600});
  scheduler=spawn(python,[resolve('dist/src/host/ordinary-backup-start.py'),profile,'scheduler'],{env:{PATH:process.env.PATH,HOME:f.root,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe']});scheduler.stdout!.on('data',chunk=>output+=chunk);scheduler.stderr!.on('data',chunk=>output+=chunk);
  let status:any;await expect.poll(async()=>{status=await f.post('/api/backup',{action:'status',scope:LEGACY_BACKUP_SCOPE});return status;},{timeout:45000,interval:1000}).toMatchObject({status:200,body:{schedule:{workerState:'recent',coverage:{state:'complete',inventoryAvailable:true,repositoryAvailable:true},runs:[{state:'succeeded',attempts:[{state:'succeeded'}]}]}}});
  expect(scheduler.exitCode,output).toBeNull();const jobs=await f.client.jobs();expect(jobs).toHaveLength(1);expect(jobs[0]).toMatchObject({id:status.body.schedule.runs[0].attempts[0].id,state:'succeeded',verification:'repository-read',points:[{taskId:'native-pi-task',engine:'pi'}]});
  const restored=join(f.root,'scheduled-material');await f.client.extract(jobs[0].id,restored);const point=join(restored,jobs[0].points[0].checkpointId),manifest=JSON.parse(await readFile(join(point,'manifest.json'),'utf8')),native=manifest.sources.find((source:any)=>source.recoveryKey.startsWith('native-session/'));expect(await readFile(join(point,'objects',native.id),'utf8')).toContain('Cold synthetic Pi history');
 }catch(error){console.error('Synthetic scheduler diagnostics',output,f.output());throw error;}finally{if(scheduler&&scheduler.exitCode===null&&scheduler.signalCode===null){const closed=once(scheduler,'close');scheduler.kill('SIGTERM');const timer=setTimeout(()=>scheduler!.kill('SIGKILL'),10000);try{await closed;}finally{clearTimeout(timer);}}await f.stop();}
},90000);

it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC||!process.env.PI_COFFEE_TEST_CODEX_ROOT)('ordinary main publishes a missing Codex task into an explicitly fresh empty source, then reopens original history after new provider configuration',async()=>{
 const f=await fixture(false,true,false,'existing',true);let socket:WebSocket|undefined;
 try{
  await captureReady(f,'codex-task');
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const exported=await f.post('/api/backup',{action:'repository-export'});expect((await f.post('/api/backup',{action:'repository-verify',recoveryPackage:exported.body.recoveryPackage})).status).toBe(200);
  const saved=await f.post('/api/backup',{action:'repository-backup',taskId:'codex-task'});expect(saved).toMatchObject({status:200,body:{state:'succeeded'}});
  const original=f.native!.id;
  await f.restart(async()=>{await rm(f.data,{recursive:true});const profile=join(f.control,'ordinary.json'),value=JSON.parse(await readFile(profile,'utf8'));value.root=join(f.control,'fresh-authority');value.enrollment.mode='fresh';await writeFile(profile,JSON.stringify(value));});
  const requested=await f.post('/api/backup',{action:'restore-request',taskId:'codex-task',jobId:saved.body.id});expect(requested.status).toBe(200);
  const planned=await f.post('/api/backup',{action:'restore-plan',id:requested.body.id,revision:requested.body.revision});expect(planned,JSON.stringify(planned)).toMatchObject({status:200,body:{state:'staged'}});
  const approval={id:planned.body.id,revision:planned.body.revision,digest:planned.body.digest};
  expect((await f.post('/api/backup',{action:'restore-publish',...approval})).status).toBe(409);
  expect(await f.post('/api/backup',{action:'restore-approve',...approval})).toMatchObject({status:200,body:{state:'approved'}});
  const published=await f.post('/api/backup',{action:'restore-publish',...approval});expect(published).toMatchObject({status:200,body:{state:'completed'}});
  expect(await f.post('/api/backup',{action:'restore-publish',...approval})).toMatchObject({status:200,body:{state:'completed'}});
  // Recovery must regain a real cold source cut before a viewer opens native history.
  await captureReady(f,'codex-task');
  expect(await stat(join(f.native!.home,'config.toml')).then(()=>true,()=>false)).toBe(false);
  const denied:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>denied.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'codex-task',nativeProtocol:1}));await expect.poll(()=>denied.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'error',code:'operation_failed',message:'Native authentication required; configure this CLI on the User VM'});const closed=once(socket,'close');socket.close();await closed;socket=undefined;
  // The operator provisions a NEW offline fixture provider after loss. No historical config or credential is restored.
  await f.restart(async()=>{await writeFile(join(f.native!.home,'config.toml'),'model="gpt-6.1-sol"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="new-offline-fixture"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n',{mode:0o600});const profile=join(f.control,'ordinary.json'),value=JSON.parse(await readFile(profile,'utf8'));value.enrollment.mode='existing';await writeFile(profile,JSON.stringify(value));});
  await captureReady(f,'codex-task');
  const frames:any[]=[];socket=new WebSocket(f.base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs'}});socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'codex-task',nativeProtocol:1}));await expect.poll(()=>frames.find(frame=>frame.type==='opened'||frame.type==='error'),{timeout:15000}).toMatchObject({type:'opened'}).catch(error=>{console.error('Synthetic native open error',frames.filter(frame=>frame.type==='error'));throw error;});
  await expect.poll(()=>JSON.stringify(frames.find(frame=>frame.type==='history')?.entries),{timeout:10000}).toContain('The ordinary answer');expect(JSON.stringify(frames.find(frame=>frame.type==='history')?.entries)).toContain('The ordinary question');expect(frames.filter(frame=>frame.type==='error')).toEqual([]);
  const restored=(await new Workspaces(join(f.data,'alice','projects')).lookup('codex-task'))!;expect(restored.nativeBinding!.id).toBe(original);expect(JSON.parse((await readFile(f.native!.rollout,'utf8')).split('\n')[0]).payload.id).toBe(original);
 }catch(error){console.error('Synthetic Host diagnostics',f.output());throw error;}finally{socket?.terminate();await f.stop();}
},90000);
