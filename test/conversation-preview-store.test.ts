import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
// @ts-expect-error browser module
import { ConversationPreviewStore, createConversationPreview } from '../public/conversation-preview-store.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const snapshot = (text = 'cached reply') => ({ entries: [{ kind: 'assistant', text }], scroll: 42, truncated: false });

async function openDatabase(indexedDB: IDBFactory, dbName = 'pi-coffee-conversation-previews') {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(database: IDBDatabase, mutate: (transaction: IDBTransaction) => void) {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['previews', 'metadata'], 'readwrite');
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    mutate(transaction);
  });
}

describe('plain-text conversation preview projection', () => {
  it('projects only inert text and scroll, without retaining controller objects', () => {
    const controller = [
      { k: 'user', text: 'question', images: ['private image'], node: { html: '<button>action</button>' } },
      { k: 'assistant', text: 'answer', action: () => {} },
      { k: 'tool', name: 'read', result: 'file contents', args: { token: 'not cached' } },
      { k: 'note', text: 'finished', failure: true },
    ];
    expect(createConversationPreview(controller, 24)).toEqual({
      entries: [
        { kind: 'user', text: 'question' }, { kind: 'assistant', text: 'answer' },
        { kind: 'tool', text: 'read\nfile contents' }, { kind: 'note', text: 'finished' },
      ], scroll: 24, truncated: false,
    });
    expect(createConversationPreview(controller, Number.NaN).scroll).toBe(0);
    expect(createConversationPreview([], -20).scroll).toBe(0);
  });

  it('retains long individual messages and 10,000 most recent entries', () => {
    const text = 'long reply '.repeat(20_000);
    expect(createConversationPreview([{ k: 'assistant', text }], 0).entries[0].text).toBe(text);
    const preview = createConversationPreview(Array.from({ length: 10_003 }, (_, i) => ({ k: 'user', text: String(i) })), 12);
    expect(preview.entries).toHaveLength(10_000);
    expect(preview.entries[0].text).toBe('3');
    expect(preview.entries.at(-1).text).toBe('10002');
    expect(preview.truncated).toBe(true);
  });

  it('bounds the latest text by four Mi characters without splitting surrogate pairs', () => {
    const preview = createConversationPreview([
      { k: 'user', text: 'oldest' },
      { k: 'assistant', text: '😀'.repeat(2 * 1024 * 1024) + 'z' },
    ], 99);
    expect(preview.entries).toHaveLength(1);
    expect(preview.entries[0].text.length).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(preview.entries[0].text.startsWith('😀')).toBe(true);
    expect(preview.entries[0].text.endsWith('z')).toBe(true);
    expect(preview.truncated).toBe(true);
  });

  it('does not serialize objects supplied as tool results or unsupported entries', () => {
    const result = { toJSON: vi.fn(() => 'secret') };
    const preview = createConversationPreview([{ k: 'tool', name: 'read', result }, { k: 'action', text: 'not safe' }], 0);
    expect(preview.entries).toEqual([{ kind: 'tool', text: 'read' }]);
    expect(result.toJSON).not.toHaveBeenCalled();
    expect(preview.truncated).toBe(true);
  });
});

