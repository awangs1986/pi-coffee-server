import {it,expect} from 'vitest';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm,access,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
it('quarantines an interrupted clone after a real Host crash without automatic native work or duplicate allocation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-preparation-crash-')),children:ReturnType<typeof spawn>[]=[];
 const start=async()=>{
  const child=spawn(process.execPath,[resolve('test/fixtures/preparation-host.mjs'),root],{detached:true,env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH,PREPARATION_GATE:root},stdio:['ignore','pipe','pipe']});children.push(child);
  let stdout='',stderr='';child.stdout!.on('data',chunk=>stdout+=chunk);child.stderr!.on('data',chunk=>stderr+=chunk);
  await expect.poll(()=>{if(child.exitCode!==null)throw Error(stderr);return stdout.includes('"port"');},{timeout:10000}).toBe(true);
  const port=JSON.parse(stdout.trim().split('\n').find(line=>line.includes('"port"'))!).port;
  return {child,call:async(body:object)=>{const r=await fetch(`http://127.0.0.1:${port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}};
 };
 try{
  const repo=join(root,'repo'),remote=join(root,'remote.git');await mkdir(repo);const git=promisify(execFile);
  for(const args of [['init','-b','main'],['commit','--allow-empty','-m','base'],['clone','--bare',repo,remote]])await git('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:repo});
  await mkdir(join(root,'bin'));await writeFile(join(root,'bin','git'),`#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path'),args=process.argv.slice(2),root=process.env.PREPARATION_GATE;if(args.includes('clone')&&!fs.existsSync(path.join(root,'resume'))){fs.writeFileSync(path.join(root,'clone-started'),'1');setInterval(()=>{},1000);}else{const r=cp.spawnSync('/usr/bin/git',args,{stdio:'inherit'});process.exit(r.status??1);}\n`,{mode:0o700});
  const first=await start();const project=await first.call({action:'project',name:'crash-project',url:remote});expect(project.status).toBe(200);
  expect((await first.call({action:'preparation_start',kind:'create-work',operationId:'crash-op',targetTaskId:'crash-task',projectId:project.body.id,branch:'main',engine:'codex'})).status).toBe(202);
  await expect.poll(()=>access(join(root,'clone-started')).then(()=>true,()=>false),{timeout:10000}).toBe(true);
  const exited=once(first.child,'exit');process.kill(-first.child.pid!,'SIGKILL');await exited;
  await writeFile(join(root,'resume'),'1');const second=await start();
  const state=await second.call({action:'preparation_get',operationId:'crash-op'});expect(state.body.status).toBe('uncertain');expect(state.body.allowedActions).toEqual([]);
  expect(await access(join(root,'codex','started-pids')).then(()=>true,()=>false)).toBe(false);
  expect((await second.call({action:'preparation_resume',operationId:'crash-op',expectedRevision:state.body.revision})).status).toBe(409);
  expect((await second.call({action:'preparation_start',kind:'create-work',operationId:'crash-op',targetTaskId:'crash-task',projectId:project.body.id,branch:'main',engine:'codex'})).body.status).toBe('uncertain');
  expect((await second.call({action:'preparation_start',kind:'create-chat',operationId:'unrelated',targetTaskId:'unrelated',engine:'codex'})).status).toBe(202);
  await expect.poll(async()=>(await second.call({action:'preparation_get',operationId:'unrelated'})).body.status,{timeout:10000}).toBe('completed');

 }finally{
  for(const child of children.reverse())if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const force=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},3000);await exited;clearTimeout(force);}
  await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});
 }
},30000);

