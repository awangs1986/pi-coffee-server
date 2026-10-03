// Rendering of messages, tool calls and Markdown. Pure view code: it turns
// data the Host already produced into DOM and never talks to the network.
import { Marked } from './vendor-marked.js';
import DOMPurify from './vendor-purify.js';
import { highlight, normalizeLang } from './highlight.js';
import { collapseContext, diffLines, diffStats } from './diff.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every plain-text DOM commit is at most 8 KiB of UTF-8, even for CJK/emoji.
// Scan only the requested slice; never TextEncoder.encode(theEntireTranscript).
export const TEXT_CHUNK_BYTES = 8 * 1024;
export const TRANSCRIPT_WINDOW_BYTES = 64 * 1024;
const boundedViews = new WeakMap();
const highSurrogate = c => c >= 0xD800 && c <= 0xDBFF;
const lowSurrogate = c => c >= 0xDC00 && c <= 0xDFFF;
const codeBytes = c => c < 0x80 ? 1 : c < 0x800 ? 2 : 3;

export function boundedTextSlice(raw, { start = 0, end, maxBytes = TEXT_CHUNK_BYTES, tail = false } = {}) {
  const text = typeof raw === 'string' ? raw : '';
  const budget = Math.max(0, Math.min(TEXT_CHUNK_BYTES, Number(maxBytes) || 0));
  let left = Math.max(0, Math.min(text.length, Math.floor(start) || 0));
  let right = Math.max(left, Math.min(text.length, end === undefined ? text.length : Math.floor(end) || 0));
  if (left && lowSurrogate(text.charCodeAt(left)) && highSurrogate(text.charCodeAt(left - 1))) left++;
  if (right < text.length && lowSurrogate(text.charCodeAt(right)) && highSurrogate(text.charCodeAt(right - 1))) right--;
  let bytes = 0;
  if (tail) {
    let index = right;
    while (index > left) {
      const code = text.charCodeAt(index - 1);
      const pair = lowSurrogate(code) && index - 2 >= left && highSurrogate(text.charCodeAt(index - 2));
      const size = pair ? 4 : codeBytes(code);
      if (bytes + size > budget) break;
      bytes += size; index -= pair ? 2 : 1;
    }
    left = index;
  } else {
    let index = left;
    while (index < right) {
      const code = text.charCodeAt(index);
      const pair = highSurrogate(code) && index + 1 < right && lowSurrogate(text.charCodeAt(index + 1));
      const size = pair ? 4 : codeBytes(code);
      if (bytes + size > budget) break;
      bytes += size; index += pair ? 2 : 1;
    }
    right = index;
  }
  return { text: text.slice(left, right), start: left, end: right, bytes, totalLength: text.length };
}

/** Display-only newest window. Never passes tool arguments, URLs or live controls. */
export function boundedTranscriptWindow(source, { maxEntries = 40, maxBytes = TRANSCRIPT_WINDOW_BYTES, maxEntryBytes = TEXT_CHUNK_BYTES } = {}) {
  const all = Array.isArray(source) ? source : [];
  const count = Math.max(1, Math.min(40, Number(maxEntries) || 40));
  const budget = Math.max(0, Math.min(TRANSCRIPT_WINDOW_BYTES, Number(maxBytes) || 0));
  const entries = [];
  let textBytes = 0, index = all.length - 1, truncated = false;
  for (; index >= 0 && entries.length < count && textBytes < budget; index--) {
    const item = all[index];
    const kind = item?.kind || item?.k || 'note';
    const raw = kind === 'tool' ? item?.result ?? item?.text : item?.text;
    const slice = boundedTextSlice(raw, { tail: true, maxBytes: Math.min(maxEntryBytes, budget - textBytes) });
    if (slice.totalLength && !slice.bytes) break;
    const partial = slice.start > 0 || slice.end < slice.totalLength;
    entries.push({ kind, ...(kind==='tool'?{name:boundedTextSlice(item?.name,{maxBytes:256}).text}:{}), id: item?.id, entityRevision: item?.entityRevision, text: slice.text,
      failure: Boolean(item?.failure || item?.isError || item?.error), textStart: slice.start,
      textEnd: slice.end, textLength: slice.totalLength, textTruncated: partial });
    textBytes += slice.bytes; truncated ||= partial;
  }
  return { entries: entries.reverse(), textBytes, truncated: truncated || index >= 0, startIndex: index + 1 };
}

