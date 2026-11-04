import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {HostServer} from '../src/host/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {BackupCoordinator} from '../src/host/backup.js';
import {RestoreCoordinator} from '../src/host/restore.js';
const execute=promisify(execFile);

it('the recovery CLI authenticates the explicit login independently of its routed scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recovery-cli-identity-'));let host:HostServer|undefined;
 try{
  const workspaces=new Workspaces(join(root,'gitea-2','projects'));
  const restore=new RestoreCoordinator({root:join(root,'restore'),scope:async()=>({workspaces}),authorize:async(actor,scope,manage)=>!manage&&actor==='alice'&&scope==='gitea-2'});
  const requested=await restore.request('alice','gitea-2',{taskId:'lost-task',jobId:randomUUID()});
  const factory={list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native provider calls');}};
  host=new HostServer({port:0,token:'synthetic-cli-token',requireUser:true,factory,scopeForUser:()=>({factory,workspaces}),backup:{coordinator:new BackupCoordinator({root:join(root,'checkpoints')}),restore}});await host.start();
  const profile=join(root,'profile.json');await writeFile(profile,JSON.stringify({schema:2,endpoint:`http://127.0.0.1:${host.address().port}/`,token:'synthetic-cli-token',user:'gitea-2',actor:'alice'}),{mode:0o600});
  const result=await execute(process.execPath,['dist/src/restore-cli.js','status','--profile',profile],{timeout:15000});
  expect(JSON.parse(result.stdout)).toMatchObject({scope:'gitea-2',canManage:false,restores:[{id:requested.id,requestedBy:'alice',state:'requested'}]});
  expect(result.stdout).not.toContain('synthetic-cli-token');
  await writeFile(profile,JSON.stringify({schema:2,endpoint:`http://127.0.0.1:${host.address().port}/`,token:'synthetic-cli-token',user:'awangs',actor:'alice'}),{mode:0o600});
  await expect(execute(process.execPath,['dist/src/restore-cli.js','status','--profile',profile,'--scope','gitea-2'],{timeout:15000})).rejects.toMatchObject({stderr:expect.stringContaining('http_403')});
 }finally{await host?.close();await rm(root,{recursive:true,force:true});}
},20000);


it('the recovery CLI rejects legacy profiles and missing or malformed actors before any HTTP request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recovery-cli-invalid-'));let requests=0;
 const server=createServer((_request,response)=>{requests++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');});
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw Error('Synthetic listener missing');
  const profile=join(root,'profile.json'),base={endpoint:`http://127.0.0.1:${address.port}/`,token:'synthetic-cli-token',user:'awangs'};
  const profiles=[{...base,schema:1},{...base,schema:1,actor:'alice'},...[undefined,null,42,'','Alice',' alice','../awangs','alice\r\nx-actor:awangs','a'.repeat(41)].map(actor=>({...base,schema:2,...(actor===undefined?{}:{actor})}))];
  for(const value of profiles){
   await writeFile(profile,JSON.stringify(value),{mode:0o600});
   await expect(execute(process.execPath,['dist/src/restore-cli.js','status','--profile',profile],{timeout:15000})).rejects.toMatchObject({stderr:expect.stringContaining('profile_invalid')});
  }
  expect(requests).toBe(0);
 }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(root,{recursive:true,force:true});}
},20000);
