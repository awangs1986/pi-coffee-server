// Pure sidebar / usage logic for the browser shell (no DOM). Kept separate so
// it can be unit-tested; app.js renders whatever these functions decide.
// Time buckets for the sidebar; lives here (not render.js) so this module stays DOM-free.
export function timeGroup(iso) {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '更早';
  const now = new Date();
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(now) - start(t)) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return '最近 7 天';
  if (days < 30) return '最近 30 天';
  return '更早';
}


// Rank: who needs you first. 0 = a dialog is waiting, 1 = finished while you
// were away, 2 = running now, 3 = everything else. Ties: newest first.
export function attentionOf(session) {
  if (!session) return null;
  if (session.attention === 'waiting') return 'waiting';
  if (session.attention === 'finished') return 'finished';
  if (session.running) return 'running';
  return null;
}

function rankOf(session) {
  switch (attentionOf(session)) {
    case 'waiting': return 0;
    case 'finished': return 1;
    case 'running': return 2;
    default: return 3;
  }
}

/** View-only stable activity order. Never freezes timestamps or native state. */
export function createSidebarOrder() {
  let active = new Map();
  return {
    snapshot(list) {
      const next = new Map();
      const result = list.map(session => {
        const rank = rankOf(session);
        if (rank === 3) return session;
        const prior = active.get(session.id);
        const state = prior?.rank === rank ? prior : {rank, at:session.updatedAt || session.createdAt || ''};
        next.set(session.id, state);
        return {...session, sidebarOrderAt:state.at};
      });
      active = next;
      return result;
    },
    clear() { active.clear(); },
  };
}

export function orderSessions(list) {
  return list.slice().sort((a, b) => {
    const r = rankOf(a) - rankOf(b);
    if (r !== 0) return r;
    return (b.sidebarOrderAt ?? b.updatedAt ?? '').localeCompare(a.sidebarOrderAt ?? a.updatedAt ?? '') || String(a.id).localeCompare(String(b.id));
  });
}

/** Threads started outside the web page (Codex `cli` / `exec`), shown in their own group. */
export function isTerminalSession(session) {
  const source = session && session.source;
  return typeof source === 'string' && source !== 'appServer' && source !== 'vscode';
}

/**
 * Ordered groups for rendering: 需要你 / 运行中 / time buckets / 本机终端会话.
 * Terminal sessions are listed last regardless of age: they are somebody
 * else's work until you take them over.
 */
export function sessionGroups(list) {
  const groups = [];
  const push = (label, session) => {
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.sessions.push(session);
    else groups.push({ label, sessions: [session] });
  };
  const ours = orderSessions(list.filter((s) => !isTerminalSession(s)));
  for (const session of ours) {
    const a = attentionOf(session);
    if (a === 'waiting' || a === 'finished') push('需要你', session);
    else if (a === 'running') push('运行中', session);
    else push(timeGroup(session.updatedAt), session);
  }
  const terminal = orderSessions(list.filter(isTerminalSession));
  for (const session of terminal) push('本机终端会话', session);
  return groups;
}

// ---------- account usage meters (P1) ----------

function remaining(window) {
  return Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)));
}

/** Compact top-bar label plus a severity level: ok / warn (≤25% left) / danger (≤10% left). */
export function usageBadge(limits) {
  if (!limits) return null;
  const parts = [];
  let worst = 100;
  if (limits.fiveHour) { const r = remaining(limits.fiveHour); parts.push('5h 余 ' + r + '%'); worst = Math.min(worst, r); }
  if (limits.weekly) { const r = remaining(limits.weekly); parts.push('周 余 ' + r + '%'); worst = Math.min(worst, r); }
  if (parts.length === 0) return null;
  return { text: parts.join(' · '), level: worst <= 10 ? 'danger' : worst <= 25 ? 'warn' : 'ok' };
}

/** "1 小时 30 分后重置" style countdown; empty when no reset is scheduled. */
export function formatReset(iso, now = Date.now()) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return '即将重置';
  const totalMin = Math.round(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days) parts.push(days + ' 天');
  if (hours) parts.push(hours + ' 小时');
  if (!days && mins) parts.push(mins + ' 分');
  if (parts.length === 0) parts.push('1 分');
  return parts.join(' ') + '后重置';
}

// ---------- docked diff review (P2) ----------

/**
 * Split a unified diff into files: { path, status, add, del, text }.
 * Works with `diff --git` headers (Codex) and with bare ---/+++ pairs.
 */
export function patchFiles(patch) {
  const lines = String(patch || '').split('\n');
  const files = [];
  let current = null;
  const start = () => { current = { path: '', status: 'modified', add: 0, del: 0, lines: [] }; files.push(current); };
  for (const line of lines) {
    if (line.startsWith('diff --git ')) { start(); const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line); if (m) current.path = m[2]; current.lines.push(line); continue; }
    if (line.startsWith('--- ')) { if (!current || current.lines.some((l) => l.startsWith('+++ '))) start(); if (line.slice(4) === '/dev/null') current.status = 'added'; current.lines.push(line); continue; }
    if (!current) { if (line.trim() === '') continue; start(); }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target === '/dev/null') current.status = 'deleted';
      else if (!current.path) current.path = target.replace(/^b\//, '');
      current.lines.push(line);
      continue;
    }
    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('+')) current.add++;
    else if (line.startsWith('-')) current.del++;
    current.lines.push(line);
  }
  return files.filter((f) => f.lines.length > 0).map(({ lines: l, ...rest }) => ({ ...rest, text: l.join('\n') }));
}

/** Visible sidebar groups are independent of repository registration. */
export function sidebarGroups(projects=[],sidebar={}) {
  const hidden=new Set(sidebar.hiddenProjects||[]);
  return [...projects.filter(p=>!hidden.has(p.id)).map(p=>({...p,kind:'project'})),...(sidebar.groups||[]).map(g=>({...g,kind:'custom'}))];
}
export function sidebarGroupMembers(groupId,conversations=[],sidebar={},deletedIds=[]) {
  const assignments=sidebar.assignments||{},deleted=new Set(deletedIds),ids=new Set();
  for(const c of conversations)if((Object.hasOwn(assignments,c.id)?assignments[c.id]:c.projectId)===groupId)ids.add(c.id);
  for(const [id,group] of Object.entries(assignments))if(group===groupId&&!deleted.has(id))ids.add(id);
  return ids;
}