/** One replaceable page per message, not an ever-growing text/DOM expansion. */
export function renderBoundedText(container, raw, { maxBytes = TEXT_CHUNK_BYTES, isCurrent = () => true } = {}) {
  const text = typeof raw === 'string' ? raw : '';
  let state = boundedViews.get(container);
  if (!state || !container.contains(state.content)) {
    const doc = container.ownerDocument;
    const content = doc.createElement('div'); content.className = 'bounded-text-content';
    const pages = doc.createElement('div'); pages.className = 'bounded-text-pages';
    const label = doc.createElement('span'); label.className = 'bounded-text-range';
    const buttons = {};
    state = { text, content, pages, label, buttons, start: 0, end: 0, tail: true, maxBytes, isCurrent };
    for (const [action, title] of [['previous', '上一段'], ['next', '下一段'], ['latest', '最新内容']]) {
      const button = doc.createElement('button'); button.type = 'button'; button.className = 'msg-tool';
      button.dataset.textPage = action; button.textContent = title; buttons[action] = button;
      button.addEventListener('click', () => {
        if (boundedViews.get(container) !== state || !container.isConnected || !container.contains(content) || !state.isCurrent()) return;
        if (action === 'previous' && state.start > 0) {
          state.tail = false; paintTextPage(state, { end: state.start, tail: true });
        } else if (action === 'next' && state.end < state.text.length) {
          state.tail = false; paintTextPage(state, { start: state.end });
          state.tail = state.end === state.text.length;
          if (state.tail) paintTextPage(state, { tail: true });
        } else if (action === 'latest') { state.tail = true; paintTextPage(state, { tail: true }); }
      });
      pages.append(button);
    }
    pages.append(label); container.replaceChildren(content, pages); boundedViews.set(container, state);
  }
  state.text = text; state.maxBytes = maxBytes; state.isCurrent = isCurrent;
  if (!isCurrent()) return;
  if (state.start > text.length) state.tail = true;
  paintTextPage(state, state.tail ? { tail: true } : { start: state.start });
  return { start: state.start, end: state.end, bytes: state.bytes };
}

function paintTextPage(state, options) {
  const slice = boundedTextSlice(state.text, { ...options, maxBytes: state.maxBytes });
  state.start = slice.start; state.end = slice.end; state.bytes = slice.bytes;
  // Preserve the text node itself for selection and cheap equal-page updates.
  if (state.content.textContent !== slice.text) state.content.textContent = slice.text;
  state.content.dataset.textStart = String(slice.start); state.content.dataset.textEnd = String(slice.end);
  state.pages.hidden = slice.start === 0 && slice.end === state.text.length;
  state.buttons.previous.disabled = slice.start === 0;
  state.buttons.next.disabled = slice.end === state.text.length;
  state.buttons.latest.disabled = slice.end === state.text.length;
  state.label.textContent = `第 ${slice.start + 1}–${slice.end} / ${state.text.length} 字符 · 纯文本分页`;
}

function fitsRichText(text, maxBytes = TEXT_CHUNK_BYTES) {
  return typeof text !== 'string' || (text.length <= maxBytes && boundedTextSlice(text, { maxBytes }).end === text.length);
}

