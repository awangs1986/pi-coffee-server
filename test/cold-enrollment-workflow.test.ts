import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupRepository} from '../src/host/backup-repository.js';
import {PiNativeRecoveryAdapter} from '../src/host/pi-recovery.js';
import {GroupedRecoveryAdapter} from '../src/host/grouped-recovery.js';
import {RestoreCoordinator} from '../src/host/restore.js';
import {AccountRecoveryCoordinator} from '../src/host/account-recovery.js';
import {ColdEnrollmentCoordinator,type ColdEnrollmentOperation} from '../src/host/cold-enrollment.js';
import {Workspaces} from '../src/host/workspaces.js';
import {durableJson,sha} from '../src/host/restore-files.js';

const binary=process.env.PI_COFFEE_TEST_RESTIC;

/** A reviewed durable-operation fixture, never an OS-qualified export. It does
 * not exercise plan(), readonly-block qualification or cold source capture.
 * Its children use actual sealed Pi material, Restic and account publication. */
async function reviewedFixture(){
 const root=await mkdtemp(join(tmpdir(),'cold-reviewed-workflow-')),disk=join(root,'disk'),journal=join(root,'cold-operations');await mkdir(disk,{mode:0o700});
 const stores=new Map<string,Workspaces>(),adapters=new Map<string,PiNativeRecoveryAdapter>(),nativeFiles=new Map<string,string>(),fence=new WriterAdmissionFence({writerClasses:['platform','native'],uncoveredWriters:[],probe:async()=>({known:true})});
 for(const scope of ['alice','bob']){const store=new Workspaces(join(root,scope,'projects'));await store.createChatConversation('task');const task=(await store.lookup('task'))!,native=join(root,scope,'native'),agent=join(root,scope,'agent');await mkdir(native,{mode:0o700});await mkdir(agent,{mode:0o700});const session=SessionManager.create(task.cwd,native,{id:scope+'-history'});session.appendMessage({role:'user',content:scope+' original retained question',timestamp:1});await store.setNativeBinding('task',{state:'bound',id:session.getSessionId()});await writeFile(join(task.cwd,'draft'),scope+' checkpoint bytes');stores.set(scope,store);nativeFiles.set(scope,session.getSessionFile()!);adapters.set(scope,new PiNativeRecoveryAdapter({scope,workspaces:store,sessionDir:native,agentDir:agent,fence,sourceCustody:async()=>({known:true})}));}
 const coordinator=new BackupCoordinator({root:join(root,'checkpoints'),adapter:new GroupedRecoveryAdapter({groupId:'reviewed-synthetic-cut',fence,inventory:async()=>['alice','bob'].map(scope=>({scope,taskId:'task',engine:'pi' as const})),resolve:(scope,id)=>adapters.get(scope)!.resolve(scope,id)})});expect((await coordinator.capture('alice','task','pi')).state).toBe('protected');const point=(await coordinator.sealedCheckpoint('alice','task'))!,repository=new BackupRepository({root:join(root,'repository'),coordinator});await repository.configure({destination:disk,binary:binary!});await repository.verifyRecoveryPackage(await repository.exportRecoveryPackage());const job=await repository.backup([{scope:'alice',taskId:'task'}]);
 const taskPaths=new Map<string,string>();for(const [scope,store]of stores){taskPaths.set(scope,(await store.lookup('task'))!.cwd);await store.archive('task',true);await store.deleteWorkspace('task','task',()=>rm(nativeFiles.get(scope)!),true);}
 const authorized=new Set(['awangs']),authorize=async(actor:string,scope:string,manage:boolean)=>['alice','bob'].includes(scope)&&(manage?authorized.has(actor):actor===scope||authorized.has(actor)),scope=async(scope:string)=>({workspaces:stores.get(scope)!,adapter:adapters.get(scope)!}),children=new RestoreCoordinator({root:join(root,'restores'),repository,authorize,scope}),accounts=new AccountRecoveryCoordinator({root:join(root,'accounts'),restore:children,scope,authorize,materialSource:async()=>repository,pins:async()=>repository});
 const prepared=[];for(const scope of ['alice','bob']){const requested=await accounts.request('awangs',scope,{jobIds:[job.id],mode:'missing-only'}),plan=await accounts.operate('awangs',requested.id,{action:'plan',revision:requested.revision});expect(plan.planComplete).toBe(true);prepared.push({scope,operationId:plan.id,revision:plan.revision,digest:plan.digest!});}
 // This explicit fixture codec creates a reviewed journal. Assertions below use
 // independently checked files, native history and refusal outcomes.
 const review={id:randomUUID(),revision:1,requestedBy:'awangs',sourceManifestSha256:sha(JSON.stringify(point.manifest)),manifestSha256:sha(JSON.stringify(point.manifest)),checkpointDirectory:point.directory,mappings:['alice','bob'].map(scope=>({scope,taskId:'task',roots:[{from:join(root,'legacy',scope),to:join(root,scope)}]})),rewrites:[],jobId:job.id,accounts:prepared},operation:ColdEnrollmentOperation={schema:1,state:'staged',...review,digest:sha(JSON.stringify(review))};await mkdir(journal,{mode:0o700});await durableJson(join(journal,operation.id+'.json'),operation);
 const cold=()=>new ColdEnrollmentCoordinator({root:journal,accounts,authorize:async actor=>authorized.has(actor),archive:async()=>{throw Error('A durable-operation fixture must never qualify or archive an export');}});
 return {root,stores,accounts,children,authorized,operation,cold,nativeFiles,taskPaths,async close(){await rm(root,{recursive:true,force:true});}};
}

