import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {NativeWriterCustody} from '../src/host/native-custody.js';
import {SessionManager} from '@earendil-works/pi-coding-agent';

it('the actual Host startup does not equate fresh source receipts and empty descendant custody with exclusive writer enforcement',async()=>{
 const root=await mkdtemp(join(tmpdir(),'coffee-backup-startup-')),sessions=join(root,'sessions');
 const custody=new NativeWriterCustody(join(root,'backup','native-custody','shared-native-group')),launch=await custody.prepare({executable:process.execPath,args:['-e','']});
 const supervised=spawn(process.execPath,[launch.cliPath],{env:{PATH:process.env.PATH,...launch.env},stdio:'ignore'});await once(supervised,'exit');expect(await custody.state()).toEqual({state:'quiescent'});
 // No prompt, runtime open, model credentials or production paths. This process can
 // write synthetic sources independently of Host, as can an existing OS daemon.
 const child=spawn(process.execPath,[resolve('dist/src/main.js'),'host'],{env:{PATH:process.env.PATH,HOME:root,PI_OFFLINE:'1',PI_COFFEE_WORKDIR:join(root,'work'),PI_COFFEE_SESSION_DIR:sessions,PI_COFFEE_AGENT_DIR:join(root,'agent'),PI_COFFEE_BACKUP_ROOT:join(root,'backup'),PI_COFFEE_TMP_ROOT:join(root,'tmp'),PI_COFFEE_HOST_BIND:'127.0.0.1',PI_COFFEE_HOST_PORT:'0',PI_COFFEE_HOST_TOKEN:'fixture',PI_COFFEE_TRANSFER_BIND:'off',PI_COFFEE_EXTENSIONS:'off'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',data=>output+=String(data));child.stderr.on('data',data=>output+=String(data));
 try{
  await expect.poll(()=>output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)?.[1]??(child.exitCode!==null?'Host exited: '+output:''),{timeout:15000}).toMatch(/^\d+$/);
  const base='http://127.0.0.1:'+output.match(/Host ws:\/\/127\.0\.0\.1:(\d+)\/host/)![1];
  const post=async(path:string,body:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{authorization:'Bearer fixture','x-pi-coffee-actor':'awangs','content-type':'application/json'},body:JSON.stringify(body)});expect(response.status).toBe(200);return response.json();};
  const task=await post('/api/workspace',{action:'conversation',workspaceKind:'chat',engine:'pi',id:'startup-task'});
  SessionManager.create(task.cwd,sessions,{id:task.id}).appendMessage({role:'user',content:'independent synthetic writer',timestamp:1000});
  const status=await post('/api/backup',{action:'capture',taskId:task.id});
  expect(status).toMatchObject({state:'unavailable',coverage:'unavailable',checkpointId:null,reason:'Native writer coverage is not verified'});
 }finally{if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await rm(root,{recursive:true,force:true});}
},25000);
