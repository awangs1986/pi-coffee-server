import {it,expect} from 'vitest';
import {mkdir,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {NativeAgentFactory,type NativeAgentOptions} from '../src/host/native/factory.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {TrustedSourceAuthority} from '../src/host/trusted-source-authority.js';
import {codexFixture} from './codex-recovery-fixture.js';

async function fixture(configuration?:Parameters<typeof codexFixture>[0]){
 const f=await codexFixture(configuration),lock=join(f.root,'group.lock'),custody=new NativeWriterCustody(join(f.root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),cliPath=await realpath(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex')),agentDir=join(f.root,'pi-agent'),sessionDir=join(f.root,'pi-sessions');await mkdir(agentDir);await mkdir(sessionDir);let unknown=0;
 const pi=new RpcPiSessionFactory({cwd:f.task.cwd,agentDir,sessionDir,nativeCustody:custody,writerFence:fence,cwdForSession:async id=>(await f.store.lookup(id))?.cwd??f.task.cwd,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']}),nativeOptions={cliPath,codexHome:f.home,env:{HOME:f.root},sandbox:'danger-full-access' as const,approvalPolicy:'never' as const};
 const options:NativeAgentOptions={workspaces:f.store,commandCustody:custody,writerFence:fence,beforeUnmanagedNative:async()=>{unknown++;},pi,codex:{command:process.execPath,args:[cliPath],env:{CODEX_HOME:f.home,HOME:f.root}},codexSessionOptions:()=>nativeOptions};
 const quiet=async(factory:NativeAgentFactory,covered=true)=>{await factory.close();await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');if(covered){expect(unknown).toBe(0);const cut=await fence.lease();cut.assertValid();cut.release();}else{expect(unknown).toBeGreaterThan(0);await expect(fence.lease()).rejects.toMatchObject({code:'writers_unknown'});}};
 return {...f,custody,fence,options,nativeOptions,sessionDir,pi,quiet,getUnknown:()=>unknown};
}
const enabled=Boolean(process.env.PI_COFFEE_TEST_CODEX_ROOT);
it.skipIf(!enabled)('built-in ordinary Codex factory resumes existing history and admits real CLI probes without poisoning its custody fence',async()=>{
 const f=await fixture(),factory=new NativeAgentFactory(f.options);let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{const config=await readFile(join(f.home,'config.toml'));session=await factory.create({sessionId:f.task.id});expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;await f.quiet(factory);const cut=await f.fence.lease();expect((await factory.readHistory(f.task.id)).sourceFreshness).toBe('current');expect((await factory.list()).some(task=>task.id===f.task.id)).toBe(true);expect(cut.signal.aborted).toBe(false);const ready=await factory.engines();expect(ready.find(engine=>engine.id==='codex')).toMatchObject({available:true});expect(cut.signal.aborted).toBe(true);cut.release();expect(await readFile(join(f.home,'config.toml'))).toEqual(config);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

for(const mismatch of ['arbitrary-callback','different-custody'] as const)it.skipIf(!enabled)(`ordinary native execution remains available but capture is unknown for ${mismatch}`,async()=>{
 const f=await fixture(),other=new NativeWriterCustody(join(f.root,'other-custody'),{lock:join(f.root,'other.lock')}),factory=new NativeAgentFactory({...f.options,...(mismatch==='arbitrary-callback'?{codexSessionOptions:undefined,codexSessionFactory:(_id,cwd,onBound,envForSession,preparation)=>new CodexSessionFactory({...f.nativeOptions,cwd,envForSession,preparation,nativeCustody:f.custody,onBound:async(_task,native)=>onBound(native)})}:{commandCustody:other})});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;await factory.close();expect(f.getUnknown()).toBeGreaterThan(0);await expect(f.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('built-in launch configuration cannot override the actual bound custody',async()=>{
 const f=await fixture(),wrong=new NativeWriterCustody(join(f.root,'must-not-launch'),{lock:join(f.root,'wrong.lock')}),factory=new NativeAgentFactory({...f.options,codexSessionOptions:()=>({...f.nativeOptions,nativeCustody:wrong})});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;await f.quiet(factory);await expect(stat(wrong.root)).rejects.toMatchObject({code:'ENOENT'});}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

for(const spoof of [false,true])it.skipIf(!enabled)(`ordinary Pi creation and resume use actual factory provenance (spoof=${spoof})`,async()=>{
 const f=await fixture(),task=await f.store.createChatConversation('pi-task','pi');SessionManager.create(task.cwd,f.sessionDir,{id:task.id}).appendMessage({role:'user',content:'Pi original history',timestamp:1});
 const pi=spoof?{create:f.pi.create.bind(f.pi),list:f.pi.list.bind(f.pi),delete:f.pi.delete.bind(f.pi)}:f.pi,factory=new NativeAgentFactory({...f.options,pi});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:task.id});expect(JSON.stringify(await session.getHistory())).toContain('Pi original history');await session.stop();session=undefined;await f.quiet(factory,!spoof);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('ordinary Codex context reset creates an empty native binding without losing writer coverage or invoking a model',async()=>{
 const f=await fixture(),factory=new NativeAgentFactory(f.options);let session:Awaited<ReturnType<typeof factory.create>>|undefined,reset:Awaited<ReturnType<typeof factory.prepareContextReset>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});const settings=await session.getModels();await session.stop();session=undefined;await factory.resetTaskRuntime(f.task.id);reset=await factory.prepareContextReset(f.task.id,{id:randomUUID(),expectedNativeId:f.id,title:'Reset without model'},settings);expect((await reset.session.getHistory()).entries).toEqual([]);await reset.commit();expect((await f.store.lookup(f.task.id))!.nativeBinding!.id).not.toBe(f.id);await reset.session.stop();reset=undefined;await f.quiet(factory);}
 finally{await session?.stop();await reset?.rollback();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('ordinary native Codex fork preserves native history and can settle to the same physical source cut',async()=>{
 const f=await fixture(),factory=new NativeAgentFactory(f.options);let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});const history=await session.getHistory();await session.stop();session=undefined;await factory.resetTaskRuntime(f.task.id);await f.store.beginFork(f.task.id,'fork-target','native','Fork without model',{});await f.store.copyForkWorkspace('fork-target',history);await factory.forkConversation(f.task.id,'fork-target','native',history);await f.store.finishFork('fork-target');session=await factory.create({sessionId:'fork-target'});expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;await f.quiet(factory);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('ordinary Codex handoff cancellation closes its actual preparation fork before any model turn without marking a managed profile requirement',async()=>{
 const f=await fixture(),abort=new AbortController();let cancel=false;const factory=new NativeAgentFactory({...f.options,codexSessionOptions:(_id,_cwd,_bound,_env,preparation)=>{if(cancel&&preparation)abort.abort();return f.nativeOptions;}});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});cancel=true;await expect(factory.prepareHandoff(f.task.id,session,abort.signal)).rejects.toThrow('Handoff stopped');expect((await f.store.lookup(f.task.id))!.nativeBinding!.id).toBe(f.id);await session.stop();session=undefined;await f.quiet(factory);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('ordinary Codex takeover cancellation keeps the original Pi binding while its real prepared runtime remains custodied',async()=>{
 const f=await fixture({project:true,initialEngine:'pi'}),task=f.task;SessionManager.create(task.cwd,f.sessionDir,{id:task.id}).appendMessage({role:'user',content:'Original Pi takeover history',timestamp:1});let cancel=false;const factory=new NativeAgentFactory({...f.options,codexSessionOptions:()=>{if(cancel)void factory.cancelTakeovers();return f.nativeOptions;}});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:task.id});const history=await session.getHistory();await session.stop();session=undefined;const operation={id:randomUUID(),from:'pi' as const,to:'codex' as const,status:'preparing' as const,at:new Date().toISOString()};await f.store.beginTakeover(task.id,operation);cancel=true;await expect(factory.prepareTakeover(task.id,operation,history)).rejects.toThrow();expect((await f.store.lookup(task.id))!.engine).toBe('pi');await f.quiet(factory);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('ordinary Pi context reset and native fork preserve local writer coverage without a model turn',async()=>{
 const f=await fixture(),task=await f.store.createChatConversation('pi-mutations','pi');await writeFile(join(f.root,'pi-agent','models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:9/v1',api:'openai-completions',apiKey:'synthetic',models:[{id:'fixture',name:'fixture',reasoning:true,input:['text'],contextWindow:128000,maxTokens:1024}]}}}));const original=SessionManager.create(task.cwd,f.sessionDir,{id:task.id});original.appendModelChange('fixture','fixture');original.appendMessage({role:'user',content:'Pi history before fork',timestamp:1});const factory=new NativeAgentFactory(f.options);let session:Awaited<ReturnType<typeof factory.create>>|undefined,reset:Awaited<ReturnType<typeof factory.prepareContextReset>>|undefined;
 try{session=await factory.create({sessionId:task.id});const history=await session.getHistory(),settings=await session.getModels();await session.stop();session=undefined;await f.store.beginFork(task.id,'pi-fork','native','Pi native fork',{});await f.store.copyForkWorkspace('pi-fork',history);await factory.forkConversation(task.id,'pi-fork','native',history);await f.store.finishFork('pi-fork');session=await factory.create({sessionId:'pi-fork'});expect(JSON.stringify(await session.getHistory())).toContain('Pi history before fork');await session.stop();session=undefined;
  reset=await factory.prepareContextReset(task.id,{id:randomUUID(),expectedNativeId:task.id,title:'Pi reset'},settings);expect((await reset.session.getHistory()).entries.filter(row=>['user','assistant','tool'].includes(row.kind))).toEqual([]);await reset.commit();await reset.session.stop();reset=undefined;await f.quiet(factory);
 }finally{await session?.stop();await reset?.rollback();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('a deferred synthetic native CLI remains executable while its source coverage stays unknown',async()=>{
 const f=await fixture(),script="console.log(process.argv.includes('--version')?'2.1.280':JSON.stringify({loggedIn:true}))",factory=new NativeAgentFactory({...f.options,claude:{command:process.execPath,args:['-e',script,'--']}});
 try{const engines=await factory.engines();expect(engines.find(engine=>engine.id==='claude')).toMatchObject({available:true});expect(f.getUnknown()).toBeGreaterThan(0);await expect(f.fence.lease()).rejects.toMatchObject({code:'writers_unknown'});}finally{await factory.close();await rm(f.root,{recursive:true,force:true});}
},30000);

it.skipIf(!enabled)('actual source-authority fence provenance permits ordinary launch but cannot turn an unenrolled source into known coverage',async()=>{
 const f=await fixture(),control=join(f.root,'source-control');await mkdir(control,{mode:0o700});const configuration=join(control,'configuration.json'),graph=join(control,'graph.json');await writeFile(configuration,JSON.stringify({schema:1,groupId:'ordinary-native',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'native',path:f.home}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});await writeFile(graph,JSON.stringify({schema:1,groupId:'ordinary-native',roots:[{id:'native',scope:'alice',engine:'codex'}]}),{mode:0o600});const authority=await TrustedSourceAuthority.open({root:join(control,'authority'),configuration,graph,fence:f.fence,authorize:async actor=>actor==='awangs'}),outer=authority.writerFence('host'),pi=new RpcPiSessionFactory({cwd:f.task.cwd,agentDir:join(f.root,'pi-agent'),sessionDir:f.sessionDir,nativeCustody:f.custody,writerFence:outer,env:{PI_OFFLINE:'1'}}),factory=new NativeAgentFactory({...f.options,writerFence:outer,pi});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');await session.stop();session=undefined;await factory.close();expect(f.getUnknown()).toBe(0);expect((await authority.qualification()).state).toBe('unknown');await expect(outer.lease()).rejects.toMatchObject({code:'writers_unknown'});}
 finally{await session?.stop();await factory.close();await authority.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('concrete legacy Codex metadata keeps native titles available without unqualified summary callbacks',async()=>{
 const f=await fixture(),legacy=new CodexSessionFactory({...f.nativeOptions,cwd:f.task.cwd,nativeCustody:f.custody}),factory=new NativeAgentFactory({...f.options,legacyCodex:legacy});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});await session.rename('Exact native title');await session.stop();session=undefined;const listed=await factory.list();expect(listed.find(task=>task.id===f.task.id)?.name).toBe('Exact native title');expect(legacy.serverRunning).toBe(true);await f.quiet(factory);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);

it.skipIf(!enabled)('arbitrary metadata callbacks remain executable but do not inherit concrete legacy factory coverage',async()=>{
 const f=await fixture(),legacy=new CodexSessionFactory({...f.nativeOptions,cwd:f.task.cwd,nativeCustody:f.custody}),factory=new NativeAgentFactory({...f.options,legacyCodex:legacy,codexSummary:(cwd,id)=>legacy.summaryForCwd(cwd,id)});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:f.task.id});await session.rename('Callback native title');await session.stop();session=undefined;expect((await factory.list()).find(task=>task.id===f.task.id)?.name).toBe('Callback native title');await f.quiet(factory,false);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);
