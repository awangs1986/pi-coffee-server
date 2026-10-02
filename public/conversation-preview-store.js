// Disposable, user-scoped display previews. Host/native history is authoritative.
// Keep large snapshots separate from metadata: a cache hit reads one transcript,
// and updating its LRU position must never rewrite that transcript.
const DB_VERSION = 1;
const SNAPSHOTS = 'previews';
const METADATA = 'metadata';
const MAX_PREVIEW_ENTRIES = 10_000;
const MAX_PREVIEW_CHARS = 4 * 1024 * 1024;
const KINDS = new Set(['user', 'assistant', 'tool', 'note']);
const coordinators = new WeakMap();
const encoder = new TextEncoder();

function defaultIndexedDB() {
  try { return globalThis.indexedDB; } catch { return undefined; }
}
function scopeKey(user, id) {
  return typeof user === 'string' && user.trim() && typeof id === 'string' && id.trim()
    ? JSON.stringify([user, id]) : undefined;
}
function byteLength(value) { return encoder.encode(JSON.stringify(value)).byteLength; }
function positive(value, fallback) { return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback; }
function latestText(text, length) {
  let start = Math.max(0, text.length - length);
  // Avoid leaving half of a surrogate pair at the truncation boundary.
  if (start && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1])) start++;
  return text.slice(start);
}

function boundedEntries(source, project) {
  const entries = [];
  let remaining = MAX_PREVIEW_CHARS, truncated = false;
  for (let i = source.length - 1; i >= 0; i--) {
    if (entries.length === MAX_PREVIEW_ENTRIES || !remaining) { truncated = true; break; }
    const entry = project(source[i]);
    if (!entry) { truncated = true; continue; }
    let text = entry.text;
    if (text.length > remaining) { text = latestText(text, remaining); truncated = true; remaining = 0; }
    else remaining -= text.length;
    entries.push({ kind: entry.kind, text });
  }
  entries.reverse();
  return { entries, truncated };
}

/** Project controller entries to inert, bounded plain text; never copy DOM,
 * images, tool arguments, actions, or arbitrary objects into persistent storage. */
export function createConversationPreview(entries, scroll) {
  const result = boundedEntries(Array.isArray(entries) ? entries : [], entry => {
    if (!entry || !KINDS.has(entry.k)) return undefined;
    if (entry.k === 'tool') {
      const name = typeof entry.name === 'string' ? entry.name : '';
      const output = typeof entry.result === 'string' ? entry.result : typeof entry.text === 'string' ? entry.text : '';
      return { kind: 'tool', text: [name, output].filter(Boolean).join('\n') };
    }
    return { kind: entry.k, text: typeof entry.text === 'string' ? entry.text : '' };
  });
  return { entries: result.entries, scroll: Number.isFinite(scroll) ? Math.max(0, scroll) : 0, truncated: result.truncated };
}

function plainSnapshot(value) {
  if (!value || !Array.isArray(value.entries) || !Number.isFinite(value.scroll) || value.scroll < 0 ||
      typeof value.truncated !== 'boolean' || (value.fingerprint !== undefined &&
      (typeof value.fingerprint !== 'string' || value.fingerprint.length > 1024))) return undefined;
  // Validate every supplied entry before dropping any old ones. A malformed disk
  // record is a miss, rather than something the controller should interpret.
  if (!value.entries.every(entry => entry && KINDS.has(entry.kind) && typeof entry.text === 'string')) return undefined;
  const bounded = boundedEntries(value.entries, entry => entry);
  const snapshot = { entries: bounded.entries, scroll: value.scroll, truncated: value.truncated || bounded.truncated };
  if (value.fingerprint !== undefined) snapshot.fingerprint = value.fingerprint;
  return snapshot;
}

// Return a suffix whose JSON-escaped UTF-8 representation fits a byte budget.
// A reverse scan avoids repeatedly encoding multi-megabyte strings by binary search.
function suffixWithinBytes(text, budget) {
  let start = text.length, bytes = 0;
  while (start > 0) {
    const code = text.charCodeAt(start - 1);
    let size, units = 1;
    if (code >= 0xDC00 && code <= 0xDFFF && start > 1 &&
        text.charCodeAt(start - 2) >= 0xD800 && text.charCodeAt(start - 2) <= 0xDBFF) { size = 4; units = 2; }
    else if (code >= 0xD800 && code <= 0xDFFF) size = 6;
    else if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) size = 2;
    else if (code < 32) size = 6;
    else size = code < 128 ? 1 : code < 2048 ? 2 : 3;
    if (bytes + size > budget) break;
    bytes += size; start -= units;
  }
  return text.slice(start);
}

