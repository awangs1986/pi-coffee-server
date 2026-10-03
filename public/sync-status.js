// Selection-scoped synchronization feedback. This never controls task execution,
// composer availability, focus, scrolling, or network retries by itself.
const STATES = new Set(['idle', 'syncing', 'synced', 'error', 'timeout', 'offline']);
const TEXT = {
  idle: '', syncing: '正在同步最新对话…', synced: '已同步',
  error: '同步失败，本地内容仍可阅读', timeout: '同步较慢，本地内容仍可阅读',
  offline: '当前离线，正在显示本地内容',
};
const FAILURES = new Set(['error', 'timeout', 'offline']);

function pixelCat(document) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 28 20');
  svg.setAttribute('class', 'running-cat');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('shape-rendering', 'crispEdges');
  // Only fixed, code-owned pixel geometry enters this SVG. No transcript markup.
  svg.innerHTML = '<g class="cat-body">' +
    '<path class="cat-tail" d="M2 3h2v5h4v3H4V9H2z"/>' +
    '<path d="M7 8h10V6h2V2h2v2h3V2h2v9h-3v2H9v-1H7z"/>' +
    '<path class="cat-eye" d="M23 6h1v1h-1z"/>' +
    '<g class="cat-legs cat-legs-a"><path d="M8 12h3v3H8v2H5v-2h3zm10 0h3v4h3v2h-5v-3h-1z"/></g>' +
    '<g class="cat-legs cat-legs-b"><path d="M9 12h3v5H9zm8 0h3v5h-3z"/></g>' +
    '<g class="cat-legs cat-legs-c"><path d="M8 12h3v2h3v2H9v-2H8zm11 0h3v3h-3v3h-4v-2h3v-2h1z"/></g>' +
    '<g class="cat-legs cat-legs-d"><path d="M10 12h3v4h-3zm7 0h3v3h-3z"/></g></g>';
  return svg;
}

export function createSyncStatus(container, { onRetry = () => {}, timeoutMs = 8000, onTimeout = () => {} } = {}) {
  const document = container.ownerDocument;
  const root = document.createElement('div'); root.className = 'conversation-sync-status'; root.hidden = true;
  const cat = pixelCat(document);
  const text = document.createElement('span'); text.className = 'sync-status-text';
  text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite'); text.setAttribute('aria-atomic', 'true');
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'sync-retry-button';
  retry.textContent = '重试同步'; retry.hidden = true;
  root.append(cat, text, retry); container.append(root);
  let conversationId = null, generation = 0, state = 'idle', timer = null, disposed = false;
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  function paint(next, message) {
    state = next; root.dataset.state = next; root.dataset.running = String(next === 'syncing');
    root.hidden = !conversationId || next === 'idle'; cat.style.display = next === 'syncing' ? '' : 'none';
    text.textContent = typeof message === 'string' && message ? message.slice(0, 512) : TEXT[next];
    retry.hidden = !FAILURES.has(next);
    root.setAttribute('aria-busy', String(next === 'syncing'));
  }
  function startDeadline() {
    const expectedConversation = conversationId, expectedGeneration = generation;
    const timeout = Math.max(1, Number(timeoutMs) || 8000);
    timer = setTimeout(() => {
      timer = null;
      if (disposed || conversationId !== expectedConversation || generation !== expectedGeneration || state !== 'syncing') return;
      paint('timeout'); onTimeout(expectedConversation);
    }, timeout);
  }
  retry.addEventListener('click', () => {
    if (disposed || !conversationId || !FAILURES.has(state)) return;
    // A retry is an explicit callback. Animation resumes only when a new sync
    // has actually been started and reported by the controller.
    onRetry(conversationId);
  });
  paint('idle');
  return {
    element: root,
    select(id, { viewGeneration } = {}) {
      if (disposed) return null;
      clear(); conversationId = id || null; generation = viewGeneration ?? generation + 1; paint('idle');
      return { conversationId, viewGeneration: generation };
    },
    update(update) {
      if (disposed || !conversationId || update?.conversationId !== conversationId ||
          (update.viewGeneration !== undefined && update.viewGeneration !== generation) || !STATES.has(update.state)) return false;
      const wasSyncing = state === 'syncing';
      if (update.state !== 'syncing') clear();
      paint(update.state, update.message);
      if (update.state === 'syncing' && !wasSyncing) startDeadline();
      return true;
    },
    get state() { return state; },
    dispose() { clear(); disposed = true; root.remove(); },
  };
}
