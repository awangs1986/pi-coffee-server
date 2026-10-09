// @vitest-environment jsdom
// Run the real app controller and renderers through its public DOM/transport seams.
// Transport fixtures are synthetic; these are correctness tests, not browser SLOs.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {ConversationModels} from '../public/conversation-models.js';

type Engine = 'pi' | 'codex' | 'claude' | 'cursor' | 'grok';
const capabilities = { stop: true, steer: true, followUp: true, tools: true, questions: true };
const allFrames: any[] = [];
const listeners: any[] = [];
const tick = (ms = 32) => vi.advanceTimersByTimeAsync(ms);
const thread = () => document.querySelector<HTMLElement>('#thread')!;
const prompt = () => document.querySelector<HTMLTextAreaElement>('#prompt')!;
const choose = (id: string) => {
  const row = document.querySelector<HTMLElement>(`#session-list [data-session-id="${id}"]`);
  expect(row, `conversation ${id} is offered in the real sidebar`).not.toBeNull();
  row!.click();
};
function draft(text: string) { prompt().value = text; prompt().dispatchEvent(new Event('input')); }
function giant(length: number, marker: string) {
  return `${marker}\n\`\`\`typescript\n` + 'const safe = "<img src=x onerror=alert(1)>";\n'.repeat(Math.ceil(length / 30)).slice(0, length) + '\nFINAL-' + marker;
}

afterEach(() => {
  for (const [target, type, listener, options] of listeners.splice(0)) target.removeEventListener(type, listener, options);
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  history.replaceState(null,'','/');localStorage.clear(); sessionStorage.clear(); vi.resetModules(); allFrames.length = 0;
});
async function setup(engine: Engine = 'codex', protocol: 1 | 2 = 1, beforeBoot=(network:{workspaceGate:Promise<void>|null;showGroups:boolean})=>{}) {
  const originalAdd = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, type: string, listener: any, options: any) { listeners.push([this, type, listener, options]); originalAdd.call(this, type, listener, options); });
  document.documentElement.innerHTML = readFileSync('public/index.html', 'utf8');
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {} }) });
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const conversations = ['a', 'b', 'c'].map(id => ({ id, name: `Conversation ${id}`, engine, workspaceKind: engine === 'pi' ? 'chat' : 'work', createdAt: '2026-10-03T00:00:00Z' }));
  const syncReads: string[] = [];
  const syncStates = new Map<string, any>(conversations.map(c => [c.id, { revision: '1', runState: 'running', entries: [{ kind: 'assistant', id: c.id + '-answer', entityRevision: '1', text: 'SYNC-' + c.id }] }]));
  const network = { showGroups:true, authGate:null as Promise<void>|null, workspaceGate:null as Promise<void>|null, user: 'synthetic-local-first-user', custom: null as null | ((url: string) => any), hang: false, deferred: new Map<string, (response: Response) => void>() };
  const snapshot = (id: string) => { const state = syncStates.get(id)!; return { syncProtocol: 2, userScope:network.user, conversationId: id, sessionId: id, bindingEpoch: 'epoch-' + id, snapshotId: 'snapshot-' + id + '-' + state.revision, baseRevision: state.revision, headRevision: state.revision, olderCursor: state.olderCursor || null, sourceFreshness: 'current', lastSourceCheckAt:state.lastSourceCheckAt||'2026-10-03T00:00:00Z', runState: state.runState, entries: state.entries }; };
  const sockets: Socket[] = [];
  class Socket {
    static OPEN = 1; readyState = 1;
    onopen: any; onmessage: any; onclose: any; onerror: any;
    constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
    send(text: string) { allFrames.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
    receive(frame: any) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  }
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    let data: any = {};
    if (url === '/auth/me') {await network.authGate;data = { auth: true, user: network.user };}
    else if (url === '/api/me') data = null;
    else if (url === '/api/engines') data = { engines: ['pi', 'codex', 'claude', 'cursor', 'grok'].map(id => ({ id, available: true })) };
    else if (url === '/api/workspace') {await network.workspaceGate;data = ['files', 'changes'].includes(body.action) ? { state: 'local', files: [] } : { projects: [], conversations, sidebar: { showGroups:network.showGroups, assignments: {}, collapsed: [] }, capabilities: { chatWorkspaces: true } };}
    // Unknown read-only sync is held, never mistaken for a valid empty snapshot.
    else if (String(url).includes('/api/conversations/')) {
      syncReads.push(String(url));
      if (protocol === 1 || network.hang) return new Promise(() => {});
      const custom = network.custom?.(String(url)); if (custom) return custom;
      const match = String(url).match(/\/api\/conversations\/([^/]+)\/(meta|page|changes|content)/)!;
      const id = match[1], action = match[2], state = syncStates.get(id)!;
      if (network.deferred.has(id)) return new Promise<Response>(resolve => network.deferred.set(id, resolve));
      if (action === 'meta') data = { ...snapshot(id), oldestAvailableRevision: '0' };
      else if (action === 'page') data = snapshot(id);
      else if (action === 'changes') {
        const from = new URL(String(url), 'http://localhost').searchParams.get('afterRevision')!;
        data = { ...snapshot(id), fromExclusive: from, throughRevision: state.revision, hasMore: false, operations: from === state.revision ? [] : state.operations || [{ opId: id + '-op-' + state.revision, revision: state.revision, entityId: id + '-answer', entityRevision: state.revision, type: 'replaceText', payload: { entry: state.entries[0] } }] };
      } else data = {};
      return new Response(JSON.stringify(data), { status: 200 });
    }
    return { ok: true, status: 200, json: async () => data };
  }));
  vi.useFakeTimers();
  beforeBoot(network);
  await import('../public/app.js'); await tick();
  sockets.at(-1)!.receive({ type: 'sessions', sessions: conversations }); await tick();
  let cursor = 0;
  const select = async (id: string, history: any[] = [{ kind: 'user', id: `${id}-u`, text: `HISTORY-${id}` }], streaming = false) => {
    choose(id); await tick();
    const socket = sockets.at(-1)!;
    socket.receive({ type: 'opened', ...(protocol===2?{syncProtocol:2,bindingEpoch:'epoch-'+id}:{}), engine, sessionId: id, capabilities, state: { isStreaming: streaming } });
    socket.receive(protocol === 2 ? { type: 'history', ...snapshot(id) } : { type: 'history', sessionId: id, entries: history }); await tick(150);
    return socket;
  };
  const emit = (socket: Socket, id: string, event: any) => socket.receive({ type: 'event', sessionId: id, cursor: ++cursor, event });
  return { sockets, select, emit, engine, network, snapshot, syncStates, syncReads, conversations };
}
function assistantEvent(engine: Engine, text: string, complete = false) {
  if (engine !== 'pi') return complete ? { type: 'message_completed', id: 'live-answer', text } : { type: 'message_delta', id: 'live-answer', delta: text };
  return complete ? { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } } : { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } };
}