function fitSnapshot(value, maxBytes) {
  const snapshot = plainSnapshot(value);
  if (!snapshot) return undefined;
  let bytes = byteLength(snapshot);
  if (bytes <= maxBytes) return { snapshot, bytes };
  snapshot.truncated = true;
  bytes = byteLength(snapshot);
  let drop = 0;
  while (bytes > maxBytes && snapshot.entries.length - drop > 1) {
    bytes -= byteLength(snapshot.entries[drop++]) + 1;
  }
  if (drop) snapshot.entries = snapshot.entries.slice(drop);
  if (bytes > maxBytes && snapshot.entries.length) {
    const entry = snapshot.entries[0], text = entry.text;
    entry.text = '';
    const overhead = byteLength(snapshot);
    if (overhead > maxBytes) return undefined;
    entry.text = suffixWithinBytes(text, maxBytes - overhead);
    bytes = byteLength(snapshot);
  }
  return bytes <= maxBytes ? { snapshot, bytes } : undefined;
}

function coordinator(indexedDB, dbName) {
  if (!indexedDB || !['object', 'function'].includes(typeof indexedDB)) return { queue: Promise.resolve(), pending: new Set() };
  let databases = coordinators.get(indexedDB);
  if (!databases) coordinators.set(indexedDB, databases = new Map());
  if (!databases.has(dbName)) databases.set(dbName, { queue: Promise.resolve(), pending: new Set() });
  return databases.get(dbName);
}

export class ConversationPreviewStore {
  constructor({ indexedDB = defaultIndexedDB(), now = Date.now, dbName = 'pi-coffee-conversation-previews',
    maxEntries = 5, maxBytes = 40 * 1024 * 1024, maxSnapshotBytes = 8 * 1024 * 1024,
    ttlMs = 24 * 60 * 60 * 1000, timeoutMs = 1000 } = {}) {
    this.indexedDB = indexedDB; this.now = now; this.dbName = dbName;
    this.maxEntries = positive(maxEntries, 5); this.maxBytes = positive(maxBytes, 40 * 1024 * 1024);
    this.maxSnapshotBytes = Math.min(positive(maxSnapshotBytes, 8 * 1024 * 1024), this.maxBytes);
    this.ttlMs = positive(ttlMs, 24 * 60 * 60 * 1000); this.timeoutMs = positive(timeoutMs, 1000);
    this.coordinator = coordinator(indexedDB, dbName);
    this.database = undefined; this.opening = undefined;
  }

  _invalidate(key) {
    for (const ticket of this.coordinator.pending) if (key === undefined || ticket.key === key) {
      ticket.valid = false;
      ticket.cancel?.();
    }
  }

  async _open() {
    if (this.database) return this.database;
    if (this.opening) return this.opening;
    if (!this.indexedDB || typeof this.indexedDB.open !== 'function') return undefined;
    const opening = new Promise(resolve => {
      let settled = false, request;
      const finish = database => {
        if (settled) { database?.close(); return; }
        settled = true; clearTimeout(timer);
        if (database) {
          this.database = database;
          database.onversionchange = () => { database.close(); if (this.database === database) this.database = undefined; };
          database.onclose = () => { if (this.database === database) this.database = undefined; };
        }
        resolve(database);
      };
      const timer = setTimeout(() => finish(undefined), this.timeoutMs);
      try {
        request = this.indexedDB.open(this.dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          try {
            if (settled) { request.transaction?.abort(); return; }
            for (const name of [SNAPSHOTS, METADATA]) if (!request.result.objectStoreNames.contains(name)) {
              request.result.createObjectStore(name, { keyPath: 'key' });
            }
          } catch { try { request.transaction?.abort(); } catch {} finish(undefined); }
        };
        request.onsuccess = () => finish(request.result);
        request.onerror = request.onblocked = () => finish(undefined);
      } catch { finish(undefined); }
    });
    this.opening = opening;
    const database = await opening;
    if (this.opening === opening) this.opening = undefined;
    return database;
  }

  _transaction(database, ticket, action, fallback) {
    return new Promise(resolve => {
      let transaction, settled = false, result = fallback;
      const finish = value => {
        if (settled) return;
        settled = true; clearTimeout(timer); ticket.cancel = undefined;
        resolve(ticket.valid ? value : fallback);
      };
      const abort = () => { try { transaction?.abort(); } catch {} finish(fallback); };
      const timer = setTimeout(abort, this.timeoutMs);
      ticket.cancel = abort;
      const guard = callback => {
        if (settled || !ticket.valid) return;
        try { callback(); } catch { abort(); }
      };
      try {
        transaction = database.transaction([SNAPSHOTS, METADATA], 'readwrite');
        transaction.oncomplete = () => finish(result);
        transaction.onerror = transaction.onabort = () => finish(fallback);
        action(transaction.objectStore(SNAPSHOTS), transaction.objectStore(METADATA),
          value => { result = value; }, guard);
      } catch {
        // Closed/deleted/version-changed databases can be reopened on the next attempt.
        if (this.database === database) { this.database = undefined; try { database.close(); } catch {} }
        abort();
      }
    });
  }

