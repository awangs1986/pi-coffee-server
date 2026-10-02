import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it} from 'vitest';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';

it.each([true,false])('discovers approved providers and honors Antigravity off (enabled=%s)',async(enabled)=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-approved-providers-')),agent=join(root,'agent');await mkdir(agent);
 await writeFile(join(agent,'auth.json'),JSON.stringify({openrouter:{type:'api_key',key:'fixture'},antigravity:{type:'oauth',access:'fixture-access',refresh:'fixture-refresh',expires:Date.now()+3600000,projectId:'fixture-project'}}));
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{openrouter:{baseUrl:'http://127.0.0.1:9/v1',api:'openai-completions',apiKey:'fixture',models:[{id:'meta/muse-spark-1.3-contributor',name:'Fixture Muse',reasoning:true,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:272000,maxTokens:4096}]}}}));
 const env={...(enabled?{}:{PI_COFFEE_ANTIGRAVITY:'off'}),PI_COFFEE_SUBAGENTS:'off',PI_COFFEE_WEB:'off',PI_COFFEE_LSP:'off',PI_COFFEE_HANDOFF:'off',PI_COFFEE_PI_ALLOWED_MODELS:'openrouter/meta/muse-spark-1.3-contributor,antigravity/gemini-3.8-flash'};
 const factory=new RpcPiSessionFactory({cwd:root,agentDir:agent,provider:'openrouter',model:'meta/muse-spark-1.3-contributor',allowedModels:env.PI_COFFEE_PI_ALLOWED_MODELS.split(','),extensions:resolveHostPiExtensions(env),args:['--offline','--no-extensions'],env:{PI_OFFLINE:'1'}});
 try{const catalog=await factory.modelCatalog('pi');expect(catalog.models.map(m=>m.provider+'/'+m.id)).toEqual(enabled?['openrouter/meta/muse-spark-1.3-contributor','antigravity/gemini-3.8-flash']:['openrouter/meta/muse-spark-1.3-contributor']);expect(catalog.current).toMatchObject({provider:'openrouter',id:'meta/muse-spark-1.3-contributor'});}
 finally{await rm(root,{recursive:true,force:true});}
});
