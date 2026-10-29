import {it,expect} from 'vitest';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {codexFixture} from './codex-recovery-fixture.js';
import {BackupCoordinator,verifySealedCheckpoint} from '../src/host/backup.js';
import {createFrozenLegacyRecoveryAdapter,type FrozenLegacyScope} from '../src/host/cold-enrollment-capture.js';

// Exercise the production native-reader composition below the OS read-only
// export gate. Synthetic files and a quiescent fence do not qualify an OS export.
for(const direction of ['pi-codex','codex-pi'] as const)it(`frozen native readers seal both original histories after ${direction} takeover`,async()=>{
 const f=await codexFixture({project:true,initialEngine:direction==='pi-codex'?'pi':'codex'});
 try{
  const sessionDir=join(f.root,'pi-sessions'),agentDir=join(f.root,'pi-agent');await mkdir(sessionDir);await mkdir(agentDir);
  const operation={id:randomUUID(),from:direction==='pi-codex'?'pi' as const:'codex' as const,to:direction==='pi-codex'?'codex' as const:'pi' as const,status:'preparing' as const,at:new Date().toISOString()},piId=operation.from==='pi'?f.task.id:operation.id;
  const pi=SessionManager.create(f.task.cwd,sessionDir,{id:piId});pi.appendMessage({role:'user',content:'Original Pi context across takeover',timestamp:1});
  await f.store.beginTakeover(f.task.id,operation);await f.store.updateTakeover(f.task.id,operation.id,{nativeId:operation.to==='pi'?piId:f.id});await f.store.commitTakeover(f.task.id,operation,{state:'bound',id:operation.to==='pi'?piId:f.id});
  const original=(await f.store.lookup(f.task.id))!,scope:FrozenLegacyScope={scope:'alice',workspacesRoot:join(f.root,'alice','projects'),chatRoot:join(f.root,'alice','chat'),pi:{sessionDir,agentDir},codex:{home:f.home,sqliteHome:f.sql,cliVersion:'0.159.1'}};
  const adapter=createFrozenLegacyRecoveryAdapter({scope,workspaces:f.store,fence:f.fence,sourceCustody:async()=>({known:true})}),coordinator=new BackupCoordinator({root:join(f.root,'frozen-capture'),adapter});
  const status=await coordinator.capture('alice',f.task.id,original.engine!);expect(status,JSON.stringify(status)).toMatchObject({state:'protected',coverage:'complete'});
  const point=(await coordinator.sealedCheckpoint('alice',f.task.id))!;await verifySealedCheckpoint(point.directory);
  const source=(key:string)=>{const row=point.manifest.sources.find(value=>value.recoveryKey===key);expect(row,key).toBeDefined();return join(point.directory,'objects',row!.id);};
  const history=JSON.parse(await readFile(source('native-history/engine-bindings-v1'),'utf8'));expect(history.history.bindings).toEqual({pi:[piId],codex:[f.id]});expect(history.history.current).toEqual({engine:original.engine,id:original.nativeBinding!.id});expect(JSON.parse(await readFile(source('registry'),'utf8')).conversation).toEqual(original);
  expect(await readFile(source('native-session/'+piId),'utf8')).toContain('Original Pi context across takeover');expect(await readFile(source('codex/rollout/'+f.id),'utf8')).toContain('The ordinary answer');
  const incompleteScope={...scope,...(operation.from==='pi'?{pi:undefined}:{codex:undefined})};
  const absentAdapter=new BackupCoordinator({root:join(f.root,'missing-engine'),adapter:createFrozenLegacyRecoveryAdapter({scope:incompleteScope,workspaces:f.store,fence:f.fence,sourceCustody:async()=>({known:true})})});
  expect(await absentAdapter.capture('alice',f.task.id,original.engine!)).toMatchObject({state:'unavailable',checkpointId:null});expect(await absentAdapter.sealedCheckpoint('alice',f.task.id)).toBeUndefined();
  await rm(operation.from==='pi'?pi.getSessionFile()!:f.rollout);
  expect(await coordinator.capture('alice',f.task.id,original.engine!)).toMatchObject({state:'unavailable',checkpointId:point.manifest.checkpointId});await verifySealedCheckpoint(point.directory);
 }finally{await rm(f.root,{recursive:true,force:true});}
},30000);

it('frozen Pi-only readers preserve retained Pi history without requiring a Codex installation',async()=>{
 const f=await codexFixture({initialEngine:'pi'});
 try{
  const sessionDir=join(f.root,'pi-sessions'),agentDir=join(f.root,'pi-agent');await mkdir(sessionDir);await mkdir(agentDir);
  for(const id of [f.task.id,'retained-pi'])SessionManager.create(f.task.cwd,sessionDir,{id}).appendMessage({role:'user',content:'Pi-only '+id,timestamp:1});
  const scope:FrozenLegacyScope={scope:'alice',workspacesRoot:join(f.root,'alice','projects'),chatRoot:join(f.root,'alice','chat'),pi:{sessionDir,agentDir}},coordinator=new BackupCoordinator({root:join(f.root,'frozen-pi'),adapter:createFrozenLegacyRecoveryAdapter({scope,workspaces:f.store,fence:f.fence,sourceCustody:async()=>({known:true})})});
  // Initial pure Pi capture and then a real provenance mutation both remain supported.
  expect(await coordinator.capture('alice',f.task.id,'pi')).toMatchObject({state:'protected'});
  await f.store.retainForkNative(f.task.id,'retained-pi');expect(await coordinator.capture('alice',f.task.id,'pi')).toMatchObject({state:'protected'});
  const point=(await coordinator.sealedCheckpoint('alice',f.task.id))!,row=point.manifest.sources.find(value=>value.recoveryKey==='native-history/engine-bindings-v1')!;
  expect(JSON.parse(await readFile(join(point.directory,'objects',row.id),'utf8')).history.bindings).toEqual({pi:['codex-task','retained-pi'],codex:[]});
 }finally{await rm(f.root,{recursive:true,force:true});}
},30000);
