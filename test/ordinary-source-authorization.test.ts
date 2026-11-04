import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {OrdinaryBackupComposition} from '../src/host/ordinary-backup-composition.js';
import {LEGACY_BACKUP_SCOPE} from '../src/host/backup.js';
it.each(['current','reader','revoked','revision','scope'] as const)('ordinary enrollment checks current application source grants: %s',async(change)=>{
 const root=await mkdtemp('/tmp/ordinary-auth-'),configuration=join(root,'configuration.json'),graph=join(root,'graph.json'),sourcePolicy=join(root,'source-policy.json');let source:OrdinaryBackupComposition|undefined;
 try{
  await writeFile(configuration,JSON.stringify({schema:1,groupId:'authorization-fixture',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'domain',path:join(root,'data')}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});
  await writeFile(graph,JSON.stringify({schema:1,groupId:'authorization-fixture',roots:[{id:'domain',scope:LEGACY_BACKUP_SCOPE,engine:'shared'}]}),{mode:0o600});
  await writeFile(sourcePolicy,JSON.stringify({schema:1,revision:change==='revision'?2:1,administrator:'awangs',scopes:[LEGACY_BACKUP_SCOPE],actors:change==='revoked'?{}:{awangs:{role:change==='reader'?'reader':'administrator',scopes:change==='scope'?[]:[LEGACY_BACKUP_SCOPE]}},sourceProducers:[]}),{mode:0o600});
  source=await OrdinaryBackupComposition.open({schema:1,root:join(root,'authority'),configuration,graph,sourceSocket:join(root,'source.sock'),sourcePolicy,enrollment:{mode:'fresh',actor:'awangs'}},join(root,'backup'),{actor:'awangs',dataScope:LEGACY_BACKUP_SCOPE,authorityRevision:1});
  expect((await source.authority.qualification()).state).toBe(change==='current'?'qualified':'unknown');
  const state=JSON.parse(await readFile(join(root,'authority','enrollment','state.json'),'utf8'));expect(Boolean(state.enrollment)).toBe(change==='current');
  await source.fence.runWriter('platform',()=>writeFile(join(root,'ordinary-work'),'continued'));expect(await readFile(join(root,'ordinary-work'),'utf8')).toBe('continued');
 }finally{await source?.close();await rm(root,{recursive:true,force:true});}
});
