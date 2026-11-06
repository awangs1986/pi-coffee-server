import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
it('reports remote, running and verification identities independently and refuses to call a mixed release aligned',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-release-audit-'));let processFixture:ReturnType<typeof spawn>|undefined;try{
  const repo=join(root,'repo'),remote=join(root,'forge.git'),runtime=join(root,'runtime'),bin=join(root,'bin');for(const p of [repo,runtime,bin])await mkdir(p);
  const git=(...args:string[])=>exec('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:repo});await git('init','-q','-b','main');await writeFile(join(repo,'VERSION'),'0.96\n');await git('add','.');await git('commit','-qm','base');const old=(await git('rev-parse','HEAD')).stdout.trim();await git('init','--bare','-q',remote);for(const name of ['origin','gitea'])await git('remote','add',name,remote);await git('push','-q','origin','main');
  await writeFile(join(repo,'VERSION'),'0.97\n');await git('commit','-qam','next');const current=(await git('rev-parse','HEAD')).stdout.trim();
  await mkdir(join(runtime,'dist/public'),{recursive:true});await writeFile(join(runtime,'release.json'),JSON.stringify({sourceCommit:current,version:'0.97'}));await writeFile(join(runtime,'dist/public/release-manifest.json'),JSON.stringify({sourceCommit:current,version:'0.97'}));
  processFixture=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:runtime,stdio:'ignore'});
  const configure=async(directory:string)=>writeFile(join(bin,'systemctl'),'#!'+process.execPath+'\nconsole.log('+JSON.stringify('ActiveState=active\nMainPID='+processFixture!.pid+'\nWorkingDirectory='+directory)+');\n',{mode:0o700});
  await configure(runtime);
  const config=join(root,'config.json'),receipt=join(root,'verification.json');await writeFile(config,JSON.stringify({webUnit:'web.service',hostUnit:'host.service',userUnit:true}));await writeFile(receipt,JSON.stringify({status:'passed',commit:old}));
  const run=async()=>JSON.parse((await exec(process.execPath,[resolve('scripts/release-audit.mjs'),'--repo',repo,'--config',config,'--verification',receipt],{env:{...process.env,PATH:bin+':'+process.env.PATH}})).stdout);
  expect(await run()).toMatchObject({aligned:false,source:{commit:current},remotes:{origin:old,gitea:old},web:{commit:current},host:{commit:current},verification:{status:'passed',commit:old,matchesSource:false}});
  await git('push','-q','origin','main');await writeFile(receipt,JSON.stringify({status:'interrupted',commit:current}));expect(await run()).toMatchObject({aligned:false,verification:{status:'interrupted',matchesSource:true}});
  await writeFile(receipt,JSON.stringify({status:'passed',commit:current}));expect(await run()).toMatchObject({aligned:true});
  // daemon-reload can change WorkingDirectory without changing the process still serving requests.
  const configured=join(root,'configured-next');await mkdir(join(configured,'dist/public'),{recursive:true});
  await writeFile(join(configured,'release.json'),JSON.stringify({sourceCommit:current,version:'0.97'}));
  await writeFile(join(configured,'dist/public/release-manifest.json'),JSON.stringify({sourceCommit:current,version:'0.97'}));
  await writeFile(join(runtime,'release.json'),JSON.stringify({sourceCommit:old,version:'0.96'}));
  await configure(configured);
  expect(await run()).toMatchObject({aligned:false,web:{commit:old,version:'0.96'},host:{commit:old,version:'0.96'}});
 }finally{processFixture?.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
});
