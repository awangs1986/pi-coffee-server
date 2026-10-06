import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,chmod,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {promisify} from 'node:util';
const exec=promisify(execFile);
async function fixture(backend=false){
 const root=await mkdtemp(join(tmpdir(),'coffee-release-')),repo=join(root,'repo');await mkdir(repo);
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:repo,encoding:'utf8'}).trim();
 git('init','-q','-b','main');await writeFile(join(repo,'.gitignore'),'dist/\nnode_modules\n');await writeFile(join(repo,'source.txt'),'fixture');
 if(backend){await writeFile(join(repo,'package.json'),'{}');await writeFile(join(repo,'package-lock.json'),'{}');await mkdir(join(repo,'node_modules','.bin'),{recursive:true});await mkdir(join(repo,'node_modules','fixture'));const bin=join(repo,'node_modules','fixture','cli.js');await writeFile(bin,'#!/usr/bin/env node\nconsole.log("retained binary");\n');await chmod(bin,0o755);await symlink('../fixture/cli.js',join(repo,'node_modules','.bin','fixture'));}
 git('add','.');git('commit','-qm','source');
 await mkdir(join(repo,'dist','public'),{recursive:true});await writeFile(join(repo,'dist','public','app.js'),'window.fixture="new";\n');
 const plan=join(root,'plan.json'),receipt=join(root,'receipt.json');await writeFile(plan,JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e','process.exit(0)']}]}));
 await exec(process.execPath,[resolve('scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',receipt]);
 const config=join(root,'config.json'),active=join(root,'active');await mkdir(active);await writeFile(join(active,'app.js'),'window.fixture="old";\n');
 await writeFile(config,JSON.stringify({releaseRoot:join(root,'releases'),activePublic:active,stateDir:join(root,'state'),backendCommit:'5073c97'}));
 return {root,repo,receipt,config,active,commit:git('rev-parse','HEAD')};
}
it('stages a verified browser release without activating it or changing current assets',async()=>{
 const f=await fixture();
 try{
  const result=await exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config]);
  expect(JSON.parse(result.stdout)).toMatchObject({state:'staged',sourceCommit:f.commit});
  expect(await readFile(join(f.active,'app.js'),'utf8')).toBe('window.fixture="old";\n');
  const status=await exec(process.execPath,[resolve('scripts/release.mjs'),'status','--config',f.config]);
  expect(JSON.parse(status.stdout)).toMatchObject({active:null,staged:[{sourceCommit:f.commit,state:'staged'}]});
 }finally{await rm(f.root,{recursive:true,force:true});}
});

it('rejects compiled assets changed after verification',async()=>{
 const f=await fixture();
 try{
  await writeFile(join(f.repo,'dist','public','app.js'),'unverified change');
  await expect(exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config])).rejects.toThrow();
  expect(await readFile(join(f.active,'app.js'),'utf8')).toBe('window.fixture="old";\n');
 }finally{await rm(f.root,{recursive:true,force:true});}
});

it('activates staged browser assets with a backup and verified HTTP bytes without restarting the server',async()=>{
 const f=await fixture();const server=createServer(async(req,res)=>{if(req.url==='/healthz'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,role:'web'}));return;}try{res.end(await readFile(join(f.active,decodeURIComponent(req.url!.slice(1)))));}catch{res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('No fixture listener');const base='http://127.0.0.1:'+address.port;
  const config=JSON.parse(await readFile(f.config,'utf8'));Object.assign(config,{healthUrl:base+'/healthz',assetBaseUrl:base,expectedAssets:{'app.js':createHash('sha256').update('window.fixture="old";\n').digest('hex')}});await writeFile(f.config,JSON.stringify(config));
  await exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config]);
  const run=await exec(process.execPath,[resolve('scripts/release.mjs'),'activate-browser','--commit',f.commit,'--config',f.config]);const active=JSON.parse(run.stdout);
  expect(active).toMatchObject({state:'active',sourceCommit:f.commit,backendCommit:'5073c97',serviceRestarted:false});
  expect(await readFile(join(active.backup,'app.js'),'utf8')).toBe('window.fixture="old";\n');
  expect(await (await fetch(base+'/app.js')).text()).toBe('window.fixture="new";\n');
  expect(await (await fetch(base+'/release-manifest.json')).json()).toMatchObject({sourceCommit:f.commit,backendCommit:'5073c97'});
  expect(server.listening).toBe(true);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(f.root,{recursive:true,force:true});}
});

