// @vitest-environment jsdom
// Run the real app controller and renderers through its public DOM/transport seams.
// Transport fixtures are synthetic; these are correctness tests, not browser SLOs.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type Engine = 'pi' | 'codex' | 'claude';
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
  localStorage.clear(); sessionStorage.clear(); vi.resetModules(); allFrames.length = 0;
});
async function setup(engine: Engine = 'codex', protocol: 1 | 2 = 1) {
  const originalAdd = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, 'addEventListener').mockImplementation(function (this: EventTarget, type: string, listener: any, options: any) { listeners.push([this, type, listener, options]); originalAdd.call(this, type, listener, options); });
  document.documentElement.innerHTML = readFileSync('public/index.html', 'utf8');
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {} }) });
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const conversations = ['a', 'b', 'c'].map(id => ({ id, name: `Conversation ${id}`, engine, workspaceKind: engine === 'pi' ? 'chat' : 'work', createdAt: '2026-10-03T00:00:00Z' }));
  const syncReads: string[] = [];
  const syncStates = new Map<string, any>(conversations.map(c => [c.id, { revision: '1', runState: 'running', entries: [{ kind: 'assistant', id: c.id + '-answer', entityRevision: '1', text: 'SYNC-' + c.id }] }]));
  const network = { authGate:null as Promise<void>|null, user: 'synthetic-local-first-user', custom: null as null | ((url: string) => any), hang: false, deferred: new Map<string, (response: Response) => void>() };
  const snapshot = (id: string) => { const state = syncStates.get(id)!; return { syncProtocol: 2, userScope:network.user, conversationId: id, sessionId: id, bindingEpoch: 'epoch-' + id, snapshotId: 'snapshot-' + id + '-' + state.revision, baseRevision: state.revision, headRevision: state.revision, olderCursor: state.olderCursor || null, sourceFreshness: 'current', runState: state.runState, entries: state.entries }; };
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
    else if (url === '/api/engines') data = { engines: ['pi', 'codex', 'claude'].map(id => ({ id, available: true })) };
    else if (url === '/api/workspace') data = ['files', 'changes'].includes(body.action) ? { state: 'local', files: [] } : { projects: [], conversations, sidebar: { assignments: {}, collapsed: [] }, capabilities: { chatWorkspaces: true } };
    // Unknown read-only sync is held, never mistaken for a valid empty snapshot.
    else if (String(url).includes('/api/conversations/')) {
      syncReads.push(String(url));
      if (protocol === 1 || network.hang) return new Promise(() => {});
      const custom = network.custom?.(String(url)); if (custom) return custom;
      const match = String(url).match(/\/api\/conversations\/([^/]+)\/(meta|page|changes|content)/)!;
      const id = match[1], action = match[2], state = syncStates.get(id)!;
      if (network.deferred.has(id)) return new Promise<Response>(resolve => network.deferred.set(id, resolve));
      if (action === 'meta') data = { ...snapshot(id), oldestAvailableRevision: '0', lastSourceCheckAt: '2026-10-03T00:00:00Z' };
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
  return { sockets, select, emit, engine, network, snapshot, syncStates, syncReads };
}
function assistantEvent(engine: Engine, text: string, complete = false) {
  if (engine !== 'pi') return complete ? { type: 'message_completed', id: 'live-answer', text } : { type: 'message_delta', id: 'live-answer', delta: text };
  return complete ? { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }] } } : { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text } };
}

describe('actual app local-first live output', () => {
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