describe('actual app local-first live output', () => {
  it.each([false,true])('places an older task with today’s conversation under Today in grouped=%s',async grouped=>{
    const app=await setup('codex',2,network=>{network.showGroups=grouped;});
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    Object.assign(app.conversations[0],{createdAt:'2026-10-04T13:24:27Z',lastActivityAt:'2026-10-06T11:04:02Z'});
    Object.assign(app.conversations[1],{createdAt:'2026-10-05T10:00:00Z',lastActivityAt:'2026-10-05T11:00:00Z'});
    Object.assign(app.conversations[2],{createdAt:'2026-10-03T00:00:00Z'});
    const native=app.conversations.map(c=>({...c,lastActivityAt:undefined,updatedAt:c.createdAt,running:c.id==='a'}));
    app.sockets.at(-1)!.receive({type:'sessions',sessions:native});await tick();
    const ids=()=>[...document.querySelectorAll('#session-list [data-session-id]')].map(n=>n.getAttribute('data-session-id'));
    expect(ids()).toEqual(['a','b','c']);
    expect(document.querySelector('[data-session-id="a"]')?.previousElementSibling?.textContent).toBe('今天');
    app.sockets.at(-1)!.receive({type:'sessions',sessions:native.map(c=>({...c,updatedAt:c.id==='c'?c.updatedAt:'2026-10-06T12:01:00Z',attention:c.id==='b'?'waiting':undefined}))});await tick();
    expect(ids()).toEqual(['a','b','c']);
    expect(document.querySelector('[data-session-id="b"]')?.previousElementSibling?.textContent).toBe('昨天');
  });

  it('restores the completed coffee icon from Host status without unread attention after reload',async()=>{
    const app=await setup('codex',2);
    const rows=app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'a-run-1'}:{})}));
    app.sockets.at(-1)!.receive({type:'sessions',sessions:rows});await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    expect(document.querySelector('[data-session-id="a"]')?.textContent).toContain('已完成');
    expect(document.querySelector('[data-session-id="a"]')?.textContent).toContain('待查看');
    app.sockets.at(-1)!.receive({type:'sessions',sessions:rows.map(c=>({...c,running:c.id==='a',attention:'finished'}))});await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
    app.sockets.at(-1)!.receive({type:'sessions',sessions:rows.map(c=>({...c,runStatus:'interrupted'}))});await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it('acknowledges indexed completion only after fresh latest history is rendered',async()=>{
    const app=await setup('codex',2);
    const state=app.syncStates.get('a')!;
    state.runState='settled';state.lastSourceCheckAt='2026-10-03T00:00:00Z';
    const rows=app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'a-run-1',completedAt:'2026-10-03T01:00:00Z'}:{})}));
    app.sockets.at(-1)!.receive({type:'sessions',sessions:rows});await tick();
    const socket=await app.select('a');
    expect(thread().textContent).toContain('SYNC-a');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    state.lastSourceCheckAt='2026-10-03T02:00:00Z';
    socket.receive({type:'sync_changed',sessionId:'a',bindingEpoch:'epoch-a'});await tick(500);
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
    // A delayed summary for the same run cannot resurrect the reminder.
    socket.receive({type:'sessions',sessions:rows});await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
    const scroller=document.querySelector<HTMLElement>('#scroller')!;
    Object.defineProperties(scroller,{scrollHeight:{value:1000,configurable:true},clientHeight:{value:100,configurable:true}});
    scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll'));
    rows[0]={...rows[0],completionId:'a-run-2',completedAt:'2026-10-03T03:00:00Z'};
    state.revision='2';state.lastSourceCheckAt='2026-10-03T04:00:00Z';state.entries=[{kind:'assistant',id:'a-answer-2',entityRevision:'2',text:'NEW-RESULT'}];
    socket.receive({type:'sessions',sessions:rows});
    socket.receive({type:'history',...app.snapshot('a')});await tick(500);
    expect(thread().textContent).toContain('NEW-RESULT');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    scroller.scrollTop=900;scroller.dispatchEvent(new Event('scroll'));await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it.each(['pi','codex'] as const)('reads a live %s completion only after pending native renders finish',async engine=>{
    const app=await setup(engine,1),socket=await app.select('a',[],true);
    app.emit(socket,'a',{type:engine==='pi'?'agent_start':'run_started'});
    socket.receive({type:'sessions',sessions:app.conversations.map(c=>({...c,running:c.id==='a',runStatus:c.id==='a'?'running':undefined}))});
    app.emit(socket,'a',assistantEvent(engine,'LIVE-COMPLETED-REPLY',true));
    app.emit(socket,'a',{type:engine==='pi'?'agent_settled':'run_completed',status:'completed'});
    socket.receive({type:'sessions',sessions:app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'live-run-1'}:{})}))});
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    await tick(150);
    expect(thread().textContent).toContain('LIVE-COMPLETED-REPLY');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it('does not assign a first completion to an older unbound native export',async()=>{
    const app=await setup('codex',1);
    choose('a');await tick();const socket=app.sockets.at(-1)!;
    socket.receive({type:'sessions',sessions:app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'first-result'}:{})}))});
    socket.receive({type:'opened',sessionId:'a',engine:'codex',capabilities,state:{isStreaming:false}});
    socket.receive({type:'history',sessionId:'a',completionId:null,entries:[{kind:'user',id:'old-user',text:'OLD-EXPORT'}]});await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    socket.receive({type:'history',sessionId:'a',completionId:'first-result',entries:[{kind:'assistant',id:'new-answer',text:'ACTUAL-RESULT'}]});await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it('keeps a long completed reply unread until its latest content segment is viewed',async()=>{
    const app=await setup('codex',2),state=app.syncStates.get('a')!;
    state.runState='settled';state.lastSourceCheckAt='2026-10-03T02:00:00Z';
    state.entries=[{kind:'assistant',id:'long-answer',entityRevision:'1',text:'OLD-SEGMENT',contentOffset:0,contentLength:5000,contentTruncated:true}];
    app.sockets.at(-1)!.receive({type:'sessions',sessions:app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'long-result',completedAt:'2026-10-03T01:00:00Z'}:{})}))});
    app.network.custom=url=>{
      if(!url.includes('/content'))return;
      const offset=Number(new URL(url,'http://localhost').searchParams.get('offset')),text='L'.repeat(5000-offset);
      return new Response(JSON.stringify({...app.snapshot('a'),entityId:'long-answer',entityRevision:'1',encoding:'utf-16',offset,nextOffset:5000,totalLength:5000,text}),{status:200});
    };
    await app.select('a');
    expect(thread().textContent).toContain('OLD-SEGMENT');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    const latest=[...thread().querySelectorAll<HTMLButtonElement>('.content-page-trigger')].find(button=>button.textContent==='最新内容')!;
    latest.click();await tick();
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it('acknowledges a completion replayed after an older native export finishes',async()=>{
    const app=await setup('codex',1);choose('a');await tick();const socket=app.sockets.at(-1)!;
    socket.receive({type:'sessions',sessions:app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'replayed-result'}:{})}))});
    socket.receive({type:'opened',sessionId:'a',engine:'codex',cursor:3,capabilities,state:{isStreaming:false}});
    socket.receive({type:'history',sessionId:'a',completionId:null,entries:[{kind:'user',id:'old-user',text:'OLD-EXPORT'}]});
    app.emit(socket,'a',{type:'run_started'});
    app.emit(socket,'a',assistantEvent('codex','REPLAYED-COMPLETED-REPLY',true));
    app.emit(socket,'a',{type:'run_completed',status:'completed'});
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    await tick(150);
    expect(thread().textContent).toContain('REPLAYED-COMPLETED-REPLY');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it.each(['pi','codex'] as const)('does not acknowledge a later %s run during partial replay',async engine=>{
    const app=await setup(engine,1);choose('a');await tick();const socket=app.sockets.at(-1)!;
    socket.receive({type:'sessions',sessions:app.conversations.map(c=>({...c,running:false,...(c.id==='a'?{runStatus:'settled',completionId:'second-replay-result'}:{})}))});
    socket.receive({type:'opened',sessionId:'a',engine,cursor:6,capabilities,state:{isStreaming:false}});
    socket.receive({type:'history',sessionId:'a',completionId:null,entries:[{kind:'user',id:'old-user',text:'OLD-EXPORT'}]});
    const start={type:engine==='pi'?'agent_start':'run_started'},end={type:engine==='pi'?'agent_settled':'run_completed',status:'completed'};
    app.emit(socket,'a',start);app.emit(socket,'a',assistantEvent(engine,'FIRST-REPLAY-REPLY',true));app.emit(socket,'a',end);await tick(150);
    expect(thread().textContent).toContain('FIRST-REPLAY-REPLY');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).not.toBeNull();
    app.emit(socket,'a',start);app.emit(socket,'a',assistantEvent(engine,'LATEST-REPLAY-REPLY',true));app.emit(socket,'a',end);await tick(150);
    expect(thread().textContent).toContain('LATEST-REPLAY-REPLY');
    expect(document.querySelector('[data-session-id="a"] .finished-coffee')).toBeNull();
  });

  it('restores the model after verified page reload before native attachment replies',async()=>{
    await setup('codex',2,network=>{
      network.workspaceGate=new Promise<void>(()=>{});
      const cache=new ConversationModels();cache.setScope('synthetic-local-first-user');
      cache.put('a',{current:{provider:'codex',id:'gpt-6.1-sol'},thinkingLevel:'medium'},{engine:'codex',fingerprint:JSON.stringify(['codex',null,null])});
      history.replaceState(null,'','/conversations/a');
    });
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6.1-sol');
    expect(allFrames.some(f=>f.type==='open')).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('#agent-model-row')?.disabled).toBe(true);
  });

  it.each(['pi','codex','claude','cursor','grok'] as const)('immediately restores the selected %s conversation model while its connection is pending',async engine=>{
    const app=await setup(engine,2);
    const model=(id:string)=>({type:'models',models:[{provider:'codex',id,name:id}],current:{provider:'codex',id},thinkingLevel:'medium',thinkingLevels:['medium']});
    const a=await app.select('a');a.receive(model('gpt-6.1-sol'));await tick();
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6.1-sol');
    const b=await app.select('b');b.receive(model('gpt-6-luna'));await tick();
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6-luna');
    app.network.authGate=new Promise<void>(()=>{});
    choose('a');
    expect(document.querySelector('#agent-name')?.textContent,'switch must use A’s last model before any auth/socket reply').toBe('gpt-6.1-sol');
    expect(allFrames.filter(frame=>frame.type==='set_model')).toHaveLength(0);
  });

  it('keeps a recalled model through native open, rejects old sockets, then corrects it from the selected session',async()=>{
    const app=await setup('codex',2);
    const model=(id:string)=>({type:'models',models:[{provider:'codex',id}],current:{provider:'codex',id},thinkingLevel:'high',thinkingLevels:['medium','high'],context:{preset:'maximum'}});
    const a=await app.select('a');a.receive(model('gpt-6.1-sol'));await tick();
    const b=await app.select('b');b.receive(model('gpt-6-luna'));await tick();const stale=b.onmessage;
    let release!:()=>void;app.network.authGate=new Promise<void>(resolve=>{release=resolve;});
    choose('a');stale({data:JSON.stringify(model('stale-model'))});
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6.1-sol');
    expect(document.querySelector('#agent-thinking-value')?.textContent).toBe('high');
    expect(document.querySelector('#agent-context-value')?.textContent).toBe('500K');
    release();await tick();
    const ws=app.sockets.at(-1)!;ws.receive({type:'opened',engine:'codex',sessionId:'a',capabilities:{...capabilities,models:true}});await tick();
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6.1-sol');
    expect(document.querySelector<HTMLButtonElement>('#agent-model-row')?.disabled).toBe(true);
    ws.receive(model('gpt-6.1-new'));await tick();
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6.1-new');
    expect(document.querySelector<HTMLButtonElement>('#agent-model-row')?.disabled).toBe(false);
    expect(allFrames.filter(f=>['set_model','set_thinking','set_context'].includes(f.type))).toHaveLength(0);
  });

  it('shows an unknown destination instead of carrying the previous model or catalog',async()=>{
    const app=await setup('codex',2);const ws=await app.select('a');
    ws.receive({type:'models',models:[{provider:'codex',id:'gpt-6.1-sol'}],current:{provider:'codex',id:'gpt-6.1-sol'},thinkingLevel:'medium'});await tick();
    app.network.authGate=new Promise<void>(()=>{});choose('c');
    expect(document.querySelector('#agent-name')?.textContent).toBe('模型加载中');
    expect(document.querySelector('#agent-model-value')?.textContent).toBe('—');
    expect(document.querySelector('#agent-menu-btn')?.getAttribute('data-state')).toBeNull();
  });

  it('invalidates a remembered model when workspace metadata proves a different native binding',async()=>{
    const app=await setup('codex',2);const ws=await app.select('a');
    ws.receive({type:'models',models:[],current:{provider:'codex',id:'gpt-6.1-sol'},thinkingLevel:'medium'});await tick();
    await app.select('b');Object.assign(app.conversations[0],{nativeBinding:{id:'replacement-native'}});
    await tick(5100);app.network.authGate=new Promise<void>(()=>{});choose('a');
    expect(document.querySelector('#agent-name')?.textContent).toBe('模型加载中');
  });

  it('never remembers an unconfirmed model choice or carries it across a cookie-account change',async()=>{
    const app=await setup('codex',2);const ws=await app.select('a');
    ws.receive({type:'models',models:[{provider:'codex',id:'gpt-6.1-sol'},{provider:'codex',id:'unconfirmed'}],current:{provider:'codex',id:'gpt-6.1-sol'},thinkingLevel:'medium'});await tick();
    const select=document.querySelector<HTMLSelectElement>('#model')!;select.value='codex/unconfirmed';select.dispatchEvent(new Event('change'));
    await app.select('b');choose('a');
    expect(document.querySelector('#agent-name')?.textContent).toBe('gpt-6.1-sol');
    app.network.user='different-user';await tick(50);
    expect(document.querySelector('#agent-name')?.textContent).not.toBe('gpt-6.1-sol');
    expect(document.querySelector('#agent-model-value')?.textContent).toBe('—');
  });

  it('restores sidebar focus without scrolling back to the busy row on refresh',async()=>{
    const app=await setup('pi',2);await app.select('a');
    const row=document.querySelector<HTMLElement>('#session-list [data-session-id="a"]')!;
    row.focus();
    const focus=vi.spyOn(HTMLElement.prototype,'focus');
    app.sockets.at(-1)!.receive({type:'sessions',sessions:['a','b','c'].map(id=>({id,name:'Conversation '+id,engine:'pi',running:id==='a',createdAt:'2026-10-03T00:00:00Z'}))});
    await tick(32);
    expect(document.activeElement?.getAttribute('data-session-id')).toBe('a');
    expect(focus).toHaveBeenCalledWith({preventScroll:true});
  });

  it('keeps concurrent running conversations in place when their output timestamps alternate',async()=>{
    const app=await setup('codex',2);await app.select('a');
    const ws=app.sockets.at(-1)!;
    const frame=(a:string,b:string)=>({type:'sessions',sessions:[{id:'a',name:'A',engine:'codex',running:true,updatedAt:a},{id:'b',name:'B',engine:'codex',running:true,updatedAt:b}]});
    const order=()=>[...document.querySelectorAll('#session-list .session-item')].map(node=>node.getAttribute('data-session-id')).filter(id=>id==='a'||id==='b');
    ws.receive(frame('2026-10-04T00:00:01Z','2026-10-04T00:00:02Z'));await tick();const original=order();
    ws.receive(frame('2026-10-04T00:00:03Z','2026-10-04T00:00:02Z'));await tick();expect(order()).toEqual(original);
    ws.receive(frame('2026-10-04T00:00:03Z','2026-10-04T00:00:04Z'));await tick();expect(order()).toEqual(original);
    expect(document.querySelectorAll('.sidebar-running-cat')).toHaveLength(2);
  });

  it('links restored V2 upload chips with current grants regardless of arrival order',async()=>{
    const app=await setup('codex',2);const ws=await app.select('a');
    ws.receive({type:'transfer',sessionId:'a',url:'http://files.example',scope:'scope-a',token:'fixture-first'});
    app.syncStates.set('a',{revision:'2',runState:'settled',entries:[{kind:'user',id:'a-upload',entityRevision:'1',text:'Read report\n\n[已上传到工作目录的文件]\n- ../attachments/report.pdf (10 KB)'}]});
    ws.receive({type:'history',...app.snapshot('a')});await tick(100);
    const chip=thread().querySelector<HTMLAnchorElement>('a.file-chip');
    expect(chip?.href).toContain('fixture-first');expect(chip?.href).toContain('report.pdf');
    expect(thread().querySelector('.text')?.textContent).toBe('Read report');
    ws.receive({type:'transfer',sessionId:'a',url:'http://files.example',scope:'scope-a',token:'fixture-renewed'});await tick(32);
    expect(thread().querySelector<HTMLAnchorElement>('a.file-chip')?.href).toContain('fixture-renewed');
    await app.select('b');expect(thread().querySelector('a.file-chip')).toBeNull();
  });

  it('switches on the first pointer gesture while a busy task updates the sidebar', async()=>{
    const app=await setup('codex',2);await app.select('b');await app.select('a',[],true);
    const target=document.querySelector<HTMLElement>('#session-list [data-session-id="b"]')!;
    target.dispatchEvent(new Event('pointerdown',{bubbles:true}));
    app.sockets.at(-1)!.receive({type:'sessions',sessions:['a','b','c'].map(id=>({id,name:'Conversation '+id,engine:'codex',running:id==='a',createdAt:'2026-10-03T00:00:00Z'}))});
    await tick(32);
    expect(target.isConnected,'sidebar refresh detached the row before pointerup').toBe(true);
    target.dispatchEvent(new Event('pointerup',{bubbles:true}));target.click();await tick(32);
    expect(document.querySelector('#session-list [data-session-id="b"]')?.classList.contains('active')).toBe(true);
    expect(thread().textContent).toContain('SYNC-b');
    expect(allFrames.some(frame=>frame.type==='abort')).toBe(false);
  });

  it('retains the already rendered cached view when same-user reconnect authentication finishes',async()=>{
    const app=await setup('codex',2);await app.select('a');await app.select('b');
    let release!:()=>void;app.network.authGate=new Promise<void>(resolve=>{release=resolve;});
    choose('a');await tick(32);const cached=thread().querySelector('.synced-transcript');expect(cached).not.toBeNull();
    release();await tick(64);expect(thread().querySelector('.synced-transcript')).toBe(cached);expect(thread().textContent).toContain('SYNC-a');
  });

  it.each(['pi', 'codex', 'claude'] as const)('bounds %s live deltas and final completion at 45k and 225k', async engine => {
    const app = await setup(engine);
    for (const size of [45_000, 225_000]) {
      const ws = await app.select('a', [], true);
      app.emit(ws, 'a', { type: engine === 'pi' ? 'agent_start' : 'run_started' });
      const text = giant(size, `LIVE-${size}`);
      app.emit(ws, 'a', assistantEvent(engine, text)); await tick();
      expect(thread().textContent).toContain(`LIVE-${size}`);
      expect(thread().textContent!.length, 'one giant live reply has a bounded visible representation').toBeLessThan(20_000);
      for (let index = 0; index < 20; index++) app.emit(ws, 'a', assistantEvent(engine, ` chunk-${index}`));
      draft(`Typing while ${engine} streams`); await tick();
      expect(prompt().value).toBe(`Typing while ${engine} streams`);
      const final = text + ' FINAL-AUTHORITATIVE';
      app.emit(ws, 'a', assistantEvent(engine, final, true));
      app.emit(ws, 'a', { type: engine === 'pi' ? 'agent_settled' : 'run_completed', status: 'completed' }); await tick();
      expect(thread().textContent!.length, 'completion does not restore an unbounded Markdown pass').toBeLessThan(20_000);
      expect(thread().querySelector('img, script, iframe')).toBeNull();
      const answer = thread().querySelector<HTMLElement>('.msg.assistant')!;
      expect(answer.textContent).toContain('FINAL-AUTHORITATIVE');
      // Navigate the real controls: bounded display must not discard the source.
      for (let n = 0; n < 100; n++) { const previous = answer.querySelector<HTMLButtonElement>('[data-text-page="previous"]'); if (!previous || previous.disabled) break; previous.click(); }
      expect(answer.textContent).toContain(`LIVE-${size}`);
      answer.querySelector<HTMLButtonElement>('[data-text-page="latest"]')?.click();
      expect(answer.textContent).toContain('FINAL-AUTHORITATIVE');
      expect(document.querySelector('#stop')!.classList.contains('hidden')).toBe(true);
    }
  });

  it.each(['pi', 'codex', 'claude'] as const)('bounds %s tool updates and completion without losing status', async engine => {
    const app = await setup(engine); const ws = await app.select('a', [], true);
    const result = giant(225_000, 'TOOL-LIVE');
    if (engine === 'pi') {
      app.emit(ws, 'a', { type: 'tool_execution_start', toolCallId: 't', toolName: 'bash', args: { command: 'synthetic output' } });
      app.emit(ws, 'a', { type: 'tool_execution_update', toolCallId: 't', partialResult: { content: [{ type: 'text', text: result }] } });
    } else app.emit(ws, 'a', { type: 'tool_update', id: 't', name: 'bash', args: { command: 'synthetic output' }, result, status: 'inProgress' });
    await tick();
    expect(thread().textContent!.length).toBeLessThan(20_000);
    if (engine === 'pi') app.emit(ws, 'a', { type: 'tool_execution_end', toolCallId: 't', result: { content: [{ type: 'text', text: result + '-DONE' }] } });
    else app.emit(ws, 'a', { type: 'tool_update', id: 't', result: result + '-DONE', status: 'completed' });
    await tick();
    expect(thread().textContent!.length).toBeLessThan(20_000);
    expect(thread().querySelector('.tool .state')?.textContent).toMatch(/^完成(?: · \d+ 字符)?$/);
    const tool = thread().querySelector<HTMLDetailsElement>('.tool')!;
    tool.open = true; tool.dispatchEvent(new Event('toggle')); await tick();
    const source = tool.querySelector<HTMLSelectElement>('.tool-source-select');
    if (source) { source.value = '输出'; source.dispatchEvent(new Event('change')); }
    tool.querySelector<HTMLButtonElement>('[data-text-page="latest"]')?.click();
    expect(tool.textContent, 'the final output remains retrievable rather than being truncated at ingest').toContain('-DONE');
    expect(tool.textContent!.length).toBeLessThan(20_000);
    expect(thread().querySelector('img, script, iframe')).toBeNull();
  });

  it('restores independent drafts and cached views while old and new sockets keep delivering frames', async () => {
    const app = await setup();
    const a = await app.select('a'); draft('draft for A');
    const staleHandler = a.onmessage;
    await app.select('b'); expect(prompt().value).toBe(''); draft('draft for B');
    choose('a');
    expect(thread().textContent).toContain('HISTORY-a');
    expect(prompt().value).toBe('draft for A');
    await tick();
    const active = app.sockets.at(-1)!;
    active.receive({ type: 'opened', engine: 'codex', sessionId: 'a', capabilities, state: { isStreaming: true } });
    active.receive({ type: 'history', sessionId: 'a', entries: [{ kind: 'user', text: 'HISTORY-a' }] });
    app.emit(active, 'a', { type: 'message_delta', id: 'live-answer', delta: giant(225_000, 'LIVE-A') });
    choose('b'); // Deliberately before the queued render's animation frame.
    expect(thread().textContent).toContain('HISTORY-b');
    expect(prompt().value).toBe('draft for B');
    staleHandler({ data: JSON.stringify({ type: 'history', sessionId: 'a', entries: [{ kind: 'assistant', text: 'STALE-A-POISON' }] }) });
    active.receive({ type: 'event', sessionId: 'a', cursor: 999, event: { type: 'message_completed', id: 'live-answer', text: 'LATE-A-POISON' } });
    await tick(1000);
    expect(thread().textContent).toContain('HISTORY-b');
    expect(thread().textContent).not.toMatch(/STALE-A-POISON|LATE-A-POISON|LIVE-A/);
    expect(allFrames.filter(frame => frame.type === 'abort' || frame.type === 'prompt')).toEqual([]);
  });

  it('keeps a 10k-history view bounded and cached navigation usable when the next history never arrives', async () => {
    const app = await setup('pi');
    const history = Array.from({ length: 10_000 }, (_, index) => ({ kind: index % 2 ? 'assistant' : 'user', id: `h-${index}`, text: `history-${index} ` + 'x'.repeat(2000) }));
    await app.select('a', history); await app.select('b');
    choose('a'); await tick(); // Auth succeeds, but no opened/history response follows.
    expect(thread().textContent).toContain('history-9999');
    expect(thread().querySelectorAll('.msg').length).toBeLessThanOrEqual(40);
    expect(thread().textContent!.length, 'forty messages also obey the page byte budget').toBeLessThanOrEqual(65_536 + 1000);
    draft('offline draft'); await tick(11_000);
    expect(prompt().disabled).toBe(false); expect(prompt().value).toBe('offline draft');
    expect(document.querySelector<HTMLButtonElement>('#send')!.disabled).toBe(true);
    choose('b'); expect(thread().textContent).toContain('HISTORY-b');
    choose('a'); expect(prompt().value).toBe('offline draft');
    expect(allFrames.filter(frame => frame.type === 'abort' || frame.type === 'prompt')).toEqual([]);
  });
});


