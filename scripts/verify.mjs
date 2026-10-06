#!/usr/bin/env node
// Trusted local verification plans. Commands execute as argv, never through a shell.
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {optionalArtifacts} from './lib/artifacts.mjs';
import {sourceIdentity} from './lib/source-identity.mjs';
const args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
async function save(file,value){await mkdir(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
try {
 const repo=resolve(take('--repo')||'.'),receipt=resolve(take('--receipt')||'.coffee-verification/receipt.json');
 const raw=await readFile(resolve(take('--plan')||'scripts/verification-plan.json'),'utf8'),plan=JSON.parse(raw);
 if(!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>16)throw Error('Invalid verification plan');
 for(const step of plan.steps)if(!/^[a-z][a-z0-9-]{0,63}$/.test(step.name)||!Array.isArray(step.argv)||!step.argv.length||step.argv.some(v=>typeof v!=='string'||v.includes('\0')))throw Error('Invalid verification command');
 const identity=await sourceIdentity(repo),result={version:1,...identity,planSha256:createHash('sha256').update(raw).digest('hex'),node:process.version,status:'running',steps:[]};
 const reviewFile=take('--require-review');
 if(reviewFile){const review=JSON.parse(await readFile(resolve(reviewFile),'utf8'));if(review.status!=='passed'||review.sourceFingerprint!==identity.sourceFingerprint)throw Error('Review does not match current source');}
 let cached;try{cached=JSON.parse(await readFile(receipt,'utf8'));}catch{}
 if(args.includes('--reuse')&&cached?.status==='passed'&&cached.sourceFingerprint===identity.sourceFingerprint&&cached.planSha256===result.planSha256&&cached.node===process.version&&JSON.stringify(cached.artifacts)===JSON.stringify(await optionalArtifacts(resolve(repo,'dist')))&&cached.steps?.length===plan.steps.length&&cached.steps.every((step,i)=>step.name===plan.steps[i].name&&step.exitCode===0)){console.log('VERIFY reused '+identity.tree);process.exit(0);}
 for(const step of plan.steps){
  console.log('VERIFY '+step.name);
  const argv=step.argv.map(value=>value==='$NODE'?process.execPath:value);
  const exitCode=await new Promise(resolve=>{const child=spawn(argv[0],argv.slice(1),{cwd:repo,stdio:'inherit',shell:false});child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});
  result.steps.push({name:step.name,exitCode});
  if(exitCode){result.status='failed';await save(receipt,result);process.exitCode=exitCode;break;}
 }
 if(result.status==='running'){if((await sourceIdentity(repo)).sourceFingerprint!==identity.sourceFingerprint)throw Error('Source changed during verification');result.status='passed';result.artifacts=await optionalArtifacts(resolve(repo,'dist'));await save(receipt,result);}
} catch {console.error('Verification failed: invalid plan, source or receipt.');process.exitCode=1;}
