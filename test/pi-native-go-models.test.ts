import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it} from 'vitest';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';

it('discovers both approved DeepSeek providers without Gemini or Zen and retains Muse',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-go-catalog-')),agent=join(root,'agent');await mkdir(agent);
 const policy=await readFile(new URL('../deploy/pi-chat-models.env.example',import.meta.url),'utf8');
 const allowedModels=policy.split('\n').find(line=>line.startsWith('PI_COFFEE_PI_ALLOWED_MODELS='))!.split('=')[1].split(',');
 expect(allowedModels).toEqual(['openrouter/meta/muse-spark-1.3-contributor','opencode-go/deepseek-v4.1-flash','openrouter/deepseek/deepseek-v4.1-flash']);
 await writeFile(join(agent,'auth.json'),JSON.stringify({'opencode-go':{type:'api_key',key:'fixture'},openrouter:{type:'api_key',key:'fixture'}}));
 const factory=new RpcPiSessionFactory({cwd:root,agentDir:agent,provider:'openrouter',model:'meta/muse-spark-1.3-contributor',allowedModels,extensions:[],args:['--offline','--no-extensions'],env:{PI_OFFLINE:'1'}});
 try{
  const catalog=await factory.modelCatalog('pi');
  expect(catalog.models.map(m=>m.provider+'/'+m.id).sort()).toEqual([...allowedModels].sort());
  expect(catalog.current).toMatchObject({provider:'openrouter',id:'meta/muse-spark-1.3-contributor'});
 }finally{await rm(root,{recursive:true,force:true});}
},30000);