describe('actual app durable sync protocol', () => {
  it('renders negotiated snapshots and later revisions once, with no parallel legacy replay duplication', async () => {
    const app = await setup('codex', 2); const ws = await app.select('a');
    await tick(500);
    expect(thread().textContent).toContain('SYNC-a');
    expect(thread().querySelectorAll('[data-entity-id="a-answer"]')).toHaveLength(1);
    const state = app.syncStates.get('a')!;
    state.revision = '2'; state.entries = [{ kind: 'assistant', id: 'a-answer', entityRevision: '2', text: 'AUTHORITATIVE-UPDATED-A' }];
    ws.receive({ type: 'sync_changed', sessionId: 'a', conversationId: 'a', bindingEpoch: 'epoch-a', headRevision: '2', sourceFreshness: 'current' });
    app.emit(ws, 'a', { type: 'message_delta', id: 'a-answer', delta: 'LEGACY-DUPLICATE-POISON' });
    await tick(500);
    expect(thread().textContent).toContain('AUTHORITATIVE-UPDATED-A');
    expect(thread().textContent).not.toContain('LEGACY-DUPLICATE-POISON');
    expect(thread().querySelectorAll('[data-entity-id="a-answer"]')).toHaveLength(1);
    expect(app.syncReads.some(url => url.includes('/changes?'))).toBe(true);
  });

  it('shows sync feedback for the selected conversation and remains editable when reads hang', async () => {
    const app = await setup('codex', 2); await app.select('a'); await tick(500);
    draft('A draft'); await app.select('b'); await tick(500); draft('B draft');
    app.network.hang = true; choose('a'); await tick(1);
    const status = document.querySelector<HTMLElement>('.conversation-sync-status')!;
    expect(status).not.toBeNull();
    expect(status.dataset.state).toBe('syncing');
    expect(prompt().value).toBe('A draft');
    expect(prompt().disabled).toBe(false);
    await tick(11_000);
    expect(['timeout', 'error', 'offline']).toContain(status.dataset.state);
    expect(status.querySelector('.running-cat')?.getAttribute('data-running')).not.toBe('true');
    expect(thread().textContent).toContain('SYNC-a');
    choose('b'); await tick(1);
    expect(prompt().value).toBe('B draft');
    expect(thread().textContent).toContain('SYNC-b');
    expect(allFrames.filter(frame => frame.type === 'abort' || frame.type === 'prompt')).toEqual([]);
  });
});

