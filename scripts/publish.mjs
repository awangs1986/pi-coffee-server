#!/usr/bin/env node
import {checkedReleaseVersion,assertReleaseIncrement} from './lib/release-version.mjs';
// One native Git pack, with an explicit Coffee account and an exact remote lease.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {requireVerification} from './lib/verification-receipt.mjs';
import {sourceIdentity} from './lib/source-identity.mjs';
const exec=promisify(execFile),args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
const refuse=code=>{const error=Error();error.publicationCode=code;throw error;};
let privateRoot;
try{
 const repo=resolve(take('--repo')||'.'),remote=take('--remote')||'origin',branch=take('--branch')||'main',expected=take('--expected');
 if(!/^[a-zA-Z0-9_.-]+$/.test(remote)||!/^[a-zA-Z0-9_./-]+$/.test(branch)||branch.includes('..')||!expected||!/[a-f0-9]{40}/.test(expected)||expected.length!==40)throw Error('Invalid publication');
 const base=join(homedir(),'.cache','pi-coffee','publication');await mkdir(base,{recursive:true,mode:0o700});privateRoot=await mkdtemp(join(base,'run-'));
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_CONFIG_'))delete env[key];
 Object.assign(env,{HOME:privateRoot,XDG_CONFIG_HOME:privateRoot,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/bin/false',SSH_ASKPASS:'/bin/false',SSH_AUTH_SOCK:'',GH_TOKEN:'coffee-no-shared-auth',GITHUB_TOKEN:'coffee-no-shared-auth'});
 const prefix=['-c','credential.helper='];
 const git=async(...tail)=>(await exec('/usr/bin/git',[...prefix,...tail],{cwd:repo,env,maxBuffer:16*1024*1024})).stdout.trim();
 const identity=await sourceIdentity(repo),verification=JSON.parse(await readFile(resolve(take('--verification')),'utf8')),reviewBytes=await readFile(resolve(take('--review')));
 await requireVerification(repo,identity,verification,{fixture:args.includes('--fixture'),reviewBytes});
 if(await git('status','--porcelain'))throw Error('Commit all source changes before publishing');
 const destinations=(await git('remote','get-url','--push','--all',remote)).split('\n');if(destinations.length!==1)throw Error('Select one destination');
 const target=destinations[0];
 if(args.includes('--fixture')){if(!target.startsWith('/')&&!target.startsWith('./')&&!target.startsWith('../'))throw Error('Fixtures require a local forge');}
 else {
  const url=new URL(target);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||!/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url.pathname))throw Error('Select a GitHub HTTPS remote');
  const account=take('--account'),root=take('--accounts-root');if(!account||!root)refuse('account_missing');
  const file=join(resolve(root),'accounts.json'),state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!state.accounts?.some(a=>a.id===account&&a.token))refuse('account_missing');
  const helper=fileURLToPath(new URL('../src/host/github-tools.mjs',import.meta.url));prefix.push('-c','credential.https://github.com.helper=!'+[process.execPath,helper,'credential',file,account].map(quote).join(' '));
  if(await git('config','--local','--get-regexp','^http\\..*extraheader$').catch(()=>''))throw Error('Remove legacy local HTTP headers');
  if(await git('config','--local','--get-regexp','^credential\\.').catch(()=>''))throw Error('Remove local credential overrides');
  if(await git('config','--local','--get-regexp','^url\\..*(pushinsteadof|insteadof)$').catch(()=>''))throw Error('Remove local URL rewrites');
 }
 const head=await git('rev-parse','HEAD');await git('merge-base','--is-ancestor',expected,head);
 const remoteHead=(await git('ls-remote',remote,'refs/heads/'+branch)).split(/\s+/)[0];if(remoteHead!==expected)refuse('remote_lease_changed');
 if(head!==expected&&(!args.includes('--fixture')||args.includes('--check-version'))){
  const current=await checkedReleaseVersion(repo),previous=await git('show',expected+':VERSION').catch(()=>undefined);
  try{assertReleaseIncrement(previous?.trim(),current);}catch{refuse('release_version_required');}
 }
 if(head!==identity.commit||(await sourceIdentity(repo)).sourceFingerprint!==identity.sourceFingerprint)refuse('source_changed');
 await git('push','--porcelain','--force-with-lease=refs/heads/'+branch+':'+expected,remote,head+':refs/heads/'+branch);
 if((await git('ls-remote',remote,'refs/heads/'+branch)).split(/\s+/)[0]!==head)throw Error('Verify remote identity before retrying');
 console.log(JSON.stringify({published:true,commit:head,tree:(await sourceIdentity(repo)).tree,branch}));
}catch(error){console.error(JSON.stringify({error:error.publicationCode||(/workflow/.test((error.stderr??'')+(error.stdout??''))?'workflow_authorization_required':'publication_refused')}));process.exitCode=1;}
finally{if(privateRoot)await rm(privateRoot,{recursive:true,force:true});}
