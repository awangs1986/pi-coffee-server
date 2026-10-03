import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {expect,it} from 'vitest';
import {HostServer} from '../src/host/server.js';
import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';
import {RunnerManager} from '../src/host/runners.js';

it('delivers account test-server changes on existing conversations only at the next user turn, never SSHME discovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-runner-guidance-'));
 const runners=new RunnerManager(join(root,'runners'));
 const factory=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),cwd:root,sessionDir:root});
 const host=new HostServer({port:0,token:'fixture',factory,runners});await host.start();
 const base=`http://127.0.0.1:${host.address().port}`,socket=new WebSocket(base.replace('http','ws')+'/host',{headers:{authorization:'Bearer fixture'}}),frames:any[]=[];
 socket.on('message',data=>frames.push(JSON.parse(String(data))));
 const request=async(body:object)=>{const r=await fetch(base+'/api/runners',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify(body)});expect(r.status).toBe(200);return r.json();};
 const prompt=async(text:string)=>{frames.length=0;socket.send(JSON.stringify({v:1,type:'prompt',requestId:crypto.randomUUID(),text}));await expect.poll(()=>frames.some(f=>f.event?.type==='agent_settled')).toBe(true);return JSON.stringify(frames);};
 try{
  await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:'chat-a'}));await expect.poll(()=>frames.some(f=>f.type==='history')).toBe(true);
  expect(await prompt('hello')).not.toMatch(/runner configuration|SSHME|sshme/);
  const {runner}=await request({action:'save',runner:{name:'Testing only',host:'192.0.2.10',port:22,username:'tester',platform:'windows',workdir:'',password:'fixture-password'}});
  const first=await prompt('test now');expect(first).toContain('For remote execution or testing, read the runner configuration at');expect(first).not.toMatch(/fixture-password|SSHME|sshme/);
  expect(await prompt('continue')).not.toContain('runner configuration');
  await request({action:'save',runner:{...runner,name:'Changed test server',password:''}});
  expect(await prompt('next test')).toContain('runner configuration');
  await request({action:'delete',id:runner.id});expect(await prompt('after clear')).toContain('No test server is currently configured');
  frames.length=0;socket.send(JSON.stringify({v:1,type:'prompt',requestId:crypto.randomUUID(),text:'hold: running task'}));await expect.poll(()=>frames.some(f=>f.event?.type==='agent_start')).toBe(true);
  await request({action:'save',runner:{name:'New target',host:'192.0.2.11',port:22,username:'tester',platform:'windows',workdir:''}});
  frames.length=0;socket.send(JSON.stringify({v:1,type:'prompt',requestId:crypto.randomUUID(),mode:'steer',text:'use the updated testing target'}));
  await expect.poll(()=>JSON.stringify(frames)).toContain('For remote execution or testing, read the runner configuration at');
 }finally{socket.terminate();await host.close();await rm(root,{recursive:true,force:true});}
},15000);
