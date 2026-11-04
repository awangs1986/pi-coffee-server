import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {acquireFileLease} from '../src/host/linux-file-lease.js';
import {sourceGroupLockIdentity} from '../src/host/source-group-lock.js';

it('ordinary custody holds the actual source lock until a detached double-fork writer exits naturally',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ordinary-custody-')),lock=join(root,'group.lock'),marker=join(root,'ready'),release=join(root,'release'),custody=new NativeWriterCustody(join(root,'custody'),{lock});
 const program=`import os,time\npid=os.fork()\nif pid: os._exit(0)\nos.setsid()\npid=os.fork()\nif pid: os._exit(0)\nopen(${JSON.stringify(marker)},'w').write('alive')\nend=time.monotonic()+8\nwhile time.monotonic()<end and not os.path.exists(${JSON.stringify(release)}):time.sleep(.02)\n`;
 const launch=await custody.prepare({executable:'/usr/bin/python3',args:['-c',program]}),child=spawn(process.execPath,[launch.cliPath],{env:{...process.env,...launch.env},stdio:'ignore'}),exited=once(child,'exit');
 try{
  await expect.poll(async()=>readFile(marker,'utf8').catch(()=>''),{timeout:5000}).toBe('alive');expect(await custody.state()).toMatchObject({state:'active'});
  const cut=acquireFileLease(lock,'exclusive');cut?.release();expect(cut).toBeUndefined();
  await writeFile(release,'done');expect((await exited)[0]).toBe(0);expect(await custody.state()).toEqual({state:'quiescent'});const next=acquireFileLease(lock,'exclusive');expect(next).toBeDefined();next!.release();
 }finally{await writeFile(release,'done');if(child.exitCode===null)await exited;await rm(root,{recursive:true,force:true});}
},15000);

it('ordinary custody preserves native environment cwd network tools and process permission baseline',async()=>{
 const root=await mkdtemp(join(tmpdir(),'ordinary-env-')),lock=join(root,'group.lock'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),server=createServer((_request,response)=>response.end('local network works'));server.listen(0,'127.0.0.1');await once(server,'listening');
 const port=(server.address() as import('node:net').AddressInfo).port,env={...process.env,HOME:root,NATIVE_FIXTURE_SETTING:'keep unchanged',LANG:'C.UTF-8'};
 const program=`const fs=require('node:fs'),cp=require('node:child_process');(async()=>{const response=await fetch('http://127.0.0.1:${port}/');const protection=fs.readFileSync('/proc/self/status','utf8').split('\\n').filter(line=>/^(NoNewPrivs|CapInh|CapEff|CapPrm|CapBnd|CapAmb):/.test(line));console.log(JSON.stringify({cwd:process.cwd(),environment:process.env,network:await response.text(),tool:cp.execFileSync('/bin/sh',['-c','printf local-tool'],{encoding:'utf8'}),protection,uid:process.getuid(),gid:process.getgid()}));})();`;
 const run=async(command:string,args:string[],environment:NodeJS.ProcessEnv)=>{const child=spawn(command,args,{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=String(chunk));child.stderr.on('data',chunk=>error+=String(chunk));expect((await once(child,'exit'))[0],error).toBe(0);return JSON.parse(output);};
 try{const baseline=await run(process.execPath,['-e',program],env),prepared=await custody.prepare({executable:process.execPath,args:['-e',program],cwd:root,env}),ordinary=await run(process.execPath,[prepared.cliPath],{...env,...prepared.env});expect(ordinary).toEqual(baseline);expect(ordinary.network).toBe('local network works');expect(ordinary.tool).toBe('local-tool');expect(ordinary.environment.HOME).toBe(root);expect(await custody.state()).toEqual({state:'quiescent'});}
 finally{await new Promise<void>(done=>server.close(()=>done()));await rm(root,{recursive:true,force:true});}
},15000);

for(const fault of ['held-cut','replaced-inode','different-bound-lock'] as const)it(`ordinary native spawn refuses a ${fault} without running its side effect`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'ordinary-refusal-')),lock=join(root,'group.lock'),marker=join(root,'must-not-run'),custody=new NativeWriterCustody(join(root,'custody'),{lock}),prepared=await custody.prepare({executable:process.execPath,args:['-e',`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`]});let cut:ReturnType<typeof acquireFileLease>;
 try{if(fault==='held-cut')cut=acquireFileLease(lock,'exclusive');else if(fault==='different-bound-lock'){cut=acquireFileLease(lock,'exclusive');const commandPath=join(prepared.env.PI_COFFEE_CUSTODY_DIR,'command.json'),command=JSON.parse(await readFile(commandPath,'utf8'));await writeFile(commandPath,JSON.stringify({...command,groupLock:sourceGroupLockIdentity(join(root,'unrelated.lock'),true)}));}else{await import('node:fs/promises').then(fs=>fs.rename(lock,lock+'.old'));await writeFile(lock,'',{mode:0o600});}const child=spawn(process.execPath,[prepared.cliPath],{env:{...process.env,...prepared.env},stdio:'ignore'});expect((await once(child,'exit'))[0]).toBe(78);await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});expect(await custody.state()).toMatchObject({state:'unknown'});}finally{cut?.release();await rm(root,{recursive:true,force:true});}
});