  _enqueue(key, action, fallback) {
    const ticket = { key, valid: true, cancel: undefined };
    this.coordinator.pending.add(ticket);
    const operation = this.coordinator.queue.then(async () => {
      if (!ticket.valid) return fallback;
      const database = await this._open();
      if (!database || !ticket.valid) return fallback;
      return this._transaction(database, ticket, action, fallback);
    }).catch(() => fallback);
    this.coordinator.queue = operation.then(() => undefined);
    return operation.then(value => ticket.valid ? value : fallback).finally(() => this.coordinator.pending.delete(ticket));
  }

  _validMetadata(record, now) {
    if (!record || typeof record.key !== 'string' || !Number.isFinite(now) ||
        !Number.isFinite(record.updatedAt) || record.updatedAt > now || now - record.updatedAt >= this.ttlMs ||
        !Number.isFinite(record.accessedAt) || !Number.isSafeInteger(record.order) || record.order < 0 ||
        !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > this.maxSnapshotBytes) return false;
    try { const scope = JSON.parse(record.key); return Array.isArray(scope) && scope.length === 2 && scopeKey(...scope) === record.key; }
    catch { return false; }
  }

  async get(user, id) {
    try {
      const key = scopeKey(user, id);
      if (!key) return undefined;
      return await this._enqueue(key, (previews, metadata, result, guard) => {
        const request = metadata.getAll();
        request.onsuccess = () => guard(() => {
          const now = this.now(), records = request.result;
          const record = records.find(item => item.key === key);
          if (!this._validMetadata(record, now)) { previews.delete(key); metadata.delete(key); return; }
          const read = previews.get(key);
          read.onsuccess = () => guard(() => {
            const stored = read.result;
            const snapshot = stored?.version === DB_VERSION && stored.key === key ? plainSnapshot(stored.snapshot) : undefined;
            const bytes = snapshot ? byteLength(snapshot) : Infinity;
            if (!snapshot || bytes !== record.bytes || bytes > this.maxSnapshotBytes) {
              previews.delete(key); metadata.delete(key); return;
            }
            record.accessedAt = now;
            record.order = Math.min(Number.MAX_SAFE_INTEGER, 1 + Math.max(0, ...records.map(item => Number.isSafeInteger(item.order) ? item.order : 0)));
            metadata.put(record); result(snapshot);
          });
        });
      }, undefined);
    } catch { return undefined; }
  }

  async put(user, id, value) {
    try {
      const key = scopeKey(user, id);
      if (!key) return false;
      const fitted = fitSnapshot(value, this.maxSnapshotBytes);
      if (!fitted) return false;
      return await this._enqueue(key, (previews, metadata, result, guard) => {
        const request = metadata.getAll();
        request.onsuccess = () => guard(() => {
          const now = this.now();
          if (!Number.isFinite(now)) return;
          const records = [];
          for (const record of request.result) {
            if (!this._validMetadata(record, now) || record.key === key) { previews.delete(record.key); metadata.delete(record.key); }
            else records.push(record);
          }
          const order = Math.min(Number.MAX_SAFE_INTEGER, 1 + Math.max(0, ...records.map(record => record.order)));
          records.sort((a, b) => a.order - b.order || a.accessedAt - b.accessedAt || a.key.localeCompare(b.key));
          let bytes = records.reduce((total, record) => total + record.bytes, fitted.bytes);
          while (records.length && (records.length >= this.maxEntries || bytes > this.maxBytes)) {
            const oldest = records.shift(); bytes -= oldest.bytes;
            previews.delete(oldest.key); metadata.delete(oldest.key);
          }
          previews.put({ key, version: DB_VERSION, snapshot: fitted.snapshot });
          metadata.put({ key, updatedAt: now, accessedAt: now, order, bytes: fitted.bytes });
          result(true);
        });
      }, false);
    } catch { return false; }
  }

  async delete(user, id) {
    try {
      const key = scopeKey(user, id);
      if (!key) return false;
      this._invalidate(key);
      return await this._enqueue(key, (previews, metadata, result) => {
        previews.delete(key); metadata.delete(key); result(true);
      }, false);
    } catch { return false; }
  }

  async clear() {
    try {
      this._invalidate();
      return await this._enqueue(undefined, (previews, metadata, result) => {
        previews.clear(); metadata.clear(); result(true);
      }, false);
    } catch { return false; }
  }
}
