// Older history is demand-loaded only. Failures keep the cursor, and one cursor
// has at most one actual request even if scroll fires repeatedly.
export class HistoryPager {
  constructor({ repository, conversationId, onPage = () => {}, onError = () => {}, isCurrent = () => true, scroller, threshold = 160 } = {}) {
    this.repository = repository; this.conversationId = conversationId; this.onPage = onPage; this.onError = onError;
    this.isCurrent = isCurrent; this.scroller = scroller; this.threshold = threshold;
    this.cursor = undefined; this.pending = new Map(); this.generation = 0; this.closed = false;
    this.scroll = () => { if (this.scroller.scrollTop <= this.threshold) void this.loadOlder().catch(() => {}); };
  }
  setCursor(cursor) { if (cursor !== this.cursor) this.generation++; this.cursor = typeof cursor === 'string' && cursor ? cursor : undefined; }
  start() { if (this.started || this.closed) return; this.started = true; this.scroller?.addEventListener('scroll', this.scroll, { passive: true }); }
  loadOlder() {
    const cursor = this.cursor;
    if (this.closed || !this.isCurrent() || !cursor) return Promise.resolve(undefined);
    if (this.pending.has(cursor)) return this.pending.get(cursor);
    const generation = this.generation;
    const promise = this.repository.loadOlder(this.conversationId, cursor).then(page => {
      if (!page || this.closed || !this.isCurrent() || generation !== this.generation || cursor !== this.cursor) return undefined;
      // Do not eagerly recurse: reaching another page is another user demand.
      this.setCursor(page.olderCursor); this.onPage(page); return page;
    }).catch(error => {
      if (!this.closed && this.isCurrent() && generation === this.generation) this.onError(error);
      throw error;
    }).finally(() => { if (this.pending.get(cursor) === promise) this.pending.delete(cursor); });
    this.pending.set(cursor, promise); return promise;
  }
  dispose() { this.closed = true; this.generation++; this.scroller?.removeEventListener('scroll', this.scroll); this.pending.clear(); }
}
