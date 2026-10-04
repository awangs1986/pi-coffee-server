import {boundedTextSlice,renderMarkdown} from './render.js';
import {renderProcessEntries} from './history-process.js';
// Cached previews remain plain text. Completed, authoritative small replies
// use the shared sanitized Markdown renderer, including code frames and Copy.
const renders = new WeakMap();
const TEXT_PAGE_SIZE = 8 * 1024;

function textPageEnd(text, start) {
  let end = Math.min(text.length, start + TEXT_PAGE_SIZE);
  // Keep a surrogate pair together when a text page ends inside an emoji.
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  return end;
}

function displayEntry(entry) {
  return {
    kind: entry?.kind === 'user' || entry?.kind === 'assistant' || entry?.kind === 'tool' ? entry.kind : 'note',
    text: typeof entry?.text === 'string' ? entry.text : '',
    failure: entry?.failure === true,
  };
}

function previewNode(entry, document, isActive = () => true, {authoritative=false} = {}) {
  const node = document.createElement('div');
  node.className = entry.kind === 'user' || entry.kind === 'assistant' ? `msg ${entry.kind}` : 'note';
  if (entry.failure) node.classList.add('failure');
  node.dataset.previewKind = entry.kind;
  const body = document.createElement('div');
  body.className = entry.kind === 'user' ? 'body md text' : 'body md';
  body.style.whiteSpace = 'pre-wrap';
  body.style.overflowWrap = 'anywhere';
  let end = textPageEnd(entry.text, 0);
  const text = document.createTextNode(entry.text.slice(0, end));
  const rich=authoritative && entry.kind==='assistant' && boundedTextSlice(entry.text).end===entry.text.length;
  if(rich){body.style.whiteSpace='';body.innerHTML=renderMarkdown(entry.text).trimEnd();}
  else body.append(text);
  if (entry.kind === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.append(body);
    node.append(bubble);
  } else node.append(body);
  if (end < entry.text.length) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'msg-tool';
    more.textContent = '展开更多';
    more.addEventListener('click', () => {
      if (!more.isConnected || !node.contains(more) || !isActive(more)) return;
      const next = textPageEnd(entry.text, end);
      text.appendData(entry.text.slice(end, next));
      end = next;
      if (end === entry.text.length) more.remove();
    });
    node.append(more);
  }
  return node;
}

/** One bounded, expandable display node for an authoritative oversized entry. */
export function conversationPreviewNode(entry) {
  const item=displayEntry(entry),node=previewNode(item,document);
  if(item.kind!=='tool')return node;
  const fragment=document.createDocumentFragment();renderProcessEntries(fragment,[{id:'preview-tool',kind:'tool',error:item.failure,node}]);return fragment.firstChild;
}

/**
 * Render the newest page immediately; older messages and long text are opt-in.
 * Returns a disposable render handle. A subsequent render in this container
 * invalidates all controls from the old render, even if a caller kept the nodes.
 */
export function renderConversationPreview(container, snapshot, { cached = true, pageSize = 40 } = {}) {
  const token = {};
  renders.set(container, token);
  const document = container.ownerDocument;
  const limit = Number.isFinite(pageSize) ? Math.max(1, Math.min(40, Math.floor(pageSize))) : 40;
  // Retain only primitive display values so callers cannot mutate an old page
  // into another conversation while its "load earlier" control is still alive.
  const entries = (Array.isArray(snapshot?.entries) ? snapshot.entries : []).map(displayEntry);
  let start = Math.max(0, entries.length - limit);
  const active = node => renders.get(container) === token && node.isConnected && container.contains(node);
  const note = text => {
    const node = document.createElement('div');
    node.className = 'note';
    node.textContent = text;
    return node;
  };

  const entryNode = entry => previewNode(entry, document, active, {authoritative:!cached});
  const renderPage=(target,from,to)=>renderProcessEntries(target,entries.slice(from,to).map((entry,index)=>({id:'preview-'+(from+index),kind:entry.kind,error:entry.failure,node:entryNode(entry)})));

  const fragment = document.createDocumentFragment();
  if (cached) fragment.append(note('正在显示本地缓存，正在同步最新对话…'));
  if (snapshot?.truncated) fragment.append(note('更早的记录未包含在此预览中，完整历史仍保存在 User VM 中。'));
  const earlier = document.createElement('button');
  earlier.type = 'button';
  earlier.className = 'msg-tool';
  earlier.textContent = '加载更早记录';
  earlier.addEventListener('click', () => {
    if (!active(earlier) || start === 0) return;
    const next = Math.max(0, start - limit);
    const page = document.createDocumentFragment();
    renderPage(page,next,start);
    earlier.after(page);
    start = next;
    if (start === 0) earlier.remove();
  });
  if (start > 0) fragment.append(earlier);
  renderPage(fragment,start,entries.length);
  container.replaceChildren(fragment);

  return {
    get shownEntries() { return entries.length - start; },
    totalEntries: entries.length,
    dispose() { if (renders.get(container) === token) renders.delete(container); },
  };
}
