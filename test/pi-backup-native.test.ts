import {it,expect} from 'vitest';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {BackupCoordinator,WriterAdmissionFence} from '../src/host/backup.js';
import {BackupSourceCustody} from '../src/host/backup-source-custody.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PiNativeRecoveryAdapter} from '../src/host/pi-recovery.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
async function eventually(check:()=>Promise<boolean>){const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('Native custody failed to settle');}

it('seals real Pi JSONL with task registry/files only after supervised native lifetime ends, without interrupting live RPC',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-pi-native-backup-'));let server:HostServer|undefined,session:Awaited<ReturnType<RpcPiSessionFactory['create']>>|undefined;
 try{
  const owner=new BackupSourceCustody(join(root,'source-ledger')),work=join(root,'owned-work'),nativeDir=join(root,'owned-native');await owner.allocate(work);await owner.allocate(nativeDir);const agentDir=join(root,'agent');await owner.allocate(agentDir);
  const nativeCustody=new NativeWriterCustody(join(root,'native-custody'));
  // Controlled synthetic writer set only: provenance/subreaper ancestry alone do not qualify unrestricted OS tools.
  const sourceProof=async()=>({known:(await owner.owns(work)).state==='owned'&&(await owner.owns(nativeDir)).state==='owned'&&(await owner.owns(agentDir)).state==='owned'});
  const fence=new WriterAdmissionFence({writerClasses:['native','platform'],uncoveredWriters:[],probe:async()=>{const source=await sourceProof(),state=await nativeCustody.state();return {known:source.known&&state.state==='quiescent',active:state.state==='active'};}});
  const store=new Workspaces(join(work,'projects'));store.setBackupWriterFence(fence);await store.createChatConversation('native-task');
  const task=(await store.lookup('native-task'))!;await writeFile(join(task.cwd,'draft.md'),'uncommitted native fixture');
  const native=SessionManager.create(task.cwd,nativeDir,{id:task.id});native.appendMessage({role:'user',content:'native context must survive',timestamp:1000});
  const factory=new RpcPiSessionFactory({cwd:task.cwd,sessionDir:nativeDir,agentDir,writerFence:fence,nativeCustody,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
  const adapter=new PiNativeRecoveryAdapter({scope:'awangs',workspaces:store,sessionDir:nativeDir,agentDir,fence,sourceCustody:sourceProof});
  const backup=new BackupCoordinator({root:join(root,'checkpoints'),adapter});
  server=new HostServer({port:0,token:'native-cut',requireUser:true,factory,backup:{coordinator:backup},scopeForUser:()=>({factory,workspaces:store})});await server.start();
  const capture=async()=>{const response=await fetch(`http://127.0.0.1:${server!.address().port}/api/backup`,{method:'POST',headers:{authorization:'Bearer native-cut','x-pi-coffee-user':'awangs','content-type':'application/json'},body:JSON.stringify({action:'capture',taskId:task.id})});expect(response.status).toBe(200);return response.json();};
  session=await factory.create({sessionId:task.id});
  expect(await capture()).toMatchObject({state:'waiting',checkpointId:null});
  // The backup request did not terminate or restart the live native runtime.
  expect((await session.getState()).isStreaming).toBe(false);
  // Ordinary fixture lifecycle end; capture itself never calls native stop.
  await session.stop();session=undefined;await eventually(async()=>(await nativeCustody.state()).state==='quiescent');
  const result=await capture();expect(result).toMatchObject({state:'protected',coverage:'complete',checkpointId:expect.any(String)});
  const point=await backup.sealedCheckpoint('awangs',task.id);expect(point).toBeDefined();
  const nativeSource=point!.manifest.sources.find(s=>s.recoveryKey==='native-session/'+native.getSessionId())!;
  const reopened=SessionManager.open(join(point!.directory,'objects',nativeSource.id));expect(reopened.buildSessionContext().messages).toMatchObject([{role:'user',content:'native context must survive'}]);
  expect(await readFile(join(point!.directory,'objects','workspace','draft.md'),'utf8')).toBe('uncommitted native fixture');
  expect(JSON.parse(await readFile(join(point!.directory,'objects','registry'),'utf8')).conversation.id).toBe(task.id);
  await writeFile(join(agentDir,'settings.json'),JSON.stringify({skills:['/unowned/shared-skills']}));
  expect(await capture()).toMatchObject({state:'unavailable',checkpointId:result.checkpointId,reason:'Mutable native Pi configuration is not mapped for recovery'});await rm(join(agentDir,'settings.json'));
  const mishu=join(store.root,'.coffee','mishu');await mkdir(mishu,{recursive:true});await writeFile(join(mishu,'memory.json'),JSON.stringify({version:1,books:{'native-task:fixture':{entries:[{text:'external notes'}]}}}));
  expect(await capture()).toMatchObject({state:'unavailable',checkpointId:result.checkpointId,reason:'External MISHU context requires a recovery mapping'});await rm(join(mishu,'memory.json'));
  // Resume in an isolated native store, through real RPC; no model prompt.
  const restoreDir=join(root,'restored-native');await mkdir(restoreDir);await writeFile(join(restoreDir,'restored.jsonl'),await readFile(join(point!.directory,'objects',nativeSource.id)));
  const resumedFactory=new RpcPiSessionFactory({cwd:task.cwd,sessionDir:restoreDir,agentDir:join(root,'restore-agent'),env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});
  const resumed=await resumedFactory.create({sessionId:task.id,requireExisting:true});try{expect((await resumed.getHistory()).entries).toMatchObject([{kind:'user',text:'native context must survive'}]);}finally{await resumed.stop();}
 }finally{await session?.stop();await server?.close();await rm(root,{recursive:true,force:true});}
},30000);
