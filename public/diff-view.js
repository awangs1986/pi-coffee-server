// Diff panel body (ADR-0023). app.js owns the panel shell (toolbar, Branch / 最近一轮, Unified | Split,
// collapse-all, the comment tray); this module owns the file list inside #diff-content.
//
// With the @pierre/diffs bundle (public/vendor/, imported on first use) every file is a virtualized
// FileDiff: Shiki highlighting, word-level changes, Arena-style bars, expandable unchanged context
// (full text from the Host's change_file) and line comments that are summarized into the composer.
// Files mount as they near the viewport and fetch their whole patch when the combined `changes`
// patch (capped by the Host) lacks it, so large Diffs are neither truncated nor rendered at once.
// Browsers without the bundle or IntersectionObserver/ResizeObserver keep the review.js renderer.
import { el } from './render.js';
import { fileCounts, renderReviewFile } from './review.js';

const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const LINE_PX = 20;
const MOUNT_MARGIN = '900px 0px';
const MAX_FETCHES = 4;
const EXCERPT_LINES = 8;
const NO_TEXT = '该文件没有可显示的文本 Diff（可能为二进制、重命名或内容超限）。';
const TOO_LARGE = '该文件的 Diff 超过 4 MB，未在浏览器中显示；请在 VM 上用 git diff 查看。';
// Pierre renders into a shadow root and its theme sets the colours there; @layer unsafe is the
// one place that may override them. var() still resolves against the app's inherited tokens.
const UNSAFE_CSS = ':host{--diffs-font-family:var(--mono);--diffs-header-font-family:var(--font);--diffs-font-size:12.5px;--diffs-line-height:20px;--diffs-light-bg:var(--bg);--diffs-dark-bg:var(--bg)}';

let library;
/** Whether this browser can run the virtualized renderer (tests may inject a stand-in library). */
export function diffRendererSupported() {
  if (globalThis.__piCoffeeDiffs) return true;
  return typeof IntersectionObserver === 'function' && typeof ResizeObserver === 'function' && typeof customElements !== 'undefined';
}
export function loadDiffLibrary() {
  if (globalThis.__piCoffeeDiffs) return Promise.resolve(globalThis.__piCoffeeDiffs);
  library ??= import('./vendor/diffs.js').catch((error) => { library = undefined; throw error; });
  return library;
}

