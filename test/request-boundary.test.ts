import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {expect,it} from 'vitest';

it.each(['web-http','web-upgrade','host-upgrade'])('rejects malformed %s targets before auth without killing the service',async kind=>{
 const host=kind==='host-upgrade',module=pathToFileURL(resolve(`dist/src/${host?'host':'web'}/server.js`)).href;
 const source=host?`import {HostServer} from ${JSON.stringify(module)};const s=new HostServer({host:'127.0.0.1',port:0,token:'fixture',requireUser:true,factory:{list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native Agent allowed');}}});await s.start();console.log(s.address().port);`:`import {WebServer} from ${JSON.stringify(module)};const s=new WebServer({host:'127.0.0.1',port:0,hostUrl:'ws://127.0.0.1:1/host',auth:{handle:async()=>false,principalOf:()=>undefined}});await s.start();console.log(s.address().port);`;
 const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);const exit=once(child,'exit');let socket:ReturnType<typeof connect>|undefined;
 try{
  const port=await new Promise<number>((yes,no)=>{child.stdout.once('data',chunk=>yes(Number(String(chunk).trim())));child.once('exit',()=>no(Error('Startup failed: '+error)));});
  socket=connect({host:'127.0.0.1',port});socket.on('error',()=>{});let raw='';socket.on('data',chunk=>raw+=chunk);await once(socket,'connect');const closed=once(socket,'close');
  socket.write('GET //[ HTTP/1.1\r\nHost: localhost\r\n'+(kind.endsWith('upgrade')?'Connection: Upgrade\r\nUpgrade: websocket\r\n':'Connection: close\r\n')+'\r\n');await closed;
  expect(raw).toMatch(/^HTTP\/1\.1 400 /);expect(child.exitCode).toBeNull();
  expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
  expect((await fetch(`http://127.0.0.1:${port}/api/workspace`)).status).toBe(401);
 }finally{socket?.destroy();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exit;}
});
