import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {once} from 'node:events';import {WebSocket} from 'ws';
import {HostServer} from '../src/host/server.js';import {RpcPiSessionFactory} from '../src/host/pi-adapter.js';import {Workspaces,type Conversation} from '../src/host/workspaces.js';
const binding=(c:Conversation)=>createHash('sha256').update(JSON.stringify([c.id,c.createdAt,c.cwd,c.engine??'pi',c.nativeBinding?.id??c.id])).digest('hex');
it('previews exact-source memory candidates, adopts once and restores the saved job after Host restart without another call',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mishu-consolidate-')),workspaces=new Workspaces(join(root,'work')),source=await workspaces.createChatConversation(),target=await workspaces.createChatConversation(),stateRoot=join(workspaces.root,'.coffee','mishu');
 await mkdir(stateRoot,{recursive:true});await writeFile(join(stateRoot,'state.json'),JSON.stringify({version:2,chats:{[source.id]:{selected:true,enabled:true,allowInstructions:false,sourceBinding:binding(source),targets:[{id:target.id,binding:binding(target),title:'target',engine:'pi'}],messages:[]}}}));let calls=0;
 const pi=new RpcPiSessionFactory({cliPath:resolve('test/fixtures/fake-pi-rpc.mjs'),sessionDir:join(root,'sessions')});
 const factory={create:pi.create.bind(pi),list:pi.list.bind(pi),delete:pi.delete.bind(pi),readHistory:async()=>({history:{entries:[{id:'message-user-1',kind:'user' as const,text:'请记住：以后简短回答。',at:'2026-10-21T10:00:00Z'}],leafId:'message-user-1'},binding:'native',sourceGeneration:'g1',sourceFreshness:'current' as const,checkedAt:new Date().toISOString()}),extractMemory:async()=>{calls++;return {text:JSON.stringify({changes:[{op:'add',kind:'preference',text:'以后简短回答',sourceId:'message-user-1',quote:'以后简短回答',start:4,end:10,certainty:'explicit'}]}),provider:'fake',model:'fake-mini',recovered:false,usage:{input:17,output:5,cacheRead:0,cacheWrite:0}};}};
 let host=new HostServer({port:0,token:'fixture',workspaces,factory}),socket:WebSocket|undefined;
 const api=async(body:object)=>{const r=await fetch(`http://127.0.0.1:${host.address().port}/api/mishu`,{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({id:source.id,action:'memory_consolidation',version:1,...body})});return {status:r.status,body:await r.json()};};
 try{
  await host.start();await api({action:'memory',operation:'configure',operationId:'enable-memory',enabled:true});
  socket=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer fixture'}});const frames:any[]=[];socket.on('message',data=>frames.push(JSON.parse(String(data))));await once(socket,'open');socket.send(JSON.stringify({v:1,type:'open',sessionId:source.id}));await expect.poll(()=>frames.some(f=>f.type==='opened'),{timeout:5000}).toBe(true);
  const prepared=await api({operation:'prepare',operationId:'manual-1'});expect(prepared.status).toBe(200);expect(prepared.body.job).toMatchObject({state:'ready',changes:[{op:'add',text:'以后简短回答',source:{messageId:'message-user-1',quote:'以后简短回答',start:4,end:10}}]});expect(calls).toBe(1);
  expect((await api({action:'memory',operation:'list'})).body.entries).toEqual([]);
  const jobId=prepared.body.job.id;socket.close();socket=undefined;await host.close();host=new HostServer({port:0,token:'fixture',workspaces:new Workspaces(workspaces.root),factory});await host.start();
  expect((await api({operation:'get',jobId})).body.job.state).toBe('ready');expect((await api({operation:'prepare',operationId:'manual-1'})).body.job.id).toBe(jobId);expect(calls).toBe(1);
  const adopted=await api({operation:'adopt',jobId,indices:[0]});expect(adopted.status).toBe(200);expect(adopted.body.job.state).toBe('adopted');
  const rows=(await api({action:'memory',operation:'list'})).body.entries;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({text:'以后简短回答',candidate:false});
  expect((await api({operation:'adopt',jobId,indices:[0]})).status).toBe(200);expect((await api({action:'memory',operation:'list'})).body.entries).toHaveLength(1);
  const usage=await api({action:'usage',version:1,purpose:'memory'});expect(usage.body.totals.input).toBe(17);expect(usage.body.totals.output).toBe(5);
 }finally{socket?.close();await host.close();await rm(root,{recursive:true,force:true});}
},20000);