// Bounded parameter summaries do not call user-controlled toJSON or traverse an
// arbitrary argument tree. Large known fields are separately pageable below.
function argumentPreview(args) {
  if (!args || typeof args !== 'object') return '';
  let text = '', keys = 0;
  for (const key in args) {
    if (!Object.hasOwn(args, key)) continue;
    if (++keys > 16 || text.length > 2048) { text += '\n…（参数摘要）'; break; }
    const value = args[key];
    if (typeof value === 'function' || value === undefined) continue;
    text += `${boundedTextSlice(key, { maxBytes: 128 }).text}: ${typeof value === 'string' ? boundedTextSlice(value, { maxBytes: 1024 }).text : value && typeof value === 'object' ? '[…]' : String(value)}\n`;
  }
  return boundedTextSlice(text).text;
}


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
      return '<span class="workspace-image"><span class="workspace-image-status" role="status">等待图片访问授权…</span><a data-workspace-path="'+esc(href)+'" href="#"><img data-workspace-path="'+esc(href)+'" alt="'+esc(text)+'"></a><a class="artifact-download" data-workspace-path="'+esc(href)+'" data-workspace-download="true" href="#">下载图片</a></span>';
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
      const text = args.command || args.path || args.file_path || args.pattern || args.query || '参数';
      return String(text);
    }
  }
}

