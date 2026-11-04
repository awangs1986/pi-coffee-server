import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';

it('shows only the authenticated task protection state without starting a native process',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-http-'));let server:HostServer|undefined;
 try{
  const stores=new Map<string,Workspaces>();
  for(const user of ['alice','bob']){const store=new Workspaces(join(root,user,'projects'));stores.set(user,store);await store.createChatConversation(user+'-task');}
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Backup status must not start a native process');}};
  server=new HostServer({port:0,token:'backup-test',requireUser:true,factory,scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const call=async(user:string,body?:unknown,token='backup-test')=>{
   const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:body?'POST':'GET',headers:{authorization:`Bearer ${token}`,'x-pi-coffee-user':user,'x-pi-coffee-actor':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
   return {status:response.status,data:await response.json()};
  };
  expect((await call('alice',undefined,'bad')).status).toBe(401);
  const state=await call('alice');expect(state.status).toBe(200);
  expect(state.data).toMatchObject({schemaVersion:1,scope:'alice',tasks:[{taskId:'alice-task',engine:'pi',state:'unprotected',coverage:'unavailable',checkpointId:null,captureAt:null,ageMs:null,reason:'Native writer coverage is not verified'}],excludedEngines:['claude','cursor','grok']});
  expect(JSON.stringify(state.data)).not.toContain('bob-task');
  expect((await call('alice',{action:'capture',taskId:'bob-task'})).status).toBe(403);
  expect((await call('alice',{action:'capture',taskId:'../bob-task'})).status).toBe(400);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

it('captures a controlled native source at an idle cut and keeps the sealed point while a writer runs',async()=>{
 const {BackupCoordinator,WriterAdmissionFence}=await import('../src/host/backup.js');
 const {SessionManager}=await import('@earendil-works/pi-coding-agent');
 const {mkdir,writeFile,readFile}=await import('node:fs/promises');
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-cut-'));let server:HostServer|undefined;
 try{
  const stores=new Map<string,Workspaces>();
  for(const user of ['awangs','bob']){const store=new Workspaces(join(root,user,'projects'));stores.set(user,store);await store.createChatConversation('native-task');}
  const task=(await stores.get('awangs')!.lookup('native-task'))!;
  const nativeDir=join(root,'native');await mkdir(nativeDir);
  const native=SessionManager.create(task.cwd,nativeDir);native.appendMessage({role:'user',content:'checkpoint generation one',timestamp:1000});
  const nativeFile=native.getSessionFile()!;
  await writeFile(join(task.cwd,'draft.txt'),'original uncommitted text');
  const fence=new WriterAdmissionFence({writerClasses:['fixture-native','fixture-workspace'],uncoveredWriters:[],probe:async()=>({known:true})});
  const adapter={version:'pi-fixture-1',async resolve(scope:string,taskId:string){
   if(scope!=='awangs'||taskId!=='native-task')throw Error('Unknown native graph');
   return {groupId:'shared-fixture-native',fence,members:[{scope,taskId,engine:'pi' as const,nativeBindings:[native.getSessionId()]}],sources:[{id:'native',recoveryKey:'native-session/'+native.getSessionId(),path:nativeFile,role:'native' as const},{id:'workspace',recoveryKey:'workspace',path:task.cwd,role:'workspace' as const},{id:'task-data',recoveryKey:'task-data',data:Buffer.from('{}'),role:'task-data' as const},{id:'registry',recoveryKey:'registry',data:Buffer.from(JSON.stringify(task)),role:'registry' as const}],async validate(){const copy=SessionManager.open(nativeFile);if(copy.getSessionId()!==native.getSessionId())throw Error('Binding changed');}};
  }};
  let now=Date.parse('2026-10-24T00:00:00Z');
  const backup=new BackupCoordinator({root:join(root,'checkpoints'),adapter,now:()=>now});
  expect(await backup.status('team.member','native-task','pi')).toMatchObject({state:'unprotected',checkpointId:null});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('Must not start an Agent');}};
  server=new HostServer({port:0,token:'backup-test',requireUser:true,factory,backup:{coordinator:backup},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const call=async(body?:unknown,user='awangs')=>{
   const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:body?'POST':'GET',headers:{authorization:'Bearer backup-test','x-pi-coffee-user':user,'x-pi-coffee-actor':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};
  };
  const captured=await call({action:'capture',taskId:'native-task'});expect(captured.status).toBe(200);
  expect(captured.data).toMatchObject({state:'protected',coverage:'complete',checkpointId:expect.any(String),captureAt:'2026-10-24T00:00:00.000Z'});
  const point=await backup.sealedCheckpoint('awangs','native-task');
  const restored=SessionManager.open(join(point!.directory,'objects','native'));expect(restored.buildSessionContext().messages).toMatchObject([{role:'user',content:'checkpoint generation one'}]);
  let release!:()=>void;const writer=fence.runWriter('fixture-native',async()=>{await writeFile(join(task.cwd,'draft.txt'),'generation two');await new Promise<void>(r=>release=r);});
  while(!release)await new Promise(r=>setTimeout(r,1));
  now+=25*60*60*1000;
  const busy=await call({action:'capture',taskId:'native-task'});expect(busy.status).toBe(200);
  expect(busy.data).toMatchObject({state:'waiting',checkpointId:captured.data.checkpointId,captureAt:captured.data.captureAt,ageMs:25*60*60*1000,stale:true});
  expect(await readFile(join(point!.directory,'objects','workspace','draft.txt'),'utf8')).toBe('original uncommitted text');
  expect(JSON.stringify((await call(undefined,'bob')).data)).not.toContain(captured.data.checkpointId);
  release();await writer;
  const restarted=new BackupCoordinator({root:join(root,'checkpoints'),adapter,now:()=>now});
  expect(await restarted.status('awangs','native-task','pi')).toMatchObject({checkpointId:captured.data.checkpointId,captureAt:captured.data.captureAt});
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

it('keeps repository administration and recovery export away from ordinary accounts',async()=>{
 const {BackupCoordinator}=await import('../src/host/backup.js');
 const {BackupRepository}=await import('../src/host/backup-repository.js');
 const root=await mkdtemp(join(tmpdir(),'coffee-repository-http-'));let server:HostServer|undefined;
 try{
  const stores=new Map<string,Workspaces>();for(const user of ['awangs','bob']){const store=new Workspaces(join(root,user,'projects'));stores.set(user,store);await store.createChatConversation(user+'-task');}
  const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'repository-runtime'),coordinator});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native calls');}};
  server=new HostServer({port:0,token:'backup-test',requireUser:true,factory,backup:{coordinator,repository},scopeForUser:user=>({factory,workspaces:stores.get(user)!})});await server.start();
  const call=async(user:string,body?:unknown)=>{const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:body?'POST':'GET',headers:{authorization:'Bearer backup-test','x-pi-coffee-user':user,'x-pi-coffee-actor':user,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
  expect((await call('bob')).data.repository).toMatchObject({configured:false,enabled:false,jobs:[],points:[]});
  for(const action of ['repository-export','repository-configure','repository-verify','repository-backup','repository-recover','repository-rotate'])expect((await call('bob',{action})).status).toBe(403);
  expect((await call('awangs',{action:'repository-configure',destination:root,binary:'/bin/true'})).status).toBe(409);
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});

it('refuses key activation when production wiring has no enforceable model-secret boundary',async()=>{
 const {BackupCoordinator}=await import('../src/host/backup.js');const {BackupRepository}=await import('../src/host/backup-repository.js');
 const root=await mkdtemp(join(tmpdir(),'coffee-key-boundary-'));let server:HostServer|undefined;try{
  const workspaces=new Workspaces(join(root,'projects'));await workspaces.createChatConversation('task');const coordinator=new BackupCoordinator({root:join(root,'checkpoints')}),repository=new BackupRepository({root:join(root,'runtime'),coordinator});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model');}};
  server=new HostServer({port:0,token:'boundary',requireUser:true,factory,backup:{coordinator,repository,activationUnavailable:'Runtime secret is not isolated from unrestricted model processes'},scopeForUser:()=>({factory,workspaces})});await server.start();
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer boundary','x-pi-coffee-user':'awangs','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify({action:'repository-export'})});expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'Runtime secret is not isolated from unrestricted model processes'});
  await expect(import('node:fs/promises').then(fs=>fs.stat(join(root,'runtime','password')))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await server?.close();await rm(root,{recursive:true,force:true});}
});