it('does not let a late durable sync for A change B content or selected sync feedback', async () => {
  const app = await setup('codex', 2);
  await app.select('a'); await tick(500); await app.select('b'); await tick(500);
  app.network.deferred.set('a', () => {});
  choose('a'); await tick(10);
  const finishA = app.network.deferred.get('a')!;
  app.network.hang = true;
  choose('b'); await tick(100);
  const selectedState = document.querySelector<HTMLElement>('.conversation-sync-status')!.dataset.state;
  const late = { ...app.snapshot('a'), oldestAvailableRevision: '0', sourceFreshness: 'current' };
  app.network.deferred.delete('a'); finishA(new Response(JSON.stringify(late), { status: 200 }));
  await tick(500);
  expect(thread().textContent).toContain('SYNC-b');
  expect(thread().textContent).not.toContain('SYNC-a');
  expect(document.querySelector<HTMLElement>('.conversation-sync-status')!.dataset.state).toBe(selectedState);
});

it('ignores a delayed older page after switching to another durable conversation', async () => {
  const app = await setup('codex', 2); app.syncStates.get('a')!.olderCursor = 'older-a';
  await app.select('a'); await tick(500);
  let finish: ((response: Response) => void) | undefined;
  app.network.custom = url => url.includes('/a/page?cursor=older-a') ? new Promise<Response>(resolve => { finish = resolve; }) : null;
  document.querySelector<HTMLButtonElement>('.history-page-trigger')!.click(); await tick(10);
  expect(finish).toBeTypeOf('function');
  await app.select('b'); await tick(100);
  finish!(new Response(JSON.stringify({ ...app.snapshot('a'), entries: [{ kind: 'assistant', id: 'older-a-entity', entityRevision: '1', text: 'OLD-PAGE-A-POISON' }] }), { status: 200 }));
  await tick(500);
  expect(thread().textContent).toContain('SYNC-b');
  expect(thread().textContent).not.toContain('OLD-PAGE-A-POISON');
});