export function toolResultText(result) {
  if (typeof result === 'string') return result;
  const blocks = result && Array.isArray(result.content) ? result.content : [];
  const text = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  return text;
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
  const text = el('div', 'text');
  if (fitsRichText(entry.text)) text.textContent = entry.text || '';
  else renderBoundedText(text, entry.text || '');
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

export function assistantNode(entry, { done = true } = {}) {
  const node = el('div', 'msg assistant');
  const body = el('div', 'body');
  if (done && fitsRichText(entry.text)) body.innerHTML = renderMarkdown(entry.text || '');
  else renderBoundedText(body, entry.text || '');
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

export function updateAssistant(node, text, { done = false, isCurrent = () => true } = {}) {
  if (!isCurrent()) return;
  const body = node.querySelector('.body');
  if (!body) return;
  if (done && fitsRichText(text)) {
    boundedViews.delete(body);
    body.innerHTML = renderMarkdown(text || '');
  } else renderBoundedText(body, text || '', { isCurrent });
}

const toolViews = new WeakMap();

export function toolCard(entry) {
  const node = el('details', 'tool');
  node.innerHTML = '<summary><span class="chev">▸</span><span class="name"></span><span class="arg"></span><span class="state"></span></summary><div class="tool-body"></div>';
  node.addEventListener('toggle', () => {
    const state = toolViews.get(node);
    if (!state || !node.isConnected) return;
    if (node.open) renderToolBody(node, state.entry);
    else { const body = node.querySelector('.tool-body'); boundedViews.delete(body); body.replaceChildren(); }
  });
  fillToolCard(node, entry);
  return node;
}

export function fillToolCard(node, entry) {
  toolViews.set(node, { ...toolViews.get(node), entry });
  node.className = 'tool' + (entry.done ? (entry.error ? ' error' : '') : ' running');
  node.querySelector('.name').textContent = boundedTextSlice(toolLabel(entry.name), { maxBytes: 256 }).text;
  node.querySelector('.arg').textContent = boundedTextSlice(toolSummary(entry.name, entry.args), { maxBytes: 512 }).text;
  const length = typeof entry.result === 'string' ? entry.result.length : 0;
  node.querySelector('.state').textContent = (entry.done ? (entry.error ? '失败' : '完成') : '运行中') + (length ? ` · ${length} 字符` : '');
  // A closed card must not parse, stringify, highlight or diff its body.
  if (node.open) renderToolBody(node, entry);
}

function toolSources(entry, editIndex = 0) {
  const sources = [];
  const add = (label, text) => { if (typeof text === 'string' && text.length) sources.push({ label, text }); };
  add('输出', entry.result);
  add('修改', entry.details?.patch || entry.details?.diff);
  add('写入内容', entry.args?.content);
  const edit = Array.isArray(entry.args?.edits) ? entry.args.edits[editIndex] : entry.args;
  add('修改前', edit?.oldText ?? edit?.old_string);
  add('修改后', edit?.newText ?? edit?.new_string);
  add('命令', entry.args?.command);
  add('参数摘要', argumentPreview(entry.args));
  return sources;
}

function renderToolBody(node, entry) {
  const body = node.querySelector('.tool-body');
  const state = toolViews.get(node);
  const editCount = Array.isArray(entry.args?.edits) ? entry.args.edits.length : 0;
  state.editIndex = Math.max(0, Math.min(state.editIndex || 0, editCount - 1));
  const sources = toolSources(entry, state.editIndex);
  // Formatting is allowed only for a small, fully stable tool result. The
  // conservative LCS limit also bounds many-short-lines edits, not just bytes.
  const args = entry.args || {};
  const old = args.oldText ?? args.old_string ?? '';
  const next = args.newText ?? args.new_string ?? '';
  const simpleArgs = !Array.isArray(args.edits);
  const small = simpleArgs && sources.every(source => fitsRichText(source.text, 2048)) &&
    (typeof old !== 'string' || typeof next !== 'string' || (old.split('\n').length * next.split('\n').length <= 16384));
  if (entry.done && small) {
    boundedViews.delete(body);
    body.innerHTML = toolBodyHtml(entry.name, entry.args, entry.result || '', true, entry.details);
    return;
  }
  // Source tabs are cheap and each source uses the same replaceable 8 KiB page.
  // Refreshing a visible card preserves its selected source and reading position.
  let content = body.querySelector('.tool-bounded-content');
  let select = body.querySelector('.tool-source-select');
  const selected = select?.value;
  if (!content) {
    select = el('select', 'tool-source-select'); select.setAttribute('aria-label', '工具内容');
    content = el('div', 'tool-bounded-content'); body.replaceChildren(select, content);
    select.addEventListener('change', () => {
      if (!node.isConnected || !node.open) return;
      const current = toolViews.get(node);
      const source = current && toolSources(current.entry, current.editIndex).find(item => item.label === select.value);
      boundedViews.delete(content);
      renderBoundedText(content, source?.text || '（无输出）');
    });
  }
  let editPages = body.querySelector('.tool-edit-pages');
  if (editCount > 1) {
    if (!editPages) {
      editPages = el('div', 'tool-edit-pages bounded-text-pages');
      for (const [direction, title] of [[-1, '上一项修改'], [1, '下一项修改']]) {
        const button = el('button', 'msg-tool', title); button.type = 'button'; button.dataset.editStep = String(direction);
        button.addEventListener('click', () => {
          if (!node.isConnected || !node.open) return;
          const current = toolViews.get(node);
          current.editIndex += direction;
          boundedViews.delete(content); renderToolBody(node, current.entry);
        });
        editPages.append(button);
      }
      editPages.append(el('span', 'tool-edit-index')); body.prepend(editPages);
    }
    editPages.querySelector('[data-edit-step="-1"]').disabled = state.editIndex === 0;
    editPages.querySelector('[data-edit-step="1"]').disabled = state.editIndex >= editCount - 1;
    editPages.querySelector('.tool-edit-index').textContent = `第 ${state.editIndex + 1} / ${editCount} 项修改`;
  } else editPages?.remove();
  const labels = sources.map(source => source.label);
  if (Array.from(select.options, option => option.value).join('|') !== labels.join('|')) {
    select.replaceChildren(...labels.map(label => { const option = el('option', '', label); option.value = label; return option; }));
    if (labels.includes(selected)) select.value = selected;
  }
  select.hidden = labels.length < 2;
  const source = sources.find(item => item.label === select.value) || sources[0];
  renderBoundedText(content, source?.text || (entry.done ? '（无输出）' : '运行中…'));
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
  const node = el('div', 'note' + (entry.failure ? ' failure' : ''));
  if (fitsRichText(entry.text)) node.textContent = entry.text || '';
  else renderBoundedText(node, entry.text || '');
  return node;
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
