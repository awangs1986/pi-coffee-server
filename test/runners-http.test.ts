import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HostServer} from '../src/host/server.js';
import {WebServer} from '../src/web/server.js';
import {RunnerManager} from '../src/host/runners.js';
const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw new Error('No Agent should start');}};
let root='',host:HostServer,web:WebServer;
afterEach(async()=>{await web?.close();await host?.close();if(root)await rm(root,{recursive:true,force:true});});
async function setup(){
 root=await mkdtemp(join(tmpdir(),'coffee-runners-'));const managers=new Map<string,RunnerManager>();
 const manager=(user:string)=>{let m=managers.get(user);if(!m){m=new RunnerManager(join(root,user));managers.set(user,m);}return m;};
 host=new HostServer({port:0,token:'runner-test',factory,requireUser:true,scopeForUser:user=>({factory,runners:manager(user)})});await host.start();
 const base=`http://127.0.0.1:${host.address().port}`;
 const call=async(body:object,user='alice',token='runner-test')=>{const r=await fetch(base+'/api/runners',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-pi-coffee-user':user,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {manager,base,call};
}
const input={name:'Windows test',host:'192.0.2.10',port:22,username:'tester',platform:'windows',workdir:'C:/work',password:'fixture-private-password'};
it('scopes runner CRUD, redacts secrets, preserves passwords on edit and conditionally adds one pointer',async()=>{
 const {call,manager}=await setup();expect((await call({action:'list'},'alice','wrong')).status).toBe(401);
 expect(await manager('alice').instruction()).toBeUndefined();
 const saved=await call({action:'save',runner:input});expect(saved.status).toBe(200);const runner=saved.body.runner;
 expect(runner).toMatchObject({name:input.name,hasPassword:true});expect(JSON.stringify(saved.body)).not.toContain(input.password);
 const pointer=await manager('alice').instruction();expect(pointer).toBe(`For remote execution or testing, read the runner configuration at ${join(root,'alice','runners.json')}.`);
 expect(pointer!.split('\n')).toHaveLength(1);
 expect((await call({action:'list'},'bob')).body.runners).toEqual([]);
 expect((await call({action:'delete',id:runner.id},'bob')).status).toBe(409);
 expect((await call({action:'save',runner:{...input,id:runner.id,password:'',name:'Renamed'}})).body.runner.hasPassword).toBe(true);
 const config=JSON.parse(await readFile(join(root,'alice','runners.json'),'utf8'));
 expect(JSON.stringify(config)).not.toContain(input.password);expect(config.runners[0].credentialFile).toBeTruthy();
 expect((await stat(config.runners[0].credentialFile)).mode&0o777).toBe(0o600);
 expect((await stat(join(root,'alice'))).mode&0o777).toBe(0o700);
 expect((await call({action:'delete',id:runner.id})).status).toBe(200);
 expect(await manager('alice').instruction()).toBeUndefined();await expect(stat(config.runners[0].credentialFile)).rejects.toMatchObject({code:'ENOENT'});
});
it('rejects option injection, unknown ids, invalid fields and cross-site Web changes',async()=>{
 const {call,base}=await setup();
 for(const patch of [{host:'-oProxyCommand=bad'},{username:'user;bad'},{platform:'other'},{port:0},{id:'../bob'},{password:'a\nb'},{workdir:'bad\u0000path'}])expect((await call({action:'save',runner:{...input,...patch}})).status).toBe(409);
 web=new WebServer({port:0,hostUrl:base.replace('http:','ws:')+'/host',hostToken:'runner-test',defaultUser:'alice',allowUnauthenticated:true});await web.start();
 const url=`http://127.0.0.1:${web.address().port}`;
 expect((await fetch(url+'/api/runners',{method:'POST',headers:{origin:'http://evil.invalid','content-type':'application/json'},body:JSON.stringify({action:'save',runner:input})})).status).toBe(403);
 const r=await fetch(url+'/api/runners',{method:'POST',headers:{origin:url,'content-type':'application/json'},body:JSON.stringify({action:'save',runner:input})});expect(r.status).toBe(200);
 expect((await call({action:'list'})).body.runners).toHaveLength(1);
});
it('accepts only one Windows computer and describes WSL through the same SSH endpoint',async()=>{
 const {call,manager}=await setup();const windows={...input,platform:'windows',workdir:'C:/work'};
 expect((await call({action:'save',runner:{...windows,platform:'wsl',workdir:'/tmp'}})).status).toBe(409);
 expect((await call({action:'save',runner:{...windows,platform:'linux',workdir:'/tmp'}})).status).toBe(409);
 const first=await call({action:'save',runner:windows});expect(first.status).toBe(200);
 expect((await call({action:'save',runner:{...windows,name:'second'}})).status).toBe(409);
 const update=await call({action:'save',runner:{...windows,id:first.body.runner.id,name:'same computer'}});expect(update.status).toBe(200);
 expect((await call({action:'list'})).body.runners).toHaveLength(1);
 await manager('alice').instruction();const config=JSON.parse(await readFile(join(root,'alice/runners.json'),'utf8'));
 expect(config.usage.operations.join(' ')).toContain('--env');expect(config.usage.notes).toContain('wsl.exe');
});

it('reports optional WSL readiness separately from Windows connectivity over the public API',async()=>{
 const {call,manager}=await setup();const saved=await call({action:'save',runner:input}),id=saved.body.runner.id;
 const run=vi.spyOn(manager('alice'),'run').mockResolvedValueOnce({code:0,stdout:'coffee-runner-ready\r\n',stderr:''}).mockResolvedValueOnce({code:1,stdout:'',stderr:'No default distribution'});
 const response=await call({action:'test',id});expect(response.body).toMatchObject({ok:true,wslReady:false});expect(response.body.message).toContain('Windows 连接正常');
 expect(run.mock.calls).toEqual([[id,{kind:'test'}],[id,{kind:'test',environment:'wsl'}]]);
 run.mockResolvedValue({code:0,stdout:'coffee-runner-ready\n',stderr:''});expect((await call({action:'test',id})).body).toMatchObject({ok:true,wslReady:true});
 run.mockResolvedValue({code:255,stdout:'',stderr:'Connection failed'});expect((await call({action:'test',id})).body.ok).toBe(false);run.mockRestore();
});

it('prepares /sshme only after Windows is reachable and keeps credentials out of model text',async()=>{
 const {call,manager}=await setup();const saved=await call({action:'save',runner:input}),id=saved.body.runner.id;
 const run=vi.spyOn(manager('alice'),'run').mockResolvedValue({code:255,stdout:'',stderr:'private failure'});
 const failed=await call({action:'sshme',id,request:'Install a text editor.'});expect(failed.status).toBe(409);expect(failed.body.prompt).toBeUndefined();
 run.mockResolvedValue({code:0,stdout:'coffee-runner-ready\r\n',stderr:''});
 const ready=await call({action:'sshme',id,request:'Install a text editor.'});expect(ready.status).toBe(200);
 expect(ready.body.prompt).toContain('Install a text editor.');expect(ready.body.prompt).toContain("the Web user's Windows computer");expect(ready.body.prompt).toContain('Linux Host');expect(ready.body.prompt).toContain(input.host);expect(ready.body.prompt).toContain(id);expect(ready.body.prompt).not.toContain(input.password);expect(ready.body.prompt).not.toContain('.password');
 expect((await call({action:'sshme',id,request:'Install.'},'bob')).status).toBe(409);
 expect((await call({action:'sshme',id,request:''})).status).toBe(409);
 run.mockRestore();
});

it('does not reuse a saved password after the SSH target changes without an explicit credential choice',async()=>{
 const {call}=await setup();const saved=await call({action:'save',runner:input}),id=saved.body.runner.id;
 expect((await call({action:'save',runner:{...input,id,password:'',host:'192.0.2.11'}})).status).toBe(409);
 expect((await call({action:'save',runner:{...input,id,password:'',host:'192.0.2.11',clearPassword:true}})).body.runner.hasPassword).toBe(false);
});
