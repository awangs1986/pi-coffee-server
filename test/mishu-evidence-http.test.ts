import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {HostServer} from '../src/host/server.js';import {Workspaces,type Conversation} from '../src/host/workspaces.js';
const binding=(c:Conversation)=>createHash('sha256').update(JSON.stringify([c.id,c.createdAt,c.cwd,c.engine??'pi',c.nativeBinding?.id??c.nativeBinding?.requestedId??c.id])).digest('hex');
it('searches exact native evidence without starting a runtime and fences contact revocation during reads',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-evidence-')),workspaces=new Workspaces(join(root,'work'));
 const source=await workspaces.createChatConversation(),target=await workspaces.createChatConversation(),other=await workspaces.createChatConversation();let reads=0,creates=0,gate:Promise<void>|undefined,release:()=>void=()=>{};
 const at='2026-10-20T12:00:00.000Z',entries=[{kind:'user' as const,id:'decision',at,text:'最新决定：使用蓝色。'+ 'x'.repeat(4000)},{kind:'assistant' as const,id:'summary',at,text:'模型摘要：蓝色'}];
 const factory={list:async()=>[],delete:async()=>false,create:async()=>{creates++;throw Error('No runtime permitted');},readHistory:async()=>{reads++;await gate;return {history:{entries,leafId:'summary'},binding:'native',sourceGeneration:'g1',sourceFreshness:'current' as const,checkedAt:at};}};
 const stateRoot=join(workspaces.root,'.coffee','mishu');await mkdir(stateRoot,{recursive:true});await writeFile(join(stateRoot,'state.json'),JSON.stringify({version:2,chats:{[source.id]:{selected:true,enabled:true,allowInstructions:false,sourceBinding:binding(source),targets:[{id:target.id,binding:binding(target),title:'target',engine:'pi'}],messages:[],manager:{sourceBinding:binding(source),viewAll:true,watchCursor:0}}}}));
 const host=new HostServer({port:0,token:'fixture',workspaces,factory});
 try{await host.start();const env=(await host.mishuRuntime(undefined,source.id)).env;
  const call=(body:unknown)=>fetch(env.PI_COFFEE_MISHU_URL,{method:'POST',headers:{authorization:'Bearer '+env.PI_COFFEE_MISHU_TOKEN,'content-type':'application/json'},body:JSON.stringify(body)});
  const found=await call({action:'evidence',version:1,mode:'search',query:'最新决定',targetId:target.id});expect(found.status).toBe(200);const result=await found.json();
  expect(result.entries).toHaveLength(1);expect(result.entries[0]).toMatchObject({messageId:'decision',conversationId:target.id,role:'user',at,kind:'user-original',truncated:true,range:{start:0,end:2000}});expect(result.entries[0].text).toContain('最新决定');expect(result.freshness).toBe('current');expect(result.untrusted).toBe(true);expect(creates).toBe(0);
  const browser=await fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({action:'evidence',id:source.id,version:1,mode:'anchor',anchorId:'summary'})});expect(browser.status).toBe(200);expect((await browser.json()).entries.map((e:any)=>e.messageId)).toEqual(['decision','summary']);
  expect((await call({action:'evidence',version:1,targetId:other.id,mode:'recent'})).status).toBe(409);expect(reads).toBe(2);
  expect((await (await call({action:'evidence',version:1,mode:'search',query:'no match'})).json()).entries).toEqual([]);
  expect((await (await call({action:'evidence',version:1,mode:'anchor',anchorId:'lost'})).json()).missingAnchor).toBe(true);
  const scan=await(await call({action:'evidence',version:1,mode:'scan',afterId:'decision',limit:1})).json();expect(scan.entries.map((e:any)=>e.messageId)).toEqual(['summary']);expect(scan.nextId).toBe('summary');expect(scan.hasMore).toBe(false);
  gate=new Promise(r=>{release=r;});const pending=call({action:'evidence',version:1,mode:'recent',targetId:target.id});await new Promise(r=>setTimeout(r,30));await call({action:'disable'});release();expect((await pending).status).toBe(409);expect(creates).toBe(0);
 }finally{release();await host.close();await rm(root,{recursive:true,force:true});}
});