it('restores previous entry assets when the served-byte probe rejects activation',async()=>{
 const f=await fixture();const server=createServer((req,res)=>{if(req.url==='/healthz'){res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,role:'web'}));}else res.end('stale proxy bytes');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('No listener');const base='http://127.0.0.1:'+address.port,config=JSON.parse(await readFile(f.config,'utf8'));
  Object.assign(config,{healthUrl:base+'/healthz',assetBaseUrl:base,expectedAssets:{'app.js':createHash('sha256').update('window.fixture="old";\n').digest('hex')}});await writeFile(f.config,JSON.stringify(config));
  await exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config]);
  await expect(exec(process.execPath,[resolve('scripts/release.mjs'),'activate-browser','--commit',f.commit,'--config',f.config])).rejects.toThrow();
  expect(await readFile(join(f.active,'app.js'),'utf8')).toBe('window.fixture="old";\n');
  const status=JSON.parse((await exec(process.execPath,[resolve('scripts/release.mjs'),'status','--config',f.config])).stdout);expect(status.active).toBeNull();expect(server.listening).toBe(true);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(f.root,{recursive:true,force:true});}
});

it('rejects a checked dirty tree whose claimed commit omits the verified source changes',async()=>{
 const f=await fixture();
 try{
  await writeFile(join(f.repo,'source.txt'),'uncommitted change');
  await exec(process.execPath,[resolve('scripts/verify.mjs'),'--repo',f.repo,'--plan',join(f.root,'plan.json'),'--receipt',f.receipt]);
  await expect(exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config])).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true});}
});

it('keeps a staged backend executable independent of the original fresh-clone directory',async()=>{
 const f=await fixture(true);
 try{
  await exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--role','host','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config]);
  const config=JSON.parse(await readFile(f.config,'utf8')),candidate=join(config.releaseRoot,f.commit+'-host');await rm(f.repo,{recursive:true,force:true});
  const run=await exec(join(candidate,'node_modules','.bin','fixture'));expect(run.stdout.trim()).toBe('retained binary');
 }finally{await rm(f.root,{recursive:true,force:true});}
});


it('refuses an active baseline changed during the health probe without overwriting it',async()=>{
 const f=await fixture();let healthCount=0;const server=createServer(async(req,res)=>{if(req.url==='/healthz'){if(++healthCount===1)await writeFile(join(f.active,'app.js'),'intervening deployment');res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,role:'web'}));}else res.end(await readFile(join(f.active,req.url!.slice(1))));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const address=server.address();if(!address||typeof address==='string')throw Error('No listener');const base='http://127.0.0.1:'+address.port,config=JSON.parse(await readFile(f.config,'utf8'));
  Object.assign(config,{healthUrl:base+'/healthz',assetBaseUrl:base,expectedAssets:{'app.js':createHash('sha256').update('window.fixture="old";\n').digest('hex')}});await writeFile(f.config,JSON.stringify(config));
  await exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config]);
  await expect(exec(process.execPath,[resolve('scripts/release.mjs'),'activate-browser','--commit',f.commit,'--config',f.config])).rejects.toThrow();
  expect(await readFile(join(f.active,'app.js'),'utf8')).toBe('intervening deployment');
 }finally{await new Promise<void>(r=>server.close(()=>r()));await rm(f.root,{recursive:true,force:true});}
});

it('refuses a dependency changed after backend verification',async()=>{
 const f=await fixture(true);
 try{
  await writeFile(join(f.repo,'node_modules','fixture','cli.js'),'unchecked dependency');
  await expect(exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--role','host','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config])).rejects.toThrow();
  const status=JSON.parse((await exec(process.execPath,[resolve('scripts/release.mjs'),'status','--config',f.config])).stdout);expect(status.staged).toEqual([]);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

it('refuses mutated package metadata in an existing backend candidate',async()=>{
 const f=await fixture(true);
 try{
  const flags=[resolve('scripts/release.mjs'),'stage','--fixture','--role','host','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config];await exec(process.execPath,flags);
  const config=JSON.parse(await readFile(f.config,'utf8'));await writeFile(join(config.releaseRoot,f.commit+'-host','package.json'),'{"type":"module"}');
  await expect(exec(process.execPath,flags)).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true});}
});


it('refuses dependencies replaced by a root symlink outside the release',async()=>{
 const f=await fixture(true);
 try{
  await rm(join(f.repo,'node_modules','.bin'),{recursive:true});await exec(process.execPath,[resolve('scripts/verify.mjs'),'--repo',f.repo,'--plan',join(f.root,'plan.json'),'--receipt',f.receipt]);
  await rename(join(f.repo,'node_modules'),join(f.root,'shared-dependencies'));await symlink(join(f.root,'shared-dependencies'),join(f.repo,'node_modules'));
  await expect(exec(process.execPath,[resolve('scripts/release.mjs'),'stage','--fixture','--role','host','--source',f.repo,'--commit',f.commit,'--verification',f.receipt,'--config',f.config])).rejects.toThrow();
 }finally{await rm(f.root,{recursive:true,force:true});}
});
