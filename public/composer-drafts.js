// Text in the current tab is recoverable after a real reload. Ownership comes
// from authenticated /auth/me, before stored text can enter the composer.
const key = 'pi-coffee.composer-text.v1';
const maxDrafts = 30;
const maxCharacters = 2 * 1024 * 1024;
const validId = id => id === null || typeof id === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(id);

export function createComposerDrafts() {
  let owner = null;
  let timer = null;
  const drafts = new Map();

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!owner) return;
    try {
      if (drafts.size) sessionStorage.setItem(key, JSON.stringify({owner, drafts: [...drafts]}));
      else sessionStorage.removeItem(key);
    } catch { /* Browser storage may be disabled or full. Keep the in-page copy. */ }
  }

  function setScope(user) {
    if (owner === user) return;
    if (timer !== null) flush();
    drafts.clear();
    owner = user;
    if (!owner) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (!saved) return;
      if (saved.owner !== owner || !Array.isArray(saved.drafts)) {
        sessionStorage.removeItem(key);
        return;
      }
      let remaining = maxCharacters;
      for (const item of saved.drafts.slice(-maxDrafts).reverse()) {
        if (!Array.isArray(item)) continue;
        const [id, text] = item;
        if (!validId(id) || typeof text !== 'string' || !text || text.length > remaining || drafts.has(id)) continue;
        drafts.set(id, text);
        remaining -= text.length;
      }
      const chronological = [...drafts].reverse();
      drafts.clear();
      for (const entry of chronological) drafts.set(...entry);
    } catch { /* Invalid storage cannot block opening a task. */ }
  }

  function set(id, text) {
    if (!validId(id) || (drafts.get(id) || '') === text) return;
    drafts.delete(id);
    if (text) drafts.set(id, text.slice(0, maxCharacters));
    let size = [...drafts.values()].reduce((total, value) => total + value.length, 0);
    while (drafts.size > maxDrafts || size > maxCharacters) {
      const first = drafts.keys().next().value;
      size -= drafts.get(first).length;
      drafts.delete(first);
    }
    if (owner && timer === null) timer = setTimeout(flush, 200);
  }

  function clear() {
    clearTimeout(timer);
    timer = null;
    drafts.clear();
    try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
  }

  return {setScope, get: id => drafts.get(id) || '', set, flush, clear};
}
