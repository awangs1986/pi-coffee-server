import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {LEGACY_BACKUP_SCOPE} from '../src/host/backup.js';
import {WebSocket} from 'ws';
async function identity(pid:number){const raw=await readFile('/proc/'+pid+'/stat','utf8');return {pid,uid:process.getuid!(),boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),birth:raw.slice(raw.lastIndexOf(')')+2).split(' ')[19]};}
async function fixture(){
 const root=await mkdtemp('/tmp/ordinary-main-'),data=join(root,'data'),control=join(root,'control'),disk=join(root,'disk'),keys=join(root,'keys');for(const dir of [control,disk,keys])await mkdir(dir,{mode:0o700});
 const keySocket=join(root,'key.sock'),sourceSocket=join(root,'source.sock'),keyConfig=join(control,'key.json'),keyPolicy=join(control,'key-policy.json'),sourcePolicy=join(control,'source-policy.json'),profile=join(control,'ordinary.json'),client=join(control,'client.json'),gate=join(control,'start'),preload=join(control,'gate.mjs');
 const policy={schema:1,revision:1,administrator:'awangs',scopes:[LEGACY_BACKUP_SCOPE],actors:{awangs:{role:'administrator',scopes:[LEGACY_BACKUP_SCOPE]}},hostClients:[] as Awaited<ReturnType<typeof identity>>[]};
 await writeFile(keyPolicy,JSON.stringify(policy),{mode:0o600});const command=[process.execPath,resolve('dist/src/backup-key-worker.js'),keyConfig];
 await writeFile(keyConfig,JSON.stringify({schema:1,trustModel:'host-root',socket:keySocket,serviceUid:process.getuid!(),hostUid:process.getuid!(),sourceUid:process.getuid!(),privateRoot:keys,authorityFile:keyPolicy,sourceSocket,binary:process.env.PI_COFFEE_TEST_RESTIC,destination:disk,node:command[0],handler:command[1]}),{mode:0o600});
 const key=spawn('/usr/bin/python3',[resolve('src/host/backup-unix-peer.py'),'serve',keyConfig],{stdio:'ignore'});await expect.poll(()=>stat(keySocket).then(()=>true,()=>false)).toBe(true);
 await writeFile(sourcePolicy,JSON.stringify({...policy,sourceProducers:[{listener:await identity(key.pid!),workerCommand:command}]}),{mode:0o600});
 const configuration=join(control,'source-configuration.json'),graph=join(control,'source-graph.json');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'ordinary-shared',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'domain',path:data}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'ordinary-shared',roots:[{id:'domain',scope:LEGACY_BACKUP_SCOPE,engine:'shared'}]}),{mode:0o600});
 await writeFile(profile,JSON.stringify({schema:1,root:join(control,'authority'),configuration,graph,sourceSocket,sourcePolicy,enrollment:{mode:'fresh',actor:'awangs'}}),{mode:0o600});
 await writeFile(client,JSON.stringify({schema:1,socket:keySocket,serviceUid:process.getuid!(),actor:'awangs',dataScope:LEGACY_BACKUP_SCOPE,authorityRevision:1}),{mode:0o600});
 await writeFile(preload,"import {access} from 'node:fs/promises';import {setTimeout} from 'node:timers/promises';const deadline=Date.now()+10000;while(!(await access("+JSON.stringify(gate)+").then(()=>true,()=>false))){if(Date.now()>deadline)throw Error('gate timeout');await setTimeout(10);}");
 const child=spawn(process.execPath,['--import',preload,resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_WORKDIR:join(data,'work'),PI_COFFEE_SESSION_DIR:join(data,'sessions'),PI_COFFEE_AGENT_DIR:join(data,'pi'),PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_ORDINARY_SOURCE_PROFILE:profile,PI_COFFEE_BACKUP_BROKER_CLIENT:client,PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'127.0.0.1',PI_COFFEE_TRANSFER_PORT:'0',PI_COFFEE_EXTENSIONS:'off',PI_COFFEE_IDLE_TIMEOUT_MS:'100'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 policy.hostClients=[await identity(child.pid!)];await writeFile(keyPolicy,JSON.stringify(policy));await writeFile(gate,'enrolled');
 const stop=async()=>{for(const process of [child,key])if(process.exitCode===null&&process.signalCode===null){const done=once(process,'exit');process.kill('SIGTERM');await done;}await rm(root,{recursive:true,force:true});};
 try{await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child.exitCode!==null?output:''),{timeout:15000}).toMatch(/^\d+$/);}catch(error){await stop();throw error;}
 const base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
 const post=async(path:string,body:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {root,data,control,sourceSocket,post,base,stop,output:()=>output};
}
it.skipIf(!process.env.PI_COFFEE_TEST_RESTIC)('actual ordinary Host opens named source and configures independent backup while an unstarted native source stays unqualified',async()=>{
 const f=await fixture();try{
  expect(await stat(f.sourceSocket).then(info=>info.isSocket(),()=>false)).toBe(true);
  expect((await f.post('/api/backup',{action:'repository-configure'})).status).toBe(200);
  const task=await f.post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'ordinary-task'});expect(task.status).toBe(200);
  expect(await f.post('/api/backup',{action:'capture',taskId:'ordinary-task'})).toMatchObject({status:200,body:{state:'unavailable',checkpointId:null}});
 }finally{await f.stop();}
},45000);
