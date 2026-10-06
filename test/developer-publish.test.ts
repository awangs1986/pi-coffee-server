import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';

async function approval(repo:string){
 const dir=join(repo,'.git','verification');await mkdir(dir);
 const plan=join(dir,'plan.json'),receipt=join(dir,'receipt.json'),review=join(dir,'review.json'),notes=join(dir,'notes.md');
 await writeFile(plan,JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e','process.exit(0)']}]}));await writeFile(notes,'Fixture review accepted at the public seam.');
 execFileSync(process.execPath,[resolve('scripts/review-receipt.mjs'),'--repo',repo,'--verdict','passed','--evidence',notes,'--output',review]);
 execFileSync(process.execPath,[resolve('scripts/verify.mjs'),'--repo',repo,'--plan',plan,'--receipt',receipt,'--require-review',review]);
 return ['--verification',receipt,'--review',review];
}

it('publishes one Git batch preserving Unicode and binary bytes to an isolated forge',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-publish-'));
 try{
  const repo=join(root,'repo'),forge=join(root,'forge.git');await mkdir(repo);
  const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:repo,encoding:'utf8'}).trim();
  git('init','-q','-b','main');await writeFile(join(repo,'readme.txt'),'base');git('add','.');git('commit','-qm','base');const expected=git('rev-parse','HEAD');git('init','--bare','-q',forge);git('remote','add','origin',forge);git('push','-q','origin','main');
  const unicode='Coffee ☕ 猫女仆\n第二行\n';const bytes=Buffer.from([0,255,10,128,1]);await writeFile(join(repo,'中文.txt'),unicode);await writeFile(join(repo,'asset.bin'),bytes);git('add','.');git('commit','-qm','feature');
  const result=spawnSync(process.execPath,[resolve('scripts/publish.mjs'),'--repo',repo,'--remote','origin','--expected',expected,'--fixture',...await approval(repo)],{encoding:'utf8'});
  expect(result.status).toBe(0);expect(execFileSync('git',['--git-dir',forge,'rev-parse','refs/heads/main'],{encoding:'utf8'}).trim()).toBe(git('rev-parse','HEAD'));
  expect(execFileSync('git',['--git-dir',forge,'show','main:中文.txt'],{encoding:'utf8'})).toBe(unicode);
  expect(execFileSync('git',['--git-dir',forge,'show','main:asset.bin'])).toEqual(bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses a stale remote lease without replacing the forge branch',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-publish-lease-'));
 try{
  const repo=join(root,'repo'),forge=join(root,'forge.git');await mkdir(repo);const git=(...a:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...a],{cwd:repo,encoding:'utf8'}).trim();
  git('init','-q','-b','main');await writeFile(join(repo,'file'),'first');git('add','.');git('commit','-qm','first');const expected=git('rev-parse','HEAD');git('init','--bare','-q',forge);git('remote','add','origin',forge);git('push','-q','origin','main');
  await writeFile(join(repo,'file'),'second');git('add','.');git('commit','-qm','second');const newer=git('rev-parse','HEAD');git('push','-q','origin','main');
  const result=spawnSync(process.execPath,[resolve('scripts/publish.mjs'),'--repo',repo,'--expected',expected,'--fixture',...await approval(repo)],{encoding:'utf8'});
  expect(result.status).toBe(1);expect(execFileSync('git',['--git-dir',forge,'rev-parse','refs/heads/main'],{encoding:'utf8'}).trim()).toBe(newer);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('rejects missing Coffee account selection despite ambient GitHub login variables',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-publish-account-'));
 try{
  const git=(...a:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...a],{cwd:root,encoding:'utf8'}).trim();git('init','-q','-b','main');await writeFile(join(root,'file'),'fixture');await mkdir(join(root,'scripts'));await writeFile(join(root,'scripts','verification-plan.json'),JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e','process.exit(0)']}]}));git('add','.');git('commit','-qm','first');git('remote','add','origin','https://github.com/fixture/fixture.git');
  const result=spawnSync(process.execPath,[resolve('scripts/publish.mjs'),'--repo',root,'--expected',git('rev-parse','HEAD'),...await approval(root)],{env:{...process.env,GH_TOKEN:'ambient-must-not-be-used',GITHUB_TOKEN:'ambient-must-not-be-used'},encoding:'utf8'});
  expect(result.status).toBe(1);expect(result.stderr).not.toContain('ambient-must-not-be-used');expect(result.stderr).toContain('account_missing');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses publication without source-bound verification and review receipts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-publish-unchecked-'));
 try{
  const repo=join(root,'repo'),forge=join(root,'forge.git');await mkdir(repo);const git=(...a:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...a],{cwd:repo,encoding:'utf8'}).trim();git('init','-q','-b','main');await writeFile(join(repo,'file'),'fixture');git('add','.');git('commit','-qm','source');const expected=git('rev-parse','HEAD');git('init','--bare','-q',forge);git('remote','add','origin',forge);git('push','-q','origin','main');
  const result=spawnSync(process.execPath,[resolve('scripts/publish.mjs'),'--repo',repo,'--expected',expected,'--fixture'],{encoding:'utf8'});expect(result.status).toBe(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
