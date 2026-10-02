// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
// @ts-expect-error browser module
import { conversationPreviewNode, renderConversationPreview } from '../public/conversation-preview-view.js';

afterEach(() => { document.body.replaceChildren(); });
const fixture = () => {
  const container = document.createElement('div');
  document.body.append(container);
  return container;
};
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-preview-kind]')];
const button = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label);

it('shows cached and truncated notes while rendering hostile strings only as selectable text', () => {
  const container = fixture();
  const text = '<script>window.attacked=true</script><img src=x onerror=alert(1)> https://example.test/private';
  renderConversationPreview(container, { truncated: true, entries: [{ kind: 'assistant', text }] });
  expect(container.textContent).toContain('正在显示本地缓存');
  expect(container.textContent).toContain('正在同步最新对话');
  expect(container.textContent).toContain('更早的记录未包含在此预览中');
  expect(rows(container)[0].textContent).toBe(text);
  expect(container.querySelector('script, img, a, iframe')).toBeNull();
  expect(container.hasAttribute('inert')).toBe(false);
  expect(container.querySelector<HTMLElement>('.body.md')!.style.whiteSpace).toBe('pre-wrap');
});

it('renders the newest forty entries and loads earlier pages in chronological order', () => {
  const container = fixture();
  const entries = Array.from({ length: 95 }, (_, index) => ({ kind: index % 2 ? 'assistant' : 'user', text: `Entry ${index}` }));
  const render = renderConversationPreview(container, { entries }, { cached: false });
  expect(render.totalEntries).toBe(95);
  expect(render.shownEntries).toBe(40);
  expect(rows(container).map(node => node.textContent)).toEqual(entries.slice(55).map(entry => entry.text));
  expect(container.firstElementChild).toBe(button(container, '加载更早记录'));
  expect(container.textContent).not.toContain('本地缓存');
  button(container, '加载更早记录')!.click();
  expect(render.shownEntries).toBe(80);
  expect(rows(container).map(node => node.textContent)).toEqual(entries.slice(15).map(entry => entry.text));
  button(container, '加载更早记录')!.click();
  expect(render.shownEntries).toBe(95);
  expect(rows(container).map(node => node.textContent)).toEqual(entries.map(entry => entry.text));
  expect(button(container, '加载更早记录')).toBeUndefined();
});

it.each(['assistant', 'tool'])('expands a giant %s entry by at most eight KiB of text per click', kind => {
  const container = fixture();
  const text = 'x'.repeat(20_000);
  renderConversationPreview(container, { entries: [{ kind, text }] });
  const body = container.querySelector('.body')!;
  expect(body.textContent).toHaveLength(8192);
  button(container, '展开更多')!.click();
  expect(body.textContent).toHaveLength(16384);
  button(container, '展开更多')!.click();
  expect(body.textContent).toBe(text);
  expect(button(container, '展开更多')).toBeUndefined();
});

it('exports a standalone bounded safe node without copy or regenerate actions', () => {
  const container = fixture();
  const entry = { kind: 'assistant', text: '<img src=x onerror=alert(1)>' + 'z'.repeat(9000) };
  const node = conversationPreviewNode(entry);
  const original = entry.text;
  entry.text = 'A different task';
  container.append(node);
  expect(node.classList.contains('assistant')).toBe(true);
  expect(node.querySelector('.body')!.textContent).toBe(original.slice(0, 8192));
  expect(node.querySelector('img, a')).toBeNull();
  expect([...node.querySelectorAll('button')].map(button => button.textContent)).toEqual(['展开更多']);
  button(container, '展开更多')!.click();
  expect(node.querySelector('.body')!.textContent).toBe(original);
  expect(node.querySelector('button')).toBeNull();
});

it('does not let a detached standalone expansion mutate its old node', () => {
  const container = fixture();
  const node = conversationPreviewNode({ kind: 'tool', text: 'x'.repeat(9000) });
  container.append(node);
  const expand = button(container, '展开更多')!;
  node.remove();
  expand.click();
  expect(node.querySelector('.body')!.textContent).toHaveLength(8192);
});

it('does not split a surrogate pair at a text-page boundary', () => {
  const container = fixture();
  const text = 'a'.repeat(8191) + '😀' + 'b';
  renderConversationPreview(container, { entries: [{ kind: 'assistant', text }] });
  expect(container.querySelector('.body')!.textContent).toBe('a'.repeat(8191));
  button(container, '展开更多')!.click();
  expect(container.querySelector('.body')!.textContent).toBe(text);
});

it('invalidates previous controls after rerender, even if their nodes are reattached', () => {
  const container = fixture();
  const first = renderConversationPreview(container, { entries: Array.from({ length: 45 }, () => ({ kind: 'assistant', text: 'old'.repeat(6000) })) });
  const earlier = button(container, '加载更早记录')!;
  const expand = button(container, '展开更多')!;
  const oldRow = rows(container)[0];
  const oldText = oldRow.querySelector('.body')!.textContent;
  const second = renderConversationPreview(container, { entries: [{ kind: 'user', text: 'New conversation' }] });
  earlier.click();
  expand.click();
  expect(rows(container).map(node => node.textContent)).toEqual(['New conversation']);
  container.append(earlier, oldRow);
  earlier.click();
  expand.click();
  expect(rows(container)).toHaveLength(2);
  expect(oldRow.querySelector('.body')!.textContent).toBe(oldText);
  expect(first.shownEntries).toBe(40);
  first.dispose();
  expect(second.shownEntries).toBe(1);
});

it('snapshots display values and lets disposal disable current controls', () => {
  const container = fixture();
  const entries = [{ kind: 'user', text: 'Original earlier message' }, { kind: 'assistant', text: 'Latest message' }];
  const handle = renderConversationPreview(container, { entries }, { pageSize: 1 });
  entries[0].text = 'Changed outside this view';
  button(container, '加载更早记录')!.click();
  expect(rows(container).map(node => node.textContent)).toEqual(['Original earlier message', 'Latest message']);
  const next = renderConversationPreview(container, { entries }, { pageSize: 1 });
  handle.dispose(); // An old disposal must not disable the new render.
  expect(next.shownEntries).toBe(1);
  next.dispose();
  button(container, '加载更早记录')!.click();
  expect(next.shownEntries).toBe(1);
});

it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY, 1000])('bounds invalid or oversized page size %s', pageSize => {
  const container = fixture();
  renderConversationPreview(container, { entries: Array.from({ length: 100 }, (_, index) => ({ kind: 'note', text: String(index) })) }, { pageSize });
  expect(rows(container).length).toBeGreaterThan(0);
  expect(rows(container).length).toBeLessThanOrEqual(40);
});

it('uses the shared user-text styling hook for cached and oversized user messages', () => {
  const node = conversationPreviewNode({ kind: 'user', text: 'A cached user instruction' });
  document.body.append(node);
  expect(node.querySelector('.bubble > .text')?.textContent).toBe('A cached user instruction');
  expect(node.querySelector('.bubble > .body.md.text')).not.toBeNull();
});
