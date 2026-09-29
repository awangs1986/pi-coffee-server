// Rendering of messages, tool calls and Markdown. Pure view code: it turns
// data the Host already produced into DOM and never talks to the network.
import { Marked } from './vendor-marked.js';
import DOMPurify from './vendor-purify.js';
import { highlight, normalizeLang } from './highlight.js';
import { collapseContext, diffLines, diffStats } from './diff.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Markdown ----------
const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const l = normalizeLang((lang || '').split(/\s+/)[0]);
      const label = (lang || '').split(/\s+/)[0] || 'text';
      return `<div class="codeblock"><div class="codeblock-head"><span class="codeblock-lang">${esc(label)}</span><button type="button" class="codeblock-copy" data-copy>复制</button></div><pre><code class="lang-${esc(l || 'text')}" data-language="${esc(label)}">${highlight(text, l)}</code></pre></div>`;
    },
    image({ href, text }) {
      if(/^(https?:|data:image\/(png|jpeg|gif|webp);base64,)/i.test(href || '')) return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer"><img src="'+esc(href)+'" alt="'+esc(text)+'"></a>';
      if(!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href))return esc(text);
      return '<a data-workspace-path="'+esc(href)+'" href="#"><img data-workspace-path="'+esc(href)+'" alt="'+esc(text)+'"></a><a class="artifact-download" data-workspace-path="'+esc(href)+'" data-workspace-download="true" href="#">下载图片</a>';
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const safe = /^(https?:|mailto:)/i.test(href || '') ? href : '#';
      if(safe==='#' && href && !/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(href)) return '<a href="#" data-workspace-path="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+text+'</a>';
      return '<a href="' + esc(safe) + '"' + (title ? ' title="' + esc(title) + '"' : '') + ' target="_blank" rel="noopener noreferrer">' + text + '</a>';
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const PURIFY = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['target', 'data-copy', 'data-language', 'data-workspace-path', 'data-workspace-download'],
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'svg', 'math'],
};

export function renderMarkdown(raw) {
  let html;
  try {
    html = marked.parse(String(raw ?? ''));
  } catch {
    html = '<p>' + esc(raw) + '</p>';
  }
  return DOMPurify.sanitize(html, PURIFY);
}

// ---------- copy ----------
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export function flashButton(button, label = '已复制') {
  const original = button.textContent;
  button.textContent = label;
  button.classList.add('done');
  setTimeout(() => { button.textContent = original; button.classList.remove('done'); }, 1200);
}

// Delegated handler for code block copy buttons inside a container.
export function installCopyHandlers(container) {
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const block = button.closest('.codeblock');
    const code = block?.querySelector('code');
    if (!code) return;
    if (await copyText(code.textContent)) flashButton(button);
  });
}

// ---------- tool calls ----------
const TOOL_LABEL = { bash: '运行命令', read: '读取文件', edit: '修改文件', write: '写入文件', grep: '搜索内容', find: '查找文件', ls: '列出目录', powershell: '运行命令' };

export function toolLabel(name) {
  return TOOL_LABEL[name] || name || 'tool';
}

export function toolSummary(name, args) {
  if (!args || typeof args !== 'object') return '';
  switch (name) {
    case 'bash':
    case 'powershell':
      return '$ ' + String(args.command || '');
    case 'read': {
      const range = args.offset || args.limit ? ` · 第 ${args.offset || 1}${args.limit ? '–' + ((args.offset || 1) + args.limit - 1) : ''} 行` : '';
      return String(args.path || args.file_path || '') + range;
    }
    case 'edit':
    case 'write':
      return String(args.path || args.file_path || '');
    case 'grep':
      return `${args.pattern || ''}${args.path ? '  in ' + args.path : ''}`;
    case 'find':
      return `${args.pattern || args.name || ''}${args.path ? '  in ' + args.path : ''}`;
    case 'ls':
      return String(args.path || '.');
    default: {
      const text = args.command || args.path || args.file_path || args.pattern || args.query || JSON.stringify(args);
      return String(text);
    }
  }
}

export function toolResultText(result) {
  if (typeof result === 'string') return result;
  const blocks = result && Array.isArray(result.content) ? result.content : [];
  const text = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return text.length > 12000 ? text.slice(0, 12000) + '\n…' : text;
}

function renderDiffOps(ops) {
  const collapsed = collapseContext(ops, 3);
  return '<div class="diff">' + collapsed.map((op) => {
    if (op.type === 'gap') return '<div class="diff-row gap">… ' + op.count + ' 行未变化 …</div>';
    const sign = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ';
    return '<div class="diff-row ' + op.type + '"><span class="sign">' + sign + '</span><span class="text">' + esc(op.line) + '</span></div>';
  }).join('') + '</div>';
}

