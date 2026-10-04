import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {HostServer} from '../src/host/server.js';
import {HostSession} from '../src/host/session.js';
import {WebServer} from '../src/web/server.js';
import {Workspaces} from '../src/host/workspaces.js';
import {ConversationIndex} from '../src/host/conversation-index.js';
const roots:string[]=[];const servers:any[]=[];
afterEach(async()=>{for(const server of servers.splice(0).reverse())await server.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function root(){const path=await mkdtemp(join(tmpdir(),'conversation-sync-'));roots.push(path);return path;}
function fake() {
 const listeners=new Set<(event:any)=>void>();const state={isStreaming:false,messageCount:0};
 const session:any={getState:async()=>({...state}),getHistory:vi.fn(async()=>({entries:[],leafId:null})),onEvent:(listener:any)=>{listeners.add(listener);return()=>listeners.delete(listener);},stop:vi.fn(async()=>{}),abort:vi.fn(async()=>{}),backgroundState:async()=>({known:true,active:0}),emit:(event:any)=>{if(event.type==='run_started')state.isStreaming=true;if(event.type==='run_completed')state.isStreaming=false;for(const listener of listeners)listener(event);}};
 session.prompt=vi.fn(async()=>{session.emit({type:'run_started',runId:'native-turn'});});session.steer=vi.fn(async()=>{});
 const factory:any={create:vi.fn(async()=>session),list:vi.fn(async()=>[]),delete:vi.fn(async()=>true),capabilities:async()=>({followUp:true})};return {session,factory};
}
async function socket(host:HostServer,user?:string){const ws=new WebSocket(`ws://127.0.0.1:${host.address().port}/host`,{headers:{authorization:'Bearer secret',...(user?{'x-pi-coffee-user':user}:{})}});const frames:any[]=[];ws.on('message',data=>frames.push(JSON.parse(data.toString())));await once(ws,'open');return {ws,frames};}
async function primeV2(host:HostServer,factory:any,entries:any[]=[]){
 factory.readHistory=async()=>({history:{entries,leafId:entries.at(-1)?.id??null},binding:'verified',sourceGeneration:'generation',sourceFreshness:'current',checkedAt:new Date().toISOString()});
 await vi.waitFor(async()=>{const response=await fetch(`http://127.0.0.1:${host.address().port}/api/conversations/c/page`,{headers:{authorization:'Bearer secret'}});expect((await response.json()).sourceFreshness).toBe('current');},{timeout:3000});
}
describe('read-only sync seam',()=>{
 it('rejects an unavailable explicit conversation instead of creating a native session',async()=>{
  const {factory}=fake();const workspaces=new Workspaces(await root());
  const host=new HostServer({port:0,token:'secret',factory,workspaces});servers.push(host);await host.start();
  const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'missing',nativeProtocol:1,syncProtocol:2}));
  try{await vi.waitFor(()=>expect(frames.some(f=>f.type==='error')).toBe(true));expect(factory.create).not.toHaveBeenCalled();}
  finally{ws.close();await once(ws,'close');}
 });
 it('rechecks freshness after native connection startup yields to a source audit',async()=>{
  const {factory,session}=fake();const dir=await root();
  const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir});servers.push(host);await host.start();
  await primeV2(host,factory,[{id:'old',kind:'assistant',text:'OLDER_REPLY'}]);
  factory.create=async()=>{
   factory.readHistory=async()=>({history:{entries:[],leafId:null},binding:'verified',sourceFreshness:'unknown'});
   await vi.waitFor(async()=>{
    const response=await fetch(`http://127.0.0.1:${host.address().port}/api/conversations/c/page`,{headers:{authorization:'Bearer secret'}});
    expect((await response.json()).sourceFreshness).toBe('unknown');
   },{timeout:3000});return session;
  };
  session.getHistory.mockResolvedValue({entries:[{id:'new',kind:'assistant',text:'LATEST_NATIVE_REPLY'}],leafId:'new'});
  const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'c',syncProtocol:2}));
  try{await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true),{timeout:4000});
   expect(frames.find(f=>f.type==='history').entries.some((entry:any)=>entry.text==='LATEST_NATIVE_REPLY')).toBe(true);
  }finally{ws.close();await once(ws,'close');}
 });

 it('does not serve an old verified index as current history when native audit is now unsupported',async()=>{
  const dir=await root(),{factory,session}=fake();
  const old={id:'old',kind:'assistant',text:'OLDER_REPLY'},latest={id:'latest',kind:'assistant',text:'LATEST_NATIVE_REPLY'};
  const index=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});
  await index.reconcile('b',[old],{binding:'native-b',checkedAt:new Date().toISOString(),sourceFreshness:'current'});await index.close();
  factory.readHistory=async()=>({history:{entries:[],leafId:null},binding:'native-b',sourceFreshness:'unknown',sourceGeneration:'unknown'});
  session.getHistory.mockResolvedValue({entries:[old,latest],leafId:'latest'});
  const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir});servers.push(host);await host.start();
  const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'b',syncProtocol:2}));
  try{await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));
   expect(frames.find(f=>f.type==='history').entries.some((entry:any)=>entry.text==='LATEST_NATIVE_REPLY')).toBe(true);
  }finally{ws.close();await once(ws,'close');}
 });

 it('authenticates every HTTP read and forwards only the verified user, preserving query strings',async()=>{
  const factories:any={};const host=new HostServer({port:0,token:'secret',requireUser:true,factory:fake().factory,conversationIndexRoot:await root(),scopeForUser:async user=>{const f=fake().factory;f.readHistory=async()=>({history:{entries:[{id:'native',kind:'assistant',text:'private '+user}],leafId:'native'},binding:user,sourceGeneration:'1',sourceFreshness:'current',checkedAt:new Date().toISOString()});factories[user]=f;return {factory:f};}});servers.push(host);await host.start();
  const web=new WebServer({port:0,hostUrl:`ws://127.0.0.1:${host.address().port}/host`,hostToken:'secret',auth:{handle:async()=>false,principalOf:(req:any)=>req.headers.cookie?{user:req.headers.cookie}:undefined} as any});servers.push(web);await web.start();
  const base=`http://127.0.0.1:${web.address().port}/api/conversations/c`;
  expect((await fetch(base+'/meta')).status).toBe(401);
  for(const user of ['alice','bob']){await fetch(base+'/meta',{headers:{cookie:user,'x-pi-coffee-user':'mallory'}});await vi.waitFor(async()=>{const response=await fetch(base+'/page?limitBytes=2048',{headers:{cookie:user}});expect(response.status).toBe(200);const page=await response.json();expect(page.userScope).toBe(user);expect(page.entries[0]?.text).toBe('private '+user);expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2048);});expect(factories[user].create).not.toHaveBeenCalled();expect(factories[user].list).not.toHaveBeenCalled();}
  expect(factories.mallory).toBeUndefined();
  expect((await fetch(`http://127.0.0.1:${host.address().port}/api/conversations/c/meta`)).status).toBe(401);
 });
 it('v2 open never calls full-history RPC and publishes only bounded committed body hints',async()=>{
  const dir=await root(),{factory,session}=fake();session.getHistory.mockImplementation(()=>new Promise(()=>{}));
  const index=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});await index.reconcile('c',Array.from({length:100},(_,i)=>({id:'m'+i,kind:'assistant',text:'a'.repeat(225000)})),{checkedAt:new Date().toISOString(),sourceFreshness:'current'});await index.close();
  const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir});servers.push(host);await host.start();await primeV2(host,factory,Array.from({length:100},(_,i)=>({id:'m'+i,kind:'assistant',text:'a'.repeat(225000)})));const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'c',syncProtocol:2}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));
  const history=frames.find(f=>f.type==='history');expect(history).toMatchObject({syncProtocol:2,sourceFreshness:'current'});expect(history.entries.length).toBeLessThanOrEqual(40);expect(Buffer.byteLength(JSON.stringify(history))).toBeLessThanOrEqual(65536);expect(session.getHistory).not.toHaveBeenCalled();
  session.emit({type:'run_started',runId:'r'});session.emit({type:'message_delta',id:'new',delta:'hello'});session.emit({type:'tool_update',id:'tool',name:'tool',args:{},result:'large'.repeat(10000)});
  await vi.waitFor(()=>expect(frames.filter(f=>f.type==='sync_changed').length).toBeGreaterThanOrEqual(3));expect(frames.some(f=>f.type==='event'&&['message_delta','tool_update'].includes(f.event.type))).toBe(false);
  session.emit({type:'message_start',message:{role:'user',content:[{type:'text',text:'Pi user before settle'}]}});
  session.emit({type:'tool_execution_start',toolCallId:'pi-tool',toolName:'read',args:{path:'README.md'}});
  session.emit({type:'tool_execution_update',toolCallId:'pi-tool',partialResult:{content:[{type:'text',text:'Pi tool before settle'}]}});
  await vi.waitFor(async()=>{const page=await (await fetch(`http://127.0.0.1:${host.address().port}/api/conversations/c/page`,{headers:{authorization:'Bearer secret'}})).json();expect(page.runState).toBe('running');expect(page.entries.some(e=>e.kind==='user'&&e.text==='Pi user before settle')).toBe(true);expect(page.entries.find(e=>e.id==='pi-tool')?.result).toBe('Pi tool before settle');});
  const hint=frames.filter(f=>f.type==='sync_changed').at(-1);const response=await fetch(`http://127.0.0.1:${host.address().port}/api/conversations/c/changes?bindingEpoch=${hint.bindingEpoch}&afterRevision=${history.baseRevision}`,{headers:{authorization:'Bearer secret'}});const changes=await response.json();expect(BigInt(changes.headRevision)).toBeGreaterThanOrEqual(BigInt(hint.headRevision));expect(changes.operations.some(o=>o.entityId==='new')).toBe(true);
  const contentBase=`http://127.0.0.1:${host.address().port}/api/conversations/c/content?entityId=new&entityRevision=1`;
  const wrongEpoch=await fetch(contentBase+'&bindingEpoch=wrong',{headers:{authorization:'Bearer secret'}});expect(wrongEpoch.status).toBe(409);expect(await wrongEpoch.json()).not.toHaveProperty('text');
  const wrongRevision=await fetch(contentBase+`0&bindingEpoch=${hint.bindingEpoch}`,{headers:{authorization:'Bearer secret'}});expect(wrongRevision.status).toBe(409);expect(await wrongRevision.json()).not.toHaveProperty('text');
  ws.close();await once(ws,'close');expect(session.abort).not.toHaveBeenCalled();expect(session.stop).not.toHaveBeenCalled();
 });
 it('fences v2 commands and keeps command receipts after disconnect without redelivery',async()=>{
  const {factory,session}=fake();const dir=await root();const seed=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});await seed.reconcile('c',[],{checkedAt:new Date().toISOString(),sourceFreshness:'current'});await seed.close();const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir});servers.push(host);await host.start();await primeV2(host,factory);const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'c',syncProtocol:2}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));const epoch=frames.find(f=>f.type==='opened').bindingEpoch;
  ws.send(JSON.stringify({v:1,type:'prompt',requestId:'wrong',text:'do not deliver',conversationId:'other',bindingEpoch:epoch}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='error'&&f.requestId==='wrong')).toBe(true));expect(session.prompt).not.toHaveBeenCalled();
  const prompt={v:1,type:'prompt',requestId:'same-request',text:'once',conversationId:'c',bindingEpoch:epoch};ws.send(JSON.stringify(prompt));await vi.waitFor(()=>expect(session.prompt).toHaveBeenCalledTimes(1));expect(frames.find(f=>f.type==='ack'&&f.requestId===prompt.requestId)).toMatchObject({conversationId:'c',bindingEpoch:epoch});
  const base=`http://127.0.0.1:${host.address().port}/api/conversations/c/commands?requestId=same-request`;await vi.waitFor(async()=>expect((await (await fetch(base,{headers:{authorization:'Bearer secret'}})).json()).commands[0].state).toBe('running'));
  session.emit({type:'run_completed'});ws.send(JSON.stringify(prompt));await vi.waitFor(()=>expect(frames.some(f=>f.type==='error'&&f.requestId===prompt.requestId)).toBe(true));expect(session.prompt).toHaveBeenCalledTimes(1);ws.close();await once(ws,'close');
 });
 it('preserves a queued request ID through edit, native delivery and settlement',async()=>{
  const {factory,session}=fake();const dir=await root();const seed=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});await seed.reconcile('c',[],{checkedAt:new Date().toISOString(),sourceFreshness:'current'});await seed.close();const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir});servers.push(host);await host.start();await primeV2(host,factory);const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'c',syncProtocol:2}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));const bindingEpoch=frames.find(f=>f.type==='opened').bindingEpoch;
  const send=(frame:any)=>ws.send(JSON.stringify({v:1,conversationId:'c',bindingEpoch,...frame}));send({type:'prompt',requestId:'first',text:'first'});await vi.waitFor(()=>expect(session.prompt).toHaveBeenCalledTimes(1));send({type:'prompt',mode:'follow_up',requestId:'queued-stable',text:'queued'});await vi.waitFor(()=>expect(frames.some(f=>f.type==='ack'&&f.requestId==='queued-stable')).toBe(true));const item=frames.filter(f=>f.type==='queue_state').at(-1).items[0];expect(item.requestId).toBe('queued-stable');send({type:'queue_action',id:item.id,revision:item.revision,requestId:'edit',action:'edit',text:'edited'});await vi.waitFor(()=>expect(frames.some(f=>f.type==='ack'&&f.requestId==='edit')).toBe(true));session.emit({type:'run_completed'});await vi.waitFor(()=>expect(session.prompt).toHaveBeenCalledTimes(2));expect(session.prompt.mock.calls[1][0]).toBe('edited');
  const response=await fetch(`http://127.0.0.1:${host.address().port}/api/conversations/c/commands?requestId=queued-stable`,{headers:{authorization:'Bearer secret'}});expect((await response.json()).commands[0]).toMatchObject({requestId:'queued-stable',state:'running'});ws.close();await once(ws,'close');
 });
 it.each(['accepted','delivering'])('public Stop bypasses a suspended %s receipt and never delivers the late prompt',async(state)=>{
  const {factory,session}=fake();const dir=await root();const seed=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});await seed.reconcile('c',[],{checkedAt:new Date().toISOString(),sourceFreshness:'current'});await seed.close();
  const original=ConversationIndex.prototype.command;let release!:()=>void,blocked=false;const gate=new Promise<void>(resolve=>release=resolve);const spy=vi.spyOn(ConversationIndex.prototype,'command').mockImplementation(async function(id,requestId,next,mode){if(requestId==='suspended'&&next===state){blocked=true;await gate;}return original.call(this,id,requestId,next,mode);});
  try{
    const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir});servers.push(host);await host.start();await primeV2(host,factory);const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'c',syncProtocol:2}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));const bindingEpoch=frames.find(f=>f.type==='opened').bindingEpoch;
    const send=(frame:any)=>ws.send(JSON.stringify({v:1,conversationId:'c',bindingEpoch,...frame}));send({type:'prompt',requestId:'suspended',text:'must never deliver'});await vi.waitFor(()=>expect(blocked).toBe(true));send({type:'prompt',requestId:'queued-before-stop',text:'also must never deliver'});send({type:'abort',requestId:'urgent-stop'});await vi.waitFor(()=>expect(session.abort).toHaveBeenCalledTimes(1));expect(frames.some(f=>f.type==='ack'&&f.requestId==='urgent-stop')).toBe(true);expect(session.prompt).not.toHaveBeenCalled();
    release();await vi.waitFor(()=>expect(frames.some(f=>f.type==='error'&&f.requestId==='suspended')).toBe(true));await vi.waitFor(()=>expect(frames.some(f=>f.type==='error'&&f.requestId==='queued-before-stop')).toBe(true));expect(session.prompt).not.toHaveBeenCalled();ws.close();await once(ws,'close');
  }finally{release();spy.mockRestore();}
 });
 it('declines cold v2 enrollment for unsupported legacy source and preserves readable native history',async()=>{
  const {factory,session}=fake();factory.readHistory=async()=>({history:{entries:[],leafId:null},binding:'old-codex',sourceGeneration:'unknown',sourceFreshness:'unknown',checkedAt:new Date().toISOString()});session.getHistory.mockResolvedValue({entries:[{kind:'assistant',id:'native-old',text:'Existing Codex response_item history'}],leafId:'native-old'});
  const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:await root()});servers.push(host);await host.start();const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'old-codex',syncProtocol:2}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));expect(frames.find(f=>f.type==='opened').syncProtocol).toBeUndefined();expect(frames.find(f=>f.type==='history').entries[0].text).toBe('Existing Codex response_item history');expect(session.abort).not.toHaveBeenCalled();ws.close();await once(ws,'close');
 });
 it('rollback disables v2 and preserves existing durable display files',async()=>{
  const dir=await root(),{factory}=fake();const index=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});await index.reconcile('c',[{id:'keep',kind:'assistant',text:'keep'}]);const before=await index.meta('c');await index.close();
  const host=new HostServer({port:0,token:'secret',factory,conversationIndexRoot:dir,syncProtocolV2:false});servers.push(host);await host.start();const {ws,frames}=await socket(host);ws.send(JSON.stringify({v:1,type:'open',sessionId:'c',syncProtocol:2}));await vi.waitFor(()=>expect(frames.some(f=>f.type==='history')).toBe(true));expect(frames.find(f=>f.type==='opened').syncProtocol).toBeUndefined();ws.close();await once(ws,'close');
  const reopened=new ConversationIndex({root:dir,userScope:'',factory,auditIntervalMs:0});expect((await reopened.meta('c')).bindingEpoch).toBe(before.bindingEpoch);expect((await reopened.page('c')).entries[0].text).toBe('keep');await reopened.close();
 });
});
describe('legacy snapshot handoff regression',()=>{
 it('does not lose completion emitted while exportHistory is suspended',async()=>{
  const {factory,session}=fake();let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let exporting=false;
  const host=new HostSession({id:'c',factory,onHistory:async()=>{exporting=true;await gate;},externalPollMs:0});await host.start();session.emit({type:'agent_start'});
  const opening=host.prepare();await vi.waitFor(()=>expect(exporting).toBe(true));session.emit({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'finished'}]}});session.emit({type:'agent_settled'});release();const result=await opening;
  expect(result.history.entries).toEqual([]);expect(result.replay.filter(f=>f.type==='event'&&(f.event as any).type==='message_end')).toHaveLength(1);await host.stop();
 });
 it('Stop reaches native abort even when cancellation receipt persistence never resolves',async()=>{
  const {factory,session}=fake();const onCommand=vi.fn(async(_id:string,_request:string,state:string)=>{if(state==='cancelled')await new Promise(()=>{});});const host=new HostSession({id:'stop',factory,onCommand});await host.start();session.emit({type:'run_started'});await host.enqueue('follow_up','pending',undefined,'queued');await host.abort();expect(session.abort).toHaveBeenCalledTimes(1);expect(onCommand.mock.calls.some(call=>call[2]==='cancelled')).toBe(true);await host.stop();
 });
 it.each(['queued prompt','promoted steer','prepare ledger'])('Stop fences %s suspended before native delivery',async(kind)=>{
  const {factory,session}=fake();let release!:()=>void,blocked=false;const gate=new Promise<void>(resolve=>release=resolve);
  const host=new HostSession({id:'fenced-stop',factory,onCommand:async(_id,requestId,state)=>{if(kind!=='prepare ledger'&&requestId==='queued'&&state==='delivering'){blocked=true;await gate;}},onRun:async(_id,state)=>{if(kind==='prepare ledger'&&state==='running'){blocked=true;await gate;}}});
  await host.start();session.emit({type:'run_started'});await host.enqueue('follow_up','must not start',undefined,'queued');
  let promotion:Promise<unknown>|undefined;
  if(kind==='promoted steer'){const item=host.queueFrame.items[0];promotion=host.changeQueue({...item,action:'promote'}).catch(error=>error);}else session.emit({type:'run_completed'});
  await vi.waitFor(()=>expect(blocked).toBe(true));await host.abort();expect(session.abort).toHaveBeenCalledTimes(1);expect(host.queueFrame.items).toEqual([]);expect(session.prompt).not.toHaveBeenCalled();expect(session.steer).not.toHaveBeenCalled();
  release();await promotion;await new Promise(resolve=>setTimeout(resolve,20));expect(session.prompt).not.toHaveBeenCalled();expect(session.steer).not.toHaveBeenCalled();await host.stop();
 });
 it('retries history when completion races the history read itself',async()=>{
  const {factory,session}=fake();let reads=0;session.getHistory.mockImplementation(async()=>{if(++reads===1){session.emit({type:'message_end',message:{role:'assistant'}});return {entries:[],leafId:null};}return {entries:[{kind:'assistant',id:'a',text:'complete'}],leafId:'a'};});
  const host=new HostSession({id:'c',factory});const result=await host.prepare();expect(reads).toBe(2);expect(result.history.entries).toHaveLength(1);expect(result.replay).toEqual([]);await host.stop();
 });
});
