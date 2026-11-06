#!/usr/bin/env node
// Trusted local verification plans. Commands execute as argv, never through a shell.
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {lowRiskPlan} from './lib/verification-risk.mjs';
import {processObservation,observedVerification} from './lib/process-observation.mjs';
import {optionalArtifacts,dependencyArtifacts,sha256} from './lib/artifacts.mjs';
import {sourceIdentity} from './lib/source-identity.mjs';
const args=process.argv.slice(2),take=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
async function save(file,value){await mkdir(dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID();await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
let activeChild,interruption,forceTimer,result,receipt,started=false;
const signalChild=signal=>{if(activeChild?.pid)try{process.kill(process.platform==='win32'?activeChild.pid:-activeChild.pid,signal);}catch{}};
const interrupt=signal=>{if(interruption)return;interruption=signal;signalChild(signal);forceTimer=setTimeout(()=>signalChild('SIGKILL'),5000);forceTimer.unref();};
process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
try {
 if(args.includes('--status')){const value=await observedVerification(JSON.parse(await readFile(resolve(take('--receipt')||'.coffee-verification/receipt.json'),'utf8')));console.log(JSON.stringify({status:value.status,commit:value.commit,activeStep:value.activeStep,startedAt:value.startedAt,updatedAt:value.updatedAt,finishedAt:value.finishedAt,reason:value.reason}));process.exit(0);}
 const repo=resolve(take('--repo')||'.'),receiptPath=resolve(take('--receipt')||'.coffee-verification/receipt.json');receipt=receiptPath;
 const risk=take('--risk')||'complete',baseCommit=take('--base');if(!['complete','low'].includes(risk)||risk==='low'&&take('--plan'))throw Error('Invalid verification risk profile');
 const raw=risk==='low'?JSON.stringify(await lowRiskPlan(repo,baseCommit)):await readFile(resolve(take('--plan')||'scripts/verification-plan.json'),'utf8'),plan=JSON.parse(raw);
 if(!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>16)throw Error('Invalid verification plan');
 for(const step of plan.steps)if(!/^[a-z][a-z0-9-]{0,63}$/.test(step.name)||!Array.isArray(step.argv)||!step.argv.length||step.argv.some(v=>typeof v!=='string'||v.includes('\0')))throw Error('Invalid verification command');
 const identity=await sourceIdentity(repo);result={version:1,...identity,risk,...(risk==='low'?{baseCommit}:{}),planSha256:createHash('sha256').update(raw).digest('hex'),node:process.version,status:'running',steps:[]};
 const reviewFile=take('--require-review');
 if(reviewFile){const reviewBytes=await readFile(resolve(reviewFile)),review=JSON.parse(reviewBytes);if(review.status!=='passed'||review.sourceFingerprint!==identity.sourceFingerprint)throw Error('Review does not match current source');result.reviewSha256=sha256(reviewBytes);}
 let cached;try{cached=JSON.parse(await readFile(receipt,'utf8'));}catch{}
 if(args.includes('--reuse')&&cached?.status==='passed'&&cached.commit===identity.commit&&cached.sourceFingerprint===identity.sourceFingerprint&&cached.planSha256===result.planSha256&&cached.node===process.version&&(!reviewFile||cached.reviewSha256===result.reviewSha256)&&JSON.stringify(cached.artifacts)===JSON.stringify(await optionalArtifacts(resolve(repo,'dist')))&&JSON.stringify(cached.dependencies)===JSON.stringify(await dependencyArtifacts(resolve(repo,'node_modules')))&&cached.steps?.length===plan.steps.length&&cached.steps.every((step,i)=>step.name===plan.steps[i].name&&step.exitCode===0)){console.log('VERIFY reused '+identity.tree);process.exit(0);}
 if(cached?.status==='running'&&(await observedVerification(cached)).status!=='interrupted')throw Error('Verification already running or unobservable');
 if(cached)await save(receipt+'.previous.json',cached);
 Object.assign(result,{runId:randomUUID(),owner:await processObservation(),startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 await save(receipt,result);started=true;
 for(const step of plan.steps){
  if(interruption)break;
  result.activeStep=step.name;result.updatedAt=new Date().toISOString();await save(receipt,result);
  console.log('VERIFY '+step.name);
  const argv=step.argv.map(value=>value==='$NODE'?process.execPath:value);
  const exitCode=await new Promise(resolve=>{const child=spawn(argv[0],argv.slice(1),{cwd:repo,stdio:'inherit',shell:false,detached:process.platform!=='win32'});activeChild=child;if(interruption)signalChild(interruption);child.once('error',()=>resolve(1));child.once('close',code=>{signalChild('SIGKILL');activeChild=undefined;resolve(code??1);});});
  result.steps.push({name:step.name,exitCode});result.updatedAt=new Date().toISOString();
  if(interruption)break;
  await save(receipt,result);
  if(exitCode){result.status='failed';await save(receipt,result);process.exitCode=exitCode;break;}
 }
 if(interruption){result.status='interrupted';result.signal=interruption;process.exitCode=interruption==='SIGINT'?130:143;}
 if(result.status==='running'){if((await sourceIdentity(repo)).sourceFingerprint!==identity.sourceFingerprint)throw Error('Source changed during verification');result.status='passed';result.artifacts=await optionalArtifacts(resolve(repo,'dist'));result.dependencies=await dependencyArtifacts(resolve(repo,'node_modules'));await save(receipt,result);}
 if(interruption){result.status='interrupted';result.signal=interruption;process.exitCode=interruption==='SIGINT'?130:143;}
 result.finishedAt=new Date().toISOString();result.updatedAt=result.finishedAt;delete result.activeStep;await save(receipt,result);
} catch {if(started){result.status=interruption?'interrupted':'failed';result.reason='verification_incomplete';result.finishedAt=new Date().toISOString();await save(receipt,result);}console.error('Verification failed: invalid plan, source or receipt.');process.exitCode=1;}
finally{clearTimeout(forceTimer);signalChild('SIGKILL');process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);}
