import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readFile,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {PiNativeRecoveryAdapter} from '../src/host/pi-recovery.js';

it('captures API-created MISHU note revisions, tombstones and old bindings as inert task-local history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-mishu-backup-')),workspaces=new Workspaces(join(root,'work')),sessions=join(root,'sessions'),agentDir=join(root,'agent');
 await mkdir(sessions);await mkdir(agentDir);
 // This fixture controls its entire writer set. It does not qualify arbitrary same-UID tools or OS daemons.
 const fence=new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true,active:false})});workspaces.setBackupWriterFence(fence);
 const task=await workspaces.createChatConversation('notes-task'),other=await workspaces.createChatConversation('notes-neighbor');
 SessionManager.create(task.cwd,sessions,{id:task.id}).appendMessage({role:'user',content:'synthetic task context',timestamp:1000});
 const factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:sessions,agentDir,writerFence:fence});
 const backup=new BackupCoordinator({root:join(root,'checkpoints'),adapter:new PiNativeRecoveryAdapter({scope:'awangs',workspaces,sessionDir:sessions,agentDir,fence,sourceCustody:async()=>({known:true})})});
 const host=new HostServer({port:0,token:'fixture',requireUser:true,factory,backup:{coordinator:backup},scopeForUser:()=>({factory,workspaces})});
 const call=async(path:string,body:Record<string,unknown>)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'awangs','content-type':'application/json'},body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
 const memory=(id:string,body:Record<string,unknown>)=>call('/api/mishu',{id,action:'memory',...body});
 try{await host.start();
  for(const id of [task.id,other.id]){await memory(id,{action:'select',selected:true});await memory(id,{operation:'configure',operationId:'enable',enabled:true});}
  const saved=await memory(task.id,{operation:'save',operationId:'save',kind:'preference',text:'original retained note'});
  await memory(task.id,{operation:'save',operationId:'edit',entryId:saved.entry.id,expectedRevision:1,kind:'preference',text:'edited retained note'});
  await memory(task.id,{operation:'delete',operationId:'delete',entryId:saved.entry.id,expectedRevision:2});
  await memory(other.id,{operation:'save',operationId:'neighbor',kind:'preference',text:'NEIGHBOR_PRIVATE_NOTE'});
  await workspaces.commitContextReset(task.id,{id:'reset',expectedNativeId:task.id},'replacement');
  SessionManager.create(task.cwd,sessions,{id:'replacement'}).appendMessage({role:'user',content:'replacement context',timestamp:2000});
  await memory(task.id,{operation:'configure',operationId:'enable-new',enabled:true});
  await memory(task.id,{operation:'save',operationId:'current',kind:'agreement',text:'current binding note'});
  // Synthetic durable historical/candidate records supplement the real API-created notes; no model is invoked.
  const mishu=join(workspaces.root,'.coffee','mishu'),state=JSON.parse(await readFile(join(mishu,'state.json'),'utf8')),binding=state.chats[task.id].sourceBinding,at='2026-10-25T00:00:00Z';
  state.chats[task.id].userInstructions=[{requestId:'never-replay',text:'pending user goal as a note'}];
  state.chats[task.id].messages=[{messageId:'message-history',targetId:other.id,binding:'retained-target-binding',kind:'information-only',state:'settled',requestId:'never-replay',fingerprint:'old-identity',text:'original historical question',result:'retained historical answer',truncated:false,createdAt:at}];
  state.chats[task.id].clarifications={version:1,operations:[],questions:[{questionId:'question-history',sourceBinding:binding,generation:0,revision:2,question:'Which export format?',options:['markdown'],createdAt:at,state:'answered',answer:{text:'markdown',eventId:'answer-history',channel:'browser',at,continuation:'available'}}]};
  await fence.runWriter('platform',()=>writeFile(join(mishu,'state.json'),JSON.stringify(state)));
  await fence.runWriter('platform',()=>writeFile(join(mishu,'consolidation-v1.json'),JSON.stringify({version:1,books:{},settings:[],jobs:[{id:'job-history',operationId:'never-replay',sourceId:task.id,binding,generation:0,revision:1,automatic:true,state:'ready',createdAt:at,targetId:task.id,model:{provider:'synthetic',id:'no-model-call'},sources:[{messageId:'source-evidence',conversationId:task.id,sourceBinding:binding,text:'candidate evidence quote',role:'user',at,range:{start:0,end:24},truncated:false}],changes:[{op:'add',kind:'summary',text:'unadopted candidate note',candidate:true,source:{kind:'evidence',at,conversationId:task.id,messageId:'source-evidence',sourceBinding:binding,quote:'candidate evidence quote',start:0,end:24}}],oldValues:{'old-entry':'previous candidate value'}}]})));
  await mkdir(join(mishu,'receipts'),{recursive:true});await fence.runWriter('platform',()=>writeFile(join(mishu,'receipts','receipts-'+task.id+'.jsonl'),JSON.stringify({messageId:'archived-answer',targetId:other.id,fingerprint:'old-fingerprint',requestId:'never-replay',state:'settled',kind:'information-only',createdAt:at,archivedAt:at,result:'archived complete answer',truncated:false})+'\n'));
  const result=await call('/api/backup',{action:'capture',taskId:task.id});expect(result).toMatchObject({state:'protected',coverage:'complete'});
  const point=(await backup.sealedCheckpoint('awangs',task.id))!,source=point.manifest.sources.find(s=>s.recoveryKey==='platform/mishu/notes-only-v1');expect(source).toBeDefined();
  const text=await readFile(join(point.directory,'objects',source!.id),'utf8'),archive=JSON.parse(text);
  expect(archive).toMatchObject({schemaVersion:1,kind:'mishu-notes-only',taskId:task.id,restorePolicy:{restoreAs:'historical-notes-archive',automaticContext:false,operationalAuthority:false,requireExplicitNoteAdoption:true}});
  const entries=archive.memory.flatMap((snapshot:any)=>snapshot.books.flatMap((book:any)=>book.entries));
  expect(entries).toContainEqual(expect.objectContaining({text:'edited retained note',deleted:true,revision:3,history:expect.arrayContaining([expect.objectContaining({text:'original retained note',revision:1}),expect.objectContaining({text:'edited retained note',revision:2})])}));
  expect(entries).toContainEqual(expect.objectContaining({text:'current binding note'}));
  expect(archive.history[0]).toMatchObject({pendingInstructionNotes:[{text:'pending user goal as a note'}],questionNotes:[{question:'Which export format?',answer:{text:'markdown',at}}],receipts:[{text:'original historical question',result:'retained historical answer'}]});
  expect(archive.consolidation).toMatchObject([{candidateNotes:[{text:'unadopted candidate note'}],previousNoteValues:{'old-entry':'previous candidate value'},evidence:[{text:'candidate evidence quote',historicalRole:'user'}]}]);
  expect(archive.archivedReceipts).toMatchObject([{result:'archived complete answer',truncated:false}]);
  expect(text).not.toContain('NEIGHBOR_PRIVATE_NOTE');
  for(const key of ['selected','enabled','allowInstructions','targets','manager','assignments','followups','authorizationRef','operationId','fingerprint','requestId'])expect(text).not.toContain('"'+key+'":');
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
},30000);

