// Real Pi RPC, synthetic on-disk resources, no model/provider call.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RpcPiSessionFactory} from '../dist/src/host/pi-adapter.js';
import {resolvePiExtensions} from 'pi-coffee';
const root=await mkdtemp(join(tmpdir(),'coffee-context-probe-'));
let session;
try{
 const agentDir=join(root,'agent');await mkdir(agentDir);
 await writeFile(join(root,'AGENTS.md'),'Synthetic project instructions: run focused checks.');
 await writeFile(join(agentDir,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:1',api:'openai-completions',apiKey:'fixture-not-a-key',models:[{id:'fixture',name:'fixture',reasoning:false,input:['text'],contextWindow:128000,maxTokens:2048}]}}}));
 const factory=new RpcPiSessionFactory({cwd:root,agentDir,sessionDir:join(root,'sessions'),provider:'fixture',model:'fixture',extensions:resolvePiExtensions(),skills:[resolve('dist/skills/lsp')],env:{PI_OFFLINE:'1',PI_COFFEE_SCHEDULER_DIR:join(root,'admission')}});
 session=await factory.create({sessionId:'00000000-0000-4000-8000-000000000001'});
 const stats=await session.getStats();const d=stats.contextBreakdown;
 assert.ok(d);assert.equal(d.basis,'session_preview');assert.equal(d.categories.length,7);
 for(const id of ['system','rules','skills','tools'])assert.ok(d.categories.find(c=>c.id===id).tokens>0,id);
 assert.equal(d.totalTokens,d.categories.reduce((n,c)=>n+c.tokens,0));
 assert.equal((await session.getHistory()).entries.filter(e=>e.kind==='user').length,0);
 console.log(JSON.stringify({ok:true,modelCalls:0,basis:d.basis,totalTokens:d.totalTokens,categories:d.categories}));
}finally{await session?.stop();await rm(root,{recursive:true,force:true});}
