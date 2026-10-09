import {it,expect} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
it('verifies the requested committed source in a fresh clone rather than uncommitted local edits',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-fresh-'));
 try{
  const git=(...a:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...a],{cwd:root,encoding:'utf8'}).trim();git('init','-q','-b','main');await writeFile(join(root,'source.txt'),'committed');git('add','.');git('commit','-qm','source');const commit=git('rev-parse','HEAD');await writeFile(join(root,'source.txt'),'uncommitted');
  const plan=join(root,'plan.json'),receipt=join(root,'receipt.json');await writeFile(plan,JSON.stringify({steps:[{name:'check',argv:[process.execPath,'-e',"if(require('fs').readFileSync('source.txt','utf8')!=='committed')process.exit(1)"]}]}));
  const result=await exec(process.execPath,[resolve('scripts/verify-fresh.mjs'),'--remote',root,'--commit',commit,'--fixture','--plan',plan,'--receipt',receipt]);
  expect(JSON.parse(result.stdout)).toMatchObject({freshClone:true,commit,status:'passed'});expect(JSON.parse(await readFile(receipt,'utf8'))).toMatchObject({freshClone:true,commit,status:'passed'});expect(await readFile(join(root,'source.txt'),'utf8')).toBe('uncommitted');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('retains a checked candidate by staging it before removing its owned fresh clone',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-fresh-stage-'));
 try{
  const repo=join(root,'repo');await mkdir(repo);const git=(...a:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...a],{cwd:repo,encoding:'utf8'}).trim();git('init','-q','-b','main');await writeFile(join(repo,'.gitignore'),'dist/\n');await writeFile(join(repo,'VERSION'),'0.11\n');await writeFile(join(repo,'package.json'),JSON.stringify({version:'0.11.0'}));await writeFile(join(repo,'package-lock.json'),JSON.stringify({version:'0.11.0',packages:{'':{version:'0.11.0'}}}));git('add','.');git('commit','-qm','source');const commit=git('rev-parse','HEAD');
  const plan=join(root,'plan.json'),config=join(root,'config.json'),receipt=join(root,'receipt.json');
  await writeFile(plan,JSON.stringify({steps:[{name:'build-and-check',argv:[process.execPath,'-e',"const fs=require('fs');fs.mkdirSync('dist/public',{recursive:true});fs.writeFileSync('dist/public/app.js','checked browser');fs.writeFileSync('dist/public/release-manifest.json',JSON.stringify({sourceCommit:require('child_process').execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),version:'0.11'}))"]}]}));
  await writeFile(config,JSON.stringify({releaseRoot:join(root,'releases'),stateDir:join(root,'state'),activePublic:join(root,'active')}));
  await exec(process.execPath,[resolve('scripts/verify-fresh.mjs'),'--remote',repo,'--commit',commit,'--fixture','--plan',plan,'--receipt',receipt,'--stage-config',config]);
  const status=JSON.parse((await exec(process.execPath,[resolve('scripts/release.mjs'),'status','--config',config])).stdout);expect(status.staged).toEqual([{sourceCommit:commit,version:'0.11',role:'browser',state:'staged'}]);
  expect(await readFile(join(root,'releases',commit+'-browser','public','app.js'),'utf8')).toBe('checked browser');
 }finally{await rm(root,{recursive:true,force:true});}
});