it('retains the old point when a MISHU API write arrives during capture and rejects unsafe or unknown note dependencies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-mishu-backup-race-')),workspaces=new Workspaces(join(root,'work')),sessions=join(root,'sessions'),agentDir=join(root,'agent');await mkdir(sessions);await mkdir(agentDir);
 // Only controlled synthetic writers are attested by this fixture.
 const fence=new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true,active:false})});workspaces.setBackupWriterFence(fence);
 const task=await workspaces.createChatConversation('notes-task');SessionManager.create(task.cwd,sessions,{id:task.id}).appendMessage({role:'user',content:'race fixture',timestamp:1000});
 const native=new PiNativeRecoveryAdapter({scope:'awangs',workspaces,sessionDir:sessions,agentDir,fence,sourceCustody:async()=>({known:true})});
 let hold=false,reached=()=>{},release=()=>{};
 const adapter={version:native.version,async resolve(scope:string,id:string){const group=await native.resolve(scope,id);return {...group,async validate(){if(hold){hold=false;reached();await new Promise<void>(r=>release=r);}await group.validate();}};}};
 const backup=new BackupCoordinator({root:join(root,'checkpoints'),adapter}),factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:sessions,agentDir,writerFence:fence});
 const host=new HostServer({port:0,token:'fixture',requireUser:true,factory,backup:{coordinator:backup},scopeForUser:()=>({factory,workspaces})});
 const call=async(path:string,body:Record<string,unknown>)=>{const response=await fetch(`http://127.0.0.1:${host.address().port}${path}`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'awangs','content-type':'application/json'},body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
 const memory=(body:Record<string,unknown>)=>call('/api/mishu',{id:task.id,action:'memory',...body});
 try{await host.start();await memory({action:'select',selected:true});await memory({operation:'configure',operationId:'enable',enabled:true});await memory({operation:'save',operationId:'original',kind:'preference',text:'original checkpoint note'});
  const old=await call('/api/backup',{action:'capture',taskId:task.id});expect(old.state).toBe('protected');
  hold=true;const entered=new Promise<void>(r=>reached=r),capture=call('/api/backup',{action:'capture',taskId:task.id});await entered;
  await memory({operation:'save',operationId:'concurrent',kind:'preference',text:'new work wins'});release();
  expect(await capture).toMatchObject({state:'waiting',checkpointId:old.checkpointId,captureAt:old.captureAt});
  const point=(await backup.sealedCheckpoint('awangs',task.id))!,source=point.manifest.sources.find(s=>s.recoveryKey==='platform/mishu/notes-only-v1')!;expect(await readFile(join(point.directory,'objects',source.id),'utf8')).not.toContain('new work wins');
  const file=join(workspaces.root,'.coffee','mishu','memory.json'),original=await readFile(file,'utf8'),unknown=JSON.parse(original);unknown.externalNotesPath='/unowned/context';await writeFile(file,JSON.stringify(unknown));
  expect(await call('/api/backup',{action:'capture',taskId:task.id})).toMatchObject({state:'unavailable',checkpointId:old.checkpointId});
  await rm(file);const victim=join(root,'private-note');await writeFile(victim,'PRIVATE_EXTERNAL_NOTE');await symlink(victim,file);
  expect(await call('/api/backup',{action:'capture',taskId:task.id})).toMatchObject({state:'failed',checkpointId:old.checkpointId,reason:'Source contains an unsafe path or unsupported file type'});expect(await readFile(victim,'utf8')).toBe('PRIVATE_EXTERNAL_NOTE');
 }finally{release();await host.close();await rm(root,{recursive:true,force:true});}
},30000);
