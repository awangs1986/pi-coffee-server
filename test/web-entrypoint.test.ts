import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {resolve} from 'node:path';

it.each([['dist/src/main.js','web'],['dist/src/web/main.js']])('Web entry %s retains authenticated GitHub renewal',async(...args)=>{
 const child=spawn(process.execPath,args.map((s,i)=>i===0?resolve(s):s),{env:{PATH:process.env.PATH,HOME:process.env.HOME,PI_COFFEE_WEB_PORT:'0',PI_COFFEE_WEB_BIND:'127.0.0.1',PI_COFFEE_HOST_TOKEN:'entry-fixture',PI_COFFEE_GITHUB_CLIENT_ID:'fixture-client',PI_COFFEE_GITHUB_CLIENT_SECRET:'fixture-secret',PI_COFFEE_PUBLIC_URL:'http://localhost:3000'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=String(x));child.stderr.on('data',()=>{});
 try{
  await expect.poll(()=>output.match(/Web (http:\/\/127\.0\.0\.1:\d+)/)?.[1],{timeout:5000}).toBeTruthy();
  const url=output.match(/Web (http:\/\/127\.0\.0\.1:\d+)/)![1]+'/internal/github-refresh';
  expect((await fetch(url,{method:'POST',body:'{}'})).status).toBe(401);
  // Invalid body after valid service authentication: configuration is loaded,
  // without exchanging any token or making an upstream GitHub request.
  expect((await fetch(url,{method:'POST',headers:{authorization:'Bearer entry-fixture','content-type':'application/json'},body:'{}'})).status).toBe(400);
 }finally{const done=once(child,'exit');child.kill('SIGTERM');await done;}
},10000);