it('applies deletion to an older message the user is reading instead of leaving a live stale page', async () => {
  const app = await setup('codex', 2); app.syncStates.get('a')!.olderCursor = 'older-a';
  const ws = await app.select('a'); await tick(500);
  app.network.custom = url => url.includes('/a/page?cursor=older-a') ? Promise.resolve(new Response(JSON.stringify({ ...app.snapshot('a'), entries: [{ kind: 'assistant', id: 'older-a-entity', entityRevision: '1', text: 'DELETE-THIS-OLD-MESSAGE' }] }), { status: 200 })) : null;
  document.querySelector<HTMLButtonElement>('.history-page-trigger')!.click(); await tick(150);
  expect(thread().textContent).toContain('DELETE-THIS-OLD-MESSAGE');
  const state = app.syncStates.get('a')!; state.revision = '2';
  state.operations = [{ opId: 'delete-old-a', revision: '2', entityId: 'older-a-entity', entityRevision: '2', type: 'deleteEntity', payload: {} }];
  ws.receive({ type: 'sync_changed', sessionId: 'a', conversationId: 'a', bindingEpoch: 'epoch-a', headRevision: '2', sourceFreshness: 'current' });
  await tick(500);
  expect(thread().textContent).not.toContain('DELETE-THIS-OLD-MESSAGE');
  expect(thread().textContent).toContain('SYNC-a');
});

