import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {expect,it} from 'vitest';
const require=createRequire(import.meta.url);
it('registers native packages idempotently while preserving private settings and resource filters',async()=>{
 const agent=await mkdtemp(join(resolve('node_modules'),'coffee-package-config-'));
 const harness=dirname(require.resolve('pi-coffee-harness/package.json'));
 const legacy=join(agent,'old');await mkdir(legacy);await writeFile(join(legacy,'package.json'),JSON.stringify({name:'pi-coffee'}));await writeFile(join(legacy,'index.js'),'');
 const before={defaultProvider:'fixture',packages:[{source:harness,extensions:[]}],extensions:[join(legacy,'index.js'),'./personal.js']};
 const secret={serperApiKey:'synthetic-private-fixture',provider:'serper',customField:true};
 try{
  await writeFile(join(agent,'settings.json'),JSON.stringify(before));await writeFile(join(agent,'web-search.json'),JSON.stringify(secret));
  for(let n=0;n<2;n++)await promisify(execFile)(process.execPath,[resolve('scripts/configure-native-pi.mjs'),agent],{timeout:20000});
  const after=JSON.parse(await readFile(join(agent,'settings.json'),'utf8'));expect(after.defaultProvider).toBe('fixture');expect(after.extensions).toEqual(['./personal.js']);expect(after.packages).toHaveLength(5);
  expect(after.packages.find((p:any)=>typeof p==='object' && resolve(agent,p.source)===harness).extensions).toEqual([]);
  expect(JSON.parse(await readFile(join(agent,'settings.json.before-pi099'),'utf8'))).toEqual(before);
  expect(JSON.parse(await readFile(join(agent,'web-search.json'),'utf8'))).toMatchObject({...secret,toolActivation:'dynamic',maxInlineContentChars:6000,workflow:'none'});
 }finally{await rm(agent,{recursive:true,force:true});}
},45000);
