import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {resolveHostPiExtensions} from '../src/host/pi-extensions.js';
it('preserves the context limit when the browser reapplies the same native model',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-same-model-')),agent=join(root,'agent');await mkdir(agent);
 await writeFile(join(agent,'models.json'),JSON.stringify({providers:{fixture:{baseUrl:'http://127.0.0.1:1',api:'openai-completions',apiKey:'fixture',models:[{id:'large',name:'large',reasoning:false,input:['text'],contextWindow:1000000,maxTokens:8192}]}}}));
 const factory=new RpcPiSessionFactory({cwd:root,agentDir:agent,provider:'fixture',model:'large',args:['--offline','--no-session','--no-skills','--no-extensions'],extensions:resolveHostPiExtensions({PI_COFFEE_SUBAGENTS:'off',PI_COFFEE_WEB:'off',PI_COFFEE_LSP:'off',PI_COFFEE_HANDOFF:'off'}),env:{PI_OFFLINE:'1',PI_COFFEE_INITIAL_MODE:'chat'}});
 const session=await factory.create({sessionId:crypto.randomUUID()});
 try{
  expect((await session.getModels()).context).toMatchObject({preset:'272k',limit:272000});
  await session.setModel('fixture','large');
  expect((await session.getModels()).context).toMatchObject({preset:'272k',limit:272000});
  expect((await session.getStats()).contextBreakdown?.contextWindow).toBe(272000);
  await session.setContextPreset('maximum');await session.setModel('fixture','large');
  expect((await session.getModels()).context).toMatchObject({preset:'maximum',limit:500000});
  await session.setContextPreset('272k');await session.setModel('fixture','large');
  expect((await session.getModels()).context?.limit).toBe(272000);
 }finally{await session.stop();await rm(root,{recursive:true,force:true});}
},30000);