it('finishes interrupted publication using the same native binding without starting another native runtime',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-publication-crash-')),children:ReturnType<typeof spawn>[]=[];
 const start=async(pause=false)=>{
  const child=spawn(process.execPath,[resolve('test/fixtures/preparation-host.mjs'),root],{detached:true,env:{...process.env,...(pause?{PREPARATION_PUBLICATION_CRASH:'1'}:{})},stdio:['ignore','pipe','pipe']});children.push(child);
  let output='',errors='';child.stdout!.on('data',chunk=>output+=chunk);child.stderr!.on('data',chunk=>errors+=chunk);
  await expect.poll(()=>{if(child.exitCode!==null)throw Error(errors);return output.includes('"port"');},{timeout:10000}).toBe(true);
  const port=JSON.parse(output.split('\n').find(line=>line.includes('"port"'))!).port;
  return {child,paused:()=>output.includes('publicationPaused'),call:async(body:object)=>{const r=await fetch(`http://127.0.0.1:${port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}};
 };
 try{
  const first=await start(true);expect((await first.call({action:'preparation_start',kind:'create-chat',operationId:'publication-op',targetTaskId:'publication-task',engine:'codex'})).status).toBe(202);
  await expect.poll(first.paused,{timeout:10000}).toBe(true);const pids=await readFile(join(root,'codex','started-pids'),'utf8');
  const exited=once(first.child,'exit');process.kill(-first.child.pid!,'SIGKILL');await exited;
  const second=await start();const recovered=await second.call({action:'preparation_get',operationId:'publication-op'});
  expect(recovered.body).toMatchObject({status:'completed',task:{id:'publication-task',creationState:'ready',nativeBinding:{state:'bound'}}});
  expect(await readFile(join(root,'codex','started-pids'),'utf8')).toBe(pids);
 }finally{
  for(const child of children.reverse())if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');try{process.kill(child.pid!,'SIGCONT');}catch{}child.kill('SIGTERM');const force=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},3000);await exited;clearTimeout(force);}
  await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});
 }
},30000);

it('does not advertise a completed task until its final publication tail releases lifecycle custody',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-completion-gate-'));
 const child=spawn(process.execPath,[resolve('test/fixtures/preparation-host.mjs'),root],{detached:true,env:{...process.env,PREPARATION_COMPLETION_GATE:'1'},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout!.on('data',chunk=>output+=chunk);child.stderr!.on('data',chunk=>errors+=chunk);
 try{
  await expect.poll(()=>{if(child.exitCode!==null)throw Error(errors);return output.includes('"port"');},{timeout:10000}).toBe(true);
  const port=JSON.parse(output.split('\n').find(line=>line.includes('"port"'))!).port;
  const call=async(body?:object)=>{const r=await fetch(`http://127.0.0.1:${port}/api/workspace`,{method:body?'POST':'GET',headers:{authorization:'Bearer fixture','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  expect((await call({action:'preparation_start',kind:'create-chat',engine:'codex',operationId:'publication-op',targetTaskId:'publication-task'})).status).toBe(202);
  await expect.poll(()=>output.includes('completionPaused'),{timeout:10000}).toBe(true);
  expect((await call()).body.conversations.find((t:any)=>t.id==='publication-task').creationState).toBe('creating');
  await writeFile(join(root,'release-completion'),'1');
  await expect.poll(async()=>(await call({action:'preparation_get',operationId:'publication-op'})).body.status,{timeout:10000}).toBe('completed');
  expect((await call({action:'archive',id:'publication-task'})).status).toBe(200);
 }finally{
  await writeFile(join(root,'release-completion'),'1');
  if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const force=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},3000);await exited;clearTimeout(force);}
  await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});
 }
},20000);

it('holds the Fork source before awaiting durable admission so another lifecycle operation cannot slip in',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-admission-gate-'));
 const child=spawn(process.execPath,[resolve('test/fixtures/preparation-host.mjs'),root],{detached:true,env:{...process.env,PREPARATION_ADMISSION_GATE:'1'},stdio:['ignore','pipe','pipe']});
 let output='',errors='';child.stdout!.on('data',chunk=>output+=chunk);child.stderr!.on('data',chunk=>errors+=chunk);let pending:Promise<any>|undefined;
 try{
  await expect.poll(()=>{if(child.exitCode!==null)throw Error(errors);return output.includes('"port"');},{timeout:10000}).toBe(true);
  const port=JSON.parse(output.split('\n').find(line=>line.includes('"port"'))!).port;
  const call=async(body:object)=>{const r=await fetch(`http://127.0.0.1:${port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  await call({action:'preparation_start',kind:'create-chat',engine:'codex',operationId:'source-op',targetTaskId:'source-task'});
  await expect.poll(async()=>(await call({action:'preparation_get',operationId:'source-op'})).body.status,{timeout:10000}).toBe('completed');
  pending=call({action:'preparation_start',kind:'native-fork',sourceId:'source-task',operationId:'admission-op',targetTaskId:'fork-task'});
  await expect.poll(()=>output.includes('admissionPaused'),{timeout:10000}).toBe(true);
  expect((await call({action:'archive',id:'source-task'})).status).toBe(409);
 }finally{
  await writeFile(join(root,'release-admission'),'1');await pending?.catch(()=>{});
  if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');const force=setTimeout(()=>{try{process.kill(-child.pid!,'SIGKILL');}catch{}},3000);await exited;clearTimeout(force);}
  await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});
 }
},20000);