it.skipIf(!binary)('a reviewed cold journal refuses wrong revision, wrong digest and unapproved publication before real account/native writes',async()=>{
 const f=await reviewedFixture();try{const {operation}=f,cold=f.cold(),input={revision:operation.revision,digest:operation.digest};
  await expect(cold.operate('awangs',operation.id,{action:'approve',...input,revision:2})).rejects.toMatchObject({code:'stale_approval'});
  await expect(cold.operate('awangs',operation.id,{action:'approve',...input,digest:'0'.repeat(64)})).rejects.toMatchObject({code:'stale_approval'});
  await expect(cold.operate('awangs',operation.id,{action:'publish',...input})).rejects.toMatchObject({code:'approval_required'});
  expect((await cold.status('awangs',operation.id)).state).toBe('staged');for(const scope of ['alice','bob']){expect((await f.accounts.status('awangs',scope))[0].state).toBe('staged');await expect(readFile(f.nativeFiles.get(scope)!)).rejects.toMatchObject({code:'ENOENT'});}
  await cold.operate('awangs',operation.id,{action:'approve',...input});expect((await cold.operate('awangs',operation.id,{action:'publish',...input})).state).toBe('completed');
  for(const scope of ['alice','bob']){const task=(await f.stores.get(scope)!.lookup('task'))!;expect(await readFile(join(task.cwd,'draft'),'utf8')).toBe(scope+' checkpoint bytes');expect(SessionManager.open(f.nativeFiles.get(scope)!).buildSessionContext().messages).toMatchObject([{role:'user',content:scope+' original retained question'}]);}
 }finally{await f.close();}
},180000);

it.skipIf(!binary)('a partial reviewed cold journal preserves completed native receipts and later human writes across revocation and another-process retry',async()=>{
 const f=await reviewedFixture();try{const {operation}=f,input={revision:operation.revision,digest:operation.digest},cold=f.cold(),bob={cwd:f.taskPaths.get('bob')!},alice={cwd:f.taskPaths.get('alice')!};
  await cold.operate('awangs',operation.id,{action:'approve',...input});await mkdir(bob.cwd,{recursive:true,mode:0o700});await writeFile(join(bob.cwd,'human-note'),'Bob newer human work must survive');
  await expect(cold.operate('awangs',operation.id,{action:'publish',...input})).rejects.toMatchObject({code:'enrollment_account_partial'});
  expect(await cold.status('awangs',operation.id)).toMatchObject({state:'partial',accounts:[{scope:'alice',completed:true},{scope:'bob'}]});expect((await f.accounts.status('awangs','alice'))[0]).toMatchObject({state:'completed',scopeComplete:true});expect((await f.accounts.status('awangs','bob'))[0].scopeComplete).toBe(false);
  const aliceNative=await readFile(f.nativeFiles.get('alice')!,'utf8'),aliceReceipt=(await f.stores.get('alice')!.lookup('task'))!.recoveryReceipt;expect(await readFile(join(alice.cwd,'draft'),'utf8')).toBe('alice checkpoint bytes');await writeFile(join(alice.cwd,'draft'),'Alice later human edit');await expect(readFile(f.nativeFiles.get('bob')!)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(bob.cwd,'human-note'),'utf8')).toBe('Bob newer human work must survive');
  f.authorized.delete('awangs');f.authorized.add('successor');await expect(f.cold().operate('awangs',operation.id,{action:'publish',...input})).rejects.toMatchObject({code:'forbidden'});await expect(f.cold().operate('successor',operation.id,{action:'publish',...input})).rejects.toMatchObject({code:'forbidden'});expect((await f.cold().status('successor',operation.id)).state).toBe('partial');expect(await readFile(join(bob.cwd,'human-note'),'utf8')).toBe('Bob newer human work must survive');
  // The operator preserves the conflicting newer tree elsewhere before retry;
  // the retry itself is never allowed to overwrite that human tree.
  const preserved=join(f.root,'bob-human-preserved');await rename(bob.cwd,preserved);f.authorized.add('awangs');const configuration=join(f.root,'reviewed-fixture.json');await writeFile(configuration,JSON.stringify({root:f.root,operationId:operation.id,revision:1,digest:operation.digest,actors:[...f.authorized]}),{mode:0o600});
  const child=spawn(process.execPath,[new URL('./fixtures/cold-enrollment-reviewed-publish.mjs',import.meta.url).pathname,configuration],{stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',bytes=>output+=String(bytes));child.stderr.on('data',bytes=>errors+=String(bytes));expect((await once(child,'exit'))[0],errors).toBe(0);expect(JSON.parse(output)).toMatchObject({state:'completed',accounts:[{scope:'alice',completed:true},{scope:'bob',completed:true}]});
  expect(await readFile(join(alice.cwd,'draft'),'utf8')).toBe('Alice later human edit');expect(await readFile(f.nativeFiles.get('alice')!,'utf8')).toBe(aliceNative);expect((await f.stores.get('alice')!.lookup('task'))!.recoveryReceipt).toEqual(aliceReceipt);expect(await readFile(join(preserved,'human-note'),'utf8')).toBe('Bob newer human work must survive');expect(await readFile(join(bob.cwd,'draft'),'utf8')).toBe('bob checkpoint bytes');expect(SessionManager.open(f.nativeFiles.get('bob')!).buildSessionContext().messages).toMatchObject([{role:'user',content:'bob original retained question'}]);expect((await f.cold().status('awangs',operation.id)).state).toBe('completed');
 }finally{await f.close();}
},180000);
