import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
/** Closed low-risk allowlist. Unknown changes always retain complete verification. */
export async function lowRiskPlan(repo,base){
 const fail=()=>{throw Error('This change requires complete verification');};
 if(typeof base!=='string'||!/^[a-f0-9]{40}$/.test(base))fail();
 const git=async(...args)=>(await exec('git',args,{cwd:repo,maxBuffer:8*1024*1024})).stdout;
 if((await git('status','--porcelain')).trim())fail();
 await git('merge-base','--is-ancestor',base,'HEAD');
 const names=(await git('diff','--name-only','-z',base,'HEAD')).split('\0').filter(Boolean);let styles=false;
 for(const name of names){
  if(/^(docs\/.*\.md|README(?:\.[A-Za-z-]+)?\.md|BACKLOG\.md|CONTEXT\.md)$/.test(name))continue;
  if(/^public\/[^/]+\.css$/.test(name)){styles=true;continue;}
  if(name==='VERSION')continue;
  if(['package.json','package-lock.json'].includes(name)){
   const clean=text=>{const value=JSON.parse(text);delete value.version;if(value.packages?.[''])delete value.packages[''].version;return JSON.stringify(value);};
   try{if(clean(await git('show',base+':'+name))===clean(await git('show','HEAD:'+name)))continue;}catch{}
  }
  fail();
 }
 return {steps:[
  {name:'lint',argv:['$NODE','node_modules/eslint/bin/eslint.js','public','scripts','eslint.config.mjs']},
  {name:'build',argv:['npm','run','build']},
  {name:'documentation',argv:['$NODE','node_modules/vitest/vitest.mjs','run','test/documentation-modes.test.ts']},
  ...(styles?[{name:'browser',argv:['$NODE','scripts/check-browser.mjs']}]:[])
 ]};
}