export function renderPatchText(patch, { cursor = false } = {}) {

  const lines = String(patch).split('\n');
  let add = 0, del = 0;
  const rows = lines.map((line) => {
    const row = (cls, cells) => `<div class="diff-row ${cls}">${cells}</div>`;
    if (line.startsWith('+++') || line.startsWith('---')) return row('meta', `<span class="sign">${cursor ? ' ' : ''}</span><span class="text">${esc(line)}</span>`);
    if (line.startsWith('@@')) return row('gap', `<span class="sign">${cursor ? ' ' : ''}</span><span class="text">${esc(line)}</span>`);
    if (line.startsWith('+')) { add++; return row('add', `<span class="sign">${cursor ? ' ' : '+'}${cursor ? '<span class="cursor-add">+</span>' : ''}</span><span class="text">${esc(line.slice(1))}</span>`); }
    if (line.startsWith('-')) { del++; return row('del', `<span class="sign">${cursor ? '- ' : '-'}${cursor ? '<span class="cursor-space"> </span>' : ''}</span><span class="text">${esc(line.slice(1))}</span>`); }
    return row('ctx', `<span class="sign">${cursor ? '　' : ' '}</span><span class="text">${esc(line.startsWith(' ') ? line.slice(1) : line)}</span>`);
  });
  return `<div class="diff-stats">${cursor ? '<span class="add">+</span><span class="del">-</span> ' : ''}<span class="add">+${add}</span> <span class="del">−${del}</span></div><div class="diff">${rows.join('')}</div>`;
}

/** Body HTML for a tool card, chosen by tool type. */
export function toolBodyHtml(name, args, resultText, done, details) {
  const a = args && typeof args === 'object' ? args : {};
  const failed = resultText && /error|fail|not found|no match|could not/i.test(resultText.split('\n')[0] || '');
  if (name === 'edit') {
    // Prefer the diff Pi computed on the Host; fall back to the requested edits.
    const patch = details && typeof details.patch === 'string' && details.patch.trim() ? details.patch : details && typeof details.diff === 'string' && details.diff.trim() ? details.diff : null;
    if (patch) return renderPatchText(patch) + (failed ? '<pre class="tool-out">' + esc(resultText) + '</pre>' : '');
    const edits = Array.isArray(a.edits) ? a.edits : (a.oldText !== undefined || a.old_string !== undefined ? [a] : []);
    if (edits.length) {
      let add = 0, del = 0, body = '';
      for (const edit of edits) {
        const ops = diffLines(edit.oldText ?? edit.old_string ?? '', edit.newText ?? edit.new_string ?? '');
        const s = diffStats(ops); add += s.add; del += s.del;
        body += renderDiffOps(ops);
      }
      return '<div class="diff-stats"><span class="add">+' + add + '</span> <span class="del">−' + del + '</span></div>' + body + (failed || !done ? '<pre class="tool-out">' + esc(resultText || (done ? '' : '运行中…')) + '</pre>' : '');
    }
  }
  if (name === 'write' && typeof a.content === 'string') {
    const lines = a.content.replace(/\n$/, '').split('\n');
    const ops = lines.map((line) => ({ type: 'add', line }));
    return '<div class="diff-stats"><span class="add">+' + ops.length + '</span></div>' + renderDiffOps(ops) + (failed ? '<pre class="tool-out">' + esc(resultText) + '</pre>' : '');
  }
  if (name === 'read' && resultText) {
    const lang = normalizeLang(String(a.path || a.file_path || '').split('.').pop());
    return '<pre class="tool-out code"><code>' + highlight(resultText, lang) + '</code></pre>';
  }
  if (!resultText) return done ? '<div class="tool-empty">（无输出）</div>' : '<div class="tool-empty">运行中…</div>';
  return '<pre class="tool-out">' + esc(resultText) + '</pre>';
}

/** Files touched and +/- counts of a unified diff, for the "本轮改动" chip. */
export function patchSummary(patch) {
  let files = 0, add = 0, del = 0;
  for (const line of String(patch || '').split('\n')) {
    if (line.startsWith('+++ ')) files++;
    else if (line.startsWith('+') && !line.startsWith('+++')) add++;
    else if (line.startsWith('-') && !line.startsWith('---')) del++;
  }
  return { files, add, del };
}

// ---------- DOM builders ----------
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