describe('persistent conversation previews', () => {
  it('round-trips across instances, isolates users and delimiter-containing IDs, and copies data', async () => {
    const indexedDB = new IDBFactory();
    const first = new ConversationPreviewStore({ indexedDB });
    const data = { ...snapshot(), fingerprint: 'codex:native-id', actions: ['never retained'] };
    expect(await first.put('alice', 'task', data)).toBe(true);
    data.entries[0].text = 'mutated input';
    const second = new ConversationPreviewStore({ indexedDB });
    expect(await second.get('bob', 'task')).toBeUndefined();
    expect(await second.get('alice', 'task')).toEqual({ ...snapshot(), fingerprint: 'codex:native-id' });
    const read = await second.get('alice', 'task');
    read.entries[0].text = 'mutated result';
    expect(await first.get('alice', 'task')).toEqual({ ...snapshot(), fingerprint: 'codex:native-id' });
    await first.put('a:b', 'c', snapshot('first'));
    await first.put('a', 'b:c', snapshot('second'));
    expect((await second.get('a:b', 'c')).entries[0].text).toBe('first');
    expect((await second.get('a', 'b:c')).entries[0].text).toBe('second');
  });

  it('retains all five multi-megabyte conversations by default', async () => {
    const indexedDB = new IDBFactory();
    const store = new ConversationPreviewStore({ indexedDB });
    const text = 'x'.repeat(2 * 1024 * 1024);
    for (let i = 0; i < 5; i++) expect(await store.put('alice', String(i), snapshot(`${i}${text}`))).toBe(true);
    const reopened = new ConversationPreviewStore({ indexedDB });
    for (let i = 0; i < 5; i++) {
      const preview = await reopened.get('alice', String(i));
      expect(preview.entries[0].text).toBe(`${i}${text}`);
      expect(preview.truncated).toBe(false);
    }
  });

  it('evicts by LRU count and exact serialized byte budget', async () => {
    const store = new ConversationPreviewStore({ indexedDB: new IDBFactory(), maxEntries: 2 });
    await store.put('alice', 'a', snapshot('a'));
    await store.put('alice', 'b', snapshot('b'));
    await store.get('alice', 'a');
    await store.put('alice', 'c', snapshot('c'));
    expect(await store.get('alice', 'b')).toBeUndefined();
    expect(await store.get('alice', 'a')).toEqual(snapshot('a'));
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot('x'.repeat(30)))).byteLength;
    const bounded = new ConversationPreviewStore({ indexedDB: new IDBFactory(), maxBytes: bytes * 2, maxEntries: 5 });
    for (const id of ['a', 'b', 'c']) await bounded.put('alice', id, snapshot('x'.repeat(30)));
    expect(await bounded.get('alice', 'a')).toBeUndefined();
    expect(await bounded.get('alice', 'b')).toBeDefined();
    expect(await bounded.get('alice', 'c')).toBeDefined();
  });

  it('bounds serialized bytes including Unicode and JSON escapes, preserving newest text', async () => {
    const store = new ConversationPreviewStore({ indexedDB: new IDBFactory(), maxSnapshotBytes: 250 });
    await store.put('alice', 'task', snapshot('😀\u0000"\\'.repeat(500) + 'newest'));
    const preview = await store.get('alice', 'task');
    expect(new TextEncoder().encode(JSON.stringify(preview)).byteLength).toBeLessThanOrEqual(250);
    expect(preview.entries[0].text.endsWith('newest')).toBe(true);
    expect(preview.truncated).toBe(true);
  });

  it('expires after 24 hours, without refreshing the TTL on read', async () => {
    let now = 100;
    const store = new ConversationPreviewStore({ indexedDB: new IDBFactory(), now: () => now });
    await store.put('alice', 'task', snapshot());
    now += 24 * 60 * 60 * 1000 - 1;
    expect(await store.get('alice', 'task')).toBeDefined();
    now++;
    expect(await store.get('alice', 'task')).toBeUndefined();
  });

  it('does not open IndexedDB for missing or empty authenticated user scopes', async () => {
    const indexedDB = { open: vi.fn(() => { throw new Error('must not open'); }) };
    const store = new ConversationPreviewStore({ indexedDB });
    for (const user of [null, undefined, '', '   ', 1]) {
      expect(await store.get(user, 'task')).toBeUndefined();
      expect(await store.put(user, 'task', snapshot())).toBe(false);
      expect(await store.delete(user, 'task')).toBe(false);
    }
    expect(indexedDB.open).not.toHaveBeenCalled();
  });

  it('delete and clear cancel older queued writes and reads, including across instances', async () => {
    const indexedDB = new IDBFactory();
    const store = new ConversationPreviewStore({ indexedDB });
    const other = new ConversationPreviewStore({ indexedDB });
    await store.put('alice', 'keep', snapshot('keep'));
    const oldPut = store.put('alice', 'task', snapshot());
    const oldGet = store.get('alice', 'task');
    const deletion = other.delete('alice', 'task');
    expect(await oldPut).toBe(false);
    expect(await oldGet).toBeUndefined();
    expect(await deletion).toBe(true);
    expect(await store.get('alice', 'task')).toBeUndefined();
    expect(await store.get('alice', 'keep')).toEqual(snapshot('keep'));
    const oldRead = store.get('alice', 'keep');
    const pendingWrite = other.put('alice', 'new', snapshot());
    expect(await store.clear()).toBe(true);
    expect(await oldRead).toBeUndefined();
    expect(await pendingWrite).toBe(false);
    expect(await other.get('alice', 'keep')).toBeUndefined();
    expect(await other.get('alice', 'new')).toBeUndefined();
    expect(await store.put('alice', 'new', snapshot('after clear'))).toBe(true);
    expect(await other.get('alice', 'new')).toEqual(snapshot('after clear'));
  });

  it('treats unavailable or throwing storage and malformed input as cache misses', async () => {
    for (const indexedDB of [null, {}, { open() { throw new Error('SecurityError'); } }]) {
      const store = new ConversationPreviewStore({ indexedDB });
      expect(await store.get('alice', 'task')).toBeUndefined();
      expect(await store.put('alice', 'task', snapshot())).toBe(false);
      expect(await store.delete('alice', 'task')).toBe(false);
      expect(await store.clear()).toBe(false);
    }
    const store = new ConversationPreviewStore({ indexedDB: new IDBFactory() });
    expect(await store.put('alice', 'task', { entries: [{ kind: 'action', text: 'no' }], scroll: 0, truncated: false })).toBe(false);
    expect(await store.put('alice', 'task', { ...snapshot(), fingerprint: 'x'.repeat(1025) })).toBe(false);
    expect(await store.put('alice', 'task', { ...snapshot(), scroll: Infinity })).toBe(false);
  });

  it('rejects and removes corrupt snapshots, mismatched byte counts and schema versions', async () => {
    const indexedDB = new IDBFactory();
    const store = new ConversationPreviewStore({ indexedDB });
    await store.put('alice', 'task', snapshot());
    const database = await openDatabase(indexedDB);
    const key = JSON.stringify(['alice', 'task']);
    for (const corrupt of [
      { key, version: 1, snapshot: { ...snapshot(), entries: [{ kind: 'action', text: 'bad' }] } },
      { key, version: 1, snapshot: snapshot('wrong byte count') },
      { key, version: 99, snapshot: snapshot() },
      { key, version: 1, snapshot: { ...snapshot(), scroll: Infinity } },
    ]) {
      await store.put('alice', 'task', snapshot());
      await transaction(database, tx => { tx.objectStore('previews').put(corrupt); });
      expect(await store.get('alice', 'task')).toBeUndefined();
      await transaction(database, tx => {
        for (const name of ['previews', 'metadata']) {
          const request = tx.objectStore(name).get(key);
          request.onsuccess = () => expect(request.result).toBeUndefined();
        }
      });
    }
    database.close();
  });

  it('returns false on quota failure and rolls back eviction atomically', async () => {
    const store = new ConversationPreviewStore({ indexedDB: new IDBFactory(), maxEntries: 1 });
    await store.put('alice', 'keep', snapshot('keep'));
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'previews') throw new DOMException('Disk quota exceeded', 'QuotaExceededError');
      return original.call(this, value, key);
    });
    expect(await store.put('alice', 'new', snapshot('new'))).toBe(false);
    put.mockRestore();
    expect(await store.get('alice', 'keep')).toEqual(snapshot('keep'));
    expect(await store.get('alice', 'new')).toBeUndefined();
    expect(await store.put('alice', 'new', snapshot('retry'))).toBe(true);
  });

  it('cancels reads and writes after their IndexedDB transaction has already started', async () => {
    const indexedDB = new IDBFactory();
    const store = new ConversationPreviewStore({ indexedDB });
    const other = new ConversationPreviewStore({ indexedDB });
    await store.put('alice', 'task', snapshot());
    let clearing: Promise<boolean> | undefined;
    const originalGet = IDBObjectStore.prototype.get;
    const get = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
      const request = originalGet.call(this, key);
      if (this.name === 'previews') clearing = other.clear();
      return request;
    });
    expect(await store.get('alice', 'task')).toBeUndefined();
    expect(await clearing).toBe(true);
    get.mockRestore();
    expect(await store.get('alice', 'task')).toBeUndefined();
    let deleting: Promise<boolean> | undefined;
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = originalPut.call(this, value, key);
      if (this.name === 'previews') deleting = other.delete('alice', 'task');
      return request;
    });
    expect(await store.put('alice', 'task', snapshot())).toBe(false);
    expect(await deleting).toBe(true);
    put.mockRestore();
    expect(await store.get('alice', 'task')).toBeUndefined();
  });

  it('closes late connections after a blocked open and bounds hanging opens', async () => {
    let request: any;
    const indexedDB = { open: vi.fn(() => (request = {})) };
    const store = new ConversationPreviewStore({ indexedDB, timeoutMs: 25 });
    const blocked = store.get('alice', 'task');
    await Promise.resolve();
    request.onblocked();
    expect(await blocked).toBeUndefined();
    request.result = { close: vi.fn() };
    request.onsuccess();
    expect(request.result.close).toHaveBeenCalledOnce();
    vi.useFakeTimers();
    const hanging = store.put('alice', 'task', snapshot());
    await vi.advanceTimersByTimeAsync(26);
    expect(await hanging).toBe(false);
  });

  it('bounds hanging transactions and aborts them before returning a cache miss', async () => {
    vi.useFakeTimers();
    const transaction = { objectStore: () => ({ getAll: () => ({}) }), abort: vi.fn() };
    const database = { transaction: () => transaction };
    const indexedDB = { open: () => {
      const request: any = { result: database };
      queueMicrotask(() => request.onsuccess());
      return request;
    } };
    const store = new ConversationPreviewStore({ indexedDB, timeoutMs: 25 });
    const reading = store.get('alice', 'task');
    await vi.advanceTimersByTimeAsync(26);
    expect(await reading).toBeUndefined();
    expect(transaction.abort).toHaveBeenCalledOnce();
  });

  it('reads only the selected large snapshot and updates only small LRU metadata', async () => {
    const store = new ConversationPreviewStore({ indexedDB: new IDBFactory() });
    for (let i = 0; i < 5; i++) await store.put('alice', String(i), snapshot('x'.repeat(200_000)));
    const get = vi.spyOn(IDBObjectStore.prototype, 'get');
    const all = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    expect(await store.get('alice', '2')).toBeDefined();
    expect(get).toHaveBeenCalledExactlyOnceWith(JSON.stringify(['alice', '2']));
    expect(all.mock.contexts.map(store => store.name)).toEqual(['metadata']);
    expect(put.mock.contexts.map(store => store.name)).toEqual(['metadata']);
  });
});
