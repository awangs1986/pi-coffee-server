import {it,expect} from 'vitest';import {spawn,type ChildProcess} from 'node:child_process';import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {BackupRepositoryClient} from '../src/host/backup-repository-client.js';
async function fixture(hostUid=process.getuid!()){const root=await mkdtemp(join(tmpdir(),'coffee-key-broker-')),socket=join(root,'control.sock'),config=join(root,'service.json');await mkdir(join(root,'private'),{mode:0o700});await writeFile(join(root,'authority.json'),JSON.stringify({schema:1,revision:7,administrator:'awangs',scopes:['awangs','bob'],actors:{awangs:{scopes:['awangs','bob'],role:'administrator'},bob:{scopes:['bob'],role:'reader'}}}),{mode:0o600});await writeFile(config,JSON.stringify({schema:1,socket,serviceUid:process.getuid!(),hostUid,sourceUid:process.getuid!(),privateRoot:join(root,'private'),authorityFile:join(root,'authority.json'),sourceSocket:join(root,'source.sock'),binary:'/fixed/pinned/restic',destination:join(root,'fixed-destination'),handler:resolve('dist/src/backup-key-worker.js'),node:process.execPath}),{mode:0o600});const child=spawn('python3',[resolve('src/host/backup-unix-peer.py'),'serve',config],{stdio:['ignore','pipe','pipe']});let error='';child.stderr!.on('data',chunk=>error+=chunk);for(let n=0;n<200;n++){if(child.exitCode!==null)throw Error('Broker exited: '+error);try{await import('node:fs/promises').then(fs=>fs.stat(socket));return {root,socket,config,child};}catch{}await new Promise(r=>setTimeout(r,10));}throw Error('Broker not ready');}
async function close(f:{root:string;child:ChildProcess}){f.child.kill('SIGTERM');await new Promise<void>(r=>f.child.once('exit',()=>r()));await rm(f.root,{recursive:true,force:true});}
it('reports scoped state over authenticated Unix IPC and rejects stale authority, foreign scope and key operations',async()=>{const f=await fixture();try{
 const bob=new BackupRepositoryClient({socket:f.socket,serviceUid:process.getuid!(),actor:'bob',dataScope:'bob',authorityRevision:7});
 expect(await bob.status('bob')).toMatchObject({configured:false,enabled:false,qualification:{state:'unavailable',reason:'service_identity_not_separate'}});
 await expect(bob.status('awangs')).rejects.toMatchObject({code:'scope_denied'});
 await expect(bob.exportRecoveryPackage()).rejects.toMatchObject({code:'administrator_required'});
 const admin=new BackupRepositoryClient({socket:f.socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'bob',authorityRevision:7});
 await expect(admin.configure()).rejects.toMatchObject({code:'activation_unqualified'});
 await expect(readFile(join(f.root,'private','repository-runtime','password'))).rejects.toMatchObject({code:'ENOENT'});
 await writeFile(join(f.root,'authority.json'),JSON.stringify({schema:1,revision:8,administrator:'awangs',scopes:['awangs','bob'],actors:{awangs:{scopes:['awangs','bob'],role:'administrator'},bob:{scopes:['bob'],role:'reader'}}}),{mode:0o600});
 await expect(admin.status('bob')).rejects.toMatchObject({code:'authority_stale'});
 const wrongService=new BackupRepositoryClient({socket:f.socket,serviceUid:process.getuid!()+1,actor:'bob',dataScope:'bob',authorityRevision:8});await expect(wrongService.status('bob')).rejects.toMatchObject({code:'peer_identity_mismatch'});
 }finally{await close(f);}
},30000);

it('rejects forged credentials, arbitrary paths and malformed bounded frames without echoing bodies',async()=>{const f=await fixture();try{
 const {createConnection}=await import('node:net');
 const raw=async(text:string)=>new Promise<string>((resolve,reject)=>{const socket=createConnection(f.socket);let output='';socket.on('error',reject);socket.on('data',chunk=>output+=chunk);socket.on('end',()=>resolve(output));socket.on('connect',()=>socket.write(text));});
 const base={schema:1,id:'12345678-1234-4234-8234-123456789abc',operation:'status',context:{actor:'bob',dataScope:'bob',authorityRevision:7},scope:'bob'};
 expect(JSON.parse(await raw(JSON.stringify({...base,_peer:{uid:0,pid:1}})+'\n')).error.code).toBe('invalid_request');
 const result=await raw(JSON.stringify({...base,path:'/private-secret',password:'synthetic-sensitive-value'})+'\n');expect(JSON.parse(result).error.code).toBe('invalid_request');expect(result).not.toContain('synthetic-sensitive-value');
 expect(JSON.parse(await raw('{"schema":1,"schema":1}\n')).error.code).toBe('invalid_request');
 expect(JSON.parse(await raw(JSON.stringify({...base,operation:'shell'})+'\n')).error.code).toBe('invalid_operation');
 expect(JSON.parse(await raw('x'.repeat(1024*1024+2)+'\n')).error.code).toBe('invalid_request');
 }finally{await close(f);}
},30000);

