import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {HostServer} from '../src/host/server.js';import {Workspaces} from '../src/host/workspaces.js';

it('coalesces concurrent Pi secretary directory reads without creating or prompting Codex targets',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-passive-poll-'));let server:HostServer|undefined,release!:()=>void;
 const gate=new Promise<void>(r=>{release=r;});let calls=0,active=0,max=0,creates=0;
 try{
  const ws=new Workspaces(join(root,'projects'));const source=await ws.createChatConversation('pi-secretary');const target=await ws.createChatConversation('codex-target','codex');
  await ws.setNativeBinding(target.id,{state:'bound',id:'00000000-0000-4000-8000-000000000001'});
  const factory={list:async()=>{calls++;active++;max=Math.max(max,active);await gate;active--;return [];},create:async()=>{creates++;throw Error('A read must never create or resume an Agent');},delete:async()=>false};
  server=new HostServer({host:'127.0.0.1',port:0,token:'synthetic-queue',factory,workspaces:ws});await server.start();const base=`http://127.0.0.1:${server.address().port}`;
  const selected=await fetch(base+'/api/mishu',{method:'POST',headers:{authorization:'Bearer synthetic-queue','content-type':'application/json'},body:JSON.stringify({action:'select',id:source.id,selected:true})});expect(selected.status).toBe(200);
  const runtime=await server.mishuRuntime(undefined,source.id),env=runtime.env;
  const requests=Array.from({length:20},()=>fetch(env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify({action:'directory'})}));
  // Hold native metadata until the concurrent HTTP requests can reach it.
  await new Promise(r=>setTimeout(r,100));release();const responses=await Promise.all(requests);
  expect(responses.map(r=>r.status)).toEqual(Array(20).fill(200));
  const body=await responses[0].json();expect(body.conversations.some((c:any)=>c.id===target.id)).toBe(true);
  expect(max).toBe(1);expect(calls).toBe(1);expect(creates).toBe(0);
 }finally{release();await server?.close();await rm(root,{recursive:true,force:true});}
});

it('bounds per-conversation native metadata reads and preserves order without starting Agents',async()=>{
 const {NativeAgentFactory}=await import('../src/host/native/factory.js');
 const root=await mkdtemp(join(tmpdir(),'mishu-metadata-limit-'));
 let active=0,max=0,reads=0,creates=0;
 try{
  const ws=new Workspaces(join(root,'work')),ids:string[]=[];
  for(let i=0;i<12;i++){const c=await ws.createChatConversation('target-'+i,'codex');ids.push(c.id);await ws.setNativeBinding(c.id,{state:'bound',id:'native-'+i});}
  const factory=new NativeAgentFactory({workspaces:ws,pi:{list:async()=>[],create:async()=>{creates++;throw Error('Passive read started an Agent');},delete:async()=>false},codexSummary:async(_cwd,id)=>{
   active++;reads++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;
   if(id==='native-3')throw Error('Synthetic unavailable metadata');
   return {id,createdAt:'2026-10-12',updatedAt:'2026-10-12',messageCount:1,preview:id};
  }});
  const result=await factory.list();expect(max).toBeLessThanOrEqual(4);expect(reads).toBe(12);expect(creates).toBe(0);
  expect(result.map(c=>c.id)).toEqual(ids);expect(result[3].preview).toBe('Codex Task');expect(result[4].preview).toBe('native-4');
 }finally{await rm(root,{recursive:true,force:true});}
});
