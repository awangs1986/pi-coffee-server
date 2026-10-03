import {it,expect,afterEach} from 'vitest';import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {SessionManager} from '@earendil-works/pi-coding-agent';import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';import {CodexSessionFactory} from '../src/host/codex-adapter.js';
const cleanup:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const f of cleanup.reverse())await f();cleanup.length=0;});
it('forks Pi through its native SessionManager without rewriting the source file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-pi-fork-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source'),target=join(root,'target'),store=join(root,'sessions');await mkdir(source);await mkdir(target);
 const original=SessionManager.create(source,store);original.appendMessage({role:'user',content:'Keep this original user requirement',timestamp:Date.now()});original.appendMessage({role:'assistant',content:[{type:'text',text:'Original answer'}],api:'openai-completions',provider:'fixture',model:'fixture',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:Date.now()});
 const before=await readFile(original.getSessionFile()!,'utf8'),id=randomUUID();
 const factory=new RpcPiSessionFactory({cwd:source,sessionDir:store,cliPath:resolve('test/fixtures/fake-pi-rpc.mjs')});const fork=await factory.forkNative(original.getSessionId(),{sessionId:id,cwd:target,sourceCwd:source});cleanup.push(()=>fork.stop());
 const listing=(await SessionManager.listAll(store)).find(row=>row.id===id)!;const native=SessionManager.open(listing.path);
 expect(native.getCwd()).toBe(target);expect(native.buildSessionContext().messages).toEqual(original.buildSessionContext().messages);expect(await readFile(original.getSessionFile()!,'utf8')).toBe(before);
});
it('uses native Codex thread/fork with an independently bound cwd and unchanged source history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-codex-fork-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source'),target=join(root,'target'),home=join(root,'home');await mkdir(source);await mkdir(target);
 const base={cliPath:process.execPath,commandArgs:[resolve('test/fixtures/fake-codex-app-server.mjs')],codexHome:home};let sourceNative='';
 const parent=new CodexSessionFactory({...base,cwd:source,onBound:async(_host,id)=>{sourceNative=id;}});cleanup.push(()=>parent.close());const session=await parent.create({sessionId:randomUUID()});
 await session.prompt('Remember original requirement');await expect.poll(async()=>(await session.getHistory()).entries.some(e=>e.kind==='assistant')).toBe(true);await expect.poll(async()=>(await session.getState()).isStreaming).toBe(false);const before=await session.getHistory();
 const childFactory=new CodexSessionFactory({...base,cwd:target});cleanup.push(()=>childFactory.close());const child=await childFactory.forkNative(sourceNative,{sessionId:randomUUID(),cwd:target,sourceCwd:source});
 expect((await child.getHistory()).entries).toEqual(before.entries);await child.prompt('Child only');await expect.poll(async()=>(await child.getHistory()).entries.some(e=>e.kind==='assistant'&&e.text.includes('Child only'))).toBe(true);await expect.poll(async()=>(await child.getState()).isStreaming).toBe(false);expect((await session.getHistory()).entries).toEqual(before.entries);
 await expect(childFactory.forkNative(sourceNative,{sessionId:randomUUID(),cwd:target,sourceCwd:root})).rejects.toThrow('does not belong');
});
