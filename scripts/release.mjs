#!/usr/bin/env node
import {checkedReleaseVersion,releaseVersion} from './lib/release-version.mjs';
// Per-machine local staging. Browser activation is separate; never restarts a unit.
import {readFile,mkdir,writeFile,rename,readdir,cp,rm,chmod,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {requireVerification} from './lib/verification-receipt.mjs';
import {sourceIdentity} from './lib/source-identity.mjs';
import {artifacts,dependencyArtifacts,sha256} from './lib/artifacts.mjs';
const exec=promisify(execFile);
const args=process.argv.slice(2),command=args[0],take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const load=async file=>JSON.parse(await readFile(file,'utf8'));
async function save(file,value){await mkdir(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID();await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,file);}
try{
 const config=await load(resolve(take('--config')));
 for(const key of ['releaseRoot','stateDir','activePublic'])if(typeof config[key]!=='string'||!config[key].startsWith('/'))throw Error('Absolute release paths required');
 const root=resolve(config.releaseRoot),state=resolve(config.stateDir);
 await mkdir(root,{recursive:true,mode:0o755});await mkdir(state,{recursive:true,mode:0o700});
 if(command==='status'){
  let active=null;try{active=await load(join(state,'current.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const staged=[];for(const name of (await readdir(root)).sort())if(/^[a-f0-9]{40}-(browser|web|host)$/.test(name)){const item=await load(join(root,name,'release.json'));if(item.sourceCommit!==active?.sourceCommit||item.role!==active?.role)staged.push({sourceCommit:item.sourceCommit,version:releaseVersion(item.version),role:item.role,state:'staged'});}
  console.log(JSON.stringify({active,staged}));
 }else if(command==='activate-browser'){
  const commit=take('--commit');if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid release');
  const directory=join(root,commit+'-browser'),manifest=await load(join(directory,'release.json'));
  const files=await artifacts(join(directory,'public'));if(manifest.sourceCommit!==commit||releaseVersion(manifest.version)==='unknown'||JSON.stringify(files)!==JSON.stringify(manifest.assets))throw Error('Staged bytes changed');
  if(!config.expectedAssets||!Object.keys(config.expectedAssets).length)throw Error('Provide the expected active asset hashes');
  const publicRoot=resolve(config.activePublic);
  const validateBaseline=async()=>{for(const [name,hash] of Object.entries(config.expectedAssets)){if(name.startsWith('/')||name.split('/').some(s=>s==='..'||s==='.')||!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid baseline');if(sha256(await readFile(join(publicRoot,name)))!==hash)throw Error('Active deployment changed');}};
  const healthUrl=new URL(config.healthUrl),baseUrl=new URL(config.assetBaseUrl);if(!['http:','https:'].includes(healthUrl.protocol)||healthUrl.username||healthUrl.password||baseUrl.origin!==healthUrl.origin)throw Error('Invalid local probe URLs');
  const health=async()=>{const r=await fetch(healthUrl,{redirect:'error',signal:AbortSignal.timeout(10000)});const body=await r.json();if(!r.ok||!body.ok||body.role!=='web')throw Error('Web health failed');};
  const service=async()=>{if(!config.unit)return null;if(!/^[a-zA-Z0-9_.@-]+\.service$/.test(config.unit))throw Error('Invalid unit');return (await exec('systemctl',[...(config.userUnit?['--user']:[]),'show',config.unit,'-p','MainPID','-p','WorkingDirectory'])).stdout;};
  const lock=join(state,'activation.lock');await mkdir(lock);
  let backup,mutated=false;const backedUp=[];
  try{
   await validateBaseline();await health();const before=await service();
   backup=join(state,'operations',randomUUID(),'before');await mkdir(backup,{recursive:true,mode:0o700});
   const names=Object.keys(files).filter(n=>!['app.js','index.html','release-manifest.json'].includes(n)).sort();for(const name of ['app.js','index.html'])if(files[name])names.push(name);
   for(const name of [...names,'release-manifest.json']){try{const meta=await lstat(join(publicRoot,name));if(!meta.isFile())throw Error('Non-regular active asset');await mkdir(dirname(join(backup,name)),{recursive:true});await cp(join(publicRoot,name),join(backup,name));backedUp.push(name);}catch(error){if(error.code!=='ENOENT')throw error;}}
   await validateBaseline();
   mutated=true;
   for(const name of names){const target=join(publicRoot,name);await mkdir(dirname(target),{recursive:true});const temp=target+'.'+randomUUID();await cp(join(directory,'public',name),temp);await chmod(temp,0o644);await rename(temp,target);}
   const identity={sourceCommit:commit,version:releaseVersion(manifest.version),backendVersion:releaseVersion(config.backendVersion),hostVersion:releaseVersion(config.hostVersion),backendCommit:config.backendCommit||'unknown',hostCommit:config.hostCommit||'unknown'};
   await save(join(publicRoot,'release-manifest.json'),identity);await chmod(join(publicRoot,'release-manifest.json'),0o644);
   for(const [name,hash] of Object.entries(files)){const url=new URL(name.split('/').map(encodeURIComponent).join('/'),baseUrl.href.endsWith('/')?baseUrl:new URL(baseUrl.href+'/'));const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok||sha256(Buffer.from(await response.arrayBuffer()))!==hash)throw Error('Served assets differ');}
   await health();if(await service()!==before)throw Error('Service changed during activation');
   const active={state:'active',role:'browser',...identity,backup,serviceRestarted:false};await save(join(state,'current.json'),active);console.log(JSON.stringify(active));
  }catch(error){
   if(mutated){for(const name of backedUp){const target=join(publicRoot,name),temp=target+'.'+randomUUID();await cp(join(backup,name),temp);await rename(temp,target);}if(!backedUp.includes('release-manifest.json'))await rm(join(publicRoot,'release-manifest.json'),{force:true});await save(join(dirname(backup),'result.json'),{state:'rolled-back',sourceCommit:commit});}
   throw error;
  }finally{await rm(lock,{recursive:true,force:true});}
 }else if(command==='stage'){
  const source=resolve(take('--source')||'.'),identity=await sourceIdentity(source),commit=take('--commit'),role=take('--role')||'browser';
  if(!/^[a-f0-9]{40}$/.test(commit)||identity.commit!==commit||!['browser','web','host'].includes(role))throw Error('Choose the checked source commit');
  if((await exec('/usr/bin/git',['status','--porcelain'],{cwd:source})).stdout.trim())throw Error('Commit the exact source before staging');
  const verification=await load(resolve(take('--verification')));await requireVerification(source,identity,verification,{fixture:args.includes('--fixture')});
  const version=await checkedReleaseVersion(source);
  const directory=join(root,commit+'-'+role),publicRoot=join(source,'dist/public'),assets=await artifacts(publicRoot);
  const dependencies=role==='browser'?null:await dependencyArtifacts(join(source,'node_modules'));
  if(role!=='browser'&&JSON.stringify(dependencies)!==JSON.stringify(verification.dependencies))throw Error('Dependencies changed after verification');
  const packageMetadata=async base=>{const hashes={};for(const name of ['package.json','package-lock.json','VERSION'])hashes[name]=sha256(await readFile(join(base,name)));return hashes;};
  const metadata=role==='browser'?null:await packageMetadata(source);
  const manifest={formatVersion:1,version,sourceCommit:commit,sourceTree:identity.tree,role,state:'staged',assets,...(role==='browser'?{}:{runtime:verification.artifacts,dependencies,metadata})};
  let existing;try{existing=await load(join(directory,'release.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing){if(JSON.stringify(existing)!==JSON.stringify(manifest)||JSON.stringify(await artifacts(join(directory,'public')))!==JSON.stringify(assets)||(role!=='browser'&&(JSON.stringify(await artifacts(join(directory,'dist')))!==JSON.stringify(manifest.runtime)||JSON.stringify(await dependencyArtifacts(join(directory,'node_modules')))!==JSON.stringify(dependencies)||JSON.stringify(await packageMetadata(directory))!==JSON.stringify(metadata))))throw Error('Immutable release differs');}
  else{
   const pending=directory+'.'+randomUUID();await mkdir(pending,{mode:0o755});
   try{await cp(publicRoot,join(pending,'public'),{recursive:true});if(role!=='browser'){for(const file of ['dist','node_modules','package.json','package-lock.json','VERSION'])await cp(join(source,file),join(pending,file),{recursive:true,verbatimSymlinks:true});}if(JSON.stringify(await artifacts(join(pending,'public')))!==JSON.stringify(assets)||(role!=='browser'&&(JSON.stringify(await artifacts(join(pending,'dist')))!==JSON.stringify(manifest.runtime)||JSON.stringify(await dependencyArtifacts(join(pending,'node_modules')))!==JSON.stringify(dependencies)||JSON.stringify(await packageMetadata(pending))!==JSON.stringify(metadata))))throw Error('Source artifacts changed during staging');await save(join(pending,'release.json'),manifest);await rename(pending,directory);}catch(error){await rm(pending,{recursive:true,force:true});throw error;}
  }
  console.log(JSON.stringify({state:'staged',sourceCommit:commit,version,role}));
 }else throw Error('Unknown release action');
}catch{console.error('Release refused: inspect configuration, checked source and immutable artifacts. No service was restarted.');process.exitCode=1;}
