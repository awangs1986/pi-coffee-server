#!/usr/bin/env node
// Read-only identity reconciliation. This report never grants publication or activation.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,readlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {processObservation,observedVerification} from './lib/process-observation.mjs';
const exec=promisify(execFile),args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const commit=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)?value:'unknown';
const read=async path=>JSON.parse(await readFile(path,'utf8'));
try{
 const repo=resolve(take('--repo')||'.'),config=await read(resolve(take('--config')));
 const git=async(...argv)=>(await exec('git',argv,{cwd:repo,timeout:15000,maxBuffer:1024*1024})).stdout.trim();
 const source={commit:commit(await git('rev-parse','HEAD')),version:(await readFile(join(repo,'VERSION'),'utf8')).trim(),clean:!(await git('status','--porcelain'))};
 const remotes={};for(const name of ['origin','gitea']){try{remotes[name]=commit((await git('ls-remote',name,'refs/heads/main')).split(/\s/)[0]);}catch{remotes[name]='unknown';}}
 const observe=async unit=>{
  if(typeof unit!=='string'||!/^[a-zA-Z0-9_.@-]+\.service$/.test(unit))throw Error('Explicit unit required');
  try{
   const {stdout}=await exec('systemctl',[...(config.userUnit?['--user']:[]),'show',unit,'-p','ActiveState','-p','MainPID','-p','WorkingDirectory'],{timeout:10000});
   const properties=Object.fromEntries(stdout.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
   const pid=Number(properties.MainPID),before=await processObservation(pid);
   if(properties.ActiveState!=='active'||!before)throw Error('No active process');
   // Loaded unit configuration can describe a future restart. Observe the actual process.
   const directory=await readlink(`/proc/${pid}/cwd`),value=await read(join(directory,'release.json'));
   if(JSON.stringify(await processObservation(pid))!==JSON.stringify(before))throw Error('Process changed during observation');
   return {commit:commit(value.sourceCommit),version:value.version,active:true,directory};
  }catch{return {commit:'unknown',active:false};}
 };
 const webObserved=await observe(config.webUnit??config.unit),hostObserved=await observe(config.hostUnit);
 let frontend={commit:'unknown'};try{const value=await read(join(webObserved.directory,'dist/public/release-manifest.json'));frontend={commit:commit(value.sourceCommit),version:value.version};}catch{}
 let verification={status:'unknown',commit:'unknown',matchesSource:false};try{const value=await observedVerification(await read(resolve(take('--verification')||join(repo,'.coffee-verification/receipt.json'))));verification={status:value.status,commit:commit(value.commit),matchesSource:value.commit===source.commit,...(value.reason?{reason:value.reason}:{})};}catch{}
 const {directory:_web,...web}=webObserved,{directory:_host,...host}=hostObserved;
 const aligned=source.clean&&web.active&&host.active&&[remotes.origin,remotes.gitea,web.commit,host.commit,frontend.commit].every(id=>id===source.commit)&&[web.version,host.version,frontend.version].every(version=>version===source.version)&&verification.status==='passed'&&verification.matchesSource;
 console.log(JSON.stringify({observedAt:new Date().toISOString(),evidence:'identity-observation-only',aligned,source,remotes,web,host,frontend,verification}));
}catch{console.error('Release audit unavailable; inspect repository and explicit unit configuration.');process.exitCode=1;}
