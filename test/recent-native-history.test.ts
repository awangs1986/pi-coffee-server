import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';import {WebSocket} from 'ws';
import {HostServer} from '../src/host/server.js';
const roots:string[]=[],servers:HostServer[]=[],sockets:WebSocket[]=[];
afterEach(async()=>{for(const ws of sockets.splice(0))ws.close();for(const s of servers.splice(0))await s.close();for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
it('opens an unverified native conversation with one recent read, pages without gaps, and fences tokens',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recent-native-'));roots.push(root);let binding='native-first';
 const all=Array.from({length:91},(_,i)=>({id:'message-'+i,kind:'assistant',text:i===90?'L'.repeat(20000):'reply '+i}));
 const full=vi.fn(async()=>{throw Error('Complete history must not be used for display');});
 const recent=vi.fn(async(cursor?:string)=>{await new Promise(r=>setTimeout(r,15));return {entries:cursor?[{id:'oldest',kind:'user',text:'oldest'}]:all,leafId:cursor?'oldest':'message-90',olderCursor:cursor?null:'native-cursor'};});
 const audit=vi.fn(async()=>({history:{entries:[],leafId:null},binding:'fixture',sourceGeneration:'unknown',sourceFreshness:'unknown',checkedAt:new Date().toISOString()}));
 const sessions=new Map();const factory:any={readHistory:audit,list:async()=>[],create:async({sessionId}:any)=>{const session={getHistory:full,getHistoryPage:recent,getHistoryBinding:()=>binding,getState:async()=>({isStreaming:false,messageCount:0}),onEvent:()=>()=>{},stop:async()=>{},abort:async()=>{}};sessions.set(sessionId,session);return session;}};
 const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:root});servers.push(host);await host.start();const base=`http://127.0.0.1:${host.address().port}`;
 const open=async(id:string)=>{const ws=new WebSocket(base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer secret'}});sockets.push(ws);const frames:any[]=[];ws.on('message',d=>frames.push(JSON.parse(String(d))));await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',recentHistory:true,sessionId:id,syncProtocol:2,displayMode:'compact'}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));return frames.find(f=>f.type==='history');};
 const first=await open('a');expect(full).not.toHaveBeenCalled();expect(recent).toHaveBeenCalledTimes(1);expect(first.recentPage.coverage).toBe('recent');expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(65536);expect(first.entries.length).toBeLessThanOrEqual(40);
 const read=(id:string,path:string)=>fetch(base+'/api/conversations/'+id+'/'+path,{headers:{authorization:'Bearer secret'}});
 const auditsBefore=audit.mock.calls.length;vi.useFakeTimers({toFake:['Date']});try{vi.setSystemTime(Date.now()+2000);await read('a','meta');await new Promise(r=>setTimeout(r,100));await read('a','meta');expect(audit).toHaveBeenCalledTimes(auditsBefore);}finally{vi.useRealTimers();}
 const latest=first.entries.at(-1);expect(latest.text.length).toBeLessThan(20000);const content=await read('a','recent-content?token='+latest.contentToken);expect(content.status).toBe(200);expect((await content.json()).entry.text).toHaveLength(20000);
 const ids=first.entries.map((e:any)=>e.id);let cursor=first.recentPage.olderCursor;const original=cursor;
 while(cursor){const response=await read('a','recent-page?displayMode=compact&cursor='+cursor);expect(response.status).toBe(200);const page=await response.json();ids.unshift(...page.entries.map((e:any)=>e.id));cursor=page.olderCursor;}
 expect(ids).toEqual(['oldest',...all.map(e=>e.id)]);expect(recent).toHaveBeenCalledTimes(2);expect(full).not.toHaveBeenCalled();
 const simultaneous=await Promise.all([read('a','recent-page?displayMode=compact'),read('a','recent-page?displayMode=compact')]);expect(simultaneous.every(r=>r.status===200)).toBe(true);await Promise.all(simultaneous.map(r=>r.arrayBuffer()));expect(recent).toHaveBeenCalledTimes(3);
 await open('b');expect((await read('b','recent-page?displayMode=compact&cursor='+original)).status).toBe(409);
 expect((await read('a','recent-page?displayMode=detailed&cursor='+original)).status).toBe(409);
 vi.useFakeTimers({toFake:['Date']});try{vi.setSystemTime(Date.now()+600001);expect((await read('a','recent-content?token='+latest.contentToken)).status).toBe(409);}finally{vi.useRealTimers();}
 const renewed=await (await read('a','recent-page?displayMode=compact')).json();binding='native-rebound';expect((await read('a','recent-content?token='+renewed.entries.at(-1).contentToken)).status).toBe(409);
});