it('revokes visible cache and drafts on identity change and rejects the old identity late result', async () => {
  const app = await setup('codex', 2); await app.select('a'); await tick(500); draft('PRIVATE-OLD-DRAFT');
  app.network.deferred.set('a', () => {});
  choose('b'); await tick(10); choose('a'); await tick(10);
  const finish = app.network.deferred.get('a')!;
  app.network.user = 'different-synthetic-user';
  window.dispatchEvent(new StorageEvent('storage', { key: 'pi-coffee.preview-clear.v1', newValue: 'identity:changed' }));
  await tick(100);
  expect(prompt().value).toBe(''); expect(thread().textContent).not.toContain('SYNC-a');
  app.network.deferred.delete('a'); finish(new Response(JSON.stringify({ ...app.snapshot('a'), oldestAvailableRevision: '0' }), { status: 200 }));
  await tick(500);
  expect(prompt().value).toBe(''); expect(thread().textContent).not.toMatch(/SYNC-a|PRIVATE-OLD-DRAFT/);
});


it('rejects an obsolete A socket after rapid A to B to A navigation', async () => {
  const app = await setup(); const old = await app.select('a'); const late = old.onmessage;
  await app.select('b'); await app.select('a', [{ kind: 'assistant', id: 'latest-a', text: 'CURRENT-A-GENERATION' }]);
  late({ data: JSON.stringify({ type: 'history', sessionId: 'a', entries: [{ kind: 'assistant', id: 'stale-a', text: 'OBSOLETE-SAME-CONVERSATION' }] }) });
  await tick(100);
  expect(thread().textContent).toContain('CURRENT-A-GENERATION');
  expect(thread().textContent).not.toContain('OBSOLETE-SAME-CONVERSATION');
});

it('shows one newly accepted prompt from the durable index and never resends it during navigation', async () => {
  const app = await setup('codex', 2); const ws = await app.select('a'); await tick(200);
  draft('ONE-AUTHORITATIVE-USER-PROMPT');
  document.querySelector('#composer')!.dispatchEvent(new Event('submit', { cancelable: true }));
  const commands = allFrames.filter(frame => frame.type === 'prompt');
  expect(commands).toHaveLength(1); expect(commands[0].text).toBe('ONE-AUTHORITATIVE-USER-PROMPT');
  ws.receive({ type: 'ack', sessionId: 'a', operation: 'prompt', requestId: commands[0].requestId });
  const state = app.syncStates.get('a')!; state.revision = '2';
  const entry = { kind: 'user', id: 'new-user-message', entityRevision: '2', text: 'ONE-AUTHORITATIVE-USER-PROMPT' };
  state.entries.push(entry);
  state.operations = [{ opId: 'new-user-op', revision: '2', entityId: entry.id, entityRevision: '2', type: 'replaceText', payload: { entry, isNew: true } }];
  ws.receive({ type: 'sync_changed', sessionId: 'a', conversationId: 'a', bindingEpoch: 'epoch-a', headRevision: '2', sourceFreshness: 'current' });
  await tick(500);
  expect(thread().textContent!.split('ONE-AUTHORITATIVE-USER-PROMPT')).toHaveLength(2);
  expect(thread().querySelectorAll('[data-entity-id="new-user-message"]')).toHaveLength(1);
  choose('b'); await tick(40); choose('a'); await tick(50);
  expect(allFrames.filter(frame => frame.type === 'prompt')).toHaveLength(1);
});

