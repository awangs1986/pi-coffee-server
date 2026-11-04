import {it,expect} from 'vitest';
import {rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {restoreFixture} from './restore-fixture.js';
const binary=process.env.PI_COFFEE_TEST_RESTIC;
it.skipIf(!binary)('restores a missing personal Pi credential while keeping the current provider configuration',async()=>{
 const f=await restoreFixture(binary!,{personalConfiguration:true});
 try{
  await writeFile(join(f.agentDir,'models.json'),'{"current":true}');
  await f.restore.operate('awangs',f.plan.id,{action:'publish',revision:f.plan.revision,digest:f.plan.digest});
  expect(JSON.parse(await readFile(join(f.agentDir,'auth.json'),'utf8'))).toEqual({synthetic:{type:'api_key',key:'fixture-key'}});
  expect(await readFile(join(f.agentDir,'models.json'),'utf8')).toBe('{"current":true}');
  expect(JSON.stringify(await f.restore.status('awangs','alice'))).not.toContain('fixture-key');
 }finally{await rm(f.root,{recursive:true,force:true});}
},120000);
