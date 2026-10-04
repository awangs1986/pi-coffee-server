import { BoundedReadPool, SyncWorkerPool, SyncError } from './sync-worker.js';
import { syncDigest } from './sync-digest.js';

const encoder = new TextEncoder();
const PAGE_BYTES = 64 * 1024, BLOCK_BYTES = 8 * 1024, QUEUE_BYTES = 256 * 1024;
const KINDS = new Set(['user', 'assistant', 'tool', 'note']);
const STORES = ['manifests', 'entities', 'pages', 'receipts', 'budgets'];
function defaultIndexedDB() { try { return globalThis.indexedDB; } catch { return undefined; } }
const keyFor = (...parts) => JSON.stringify(parts);
const bytes = value => encoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
const revision = value => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) throw new SyncError('invalid_revision');
  return value;
};
export function compareRevision(a, b) { revision(a); revision(b); return a.length === b.length ? (a === b ? 0 : a < b ? -1 : 1) : a.length < b.length ? -1 : 1; }
const nextRevision = value => (BigInt(revision(value)) + 1n).toString();
function prefix(text, limit = BLOCK_BYTES) {
  // Never encode/copy an entire oversized message just to retain its first block.
  let end = Math.min(text.length, limit), start = 0;
  while (start < end) { const mid = Math.ceil((start + end) / 2); if (bytes(text.slice(0, mid)) <= limit) start = mid; else end = mid - 1; }
  if (start && /[\uD800-\uDBFF]/.test(text[start - 1]) && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  return text.slice(0, start);
}
function suffix(text, limit = BLOCK_BYTES) {
  let start = Math.max(0, text.length - limit), end = text.length;
  while (start < end) { const mid = Math.floor((start + end) / 2); if (bytes(text.slice(mid)) <= limit) end = mid; else start = mid + 1; }
  if (start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  return text.slice(start);
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Cache only inert display data. Tool arguments, file grants and approvals are never cached. */
export function displayEntity(entry) {
  if (!entry || !KINDS.has(entry.kind) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 1024) throw new SyncError('invalid_entity');
  const entityRevision = revision(entry.entityRevision), text = entry.kind === 'tool' ? (typeof entry.result === 'string' ? entry.result : '') : (typeof entry.text === 'string' ? entry.text : '');
  const short = suffix(text), initialOffset = Number.isSafeInteger(entry.contentOffset) && entry.contentOffset >= 0 ? entry.contentOffset : 0;
  const contentLength = Number.isSafeInteger(entry.contentLength) && entry.contentLength >= initialOffset + text.length ? entry.contentLength : initialOffset + text.length;
  const contentOffset = initialOffset + text.length - short.length;
  const value = { id: entry.id, kind: entry.kind, entityRevision, text: short, contentOffset,
    contentTruncated: entry.contentTruncated === true || contentOffset > 0 || contentOffset + short.length < contentLength, contentLength };
  if (entry.kind === 'tool') { value.name = prefix(typeof entry.name === 'string' ? entry.name : '', 512); value.result = short; value.isError = entry.isError === true; }
  if (entry.contentLengths && typeof entry.contentLengths === 'object') value.contentLengths = Object.fromEntries(['text', 'result', 'args', 'diff'].filter(field => Number.isSafeInteger(entry.contentLengths[field]) && entry.contentLengths[field] >= 0).map(field => [field, entry.contentLengths[field]]));
  if (typeof entry.status === 'string') value.status = entry.status.slice(0, 64);
  if (typeof entry.done === 'boolean') value.done = entry.done;
  if (typeof entry.inProgress === 'boolean') value.inProgress = entry.inProgress;
  if (typeof entry.at === 'string') value.at = entry.at.slice(0, 64);
  if (typeof entry.orderKey === 'string') value.orderKey = entry.orderKey.slice(0, 1024);
  if (Number.isSafeInteger(entry.imageCount) && entry.imageCount > 0) value.imageCount = entry.imageCount;
  return value;
}
function boundedWindow(entries) {
  const result = [], ids = new Set(); let size = 0;
  for (let index = entries.length - 1; index >= 0 && result.length < 40; index--) {
    const entry = displayEntity(entries[index]); if (ids.has(entry.id)) continue;
    const count = bytes(entry); if (size + count > PAGE_BYTES && result.length) break;
    size += count; result.push(entry); ids.add(entry.id);
  }
  return result.reverse();
}
function identity(frame, id) {
  if (!frame || frame.conversationId !== id || typeof frame.bindingEpoch !== 'string' || !frame.bindingEpoch || frame.bindingEpoch.length > 1024) throw new SyncError('invalid_identity');
}
function metadata(frame) {
  return { runState: ['unknown', 'running', 'settled', 'interrupted'].includes(frame.runState) ? frame.runState : 'unknown',
    sourceFreshness: ['unknown', 'reconciling', 'current'].includes(frame.sourceFreshness) ? frame.sourceFreshness : 'unknown',
    lastSourceCheckAt: typeof frame.lastSourceCheckAt === 'string' || Number.isFinite(frame.lastSourceCheckAt) ? frame.lastSourceCheckAt : undefined };
}
function snapshotState(frame, id) {
  identity(frame, id);
  if (!Array.isArray(frame.entries) || typeof frame.snapshotId !== 'string' || frame.snapshotId.length > 1024) throw new SyncError('invalid_snapshot');
  return { conversationId: id, bindingEpoch: frame.bindingEpoch, snapshotId: frame.snapshotId, appliedRevision: revision(frame.baseRevision),
    headRevision: revision(frame.headRevision || frame.baseRevision), entries: boundedWindow(frame.entries), olderCursor: typeof frame.olderCursor === 'string' ? frame.olderCursor : undefined,
    ...metadata(frame), status: 'cached', persistent: false, verified: true };
}

/** Pure per-conversation merge. No cursor is advanced on a gap or bad patch. */
export function applyOperations(state, batch, receipts = new Map()) {
  identity(batch, state.conversationId);
  if (batch.bindingEpoch !== state.bindingEpoch) throw new SyncError('epoch_mismatch');
  revision(batch.fromExclusive); revision(batch.throughRevision); revision(batch.headRevision);
  if (compareRevision(batch.throughRevision, batch.headRevision) > 0 || compareRevision(batch.fromExclusive, batch.throughRevision) > 0) throw new SyncError('future_revision');
  if (!Array.isArray(batch.operations) || batch.operations.length > 1024 || bytes(batch) > 80 * 1024) throw new SyncError('queue_overflow');
  const known = new Map(receipts), entries = new Map(state.entries.map(entry => [entry.id, entry]));
  const changed = new Map(), deleted = new Set(), addedReceipts = [], visibleOperations = [];
  let applied = state.appliedRevision, from = batch.fromExclusive, runState = state.runState, contentChanged = false, pagesInvalidated = false;
  if (compareRevision(from, applied) > 0) throw new SyncError('revision_gap');
  for (const op of batch.operations) {
    revision(op?.revision);
    if (op.revision !== nextRevision(from)) throw new SyncError('revision_gap');
    from = op.revision;
    if (typeof op.opId !== 'string' || op.opId.length > 1024) throw new SyncError('invalid_operation');
    const signature = syncDigest(canonical(op)), previous = known.get(op.revision);
    if (compareRevision(op.revision, applied) <= 0) {
      if (previous !== signature) throw new SyncError(previous === undefined ? 'duplicate_unverifiable' : 'revision_conflict');
      continue;
    }
    if (op.revision !== nextRevision(applied)) throw new SyncError('revision_gap');
    if (['replaceText', 'upsertTool', 'appendText', 'deleteEntity'].includes(op.type)) {
      if (typeof op.entityId !== 'string' || !op.entityId) throw new SyncError('invalid_entity');
      revision(op.entityRevision); const old = entries.get(op.entityId);
      if (old && compareRevision(op.entityRevision, old.entityRevision) <= 0) throw new SyncError('entity_revision_conflict');
      if (op.type === 'deleteEntity') { entries.delete(op.entityId); deleted.add(op.entityId); changed.delete(op.entityId); }
      else if (op.type === 'appendText') {
        const patch = op.payload;
        if (!old || patch?.encoding !== 'utf-16' || patch.baseEntityRevision !== old.entityRevision || patch.baseLength !== old.contentLength || typeof patch.text !== 'string') throw new SyncError('entity_reset_required');
        if ((old.contentOffset || 0) + old.text.length !== old.contentLength) throw new SyncError('entity_reset_required');
        const text = suffix(old.text + patch.text), contentLength = old.contentLength + patch.text.length;
        const value = { ...old, entityRevision: op.entityRevision, text, contentLength, contentOffset: contentLength - text.length,
          contentTruncated: text.length < contentLength };
        if (old.kind === 'tool') value.result = text;
        entries.set(op.entityId, value); changed.set(op.entityId, value);
      } else {
        const value = displayEntity({ ...op.payload?.entry, entityRevision: op.entityRevision });
        if (value.id !== op.entityId) throw new SyncError('invalid_entity');
        // An edit outside the latest window invalidates an old page, never becomes a new tail entry.
        if (old || op.payload?.isNew !== false) { entries.set(op.entityId, value); changed.set(op.entityId, value); deleted.delete(op.entityId); }
      }
      contentChanged = true;
    } else if (op.type === 'setRunState') runState = metadata(op.payload || {}).runState;
    else if (op.type === 'setMetadata') pagesInvalidated ||= op.payload?.pagesInvalidated === true;
    else if (op.type !== 'setPendingRequest') throw new SyncError('unknown_operation');
    // Approval summaries are deliberately not retained as executable state.
    known.set(op.revision, signature); addedReceipts.push([op.revision, signature]); visibleOperations.push(op); applied = op.revision;
  }
  if (from !== batch.throughRevision || compareRevision(batch.throughRevision, applied) > 0) throw new SyncError('revision_gap');
  const bounded = boundedWindow([...entries.values()]), keep = new Set(bounded.map(entry => entry.id));
  for (const entry of state.entries) if (!keep.has(entry.id)) deleted.add(entry.id);
  for (const id of changed.keys()) if (!keep.has(id)) changed.delete(id);
  return { state: { ...state, entries: bounded, appliedRevision: applied, headRevision: batch.headRevision, runState,
    snapshotId: typeof batch.snapshotId === 'string' ? batch.snapshotId : state.snapshotId,
    olderCursor: typeof batch.olderCursor === 'string' ? batch.olderCursor : state.olderCursor,
    status: compareRevision(applied, batch.headRevision) === 0 ? 'current' : 'syncing' },
    changed: [...changed.values()], deleted: [...deleted], receipts: addedReceipts, operations: visibleOperations, contentChanged, pagesInvalidated };
}

/** IndexedDB is a replaceable cache, with transactional compare-and-set across tabs. */
export class ConversationSyncStore {
  constructor({ indexedDB = defaultIndexedDB(), dbName = 'pi-coffee-conversation-sync-v2', timeoutMs = 1500,
    maxBytes = 40 * 1024 * 1024, maxPages = 160, maxConversations = 50, now = Date.now } = {}) {
    this.indexedDB = indexedDB; this.dbName = dbName; this.timeoutMs = timeoutMs; this.maxBytes = maxBytes;
    this.maxPages = maxPages; this.maxConversations = maxConversations; this.now = now; this.transactions = new Set();
  }
  invalidate() { for (const tx of this.transactions) { try { tx.abort(); } catch {} } }
  async _open() {
    if (this.database) return this.database; if (this.opening) return this.opening;
    if (!this.indexedDB?.open) return undefined;
    this.opening = new Promise(resolve => {
      let settled = false; const done = db => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); resolve(db); };
      const timer = setTimeout(() => done(undefined), this.timeoutMs);
      try {
        const request = this.indexedDB.open(this.dbName, 1);
        request.onupgradeneeded = () => { if (settled) { request.transaction.abort(); return; } for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'key' }); };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); if (this.database === db) this.database = undefined; }; done(db); };
        request.onerror = request.onblocked = () => done(undefined);
      } catch { done(undefined); }
    });
    const db = await this.opening; this.opening = undefined; this.database = db; return db;
  }
  async _transaction(action, { writable = false, guard = () => true, fallback } = {}) {
    const db = await this._open(); if (!db || !guard()) return fallback;
    return new Promise(resolve => {
      let tx, result = fallback, settled = false;
      const done = value => { if (settled) return; settled = true; clearTimeout(timer); this.transactions.delete(tx); resolve(guard() ? value : fallback); };
      const abort = () => { try { tx?.abort(); } catch {} done(fallback); };
      const timer = setTimeout(abort, this.timeoutMs);
      const safe = fn => { if (!guard()) { abort(); return; } try { fn(); } catch { abort(); } };
      try {
        tx = db.transaction(STORES, writable ? 'readwrite' : 'readonly'); this.transactions.add(tx);
        tx.oncomplete = () => done(result); tx.onabort = tx.onerror = () => done(fallback);
        const stores = Object.fromEntries(STORES.map(name => [name, tx.objectStore(name)]));
        action(stores, value => { result = value; }, safe, tx);
      } catch { abort(); }
    });
  }
  read(scope, id, guard) {
    const key = keyFor(scope, id);
    return this._transaction((stores, result, safe) => {
      const get = stores.manifests.get(key);
      get.onsuccess = () => safe(() => {
        const manifest = get.result; if (!manifest || manifest.scope !== scope || manifest.id !== id || this.now() - manifest.updatedAt > 24 * 60 * 60 * 1000) return;
        if (!Array.isArray(manifest.entityKeys) || manifest.entityKeys.length > 40 || !Array.isArray(manifest.receiptKeys) || manifest.receiptKeys.length > 128 || !Array.isArray(manifest.state?.entityIds)) return;
        identity(manifest.state, id); revision(manifest.state.appliedRevision);
        const entries = [], receipts = new Map(); let remaining = manifest.entityKeys.length + manifest.receiptKeys.length, missing = false;
        const finish = () => { if (!remaining && !missing) result({ state: { ...manifest.state, entries: entries.sort((a, b) => manifest.state.entityIds.indexOf(a.id) - manifest.state.entityIds.indexOf(b.id)), persistent: true, durableRevision: manifest.state.appliedRevision }, receipts }); };
        for (const entityKey of manifest.entityKeys) { const req = stores.entities.get(entityKey); req.onsuccess = () => safe(() => { if (req.result?.entry) entries.push(displayEntity(req.result.entry)); else missing = true; remaining--; finish(); }); }
        for (const receiptKey of manifest.receiptKeys) { const req = stores.receipts.get(receiptKey); req.onsuccess = () => safe(() => { if (req.result) receipts.set(req.result.revision, req.result.signature); remaining--; finish(); }); }
        finish();
      });
    }, { guard });
  }
  commit(scope, id, expected, state, { changed = state.entries, deleted = [], receipts = [], reset = false, guard = () => true } = {}) {
    const key = keyFor(scope, id);
    return this._transaction((stores, result, safe) => {
      const get = stores.manifests.get(key);
      get.onsuccess = () => safe(() => {
        const previous = get.result;
        if (previous && (!expected || previous.state.bindingEpoch !== expected.bindingEpoch || previous.state.appliedRevision !== expected.appliedRevision)) { result({ conflict: true }); return; }
        if (!previous && expected?.persistent) { result({ conflict: true }); return; }
        if (reset && previous) { for (const k of previous.entityKeys) stores.entities.delete(k); for (const k of previous.receiptKeys) stores.receipts.delete(k); }
        const entityKeys = state.entries.map(entry => keyFor(scope, id, state.bindingEpoch, entry.id));
        for (const entry of changed) stores.entities.put({ key: keyFor(scope, id, state.bindingEpoch, entry.id), entry });
        for (const entityId of deleted) stores.entities.delete(keyFor(scope, id, state.bindingEpoch, entityId));
        let receiptKeys = reset ? [] : [...(previous?.receiptKeys || [])], receiptSizes = reset ? [] : [...(previous?.receiptSizes || [])];
        for (const [rev, signature] of receipts) {
          const k = keyFor(scope, id, state.bindingEpoch, rev);
          stores.receipts.put({ key: k, revision: rev, signature }); receiptKeys.push(k); receiptSizes.push(bytes(signature));
        }
        let receiptBytes = receiptSizes.reduce((sum, size) => sum + size, 0);
        while (receiptKeys.length > 128 || receiptBytes > QUEUE_BYTES) { stores.receipts.delete(receiptKeys.shift()); receiptBytes -= receiptSizes.shift(); }
        const { entries, ...small } = state; small.entityIds = entries.map(entry => entry.id); small.persistent = true; small.durableRevision = state.appliedRevision;
        const updatedAt = this.now(), entityBytes = entries.reduce((sum, entry) => sum + bytes(entry), 0);
        stores.manifests.put({ key, scope, id, state: small, entityKeys, receiptKeys, receiptSizes, updatedAt });
        stores.budgets.put({ key: `m:${key}`, type: 'manifest', recordKey: key, scope, id, bytes: entityBytes + receiptBytes, entityKeys, receiptKeys, updatedAt });
        result({ persisted: true }); this._prune(stores, safe);
      });
    }, { writable: true, guard, fallback: { persisted: false } });
  }
  _prune(stores, safe) {
    const read = stores.budgets.getAll();
    read.onsuccess = () => safe(() => {
      const rows = read.result.sort((a, b) => (a.type === b.type ? a.updatedAt - b.updatedAt : a.type === 'page' ? -1 : 1));
      let total = rows.reduce((sum, row) => sum + row.bytes, 0), pages = rows.filter(row => row.type === 'page').length, conversations = rows.length - pages;
      for (const row of rows) {
        if (total <= this.maxBytes && (row.type !== 'page' || pages <= this.maxPages) && (row.type !== 'manifest' || conversations <= this.maxConversations) && this.now() - row.updatedAt < 24 * 60 * 60 * 1000) continue;
        stores.budgets.delete(row.key); total -= row.bytes;
        if (row.type === 'page') { stores.pages.delete(row.recordKey); pages--; }
        else { stores.manifests.delete(row.recordKey); for (const key of row.entityKeys) stores.entities.delete(key); for (const key of row.receiptKeys) stores.receipts.delete(key); conversations--; }
      }
    });
  }
  readPage(scope, id, epoch, cursor, guard) {
    const key = keyFor(scope, id, epoch, cursor);
    return this._transaction((stores, result, safe) => { const req = stores.pages.get(key); req.onsuccess = () => safe(() => { if (req.result) result(req.result.page); }); }, { guard });
  }
  putPage(scope, id, cursor, page, guard) {
    const key = keyFor(scope, id, page.bindingEpoch, cursor);
    return this._transaction((stores, result, safe) => {
      const size = bytes(page); if (size > 80 * 1024) return;
      stores.pages.put({ key, page }); stores.budgets.put({ key: `p:${key}`, type: 'page', recordKey: key, scope, id, bytes: size, updatedAt: this.now() });
      this._prune(stores, safe); result(true);
    }, { writable: true, guard, fallback: false });
  }
  delete(scope, id) {
    return this._transaction((stores, result, safe) => {
      const get = stores.budgets.getAll(); get.onsuccess = () => safe(() => {
        for (const row of get.result) if (row.scope === scope && (id === undefined || row.id === id)) {
          stores.budgets.delete(row.key);
          if (row.type === 'page') stores.pages.delete(row.recordKey);
          else { stores.manifests.delete(row.recordKey); for (const key of row.entityKeys) stores.entities.delete(key); for (const key of row.receiptKeys) stores.receipts.delete(key); }
        } result(true);
      });
    }, { writable: true, fallback: false });
  }
  close() { this.invalidate(); this.database?.close(); this.database = undefined; }
}