it('revokes cached transcript and draft on sync401 while socket stays open',async()=>{const app=await setup('codex',2);const ws=await app.select('a');await tick(500);draft('PRIVATE-401-DRAFT');expect(thread().textContent).toContain('SYNC-a');app.network.custom=()=>Promise.resolve(new Response('{}',{status:401}));ws.receive({type:'sync_changed',sessionId:'a',conversationId:'a',bindingEpoch:'epoch-a',headRevision:'2',sourceFreshness:'current'});await tick(500);expect(thread().textContent).not.toContain('SYNC-a');expect(prompt().value).toBe('');});

it('shows a newly created durable conversation without manual sidebar reselection', async () => {
  const app = await setup('codex', 2);
  const fetcher = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url === '/api/workspace' && body.action === 'conversation') return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'a' }) } as Response);
    return fetcher(url, init);
  });
  document.querySelector<HTMLButtonElement>('#new-task')!.click(); await tick(50);
  document.querySelector<HTMLSelectElement>('#task-kind')!.value = 'chat';
  document.querySelector<HTMLButtonElement>('#create-task')!.click(); await tick(100);
  expect(allFrames.filter(frame => frame.type === 'open').at(-1)?.sessionId).toBe('a');
  const ws = app.sockets.at(-1)!;
  ws.receive({ type: 'opened', syncProtocol: 2, engine: 'codex', sessionId: 'a', bindingEpoch: 'epoch-a', capabilities, state: { isStreaming: false } });
  ws.receive({ type: 'history', ...app.snapshot('a') }); await tick(500);
  expect(thread().textContent).toContain('SYNC-a');
});

it('retains uncertain prompt recovery across durable conversation switches and root replacement', async () => {
  const app = await setup('codex', 2); await app.select('a'); await tick(500);
  draft('UNACKNOWLEDGED-PROMPT-TO-RECOVER');
  document.querySelector('#composer')!.dispatchEvent(new Event('submit', { cancelable: true }));
  expect(allFrames.filter(frame => frame.type === 'prompt')).toHaveLength(1);
  await app.select('b'); await app.select('a'); await tick(500);
  expect(thread().textContent).toContain('UNACKNOWLEDGED-PROMPT-TO-RECOVER');
  const recover = [...thread().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '恢复到输入框');
  expect(recover).toBeTruthy(); recover!.click();
  expect(prompt().value).toBe('UNACKNOWLEDGED-PROMPT-TO-RECOVER');
  expect(allFrames.filter(frame => frame.type === 'prompt')).toHaveLength(1);
});

it('restores the older visible window when switching away and back', async () => {
  const app = await setup('codex', 2); app.syncStates.get('a')!.olderCursor = 'older-a';
  await app.select('a'); await tick(500);
  app.network.custom = url => url.includes('/a/page?cursor=older-a') ? Promise.resolve(new Response(JSON.stringify({ ...app.snapshot('a'), olderCursor: null, entries: [{ kind: 'assistant', id: 'older-a-entity', entityRevision: '1', text: 'RETURN-TO-THIS-OLDER-PAGE' }] }), { status: 200 })) : null;
  document.querySelector<HTMLButtonElement>('.history-page-trigger')!.click(); await tick(150);
  expect(thread().textContent).toContain('RETURN-TO-THIS-OLDER-PAGE');
  await app.select('b'); await app.select('a'); await tick(500);
  expect(thread().textContent).toContain('RETURN-TO-THIS-OLDER-PAGE');
});

it.each(['inProgress', 'completed'])('loads tool arguments and diff on demand while preserving the %s tool card', async status => {
  const app = await setup('codex', 2);
  const state = app.syncStates.get('a')!;
  const fields: Record<string, string> = { args: '{"command":"VISIBLE-DEMAND-COMMAND"}', result: 'bounded result', diff: '- before\n+ VISIBLE-DEMAND-DIFF' };
  state.entries = [{ kind: 'tool', id: 'paged-tool', entityRevision: '1', name: 'bash', status, result: fields.result, contentTruncated: true, contentLength: fields.result.length, contentLengths: Object.fromEntries(Object.entries(fields).map(([field, text]) => [field, text.length])) }];
  app.network.custom = url => {
    if (!url.includes('/a/content?')) return null;
    const query = new URL(url, 'http://localhost').searchParams, field = query.get('field')!;
    const text = fields[field], offset = Number(query.get('offset'));
    return Promise.resolve(new Response(JSON.stringify({ ...app.snapshot('a'), entityId: 'paged-tool', entityRevision: '1', field, encoding: 'utf-16', offset, nextOffset: offset + text.length, totalLength: text.length, text }), { status: 200 }));
  };
  await app.select('a'); await tick(500);
  expect(app.syncReads.some(url => url.includes('/content?'))).toBe(false);
  const card = thread().querySelector<HTMLDetailsElement>('[data-entity-id="paged-tool"]')!;
  card.open = true; card.dispatchEvent(new Event('toggle')); await tick();
  for (const [field, marker] of [['args', 'VISIBLE-DEMAND-COMMAND'], ['diff', 'VISIBLE-DEMAND-DIFF']]) {
    const source = card.querySelector<HTMLSelectElement>('.remote-content-source');
    expect(source).toBeTruthy(); source!.value = field; source!.dispatchEvent(new Event('change')); await tick(150);
    expect(card.textContent).toContain(marker);
    expect(card.querySelector('summary'), 'lazy remote content must retain tool identity and open/close controls').not.toBeNull();
    expect(card.querySelector('.state')?.textContent).toContain(status === 'inProgress' ? '运行中' : '完成');
  }
});