it('hides the synthetic broker secret, control socket and host process root from an actual model namespace',async()=>{const f=await fixture();try{
 const secret=join(f.root,'private','synthetic-secret');await writeFile(secret,'synthetic-value',{mode:0o600});expect(await readFile(secret,'utf8')).toBe('synthetic-value');
 const code=`import os,socket,json,subprocess\nchecks={}\nfor name,path in [('secret',${JSON.stringify(secret)}),('socket',${JSON.stringify(f.socket)}),('proc',${JSON.stringify('/proc/'+f.child.pid+'/root'+secret)}),('bus','/run/user/${process.getuid!()}/bus')]:\n try:\n  if name=='socket':\n   s=socket.socket(socket.AF_UNIX);s.connect(path)\n  else: open(path,'rb').read(1)\n  checks[name]=False\n except OSError:checks[name]=True\nchecks['nested_userns']=subprocess.run(['/usr/bin/unshare','-Ur','true'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0\nstatus=open('/proc/self/status').read();checks['no_caps']='CapEff:\\t0000000000000000' in status;checks['no_new_privs']='NoNewPrivs:\\t1' in status\nprint(json.dumps(checks))`;
 const child=spawn('/usr/bin/bwrap',['--unshare-all','--unshare-user','--disable-userns','--assert-userns-disabled','--cap-drop','ALL','--new-session','--die-with-parent','--clearenv','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--symlink','usr/bin','/bin','--setenv','PATH','/usr/bin:/bin','--','/usr/bin/python3','-c',code],{stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);const exit=await new Promise<number|null>(r=>child.once('exit',r));expect({exit,error}).toEqual({exit:0,error:''});expect(JSON.parse(output)).toEqual({secret:true,socket:true,proc:true,bus:true,nested_userns:true,no_caps:true,no_new_privs:true});
 }finally{await close(f);}
},30000);

it('uses the kernel client UID even when the request claims a permitted administrator',async()=>{const f=await fixture(process.getuid!()+1);try{const client=new BackupRepositoryClient({socket:f.socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'awangs',authorityRevision:7});await expect(client.status()).rejects.toMatchObject({code:'peer_identity_mismatch'});}finally{await close(f);}},30000);

it('rechecks current administrator revocation independently of routed data scope',async()=>{const f=await fixture();try{
 const admin=new BackupRepositoryClient({socket:f.socket,serviceUid:process.getuid!(),actor:'awangs',dataScope:'bob',authorityRevision:7});expect(await admin.status('bob')).toMatchObject({configured:false});
 await writeFile(join(f.root,'authority.json'),JSON.stringify({schema:1,revision:7,administrator:'awangs',scopes:['awangs','bob'],actors:{awangs:{scopes:['awangs','bob'],role:'reader'},bob:{scopes:['bob'],role:'reader'}}}),{mode:0o600});
 await expect(admin.exportRecoveryPackage()).rejects.toMatchObject({code:'administrator_required'});await expect(admin.configure()).rejects.toMatchObject({code:'administrator_required'});
 }finally{await close(f);}
},30000);

it('bounds concurrent incomplete requests and refuses to replace an existing service socket',async()=>{const f=await fixture();const held:import('node:net').Socket[]=[];try{
 const {createConnection}=await import('node:net');for(let i=0;i<4;i++){const socket=createConnection(f.socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});socket.write('{');held.push(socket);}
 const result=await new Promise<string>((resolve,reject)=>{const socket=createConnection(f.socket);let data='';socket.on('data',chunk=>data+=chunk);socket.on('end',()=>resolve(data));socket.on('error',reject);});expect(JSON.parse(result).error.code).toBe('broker_busy');
 const duplicate=spawn('python3',[resolve('src/host/backup-unix-peer.py'),'serve',f.config],{stdio:['ignore','pipe','ignore']});const exit=await new Promise<number|null>(r=>duplicate.once('exit',r));expect(exit).not.toBe(0);
 for(const socket of held)socket.destroy();held.length=0;
 const bob=new BackupRepositoryClient({socket:f.socket,serviceUid:process.getuid!(),actor:'bob',dataScope:'bob',authorityRevision:7});for(let i=0;;i++){try{expect(await bob.status()).toMatchObject({configured:false});break;}catch(error){if(i>50)throw error;await new Promise(r=>setTimeout(r,10));}}
 }finally{for(const socket of held)socket.destroy();await close(f);}
},30000);
