// Stable-entity scroll restoration. Never retain DOM from another view generation.
const ID_SELECTOR = '[data-entity-id], [data-message-id]';
const id = node => node.dataset.entityId || node.dataset.messageId;
export class ScrollAnchor {
  constructor(scroller, container = scroller, { isCurrent = () => true, onAdjusted = () => {}, ResizeObserver = globalThis.ResizeObserver } = {}) {
    this.scroller = scroller; this.container = container; this.isCurrent = isCurrent; this.onAdjusted = onAdjusted;
    this.ResizeObserver = ResizeObserver; this.followTail = undefined; this.observer = undefined; this.anchor = undefined;
    this.onScroll = () => {
      if (!this.isCurrent()) return;
      const nearTail = this.scroller.scrollHeight - this.scroller.clientHeight - this.scroller.scrollTop <= 48;
      this.followTail = nearTail;
      // A user's scroll redefines the anchor; late layout must not undo it.
      if (this.observer && !this.compensating) this.anchor = this.capture();
    };
    scroller.addEventListener('scroll', this.onScroll, { passive: true });
  }
  capture() {
    const top = this.scroller.getBoundingClientRect().top, bottom = top + this.scroller.clientHeight;
    const nodes = [...this.container.querySelectorAll(ID_SELECTOR)];
    const index = nodes.findIndex(node => { const r = node.getBoundingClientRect(); return r.bottom > top && r.top < bottom; });
    const node = nodes[index];
    let block;
    if (node) block = [...node.querySelectorAll('[data-block-id]')].find(item => item.getBoundingClientRect().bottom > top);
    const target = block || node, y = target ? target.getBoundingClientRect().top - top : 0;
    return { anchorMessageId: node ? id(node) : undefined, blockId: block?.dataset.blockId,
      previousMessageId: nodes[index - 1] ? id(nodes[index - 1]) : undefined, nextMessageId: nodes[index + 1] ? id(nodes[index + 1]) : undefined,
      offset: Math.max(0, -y), y, scrollTop: this.scroller.scrollTop,
      followTail: this.followTail ?? (this.scroller.scrollHeight - this.scroller.clientHeight - this.scroller.scrollTop <= 48) };
  }
  restore(anchor) {
    if (!anchor || !this.isCurrent()) return false;
    this.compensating = true;
    try {
      if (anchor.followTail) { this.scroller.scrollTop = Math.max(0, this.scroller.scrollHeight - this.scroller.clientHeight); this.followTail = true; return true; }
      const nodes = [...this.container.querySelectorAll(ID_SELECTOR)];
      let node = nodes.find(node => id(node) === anchor.anchorMessageId), adjusted = false;
      if (!node) { node = nodes.find(node => id(node) === anchor.nextMessageId) || nodes.find(node => id(node) === anchor.previousMessageId); adjusted = !!node; }
      if (!node) { this.scroller.scrollTop = Math.max(0, anchor.scrollTop || 0); this.followTail = false; return false; }
      const block = anchor.blockId && [...node.querySelectorAll('[data-block-id]')].find(item => item.dataset.blockId === anchor.blockId);
      const y = (block || node).getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
      this.scroller.scrollTop += y - (Number.isFinite(anchor.y) ? anchor.y : 0); this.followTail = false;
      if (adjusted) this.onAdjusted({ from: anchor.anchorMessageId, to: id(node) });
      return true;
    } finally { this.compensating = false; }
  }
  observe(anchor = this.capture()) {
    this.stopObserving(); this.anchor = anchor;
    if (!this.ResizeObserver || !this.isCurrent()) return;
    this.originalOverflowAnchor = this.scroller.style.overflowAnchor; this.scroller.style.overflowAnchor = 'none';
    this.observer = new this.ResizeObserver(() => { if (this.isCurrent() && this.anchor) this.restore(this.anchor); });
    this.observer.observe(this.container);
    for (const node of this.container.querySelectorAll(ID_SELECTOR)) this.observer.observe(node);
  }
  stopObserving() {
    this.observer?.disconnect(); this.observer = undefined;
    if (this.originalOverflowAnchor !== undefined) { this.scroller.style.overflowAnchor = this.originalOverflowAnchor; this.originalOverflowAnchor = undefined; }
  }
  disconnect() { this.stopObserving(); this.anchor = undefined; this.scroller.removeEventListener('scroll', this.onScroll); }
}
