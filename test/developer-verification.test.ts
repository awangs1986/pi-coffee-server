import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

it('stops verification at the failing public command and records an unsuccessful receipt',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-verification-'));
 try {
  const repo=join(root,'repo');await mkdir(repo);spawnSync('git',['init','-q'],{cwd:repo});
  await writeFile(join(repo,'source.txt'),'fixture\n');spawnSync('git',['add','.'],{cwd:repo});
  spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:repo});
  const first=join(root,'first'),later=join(root,'later'),receipt=join(root,'receipt.json'),plan=join(root,'plan.json');
  await writeFile(plan,JSON.stringify({steps:[{name:'targeted',argv:[process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(first)},'ran');process.exit(7)`]},{name:'full-check',argv:[process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(later)},'must not run')`]}]}));
  const result=spawnSync(process.execPath,[resolve('scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',receipt],{encoding:'utf8'});
  expect(await readFile(first,'utf8')).toBe('ran');expect(result.status).toBe(7);
  await expect(access(later)).rejects.toThrow();
  expect(JSON.parse(await readFile(receipt,'utf8'))).toMatchObject({status:'failed',steps:[{name:'targeted',exitCode:7}]});
 } finally {await rm(root,{recursive:true,force:true});}
});

it('reuses successful verification only for unchanged source and plan',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-verification-cache-'));
 try{
  const repo=join(root,'repo');await mkdir(repo);spawnSync('git',['init','-q'],{cwd:repo});
  await writeFile(join(repo,'source.txt'),'before');spawnSync('git',['add','.'],{cwd:repo});spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:repo});
  const count=join(root,'count'),plan=join(root,'plan.json'),receipt=join(root,'receipt.json');
  await writeFile(plan,JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e',`const fs=require('fs'),p=${JSON.stringify(count)};fs.writeFileSync(p,String(Number(fs.existsSync(p)?fs.readFileSync(p):0)+1))`]}]}));
  const run=(...extra:string[])=>spawnSync(process.execPath,[resolve('scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',receipt,...extra],{encoding:'utf8'});
  expect(run().status).toBe(0);expect(run('--reuse').status).toBe(0);expect(await readFile(count,'utf8')).toBe('1');
  await writeFile(join(repo,'source.txt'),'after');expect(run('--reuse').status).toBe(0);expect(await readFile(count,'utf8')).toBe('2');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('requires a matching review receipt before executing release verification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-review-gate-'));
 try{
  const repo=join(root,'repo');await mkdir(repo);spawnSync('git',['init','-q'],{cwd:repo});await writeFile(join(repo,'source.txt'),'fixture');spawnSync('git',['add','.'],{cwd:repo});spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:repo});
  const marker=join(root,'must-not-run'),plan=join(root,'plan.json');await writeFile(plan,JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e',`require('fs').writeFileSync(${JSON.stringify(marker)},'bad')`]}]}));
  const result=spawnSync(process.execPath,[resolve('scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',join(root,'receipt.json'),'--require-review',join(root,'missing-review.json')],{encoding:'utf8'});
  expect(result.status).toBe(1);await expect(access(marker)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});

it('reuses a reviewed final check through the unqualified pre-push command without losing its review binding',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-review-reuse-'));
 try{
  const repo=join(root,'repo');await mkdir(repo);spawnSync('git',['init','-q'],{cwd:repo});await writeFile(join(repo,'source.txt'),'fixture');spawnSync('git',['add','.'],{cwd:repo});spawnSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-qm','fixture'],{cwd:repo});
  const plan=join(root,'plan.json'),receipt=join(root,'receipt.json'),review=join(root,'review.json'),evidence=join(root,'notes');await writeFile(evidence,'Reviewed fixture');await writeFile(plan,JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e','process.exit(0)']}]}));
  expect(spawnSync(process.execPath,[resolve('scripts/review-receipt.mjs'),'--repo',repo,'--verdict','passed','--evidence',evidence,'--output',review]).status).toBe(0);
  const flags=[resolve('scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',receipt];expect(spawnSync(process.execPath,[...flags,'--require-review',review]).status).toBe(0);
  const before=await readFile(receipt,'utf8');expect(spawnSync(process.execPath,[...flags,'--reuse']).status).toBe(0);expect(await readFile(receipt,'utf8')).toBe(before);
 }finally{await rm(root,{recursive:true,force:true});}
});