it('updates a durable live tail during an unbroken sequence of sync hints',async()=>{
 const app=await setup('codex',2),ws=await app.select('a');await tick(500);
 const state=app.syncStates.get('a')!;state.revision='2';state.entries=[{kind:'assistant',id:'a-answer',entityRevision:'2',text:'VISIBLE-DURING-UNBROKEN-STREAM'}];
 for(let i=0;i<10;i++){ws.receive({type:'sync_changed',sessionId:'a',conversationId:'a',bindingEpoch:'epoch-a',headRevision:'2',sourceFreshness:'current'});await tick(20);}
 expect(thread().textContent).toContain('VISIBLE-DURING-UNBROKEN-STREAM');
});
it('binds negotiated task commands to their selected conversation and durable epoch',async()=>{
 const app=await setup('codex',2);await app.select('a');await tick(500);draft('Explicit scoped prompt');document.querySelector('#composer')!.dispatchEvent(new Event('submit',{cancelable:true}));
 expect(allFrames.find(frame=>frame.type==='prompt')).toMatchObject({conversationId:'a',bindingEpoch:'epoch-a',text:'Explicit scoped prompt'});
 document.querySelector<HTMLButtonElement>('#stop')!.click();expect(allFrames.find(frame=>frame.type==='abort')).toMatchObject({conversationId:'a',bindingEpoch:'epoch-a'});
});
it('rechecks identity before attaching after a cookie-account change without a logout broadcast',async()=>{
 const app=await setup('codex',2);await app.select('a');await tick(500);draft('ACCOUNT-A-UNSENT');
 let release!:()=>void;app.network.authGate=new Promise<void>(resolve=>release=resolve);app.network.user='account-b';
 // Keep read-only transport pending so only the attachment identity check can
 // discover the new login; no storage logout notification is sent.
 app.network.hang=true;const count=app.sockets.length;choose('b');await tick(50);expect(app.sockets.length).toBe(count);
 release();await tick(100);expect(app.sockets.length).toBeGreaterThan(count);expect(prompt().value).toBe('');expect(thread().textContent).not.toContain('SYNC-a');
 // Only fresh account-B metadata may repopulate the cleared sidebar.
 app.sockets.at(-1)!.receive({type:'sessions',sessions:app.conversations});await tick(50);
 choose('a');await tick(100);expect(prompt().value).not.toContain('ACCOUNT-A-UNSENT');
});

it('collapses finished live tool activity when the Agent resumes dialogue',async()=>{
 const app=await setup('codex',1),ws=await app.select('a');
 app.emit(ws,'a',{type:'tool_update',id:'fold-tool',name:'bash',args:{command:'echo fixture'},result:'working',status:'inProgress'});await tick();
 const group=thread().querySelector<HTMLDetailsElement>('details.activity')!;expect(group.open).toBe(true);
 app.emit(ws,'a',{type:'tool_update',id:'fold-tool',name:'bash',result:'done',status:'completed'});
 app.emit(ws,'a',assistantEvent('codex','Here is the answer',true));await tick();
 expect(thread().textContent).toContain('Here is the answer');expect(group.open).toBe(false);
});

it('refreshes workspace conversation activity even while the new-conversation composer is selected',async()=>{
 const app=await setup('codex',2);vi.mocked(fetch).mockClear();
 app.sockets.at(-1)!.receive({type:'sessions',sessions:app.conversations});await tick();
 expect(vi.mocked(fetch).mock.calls.some(([url,init])=>url==='/api/workspace'&&!init?.body)).toBe(true);
 expect(allFrames.some(frame=>frame.type==='open')).toBe(false);
});
it('clears previous-account sidebar metadata immediately while the next workspace response is delayed',async()=>{
 const app=await setup('codex',2);await app.select('a');await tick(500);
 expect(document.querySelector('[data-session-id="c"]')?.textContent).toContain('Conversation c');
 let release!:()=>void;app.network.authGate=new Promise<void>(resolve=>{release=resolve;});
 app.network.user='account-b';app.network.workspaceGate=new Promise<void>(()=>{});app.network.hang=true;
 choose('b');await tick(30);
 document.querySelector('[data-session-id="c"] .more')!.dispatchEvent(new Event('pointerdown',{bubbles:true}));
 document.querySelector<HTMLButtonElement>('[data-session-id="c"] .more')!.click();
 release();await tick(100);
 expect(document.querySelector('[data-session-id="a"]')).toBeNull();
 expect(document.querySelector('[data-session-id="c"]')).toBeNull();
 expect(document.querySelector('#session-list')?.textContent).not.toContain('Conversation');
});

// Attachment drafts use the same real controller boundary as text drafts.
const attachmentNames=()=>[...document.querySelectorAll('#attachments .upload-name')].map(n=>n.textContent);
function chooseAttachment(name:string){
 const input=document.querySelector<HTMLInputElement>('#file')!;
 Object.defineProperty(input,'files',{configurable:true,value:[new File(['synthetic'],name,{type:'text/plain'})]});
 input.dispatchEvent(new Event('change'));
}
it.each(['pi','codex'] as const)('keeps unsent attachments and text with their original %s conversation, including immediate selection',async engine=>{
 const app=await setup(engine);await app.select('a');draft('A draft');chooseAttachment('a.txt');
 expect(attachmentNames()).toEqual(['a.txt']);
 const switchToB=app.select('b');expect(attachmentNames()).toEqual([]);await switchToB;
 draft('B draft');chooseAttachment('b.txt');await app.select('a');
 expect(prompt().value).toBe('A draft');expect(attachmentNames()).toEqual(['a.txt']);
 document.querySelector<HTMLButtonElement>('#attachments .attachment-remove')!.click();
 await app.select('b');expect(attachmentNames()).toEqual(['b.txt']);expect(prompt().value).toBe('B draft');
 await app.select('a');expect(attachmentNames()).toEqual([]);
 expect(allFrames.filter(f=>['prompt','steer','follow_up'].includes(f.type))).toEqual([]);
 expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/prepare-upload'))).toBe(false);
});
it('isolates the new-task attachment draft and removes all account-owned drafts on logout',async()=>{
 const app=await setup();await app.select('a');chooseAttachment('a.txt');
 document.querySelector<HTMLButtonElement>('#new-task')!.click();await tick();
 expect(attachmentNames()).toEqual([]);draft('New draft');chooseAttachment('new.txt');await app.select('a');expect(attachmentNames()).toEqual(['a.txt']);
 document.querySelector<HTMLButtonElement>('#new-task')!.click();await tick();expect(attachmentNames()).toEqual(['new.txt']);expect(prompt().value).toBe('New draft');
 window.dispatchEvent(new StorageEvent('storage',{key:'pi-coffee.preview-clear.v1',newValue:'identity:logout'}));await tick();expect(attachmentNames()).toEqual([]);
 await app.select('a');expect(attachmentNames()).toEqual([]);
});
it('clears both active and saved attachment drafts when authentication changes users',async()=>{
 const app=await setup();await app.select('a');chooseAttachment('alice-a.txt');await app.select('b');chooseAttachment('alice-b.txt');
 app.network.user='another-synthetic-user';app.sockets.at(-1)!.onclose({code:1006});await tick(2000);
 expect(attachmentNames()).toEqual([]);app.sockets.at(-1)!.receive({type:'sessions',sessions:app.conversations});await tick();await app.select('a');expect(attachmentNames()).toEqual([]);await app.select('b');expect(attachmentNames()).toEqual([]);
});
