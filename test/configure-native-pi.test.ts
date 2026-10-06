import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect,it} from 'vitest';

const script=resolve('scripts/configure-native-pi.mjs');
const run=(agent:string)=>execFileSync(process.execPath,[script,agent],{encoding:'utf8',timeout:30000});

it('migrates Azure native configuration without losing credentials, model choices or original backups',async()=>{
 const agent=await mkdtemp(join(tmpdir(),'coffee-azure-upgrade-'));
 const originals={
  'auth.json':{ 'azure-openai-responses':{type:'api_key',key:'synthetic-azure-credential'},fixture:{type:'api_key',key:'synthetic-other-credential'} },
  'models.json':{providers:{'azure-openai-responses':{baseUrl:'https://example.invalid',api:'azure-openai-responses',models:[{id:'fixture',contextWindow:128000,maxTokens:4096}]},fixture:{apiKey:'synthetic-other-credential'}}},
  'settings.json':{defaultProvider:'azure-openai-responses',defaultModel:'fixture',defaultThinkingLevel:'high',enabledModels:['azure-openai-responses/*','fixture/model'],modelThinkingLevels:{'azure-openai-responses/fixture':'high','fixture/model':'low'}},
  'web-search.json':{serperApiKey:'synthetic-serper-credential',searchProvider:'serper'},
 };
 try{
  for(const [file,value] of Object.entries(originals))await writeFile(join(agent,file),JSON.stringify(value)+'\n');
  run(agent);
  const load=async(file:string)=>JSON.parse(await readFile(join(agent,file),'utf8'));
  expect(await load('auth.json')).toEqual({azure:originals['auth.json']['azure-openai-responses'],fixture:originals['auth.json'].fixture});
  expect(await load('models.json')).toEqual({providers:{azure:originals['models.json'].providers['azure-openai-responses'],fixture:originals['models.json'].providers.fixture}});
  expect(await load('settings.json')).toMatchObject({defaultProvider:'azure',defaultModel:'fixture',defaultThinkingLevel:'high',enabledModels:['azure/*','fixture/model'],modelThinkingLevels:{'azure/fixture':'high','fixture/model':'low'}});
  expect(await load('web-search.json')).toMatchObject(originals['web-search.json']);
  for(const [file,value] of Object.entries(originals))expect(await readFile(join(agent,file+'.before-pi104'),'utf8')).toBe(JSON.stringify(value)+'\n');
  run(agent);
  for(const [file,value] of Object.entries(originals))expect(await readFile(join(agent,file+'.before-pi104'),'utf8')).toBe(JSON.stringify(value)+'\n');
  expect((await load('settings.json')).packages).toHaveLength(5);
 }finally{await rm(agent,{recursive:true,force:true});}
},65000);

it('rejects conflicting Azure providers before changing any native configuration',async()=>{
 const agent=await mkdtemp(join(tmpdir(),'coffee-azure-conflict-'));
 const originals={
  'auth.json':{azure:{type:'api_key',key:'synthetic-new'},'azure-openai-responses':{type:'api_key',key:'synthetic-old'}},
  'models.json':{providers:{}},'settings.json':{defaultProvider:'fixture'},'web-search.json':{searchProvider:'serper'},
 };
 try{
  for(const [file,value] of Object.entries(originals))await writeFile(join(agent,file),JSON.stringify(value)+'\n');
  expect(()=>run(agent)).toThrow(/[Cc]onflicting Azure/);
  for(const [file,value] of Object.entries(originals))expect(await readFile(join(agent,file),'utf8')).toBe(JSON.stringify(value)+'\n');
 }finally{await rm(agent,{recursive:true,force:true});}
},35000);
