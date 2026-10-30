import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {CodexSessionFactory} from '../src/host/codex-adapter.js';
import {codexFixture} from './codex-recovery-fixture.js';

it('real Pi resumes original history through ordinary custody without namespace provider overlay or a model turn',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ordinary-pi-')),sessionDir=join(root,'sessions'),agentDir=join(root,'agent');await mkdir(sessionDir);await mkdir(agentDir);const stored=SessionManager.create(root,sessionDir,{id:'original-pi'});stored.appendMessage({role:'user',content:'Original ordinary Pi history',timestamp:1});
 const lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),factory=new RpcPiSessionFactory({cwd:root,sessionDir,agentDir,nativeCustody:custody,writerFence:fence,env:{PI_OFFLINE:'1'},args:['--no-extensions','--no-skills','--no-prompt-templates','--no-themes']});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{session=await factory.create({sessionId:'original-pi',requireExisting:true});expect(JSON.stringify(await session.getHistory())).toContain('Original ordinary Pi history');expect(await custody.state()).toMatchObject({state:'active'});await expect(fence.lease()).rejects.toMatchObject({code:'writers_active'});await session.stop();session=undefined;await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');const cut=await fence.lease();cut.assertValid();cut.release();expect(SessionManager.open(stored.getSessionFile()!).getSessionId()).toBe('original-pi');}
 finally{await session?.stop();await rm(root,{recursive:true,force:true});}
},30000);

it.skipIf(!process.env.PI_COFFEE_TEST_CODEX_ROOT)('pinned Codex resumes ordinary native history with its existing home config and source lock',async()=>{
 const f=await codexFixture(),lock=join(f.root,'group.lock'),custody=new NativeWriterCustody(join(f.root,'ordinary-custody'),{lock}),fence=new PhysicalWriterFence({lock,custody}),cliPath=await realpath(join(process.env.PI_COFFEE_TEST_CODEX_ROOT!,'node_modules','.bin','codex')),configBefore=await readFile(join(f.home,'config.toml'));
 const factory=new CodexSessionFactory({cwd:f.task.cwd,cliPath,codexHome:f.home,nativeCustody:custody,env:{HOME:f.root},sandbox:'danger-full-access'});let session:Awaited<ReturnType<typeof factory.create>>|undefined;
 try{const admission=fence.beginWriter('native');try{session=await factory.create({sessionId:f.id,requireExisting:true});}finally{admission();}expect(JSON.stringify(await session.getHistory())).toContain('The ordinary answer');expect(await custody.state()).toMatchObject({state:'active'});await expect(fence.lease()).rejects.toMatchObject({code:'writers_active'});await session.stop();session=undefined;await factory.close();await expect.poll(async()=>(await custody.state()).state,{timeout:10000}).toBe('quiescent');const cut=await fence.lease();cut.assertValid();cut.release();expect(await readFile(join(f.home,'config.toml'))).toEqual(configBefore);expect((await factory.readHistory(f.id)).history.entries.map(entry=>entry.id)).toEqual(['original-user-item','original-agent-item']);}
 finally{await session?.stop();await factory.close();await rm(f.root,{recursive:true,force:true});}
},40000);
