import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {lowRiskPlan} from '../scripts/lib/verification-risk.mjs';
it('permits only documentation, styles and version-only metadata in the low-risk release plan',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-risk-'));try{
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:root,encoding:'utf8'}).trim();
  git('init','-q','-b','main');await mkdir(join(root,'docs'));await writeFile(join(root,'docs/spec.md'),'before');await writeFile(join(root,'package.json'),JSON.stringify({version:'0.11.0',dependencies:{fixture:'1'}}));git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  await writeFile(join(root,'docs/spec.md'),'after');await writeFile(join(root,'package.json'),JSON.stringify({version:'0.12.0',dependencies:{fixture:'1'}}));git('add','.');git('commit','-qm','docs');
  expect((await lowRiskPlan(root,base)).steps.map((s:any)=>s.name)).toEqual(['lint','build','documentation']);
  await mkdir(join(root,'public'));await writeFile(join(root,'public/app.css'),'body{color:white}');git('add','.');git('commit','-qm','style');expect((await lowRiskPlan(root,base)).steps.map((s:any)=>s.name)).toContain('browser');
  await writeFile(join(root,'public/app.js'),'execute()');git('add','.');git('commit','-qm','execution');await expect(lowRiskPlan(root,base)).rejects.toThrow('requires complete verification');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('rejects dependency or executable changes disguised as a version update',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-risk-dependency-'));try{
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:root,encoding:'utf8'}).trim();git('init','-q');await writeFile(join(root,'package.json'),JSON.stringify({version:'0.11.0',scripts:{start:'original'}}));git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');await writeFile(join(root,'package.json'),JSON.stringify({version:'0.12.0',scripts:{start:'changed'}}));git('commit','-qam','changed');await expect(lowRiskPlan(root,base)).rejects.toThrow('requires complete verification');
 }finally{await rm(root,{recursive:true,force:true});}
});