export function fileChips(files) {
  const strip = el('div', 'file-chips');
  for (const file of files) {
    const chip = el(file.href ? 'a' : 'span', 'file-chip');
    const uploadPath = file.uploadPath || file.path;
    if (uploadPath) chip.dataset.uploadPath = uploadPath;
    if (file.href) { chip.href = file.href; chip.target = '_blank'; chip.rel = 'noopener'; chip.title = '下载 ' + file.name; }
    else if (uploadPath) { chip.title = uploadPath; }
    chip.innerHTML = '<span class="file-ico">📄</span><span class="file-name"></span><span class="file-size"></span>';
    chip.querySelector('.file-name').textContent = file.name;
    chip.querySelector('.file-size').textContent = typeof file.size === 'number' ? formatBytes(file.size) : (file.sizeText || '');
    strip.appendChild(chip);
  }
  return strip;
}

export function userBubble(entry) {
  const node = el('div', 'msg user');
  const bubble = el('div', 'bubble');
  const text = el('div', 'text', entry.text || '');
  bubble.appendChild(text);
  if (entry.files && entry.files.length) bubble.appendChild(fileChips(entry.files));
  if (entry.images && entry.images.length) {
    const strip = el('div', 'thumbs');
    for (const image of entry.images) {
      const img = document.createElement('img');
      img.src = 'data:' + image.mimeType + ';base64,' + image.data;
      img.alt = '附图';
      strip.appendChild(img);
    }
    bubble.appendChild(strip);
  } else if (entry.imageCount) {
    bubble.appendChild(el('div', 'thumbs-note', `[${entry.imageCount} 张图片]`));
  }
  node.appendChild(bubble);
  const tools = el('div', 'msg-tools');
  const copy = el('button', 'msg-tool', '复制');
  copy.type = 'button';
  copy.title = '复制这条消息';
  copy.addEventListener('click', async () => { if (await copyText(entry.text || '')) flashButton(copy); });
  tools.appendChild(copy);
  node.appendChild(tools);
  return node;
}

export function assistantNode(entry) {
  const node = el('div', 'msg assistant');
  const body = el('div', 'body');
  body.innerHTML = renderMarkdown(entry.text || '');
  const tools = el('div', 'msg-tools');
  const copy = el('button', 'msg-tool', '复制');
  copy.type = 'button';
  copy.title = '复制回复';
  copy.addEventListener('click', async () => { if (await copyText(entry.text || '')) flashButton(copy); });
  tools.appendChild(copy);
  node.appendChild(body);
  node.appendChild(tools);
  return node;
}

export function updateAssistant(node, text) {
  const body = node.querySelector('.body');
  if (body) body.innerHTML = renderMarkdown(text || '');
}

export function toolCard(entry) {
  const node = el('details', 'tool' + (entry.done ? (entry.error ? ' error' : '') : ' running'));
  node.innerHTML = '<summary><span class="chev">▸</span><span class="name"></span><span class="arg"></span><span class="state"></span></summary><div class="tool-body"></div>';
  fillToolCard(node, entry);
  return node;
}

export function fillToolCard(node, entry) {
  node.className = 'tool' + (entry.done ? (entry.error ? ' error' : '') : ' running');
  node.querySelector('.name').textContent = toolLabel(entry.name);
  node.querySelector('.arg').textContent = toolSummary(entry.name, entry.args);
  node.querySelector('.state').textContent = entry.done ? (entry.error ? '失败' : '完成') : '运行中';
  node.querySelector('.tool-body').innerHTML = toolBodyHtml(entry.name, entry.args, entry.result || '', entry.done, entry.details);
}

export function toolResultDetails(result) {
  return result && typeof result === 'object' && result.details && typeof result.details === 'object' ? result.details : undefined;
}

/** A collapsible group of tool cards for one run ("工作过程 · N 步"). */
export function activityGroup() {
  const node = el('details', 'activity');
  node.innerHTML = '<summary><span class="chev">▸</span><span class="label">工作过程</span><span class="count"></span><span class="spinner"></span></summary><div class="activity-body"></div>';
  return node;
}

export function updateActivity(node, count, running) {
  node.querySelector('.count').textContent = count + ' 步';
  node.classList.toggle('running', running);
  if (running) node.open = true;
}

export function noteNode(entry) {
  return el('div', 'note' + (entry.failure ? ' failure' : ''), entry.text || '');
}

export function relativeTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.round(h / 24);
  if (d < 7) return d + ' 天前';
  return new Date(t).toLocaleDateString();
}


export { timeGroup } from './sidebar.js';
