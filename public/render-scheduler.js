// Rendering is a lossy projection of already-ingested data. Coalesce only view
// jobs here; command delivery and ordered repository events never enter this queue.
const VIEW_KEYS = ['userScope', 'conversationId', 'epoch', 'viewGeneration'];
const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();
const defaultRequest = fn => globalThis.requestAnimationFrame ? requestAnimationFrame(fn) : setTimeout(fn, 16);
const defaultCancel = id => globalThis.cancelAnimationFrame ? cancelAnimationFrame(id) : clearTimeout(id);

function compareRevision(a, b) {
  const left = String(a ?? '0').replace(/^0+(?=\d)/, '');
  const right = String(b ?? '0').replace(/^0+(?=\d)/, '');
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return left.length === right.length ? (left > right ? 1 : left < right ? -1 : 0) : left.length - right.length;
  }
  return left === right ? 0 : null;
}

/** A run must perform one bounded synchronous unit and may return its next unit. */
export function createRenderScheduler({
  budgetMs = 4, maxPending = 256, maxStepsPerFrame = 64,
  requestFrame = defaultRequest, cancelFrame = defaultCancel, now = defaultNow,
  onError = () => {}, onMetric = () => {},
} = {}) {
  const jobs = new Map();
  const latest = new Map();
  let view = null, frame = null, disposed = false, sequence = 0, running = false, turns = 0;
  const budget = Math.max(1, Math.min(16, Number(budgetMs) || 4));
  const capacity = Math.max(1, Math.min(1024, Number(maxPending) || 256));
  const matchesView = job => view && VIEW_KEYS.every(key => job[key] === view[key]);
  const isCurrent = job => !disposed && matchesView(job) && latest.get(job.entityId) === job.token && (!job.isCurrent || job.isCurrent());
  function request() {
    if (!disposed && !running && jobs.size && frame === null) frame = requestFrame(flush);
  }
  function flush() {
    frame = null;
    running = true;
    const start = now();
    let steps = 0;
    try {
      while (jobs.size && steps < Math.max(1, Math.min(256, Number(maxStepsPerFrame) || 64)) && (steps === 0 || now() - start < budget)) {
        // The queue is capped. Every sixteenth unit grants the oldest job a turn
        // so history/user paging cannot starve behind repeatedly dirty live text.
        let selected;
        for (const candidate of jobs.values()) {
          if (!selected || (turns % 16 !== 15 && candidate.priority < selected.priority)) selected = candidate;
        }
        jobs.delete(selected.entityId);
        if (!isCurrent(selected)) continue;
        steps++; turns++;
        const before = now();
        try {
          const next = selected.run({ isCurrent: () => isCurrent(selected), view: { ...view } });
          if (typeof next === 'function' && isCurrent(selected) && !jobs.has(selected.entityId)) {
            jobs.set(selected.entityId, { ...selected, run: next });
          }
        } catch (error) { onError(error); }
        const durationMs = now() - before;
        if (durationMs > budget) onMetric({ type: 'render_budget_overrun', durationMs, budgetMs: budget });
      }
    } finally { running = false; request(); }
  }
  function clear() {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    jobs.clear(); latest.clear();
  }
  return {
    setView(next) { clear(); view = next ? Object.freeze({ ...next }) : null; return view; },
    get view() { return view; },
    get pendingCount() { return jobs.size; },
    schedule(job) {
      if (disposed || !view || !job?.entityId || typeof job.run !== 'function') return false;
      const candidate = { ...view, priority: 2, ...job };
      if (!matchesView(candidate)) return false;
      const previous = latest.get(candidate.entityId);
      if (previous && compareRevision(candidate.entityRevision, previous.revision) < 0) return false;
      if (!jobs.has(candidate.entityId) && jobs.size >= capacity) return false;
      candidate.token = { revision: candidate.entityRevision, sequence: ++sequence };
      latest.set(candidate.entityId, candidate.token);
      jobs.set(candidate.entityId, candidate);
      request(); return true;
    },
    cancelEntity(entityId) { jobs.delete(entityId); latest.delete(entityId); },
    clear,
    dispose() { clear(); view = null; disposed = true; },
  };
}
