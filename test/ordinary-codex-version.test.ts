import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {OrdinaryBackupComposition} from '../src/host/ordinary-backup-composition.js';
import {LEGACY_BACKUP_SCOPE} from '../src/host/backup.js';
async function fixture(program:string){
 const root=await mkdtemp('/tmp/ordinary-version-'),configuration=join(root,'configuration.json'),graph=join(root,'graph.json'),command=join(root,'codex');
 await writeFile(configuration,JSON.stringify({schema:1,groupId:'version-fixture',owner:{administrator:'awangs',operatingAssumption:'all-source-producers-use-admission-v1'},roots:[{id:'native',path:join(root,'data')}],producers:[{id:'host',kind:'host'}]}),{mode:0o600});
 await writeFile(graph,JSON.stringify({schema:1,groupId:'version-fixture',roots:[{id:'native',scope:LEGACY_BACKUP_SCOPE,engine:'shared'}]}),{mode:0o600});
 await writeFile(command,'#!'+process.execPath+'\n'+program,{mode:0o700});
 const source=await OrdinaryBackupComposition.open({schema:1,root:join(root,'authority'),configuration,graph,sourceSocket:join(root,'source.sock'),sourcePolicy:join(root,'source-policy.json'),enrollment:{mode:'fresh',actor:'awangs'}},join(root,'backup'));
 await mkdir(join(root,'home'));return {root,command,source,options:{cwd:root,env:{HOME:join(root,'home'),SYNTHETIC_VERSION_ENV:'preserved'}},close:async()=>{await source.close();await rm(root,{recursive:true,force:true});}};
}
it('ordinary Codex version observation preserves native HOME, environment, cwd and actual command arguments under real custody',async()=>{
 const f=await fixture("require('node:fs').writeFileSync('observed.json',JSON.stringify({home:process.env.HOME,env:process.env.SYNTHETIC_VERSION_ENV,cwd:process.cwd(),args:process.argv.slice(2)}));console.log('codex-cli 0.159.1');");try{
  expect(await f.source.codexVersion(f.command,f.options)).toBe('0.159.1');expect(JSON.parse(await readFile(join(f.root,'observed.json'),'utf8'))).toEqual({home:f.options.env.HOME,env:'preserved',cwd:f.root,args:['--version']});expect(await f.source.custody.state()).toEqual({state:'quiescent'});
 }finally{await f.close();}
});
it('version observation times out while its surviving helper retains actual custody and excludes backup',async()=>{
 const f=await fixture("const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},8000)'],{detached:true,stdio:'ignore'});c.unref();console.log('codex-cli 0.159.1');");try{
  const before=Date.now();expect(await f.source.codexVersion(f.command,f.options)).toBe('unknown');expect(Date.now()-before).toBeLessThan(6500);expect((await f.source.custody.state()).state).toBe('active');await expect(f.source.physical.lease()).rejects.toMatchObject({code:'writers_active'});await expect.poll(async()=>(await f.source.custody.state()).state,{timeout:6000}).toBe('quiescent');
 }finally{await f.close();}
},15000);
it('oversized version output is bounded and cannot qualify an arbitrary executable as supported Codex',async()=>{
 const f=await fixture("console.log('codex-cli 0.159.1');process.stdout.write('x'.repeat(20000));");try{
  expect(await f.source.codexVersion(f.command,f.options)).toBe('unknown');await expect.poll(async()=>(await f.source.custody.state()).state,{timeout:5000}).toBe('quiescent');
 }finally{await f.close();}
});
