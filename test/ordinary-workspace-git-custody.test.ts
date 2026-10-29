import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Workspaces} from '../src/host/workspaces.js';
import {HostServer} from '../src/host/server.js';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {PhysicalWriterFence} from '../src/host/physical-writer-fence.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';

it('returns ordinary Host Git results while detached fsmonitor writers retain the physical source lock until natural exit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ordinary-host-git-')),upstream=join(root,'upstream'),control=join(root,'control');
 await mkdir(upstream,{mode:0o700});await mkdir(control,{mode:0o700});
 const git=(cwd:string,...args:string[])=>execFileSync('git',['-C',cwd,...args],{env:{...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'},encoding:'utf8'});
 git(upstream,'init','--quiet','-b','main');await writeFile(join(upstream,'README'),'base');git(upstream,'add','.');git(upstream,'commit','--quiet','-m','base');
 const lock=join(control,'source.lock'),custody=new NativeWriterCustody(join(control,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});
 const store=new Workspaces(join(root,'projects'),{gitCommandCustody:custody});store.setBackupWriterFence(fence);
 const project=await store.registerProject('Fixture',upstream),task=await store.createConversation(project.id,undefined,'task','pi');
 const finish=join(control,'finish'),heartbeat=join(task.cwd,'background-writer'),started=join(control,'started'),script=join(control,'fsmonitor.cjs');
 await writeFile(script,`const fs=require('node:fs'),cp=require('node:child_process');
if(process.argv[2]==='writer') {let n=0;const timer=setInterval(()=>{fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n));if(fs.existsSync(${JSON.stringify(finish)})){clearInterval(timer);process.exit(0);}},20);}
else {try{fs.writeFileSync(${JSON.stringify(started)},JSON.stringify({cwd:process.cwd(),uid:process.getuid(),home:process.env.HOME,path:process.env.PATH}),{flag:'wx'});const child=cp.spawn(process.execPath,[__filename,'writer'],{detached:true,stdio:'ignore'});child.unref();}catch(error){if(error.code!=='EEXIST')throw error;}process.stdout.write('fixture-token\\0');}
`);
 git(task.cwd,'config','core.fsmonitor',process.execPath+' '+script);
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No model calls');}},host=new HostServer({port:0,token:'fixture',requireUser:true,factory,scopeForUser:()=>({factory,workspaces:store})});
 try{
  await host.start();const response=await fetch(`http://127.0.0.1:${host.address().port}/api/workspace`,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-user':'alice','content-type':'application/json'},body:JSON.stringify({action:'changes',id:task.id}),signal:AbortSignal.timeout(8000)});
  expect(response.status).toBe(200);await response.json();
  await expect.poll(()=>readFile(heartbeat,'utf8').then(Number,()=>0),{timeout:3000}).toBeGreaterThan(0);
  const observed=JSON.parse(await readFile(started,'utf8'));expect(observed).toMatchObject({cwd:task.cwd,uid:process.getuid?.(),home:process.env.HOME,path:git(task.cwd,'--exec-path').trim()+':'+process.env.PATH});
  const accidentalCut=acquireFileLease(lock,'exclusive');try{expect(accidentalCut,'Git returned but its detached helper still writes the source').toBeUndefined();}finally{accidentalCut?.release();}
  expect((await custody.state()).state).toBe('active');const before=Number(await readFile(heartbeat,'utf8'));await expect.poll(()=>readFile(heartbeat,'utf8').then(Number)).toBeGreaterThan(before);
  await writeFile(finish,'fixture work finished');await expect.poll(async()=>(await custody.state()).state,{timeout:5000}).toBe('quiescent');const cut=acquireFileLease(lock,'exclusive');expect(cut).toBeDefined();cut!.release();
 }finally{await writeFile(finish,'fixture cleanup');await host.close();await new Promise(resolve=>setTimeout(resolve,150));await rm(root,{recursive:true,force:true});}
},30000);

it('preserves ordinary Git network authentication, output budgets and command timeouts inside custody',async()=>{
 const {createServer}=await import('node:http'),{once}=await import('node:events'),{executeWorkspaceGit}=await import('../src/host/workspace-git.js');
 const root=await mkdtemp(join(tmpdir(),'ordinary-git-http-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),fence=new PhysicalWriterFence({lock,custody});
 const sha='1234567890123456789012345678901234567890',authorization='Basic c3ludGhldGljOm9ubHk=';let authenticated=0;const slowResponses:Array<import('node:http').ServerResponse>=[];
 const server=createServer((req,res)=>{if(req.headers.authorization!==authorization){res.writeHead(401);res.end();return;}authenticated++;if(req.url?.startsWith('/slow/')){slowResponses.push(res);return;}if(req.url?.includes('/info/refs')){res.setHeader('content-type','text/plain');res.end(req.url.startsWith('/many/')?Array.from({length:200},(_,i)=>sha+'\trefs/heads/branch-'+i+'\n').join(''):sha+'\trefs/heads/main\n');return;}res.end('ref: refs/heads/main\n');});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('Fixture address missing');const base='http://127.0.0.1:'+address.port;
 const run=(path:string,timeout=5000,maxBuffer=4096)=>fence.runWriter('platform',()=>executeWorkspaceGit(['ls-remote',base+'/'+path],{cwd:root,env:{...process.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: '+authorization,GIT_TERMINAL_PROMPT:'0'},ordinaryCustody:custody,managedRequired:false,timeout,maxBuffer}));
 try{
  const result=await run('repo');expect(result.stdout.toString()).toContain(sha+'\trefs/heads/main');expect(authenticated).toBeGreaterThan(0);await expect.poll(async()=>(await custody.state()).state,{timeout:5000}).toBe('quiescent');
  const start=Date.now();await expect(run('slow',200)).rejects.toMatchObject({code:'ETIMEDOUT'});expect(Date.now()-start).toBeLessThan(2000);expect((await custody.state()).state).toBe('active');const cut=acquireFileLease(lock,'exclusive');try{expect(cut).toBeUndefined();}finally{cut?.release();}for(const response of slowResponses){response.writeHead(503);response.end('fixture remote work ended');}await expect.poll(async()=>(await custody.state()).state,{timeout:5000}).toBe('quiescent');
  await expect(run('many',5000,64)).rejects.toMatchObject({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'});await expect.poll(async()=>(await custody.state()).state).toBe('quiescent');
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},20000);
