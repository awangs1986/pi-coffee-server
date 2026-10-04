// Read-only synchronization transport. Waiting deadlines never free an actual
// network slot: even an abort-ignoring transport stays counted until settlement.
export class SyncError extends Error {
  constructor(code, message = code, status) { super(message); this.name = 'SyncError'; this.code = code; this.status = status; }
}

export class BoundedReadPool {
  constructor({ concurrency = 4, maxQueue = 64, reservedForeground = 1 } = {}) {
    this.concurrency = Math.max(1, Math.min(8, concurrency)); this.maxQueue = maxQueue;
    this.reservedForeground = this.concurrency > 1 ? Math.min(this.concurrency - 1, reservedForeground) : 0;
    this.active = 0; this.backgroundActive = 0; this.queue = []; this.pending = new Map(); this.closed = false; this.sequence = 0; this.turn = 0;
  }
  run(key, task, { timeoutMs = 8000, priority = 2, signal } = {}) {
    if (this.closed) return Promise.reject(new SyncError('closed'));
    if (this.pending.has(key)) { const ticket=this.pending.get(key); this.promote(key,priority); return ticket.promise; }
    if (this.queue.length >= this.maxQueue) return Promise.reject(new SyncError('queue_full'));
    const ticket = { key, task, priority, sequence: this.sequence++, started: false, settled: false, controller: new AbortController() };
    ticket.promise = new Promise((resolve, reject) => { ticket.resolve = resolve; ticket.reject = reject; });
    const cancel = code => {
      if (ticket.settled) return;
      ticket.reject(new SyncError(code)); ticket.controller.abort();
      // A queued read has no underlying work; a started read remains single-flight.
      if (!ticket.started) { clearTimeout(ticket.timer); ticket.externalSignal?.removeEventListener('abort', ticket.cancel); ticket.settled = true; this.queue = this.queue.filter(item => item !== ticket); this.pending.delete(key); }
    };
    ticket.timer = setTimeout(() => cancel('timeout'), timeoutMs);
    ticket.cancel = () => cancel('cancelled');
    ticket.externalSignal = signal; signal?.addEventListener('abort', ticket.cancel, { once: true });
    this.pending.set(key, ticket); this.queue.push(ticket);
    if (signal?.aborted) cancel('cancelled'); else this._drain();
    return ticket.promise;
  }
  promote(key, priority) {
    const ticket=this.pending.get(key);
    if(!ticket || priority>=ticket.priority)return;
    ticket.priority=priority;
    if(!ticket.started)this._drain();
  }
  _drain() {
    while (!this.closed && this.active < this.concurrency && this.queue.length) {
      // Periodic FIFO admission reserves a small fair share for background reads.
      this.queue.sort(++this.turn % 8 === 0 ? (a, b) => a.sequence - b.sequence : (a, b) => a.priority - b.priority || a.sequence - b.sequence);
      const index = this.queue.findIndex(item => item.priority <= 1 || this.backgroundActive < this.concurrency - this.reservedForeground);
      if (index < 0) break;
      const [ticket] = this.queue.splice(index, 1); ticket.started = true; ticket.background = ticket.priority > 1; this.active++; if (ticket.background) this.backgroundActive++;
      Promise.resolve().then(() => ticket.task(ticket.controller.signal)).then(ticket.resolve, ticket.reject).finally(() => {
        ticket.settled = true; clearTimeout(ticket.timer); ticket.externalSignal?.removeEventListener('abort', ticket.cancel);
        this.active--; if (ticket.background) this.backgroundActive--; if (this.pending.get(ticket.key) === ticket) this.pending.delete(ticket.key); this._drain();
      });
    }
  }
  close() {
    this.closed = true;
    for (const ticket of this.pending.values()) { clearTimeout(ticket.timer); ticket.cancel(); }
    this.queue = [];
  }
}

export async function readBoundedJSON(fetcher, url, { signal, maxBytes = 80 * 1024 } = {}) {
  const response = await fetcher(url, { signal, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new SyncError(response.status === 409 ? 'reset_required' : response.status === 401 ? 'unauthorized' : response.status === 404 ? 'not_found' : 'http_error', `Synchronization HTTP ${response.status}`, response.status);
  }
  const length = Number(response.headers?.get?.('content-length'));
  if (length > maxBytes) throw new SyncError('response_too_large');
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new SyncError('response_too_large'); }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
  } else {
    text = await response.text(); if (new TextEncoder().encode(text).byteLength > maxBytes) throw new SyncError('response_too_large');
  }
  try { return JSON.parse(text); } catch { throw new SyncError('invalid_json'); }
}

/** A bounded shared CPU/JSON pool, not one Worker for every conversation. */
export class SyncWorkerPool {
  constructor({ size = Math.min(2, Math.max(1, (globalThis.navigator?.hardwareConcurrency || 2) - 1)), workerFactory, fetch = globalThis.fetch?.bind(globalThis), useWorkers = true } = {}) {
    this.fetch = fetch; this.size = Math.max(1, Math.min(2, size)); this.next = 0; this.sequence = 0; this.workers = []; this.closed = false;
    this.factory = workerFactory || (useWorkers && typeof Worker !== 'undefined' ? () => new Worker(new URL('./workers/conversation-sync.js', import.meta.url), { type: 'module' }) : undefined);
  }
  _worker(index) {
    if (this.workers[index]) return this.workers[index];
    const worker = this.factory(), slot = { worker, pending: new Map() };
    worker.onmessage = ({ data }) => {
      const ticket = slot.pending.get(data?.requestId); if (!ticket) return;
      slot.pending.delete(data.requestId); ticket.cleanup();
      if (data.userScope !== ticket.context.userScope || data.authGeneration !== ticket.context.authGeneration || data.conversationId !== ticket.context.conversationId) ticket.reject(new SyncError('stale_scope'));
      else if (data.error) ticket.reject(new SyncError(data.error.code, data.error.message, data.error.status));
      else ticket.resolve(data.value);
    };
    worker.onerror = worker.onmessageerror = () => {
      worker.terminate(); this.workers[index] = undefined;
      for (const ticket of slot.pending.values()) { ticket.cleanup(); ticket.reject(new SyncError('worker_failed')); } slot.pending.clear();
    };
    this.workers[index] = slot; return slot;
  }
  read(url, context, signal, maxBytes = 80 * 1024) {
    if (this.closed) return Promise.reject(new SyncError('closed'));
    if (!this.factory) return readBoundedJSON(this.fetch, url, { signal, maxBytes });
    let slot;
    try { slot = this._worker(this.next++ % this.size); } catch { this.factory = undefined; return readBoundedJSON(this.fetch, url, { signal, maxBytes }); }
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      const abort = () => slot.worker.postMessage({ type: 'cancel', requestId });
      const cleanup = () => signal?.removeEventListener('abort', abort);
      slot.pending.set(requestId, { resolve, reject, context, cleanup }); signal?.addEventListener('abort', abort, { once: true });
      slot.worker.postMessage({ type: 'read', requestId, url, context, maxBytes }); if (signal?.aborted) abort();
    });
  }
  close() {
    this.closed = true;
    for (const slot of this.workers) if (slot) {
      slot.worker.terminate(); for (const ticket of slot.pending.values()) { ticket.cleanup(); ticket.reject(new SyncError('cancelled')); }
    }
    this.workers = [];
  }
}