export class ConversationRepository {
  constructor({ onUpdate = () => {}, onUnauthorized = () => {}, fetch, indexedDB, store, useWorkers = true, workerFactory,
    concurrency = 4, maxMemoryConversations = 5, pollMs = 2500, now = Date.now, ...storeOptions } = {}) {
    this.store = store || new ConversationSyncStore({ indexedDB, ...storeOptions }); this.onUpdate = onUpdate; this.onUnauthorized = onUnauthorized;
    this.pool = new BoundedReadPool({ concurrency }); this.transport = new SyncWorkerPool({ fetch, useWorkers: useWorkers && !fetch, workerFactory });
    this.actors = new Map(); this.subscriptions=new Map(); this.generations = new Map(); this.authGeneration = 0; this.maxMemoryConversations = maxMemoryConversations; this.pollMs = pollMs; this.now = now;
    this.scope = undefined; this.closed = false; this.watched = new Set(); this.timers = new Map(); this.authController = new AbortController();
  }
  setScope(scope) {
    const next = typeof scope === 'string' && scope ? scope : undefined; if (next === this.scope) return;
    const previous = this.scope; this.scope = next; this.authGeneration++; this.authController.abort(); this.authController = new AbortController(); this.store.invalidate();
    this.actors.clear(); this.subscriptions.clear(); this.generations.clear(); this.watched.clear(); for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear();
    if (!next && previous) void this.store.delete(previous);
  }
  _context(id) { return { userScope: this.scope, conversationId: id, authGeneration: this.authGeneration, conversationGeneration: this.generations.get(id) || 0 }; }
  _valid(context) { return !this.closed && !!context.userScope && context.userScope === this.scope && context.authGeneration === this.authGeneration && context.conversationGeneration === (this.generations.get(context.conversationId) || 0); }
  _actor(id) {
    if (!this.scope || typeof id !== 'string' || !id) throw new SyncError('unauthorized');
    let actor = this.actors.get(id);
    if (!actor) { actor = { id, queue: Promise.resolve(), receipts: new Map(), listeners: this.subscriptions.get(id)??new Set(), lastAccess: this.now(), generation: 0, failures: 0 }; this.actors.set(id, actor); }
    actor.lastAccess = this.now(); return actor;
  }
  _enqueue(actor, action) { const pending = actor.queue.then(action); actor.queue = pending.then(() => undefined, () => undefined); return pending; }
  _emit(actor, details, state=actor.state) {
    if (!state) return;
    try { this.onUpdate(actor.id, state, details); } catch {}
    for (const listener of actor.listeners) { try { listener(state, details); } catch {} }
    const retained = [...this.actors.values()].filter(item => item.state && item !== actor && !item.listeners.size && !item.syncing).sort((a, b) => a.lastAccess - b.lastAccess);
    let count = [...this.actors.values()].filter(item => item.state).length;
    while (count > this.maxMemoryConversations && retained.length) { const old = retained.shift(); old.state = undefined; old.receipts.clear(); count--; }
  }
  peek(id) { const actor = this.actors.get(id); if (actor) actor.lastAccess = this.now(); return actor?.state; }
  subscribe(id, listener) { const actor = this._actor(id),listeners=actor.listeners; this.subscriptions.set(id,listeners);listeners.add(listener);return ()=>{listeners.delete(listener);if(!listeners.size&&this.subscriptions.get(id)===listeners)this.subscriptions.delete(id);}; }
  async _load(actor, context, refresh = false) {
    if (actor.state && !refresh) return actor.state;
    const disk = await this.store.read(context.userScope, actor.id, () => this._valid(context));
    if (!this._valid(context)) throw new SyncError('stale_scope');
    if (disk) { actor.state = disk.state; actor.receipts = disk.receipts; this._emit(actor, { reason: 'local' }); }
    return actor.state;
  }
  getLocal(id, { refresh = false } = {}) {
    if (!this.scope) return Promise.resolve(undefined);
    const actor = this._actor(id), context = this._context(id);
    if(actor.state && !refresh)return Promise.resolve(actor.state);
    return this._enqueue(actor, () => this._load(actor, context, refresh)).catch(() => undefined);
  }
  async _snapshot(actor, frame, context, { allowEpochChange = false } = {}) {
    if (!this._valid(context)) throw new SyncError('stale_scope');
    if (frame.userScope !== undefined && frame.userScope !== context.userScope) throw new SyncError('stale_scope');
    const state = snapshotState(frame, actor.id), old = actor.state;
    if (old && old.bindingEpoch !== state.bindingEpoch && !allowEpochChange) throw new SyncError('epoch_mismatch');
    if (old?.bindingEpoch === state.bindingEpoch && compareRevision(state.appliedRevision, old.appliedRevision) < 0) return old;
    const committed = await this.store.commit(context.userScope, actor.id, old, state, { reset: true, guard: () => this._valid(context) });
    if (!this._valid(context)) throw new SyncError('stale_scope');
    if (committed.conflict) throw new SyncError('store_conflict');
    state.persistent = committed.persisted; state.durableRevision = committed.persisted ? state.appliedRevision : undefined;
    actor.state = state; actor.receipts.clear(); actor.generation++; this._emit(actor, { reason: 'snapshot' }); return state;
  }
  acceptSnapshot(id, frame) {
    const actor = this._actor(id), context = this._context(id);
    return this._enqueue(actor, async () => { await this._load(actor, context); return this._snapshot(actor, frame, context); });
  }
  ingestSnapshot(id, frame) { return this.acceptSnapshot(id, frame); }
  async _changes(actor, batch, context) {
    if (!this._valid(context) || !actor.state || (batch.userScope !== undefined && batch.userScope !== context.userScope)) throw new SyncError('stale_scope');
    const merged = applyOperations(actor.state, batch, actor.receipts);
    if (!merged.operations.length) return actor.state;
    const committed = await this.store.commit(context.userScope, actor.id, actor.state, merged.state, { ...merged, guard: () => this._valid(context) });
    if (!this._valid(context)) throw new SyncError('stale_scope');
    if (committed.conflict) throw new SyncError('store_conflict');
    merged.state.persistent = committed.persisted; merged.state.durableRevision = committed.persisted ? merged.state.appliedRevision : actor.state.durableRevision;
    actor.state = merged.state;
    for (const receipt of merged.receipts) actor.receipts.set(...receipt);
    let count = [...actor.receipts.values()].reduce((total, text) => total + bytes(text), 0);
    while (actor.receipts.size > 128 || count > QUEUE_BYTES) { const key = actor.receipts.keys().next().value; count -= bytes(actor.receipts.get(key)); actor.receipts.delete(key); }
    if (merged.pagesInvalidated) actor.needsSnapshot = true;
    this._emit(actor, { reason: 'changes', operations: merged.operations, invalidatedPages: merged.contentChanged, pagesInvalidated: merged.pagesInvalidated }); return actor.state;
  }
  acceptChanges(id, batch) {
    const actor = this._actor(id), context = this._context(id);
    return this._enqueue(actor, async () => { await this._load(actor, context); return this._changes(actor, batch, context); });
  }
  _read(id, type, params, context, priority = 2) {
    const query = new URLSearchParams(params).toString(), url = `/api/conversations/${encodeURIComponent(id)}/${type}${query ? `?${query}` : ''}`;
    const timeoutMs = type === 'meta' ? 3000 : type === 'changes' ? 8000 : 10000;
    const actor=this._actor(id), key=keyFor(context.userScope, context.authGeneration, url);
    actor.readKeys??=new Set();actor.readKeys.add(key);
    return this.pool.run(key, signal => this.transport.read(url, context, signal), { priority: Math.min(priority,actor.priority??priority), timeoutMs, signal: this.authController.signal }).then(value => {
      // The Web gateway stamps this from authenticated identity, never from Host/client input.
      if (!value || value.userScope !== context.userScope) throw new SyncError('unauthorized');
      return value;
    }).catch(error => {
      if (error.code === 'unauthorized' && this._valid(context)) { this.setScope(undefined); try { this.onUnauthorized(); } catch {} }
      throw error;
    }).finally(()=>actor.readKeys.delete(key));
  }
  sync(id, { priority = 2, forceSnapshot = false } = {}) {
    if (!this.scope || this.closed) return Promise.resolve(undefined);
    const actor = this._actor(id); if (forceSnapshot) actor.needsSnapshot = true;
    actor.priority=Math.min(actor.syncing?actor.priority:priority,priority);
    if(actor.syncing){for(const key of actor.readKeys??[])this.pool.promote(key,actor.priority);return actor.syncing;}
    const context = this._context(id);
    // Serialize only local state transitions. Never hold the commit queue across
    // network I/O: a socket snapshot and local reading must remain independent.
    const commit=action=>this._enqueue(actor,()=>{if(!this._valid(context))throw new SyncError('stale_scope');return action();});
    const snapshot=async()=>{
      const generation=actor.generation;
      const frame=await this._read(id,'page',{limitBytes:String(PAGE_BYTES)},context,actor.priority);
      await commit(async()=>{
        // A newer socket snapshot may have rebound the conversation during I/O.
        if(actor.generation!==generation && actor.state?.bindingEpoch!==frame.bindingEpoch)return;
        await this._snapshot(actor,frame,context,{allowEpochChange:true});actor.needsSnapshot=false;
      });
    };
    actor.syncing = (async () => {
      await this.getLocal(id);
      const meta = await this._read(id, 'meta', {}, context, actor.priority);
      if (!this._valid(context)) return undefined;
      identity(meta, id); revision(meta.headRevision);
      if (meta.syncProtocol !== 2) throw new SyncError('unsupported_protocol');
      const old = actor.state;
      if (actor.needsSnapshot || !old || old.bindingEpoch !== meta.bindingEpoch ||
          (meta.oldestAvailableRevision && compareRevision(old.appliedRevision, meta.oldestAvailableRevision) < 0)) await snapshot();
      let batches = 0;
      while (this._valid(context) && actor.state?.bindingEpoch===meta.bindingEpoch && compareRevision(actor.state.appliedRevision, meta.headRevision) < 0) {
        const before = actor.state.appliedRevision,epoch=actor.state.bindingEpoch;
        try {
          const batch = await this._read(id, 'changes', { bindingEpoch: epoch, afterRevision: before, limitBytes: String(PAGE_BYTES) }, context, actor.priority);
          await commit(()=>{
            if(actor.state?.bindingEpoch!==epoch)return;
            if(compareRevision(actor.state.appliedRevision,batch.throughRevision)>=0)return;
            return this._changes(actor, batch, context);
          });
          if (actor.needsSnapshot) {await snapshot();break;}
          if (actor.state.appliedRevision === before && batch.hasMore) throw new SyncError('revision_gap');
          if (!batch.hasMore) break;
        } catch (error) {
          if (error.code === 'store_conflict') { await commit(()=>this._load(actor, context, true)); }
          else if (['reset_required', 'epoch_mismatch', 'entity_reset_required', 'revision_gap', 'duplicate_unverifiable', 'unknown_operation'].includes(error.code)) {await snapshot();break;}
          else throw error;
        }
        if (++batches % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      return commit(()=>{
        if(!actor.state)return undefined;
        // A delayed metadata response must not overwrite a newer snapshot's
        // binding, run state or freshness, even though its body was harmless.
        if(actor.state.bindingEpoch===meta.bindingEpoch && compareRevision(actor.state.appliedRevision,meta.headRevision)<=0){
          actor.state = { ...actor.state, sourceFreshness: metadata(meta).sourceFreshness, lastSourceCheckAt: metadata(meta).lastSourceCheckAt,
            runState: actor.state.appliedRevision === meta.headRevision ? metadata(meta).runState : actor.state.runState, headRevision: meta.headRevision,
            status: compareRevision(actor.state.appliedRevision, meta.headRevision) >= 0 ? 'current' : 'syncing' };
        }
        actor.failures = 0; this._emit(actor, { reason: 'status' }); return actor.state;
      });
    })().catch(async error => {
      if (!this._valid(context)) return undefined;
      if (error.code === 'unauthorized') { this.setScope(undefined); return undefined; }
      return commit(async()=>{
        if (error.code === 'store_conflict') await this._load(actor, context, true);
        actor.failures++; if (actor.state) actor.state = { ...actor.state, status: error.code || 'network_error' };
        this._emit(actor,{reason:'status'},actor.state??{conversationId:id,status:error.code||'network_error',sourceFreshness:'unknown'});
        return actor.state;
      }).catch(()=>undefined);
    }).finally(() => { actor.syncing = undefined; });
    return actor.syncing;
  }

  async loadOlder(id, cursor) {
    if (typeof cursor !== 'string' || !cursor) return undefined;
    const actor = this._actor(id), context = this._context(id); await this.getLocal(id);
    const epoch = actor.state?.bindingEpoch, snapshotId = actor.state?.snapshotId;
    if (!epoch) throw new SyncError('snapshot_required');
    const valid = () => this._valid(context) && actor.state?.bindingEpoch === epoch && actor.state?.snapshotId === snapshotId;
    const cached = await this.store.readPage(context.userScope, id, epoch, cursor, valid);
    if (cached && cached.snapshotId === snapshotId && valid()) return cached;
    let frame;
    try { frame = await this._read(id, 'page', { cursor, limitBytes: String(PAGE_BYTES) }, context, 1); }
    catch (error) { if (error.code === 'reset_required' && this._valid(context)) void this.sync(id, { priority: 1, forceSnapshot: true }); throw error; }
    identity(frame, id); if (!valid() || frame.bindingEpoch !== epoch || frame.snapshotId !== snapshotId) throw new SyncError('reset_required');
    const page = { ...snapshotState(frame, id), baseRevision: frame.baseRevision };
    await this.store.putPage(context.userScope, id, cursor, page, valid);
    if (!valid()) throw new SyncError('stale_scope'); return page;
  }
  async loadAround(id, anchorEntityId) {
    if(typeof anchorEntityId!=='string'||!anchorEntityId||anchorEntityId.length>1024)throw new SyncError('invalid_entity');
    const actor=this._actor(id),context=this._context(id),epoch=actor.state?.bindingEpoch;
    const frame=await this._read(id,'page',{anchorEntityId,limitBytes:String(PAGE_BYTES)},context,0);
    identity(frame,id);if(!this._valid(context)||actor.state?.bindingEpoch!==epoch||frame.bindingEpoch!==epoch)throw new SyncError('reset_required');
    return {...snapshotState(frame,id),baseRevision:frame.baseRevision};
  }
  async loadContent(id, entry, offset = 0, field) {
    const actor = this._actor(id), context = this._context(id), epoch = actor.state?.bindingEpoch;
    if (!epoch || !Number.isSafeInteger(offset) || offset < 0) throw new SyncError('invalid_content_request');
    const value = await this._read(id, 'content', { bindingEpoch: epoch, entityId: entry.id, entityRevision: entry.entityRevision, offset: String(offset), limitBytes: String(BLOCK_BYTES), ...(field ? { field } : {}) }, context, 0);
    identity(value, id);
    if (!this._valid(context) || actor.state?.bindingEpoch !== epoch || value.bindingEpoch !== epoch || value.entityId !== entry.id || value.entityRevision !== entry.entityRevision) throw new SyncError('stale_entity');
    const currentEntity = actor.state?.entries.find(item => item.id === entry.id);
    if (currentEntity && currentEntity.entityRevision !== entry.entityRevision) throw new SyncError('stale_entity');
    if (typeof value.text !== 'string' || bytes(value.text) > BLOCK_BYTES || value.encoding !== 'utf-16' || value.offset !== offset || !Number.isSafeInteger(value.nextOffset) || value.nextOffset !== offset + value.text.length || !Number.isSafeInteger(value.totalLength) || value.totalLength < value.nextOffset) throw new SyncError('invalid_content');
    return value;
  }
  watch(ids) {
    const wanted = new Set(ids.slice(0, 10));
    for (const id of this.watched) if (!wanted.has(id)) { clearTimeout(this.timers.get(id)); this.timers.delete(id); }
    this.watched = wanted;
    for (const id of wanted) if (!this.timers.has(id)) {
      const poll = async () => {
        if (!this.watched.has(id) || this.closed || !this.scope) return;
        await this.sync(id, { priority: 3 }); if (!this.watched.has(id) || this.closed || !this.scope) return;
        const failures = this.actors.get(id)?.failures || 0;
        const delay = Math.min(60000, this.pollMs * 2 ** Math.min(failures, 5)) * (1 + Math.random() * .15);
        this.timers.set(id, setTimeout(poll, delay));
      };
      this.timers.set(id, setTimeout(poll, 0));
    }
  }
  unwatch(id) { this.watched.delete(id); clearTimeout(this.timers.get(id)); this.timers.delete(id); }
  async invalidate(id) {
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    const actor = this.actors.get(id); if (actor) { actor.generation++; actor.state = undefined; actor.receipts.clear(); }
    this.actors.delete(id); this.unwatch(id); if (this.scope) await this.store.delete(this.scope, id);
  }
  async clear() {
    const scope = this.scope; this.authGeneration++; this.authController.abort(); this.authController = new AbortController(); this.store.invalidate();
    for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.watched.clear(); this.actors.clear(); this.generations.clear();
    if (scope) await this.store.delete(scope);
  }
  dispose() {
    this.closed = true; this.authGeneration++; this.authController.abort(); this.pool.close(); this.transport.close(); this.store.close(); this.subscriptions.clear();
    for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.watched.clear(); this.actors.clear();
  }
}