/** Split a combined `git diff` into per-file sections; a section cut by the Host's cap is left out. */
export function patchSections(patch, truncated = false) {
  const sections = new Map();
  if (!patch) return sections;
  const parts = patch.split(/(?=^diff --git )/m).filter(Boolean);
  if (truncated) parts.pop();
  for (const part of parts) {
    let path = part.match(/^diff --git [^\n]* b\/(.+)$/m)?.[1] || part.match(/^\+\+\+ b\/(.+)$/m)?.[1];
    if (path?.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).replace(/\\(["\\])/g, '$1');
    if (path) sections.set(path, part.replace(/\n$/, ''));
  }
  return sections;
}

/** Text of one line on one side, from a whole-file diff or from the lines a patch carries. */
export function sideLine(fileDiff, side, lineNumber) {
  const deletions = side === 'deletions';
  const lines = deletions ? fileDiff.deletionLines : fileDiff.additionLines;
  let text;
  if (!fileDiff.isPartial) text = lines[lineNumber - 1];
  else for (const hunk of fileDiff.hunks) {
    const start = deletions ? hunk.deletionStart : hunk.additionStart;
    const count = deletions ? hunk.deletionCount : hunk.additionCount;
    if (lineNumber >= start && lineNumber < start + count) { text = lines[(deletions ? hunk.deletionLineIndex : hunk.additionLineIndex) + lineNumber - start]; break; }
  }
  return typeof text === 'string' ? text.replace(/\r?\n$/, '') : undefined;
}

export function rangeLabel({ start, end, side, scope }) {
  return (start === end ? `L${start}` : `L${start}–L${end}`) + (side === 'deletions' ? (scope === 'turn' ? '（本轮改动前）' : '（改动前）') : '');
}

/** One message for the composer: every comment with its location and the lines it is about. */
export function composeCommentMessage(comments) {
  if (!comments.length) return '';
  const blocks = comments.map((comment, index) => {
    const lines = [`${index + 1}. \`${comment.path}\` ${rangeLabel(comment)}`];
    for (const text of comment.excerpt.slice(0, EXCERPT_LINES)) lines.push('   > ' + text);
    if (comment.excerpt.length > EXCERPT_LINES) lines.push('   > …');
    comment.text.split('\n').forEach((line, row) => lines.push((row ? '   ' : '   评论：') + line));
    return lines.join('\n');
  });
  return [`请根据下面 ${comments.length} 条 Diff 评论修改：`, ...blocks].join('\n\n');
}

function sameChanges(before, after) {
  return before.scope === after.scope && before.base === after.base && before.patch === after.patch
    && JSON.stringify(before.files) === JSON.stringify(after.files);
}
function estimatedHeight(file) {
  const changed = (file.additions ?? 0) + (file.deletions ?? 0);
  return Math.min(Math.max(changed + 6, 3) * LINE_PX, 24000);
}
function button(label, className = 'btn small') {
  const node = el('button', className, label);
  node.type = 'button';
  return node;
}

export class DiffView {
  constructor(root, { onCommentsChange = () => {}, onNotice = () => {} } = {}) {
    this.root = root;
    this.onCommentsChange = onCommentsChange;
    this.onNotice = onNotice;
    this.entries = new Map();
    this.commentsByTask = new Map();
    this.draft = null;
    this.lib = null;
    this.libraryFailed = false;
    this.observer = null;
    this.virtualizer = null;
    this.waiting = [];
    this.active = 0;
    this.epoch = 0;
    this.data = null;
    this.layout = 'unified';
    this.theme = 'light';
  }

  get mode() { return !this.libraryFailed && diffRendererSupported() ? 'pierre' : 'fallback'; }
  comments() { return this.commentsByTask.get(this.taskId) ?? []; }

  /**
   * Render a `changes` payload. loadFile(path, {contents}) fetches one file from the Host for the
   * same task, scope and base. preserve keeps folding and scroll position across refreshes.
   */
  render(data, { taskId, layout = this.layout, theme = this.theme, loadFile, focusPath = null, preserve = false }) {
    // A refresh that changed nothing (say, a turn without edits) keeps the mounted Diff as it is.
    // A capped Diff is rebuilt anyway: files loaded one by one may have changed behind equal counts.
    if (preserve && this.data && !data.truncated && taskId === this.taskId && layout === this.layout && sameChanges(this.data, data)) {
      this.data = data;
      this.loadFile = loadFile;
      return;
    }
    const collapsed = preserve ? new Set([...this.root.querySelectorAll('.review-file:not([open])')].map((node) => node.dataset.path)) : new Set();
    const scrollTop = preserve ? this.root.scrollTop : 0;
    this.refocusDraft = Boolean(document.activeElement?.closest?.('#diff-content .diff-comment-box'));
    this.teardown();
    if (this.draft && this.draft.taskId !== taskId) this.draft = null;
    Object.assign(this, { data, taskId, layout, theme, loadFile, focusPath: null });
    this.sections = patchSections(data.patch, data.truncated);
    this.fetched = new Map();
    this.root.replaceChildren();
    this.emitComments();
    if (!data.files.length) {
      this.root.append(el('p', 'workspace-empty', data.scope === 'turn' ? '最近一轮没有改动文件。' : '没有改动。'));
      return;
    }
    if (this.mode === 'fallback') {
      if (!this.libraryFailed && !this.unsupportedNoticed) {
        this.unsupportedNoticed = true;
        this.onNotice('当前浏览器不支持增强 Diff，已切换为基础视图');
      }
      this.renderFallback(collapsed);
    }
    else this.renderSkeleton(collapsed);
    if (preserve) { this.root.scrollTop = scrollTop; return; }
    this.root.scrollTop = 0;
    const target = focusPath ? [...this.root.querySelectorAll('.review-file')].find((node) => node.dataset.path === focusPath) : null;
    if (target) { target.open = true; target.scrollIntoView?.({ block: 'start' }); }
    this.focusPath = target ? focusPath : null;
  }

  close() {
    this.teardown();
    if (this.draft && !this.draft.text?.trim()) this.draft = null;
  }

  teardown() {
    ++this.epoch;
    this.observer?.disconnect();
    this.observer = null;
    for (const entry of this.entries.values()) entry.instance?.cleanUp();
    this.entries.clear();
    this.virtualizer?.cleanUp();
    this.virtualizer = null;
    for (const job of this.waiting.splice(0)) job.resolve(null);
  }

  setLayout(layout) {
    this.layout = layout;
    if (!this.data) return;
    if (this.mode === 'fallback') {
      const collapsed = new Set([...this.root.querySelectorAll('.review-file:not([open])')].map((node) => node.dataset.path));
      const scrollTop = this.root.scrollTop;
      this.root.replaceChildren();
      this.renderFallback(collapsed);
      this.root.scrollTop = scrollTop;
      return;
    }
    for (const entry of this.entries.values()) {
      if (!entry.instance) continue;
      entry.instance.setOptions(this.options(entry));
      entry.instance.rerender();
    }
  }

  setTheme(theme) {
    this.theme = theme;
    for (const entry of this.entries.values()) entry.instance?.setThemeType(theme);
  }

  // ---------- review.js fallback ----------
  renderFallback(collapsed) {
    for (const file of this.data.files) {
      const open = !collapsed.has(file.path);
      const patch = this.sections.get(file.path) ?? this.fetched.get(file.path);
      if (patch !== undefined || !this.needsFetch(file)) { this.root.append(renderReviewFile(file, patch ?? '', this.layout, { open })); continue; }
      const placeholder = renderReviewFile(file, '', this.layout, { open });
      placeholder.querySelector('.review-file-empty')?.replaceChildren('正在读取…');
      this.root.append(placeholder);
      const epoch = this.epoch;
      void this.queue(() => this.loadFile(file.path, {})).then((result) => {
        if (!result || epoch !== this.epoch || !placeholder.isConnected) return;
        const text = result.truncated ? '' : String(result.patch ?? '');
        this.fetched.set(file.path, text);
        const next = renderReviewFile(file, text, this.layout, { open: placeholder.open });
        if (result.truncated) next.querySelector('.review-file-empty')?.replaceChildren(TOO_LARGE);
        placeholder.replaceWith(next);
      }).catch((error) => placeholder.querySelector('.review-file-empty')?.replaceChildren(error.message));
    }
  }

  /** The combined patch lacks a file when the Host capped it, or when the file had no text patch there. */
  needsFetch(file) {
    return Boolean(this.data.truncated) || file.additions == null || file.deletions == null;
  }

  // ---------- @pierre/diffs ----------
  renderSkeleton(collapsed) {
    const list = el('div', 'review-files');
    for (const file of this.data.files) {
      const section = el('details', 'review-file');
      section.open = !collapsed.has(file.path);
      section.dataset.path = file.path;
      const summary = el('summary', 'review-file-head');
      const chevron = el('span', 'review-chevron');
      chevron.innerHTML = CHEVRON;
      const name = el('code', 'review-file-name', file.path);
      name.title = file.path;
      summary.append(chevron, name, fileCounts(file));
      const body = el('div', 'review-file-body');
      body.style.minHeight = estimatedHeight(file) + 'px';
      section.append(summary, body);
      list.append(section);
      const entry = { file, section, body, patch: this.sections.get(file.path), instance: null, fileDiff: null, pending: false };
      this.entries.set(file.path, entry);
      section.addEventListener('toggle', () => this.toggled(entry));
    }
    this.list = list;
    this.root.append(list);
    void this.boot(this.epoch);
  }

  async boot(epoch) {
    let lib;
    try {
      lib = await loadDiffLibrary();
    } catch {
      if (epoch !== this.epoch) return;
      this.libraryFailed = true;
      this.onNotice('Diff 渲染组件加载失败，已切换为基础视图');
      this.render(this.data, { taskId: this.taskId, loadFile: this.loadFile, preserve: true });
      return;
    }
    if (epoch !== this.epoch) return;
    this.lib = lib;
    this.virtualizer = new lib.Virtualizer();
    this.virtualizer.setup(this.root, this.list);
    const bySection = new Map([...this.entries.values()].map((entry) => [entry.section, entry]));
    this.observer = new IntersectionObserver((changes) => {
      for (const change of changes) if (change.isIntersecting) void this.mount(bySection.get(change.target));
    }, { root: this.root, rootMargin: MOUNT_MARGIN });
    for (const entry of this.entries.values()) this.observer.observe(entry.section);
    if (this.focusPath) void this.mount(this.entries.get(this.focusPath));
  }

  toggled(entry) {
    if (!entry.section.open) { this.unmount(entry); return; }
    // Observing again reports the current intersection, so only files near the viewport mount.
    if (this.observer) { this.observer.unobserve(entry.section); this.observer.observe(entry.section); }
  }

  async mount(entry) {
    if (!entry || !this.lib || entry.instance || entry.pending || !entry.section.open) return;
    const epoch = this.epoch;
    entry.pending = true;
    try {
      if (entry.patch === undefined) {
        entry.body.replaceChildren(el('p', 'review-file-empty', '正在读取…'));
        const result = await this.queue(() => this.loadFile(entry.file.path, {}));
        if (!result || epoch !== this.epoch) return;
        entry.tooLarge = Boolean(result.truncated);
        entry.patch = entry.tooLarge ? '' : String(result.patch ?? '');
      }
      if (entry.section.open) this.paint(entry);
    } catch (error) {
      if (epoch !== this.epoch) return;
      entry.body.style.minHeight = '';
      entry.body.replaceChildren(el('p', 'workspace-warning', error instanceof Error ? error.message : String(error)));
    } finally {
      entry.pending = false;
    }
  }

  paint(entry) {
    const { body } = entry;
    body.style.minHeight = '';
    if (entry.tooLarge) { body.replaceChildren(el('p', 'review-file-empty', TOO_LARGE)); return; }
    let fileDiff;
    try { fileDiff = entry.patch ? this.lib.parsePatchFiles(entry.patch)?.[0]?.files?.[0] : undefined; } catch { fileDiff = undefined; }
    if (!fileDiff?.hunks?.length) { body.replaceChildren(el('p', 'review-file-empty', NO_TEXT)); return; }
    entry.fileDiff = fileDiff;
    const container = document.createElement('diffs-container');
    body.replaceChildren(container);
    entry.instance = new this.lib.VirtualizedFileDiff(this.options(entry), this.virtualizer);
    entry.instance.render({ fileDiff, fileContainer: container, lineAnnotations: this.annotations(entry) });
    if (this.refocusDraft && this.draft?.path === entry.file.path) {
      this.refocusDraft = false;
      setTimeout(() => entry.body.querySelector('.diff-comment-box textarea')?.focus({ preventScroll: true }), 0);
    }
  }

  unmount(entry) {
    entry.instance?.cleanUp();
    entry.instance = null;
    entry.fileDiff = null;
    entry.body.replaceChildren();
    entry.body.style.minHeight = '';
  }

  options(entry) {
    return {
      diffStyle: this.layout,
      diffIndicators: 'bars',
      lineDiffType: 'word-alt',
      overflow: 'scroll',
      themeType: this.theme,
      hunkSeparators: 'line-info',
      disableFileHeader: true,
      enableLineSelection: true,
      enableGutterUtility: true,
      onGutterUtilityClick: (range) => this.startComment(entry, range),
      renderAnnotation: (annotation) => this.renderAnnotation(entry, annotation),
      loadDiffFiles: () => this.loadContents(entry),
      unsafeCSS: UNSAFE_CSS,
    };
  }

  /** Full text of both sides, fetched the first time the user expands unchanged lines. */
  async loadContents(entry) {
    const result = await this.loadFile(entry.file.path, { contents: true });
    if (typeof result?.oldContents !== 'string' || typeof result?.newContents !== 'string') {
      const reason = result?.contentsUnavailable === 'binary' ? '二进制文件' : result?.contentsUnavailable === 'too_large' ? '文件超过 1 MB' : '文件内容已不可用';
      this.onNotice('无法展开未改动的行：' + reason);
      throw new Error('Diff context unavailable: ' + reason);
    }
    const name = entry.file.path;
    return { oldFile: { name, contents: result.oldContents }, newFile: { name, contents: result.newContents } };
  }

  queue(task) {
    return new Promise((resolve, reject) => { this.waiting.push({ task, resolve, reject }); this.pump(); });
  }
  pump() {
    while (this.active < MAX_FETCHES && this.waiting.length) {
      const job = this.waiting.shift();
      this.active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { this.active--; this.pump(); });
    }
  }

  // ---------- comments ----------
  annotations(entry) {
    const path = entry.file.path;
    const list = this.comments()
      .filter((comment) => comment.path === path && comment.scope === this.data.scope && comment.id !== this.draft?.editing)
      .map((comment) => ({ side: comment.side, lineNumber: comment.end, metadata: { comment } }));
    if (this.draft?.path === path && this.draft.taskId === this.taskId && this.draft.scope === this.data.scope) list.push({ side: this.draft.side, lineNumber: this.draft.end, metadata: { draft: this.draft } });
    return list;
  }

  refresh(entry, focusDraft = false) {
    if (!entry?.instance) return;
    entry.instance.render({ fileDiff: entry.fileDiff, lineAnnotations: this.annotations(entry), forceRender: true });
    // preventScroll: focusing inside the horizontally scrolling code column would shift the code sideways.
    if (focusDraft) setTimeout(() => entry.body.querySelector('.diff-comment-box textarea')?.focus({ preventScroll: true }), 0);
  }

  startComment(entry, range, previous = null) {
    if (!range || !entry.fileDiff) return;
    const side = range.endSide ?? range.side ?? 'additions';
    const oneSide = (range.side ?? side) === side;
    const start = oneSide ? Math.min(range.start, range.end) : range.end;
    const end = oneSide ? Math.max(range.start, range.end) : range.end;
    const before = this.draft && this.entries.get(this.draft.path);
    this.draft = { taskId: this.taskId, scope: this.data.scope, path: entry.file.path, side, start, end, text: previous?.text ?? '', ...(previous ? { editing: previous.id } : {}) };
    entry.instance?.setSelectedLines?.(null);
    if (before && before !== entry) this.refresh(before);
    this.refresh(entry, true);
  }

  renderAnnotation(entry, annotation) {
    const { draft, comment } = annotation.metadata ?? {};
    if (draft) return this.draftBox(entry, draft);
    if (comment) return this.commentCard(entry, comment);
    return undefined;
  }

  draftBox(entry, draft) {
    const box = el('form', 'diff-comment-box');
    const input = el('textarea', '');
    input.rows = 3;
    input.value = draft.text ?? '';
    input.placeholder = '对这些行写评论，汇总后放进输入框（⌘/Ctrl + Enter 保存）';
    input.setAttribute('aria-label', `评论 ${entry.file.path} ${rangeLabel(draft)}`);
    input.addEventListener('input', () => { draft.text = input.value; });
    const cancel = () => { this.draft = null; this.refresh(entry); };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); this.saveDraft(entry, input); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    });
    const actions = el('div', 'diff-comment-actions');
    const cancelButton = button('取消');
    cancelButton.addEventListener('click', cancel);
    const save = el('button', 'btn small primary', draft.editing ? '保存' : '添加评论');
    save.type = 'submit';
    actions.append(el('span', 'diff-comment-ref', rangeLabel(draft)), cancelButton, save);
    box.addEventListener('submit', (event) => { event.preventDefault(); this.saveDraft(entry, input); });
    box.append(input, actions);
    return box;
  }

  commentCard(entry, comment) {
    const card = el('div', 'diff-comment');
    const head = el('div', 'diff-comment-head');
    const edit = button('编辑', 'diff-comment-link');
    edit.addEventListener('click', () => this.startComment(entry, { start: comment.start, end: comment.end, side: comment.side }, comment));
    const remove = button('删除', 'diff-comment-link');
    remove.addEventListener('click', () => {
      this.commentsByTask.set(this.taskId, this.comments().filter((item) => item.id !== comment.id));
      this.refresh(entry);
      this.emitComments();
    });
    head.append(el('span', 'diff-comment-ref', rangeLabel(comment)), edit, remove);
    card.append(head, el('p', 'diff-comment-text', comment.text));
    return card;
  }

  saveDraft(entry, input) {
    const draft = this.draft;
    const text = (draft?.text ?? '').trim();
    if (!draft || !text) { input?.focus({ preventScroll: true }); return; }
    const excerpt = [];
    for (let line = draft.start; line <= draft.end && excerpt.length <= EXCERPT_LINES; line++) {
      const value = sideLine(entry.fileDiff, draft.side, line);
      if (value !== undefined) excerpt.push(value);
    }
    const comment = { id: draft.editing ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, scope: draft.scope, path: draft.path, side: draft.side, start: draft.start, end: draft.end, text, excerpt };
    const list = [...this.comments()];
    const index = list.findIndex((item) => item.id === comment.id);
    if (index >= 0) list[index] = comment; else list.push(comment);
    this.commentsByTask.set(this.taskId, list);
    this.draft = null;
    this.refresh(entry);
    this.emitComments();
  }

  /** Summarize and forget this task's comments; the caller puts the text into the composer. */
  takeComments() {
    const message = composeCommentMessage(this.comments());
    this.clearComments();
    return message;
  }

  clearComments() {
    this.commentsByTask.delete(this.taskId);
    if (this.draft?.taskId === this.taskId) this.draft = null;
    for (const entry of this.entries.values()) this.refresh(entry);
    this.emitComments();
  }

  emitComments() {
    const all = this.comments();
    const inScope = this.data?.scope ? all.filter((item) => item.scope === this.data.scope).length : all.length;
    this.onCommentsChange(all.length, all.length - inScope);
  }
}