it('evicts old display payloads at the process budget without scanning complete history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'recent-budget-'));roots.push(root);
 const session:any={getState:async()=>({isStreaming:false,messageCount:0}),getHistory:vi.fn(async()=>{throw Error('unexpected complete scan');}),getHistoryBinding:()=> 'bound',getHistoryPage:async()=>({entries:[{id:'large',kind:'assistant',text:'x'.repeat(1024*1024)}],leafId:'large',olderCursor:null,coverage:'recent'}),onEvent:()=>()=>{},stop:async()=>{}};
 const host=new HostServer({port:0,token:'secret',factory:{create:async()=>session,list:async()=>[],delete:async()=>true} as any,conversationIndexRoot:root});servers.push(host);await host.start();const base=`http://127.0.0.1:${host.address().port}`;
 const ws=new WebSocket(base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer secret'}});sockets.push(ws);const frames:any[]=[];ws.on('message',d=>frames.push(JSON.parse(String(d))));await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',recentHistory:true,sessionId:'budget',displayMode:'compact'}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));const token=frames.find(f=>f.type==='history').entries[0].contentToken;
 for(let i=0;i<23;i++){const r=await fetch(base+'/api/conversations/budget/recent-page?displayMode=compact',{headers:{authorization:'Bearer secret'}});expect(r.status).toBe(200);await r.arrayBuffer();}
 expect((await fetch(base+'/api/conversations/budget/recent-content?token='+token,{headers:{authorization:'Bearer secret'}})).status).toBe(409);expect(session.getHistory).not.toHaveBeenCalled();
},15000);


it("never accepts another authenticated user's page or content token for the same task ID",async()=>{
 const root=await mkdtemp(join(tmpdir(),'recent-scopes-'));roots.push(root);
 const factory=(user:string):any=>({list:async()=>[],create:async()=>({getState:async()=>({isStreaming:false,messageCount:0}),getHistory:async()=>{throw Error('unexpected complete read');},getHistoryBinding:()=>user,getHistoryPage:async()=>({entries:[{id:'large',kind:'assistant',text:user+'x'.repeat(20000)}],leafId:'large',olderCursor:null,coverage:'recent'}),onEvent:()=>()=>{},stop:async()=>{}})});
 const host=new HostServer({port:0,token:'secret',requireUser:true,factory:factory('unused'),scopeForUser:async user=>({factory:factory(user)}),conversationIndexRoot:root});servers.push(host);await host.start();const base=`http://127.0.0.1:${host.address().port}`;
 const open=async(user:string)=>{const ws=new WebSocket(base.replace('http:','ws:')+'/host',{headers:{authorization:'Bearer secret','x-pi-coffee-user':user}});sockets.push(ws);const frames:any[]=[];ws.on('message',d=>frames.push(JSON.parse(String(d))));await once(ws,'open');ws.send(JSON.stringify({v:1,type:'open',sessionId:'same',recentHistory:true,displayMode:'compact'}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));return frames.find(f=>f.type==='history');};
 const a=await open('alice');await open('bob');const url=base+'/api/conversations/same/recent-content?token='+a.entries[0].contentToken;
 expect((await fetch(url,{headers:{authorization:'Bearer secret','x-pi-coffee-user':'bob'}})).status).toBe(409);
 expect((await fetch(url,{headers:{authorization:'Bearer secret','x-pi-coffee-user':'alice'}})).status).toBe(200);
 expect((await fetch(url)).status).toBe(401);
});
