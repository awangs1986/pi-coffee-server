// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assistantNode, updateAssistant, toolCard, fillToolCard, userBubble, noteNode,
  boundedTextSlice, boundedTranscriptWindow, renderBoundedText, toolResultText,
} from '../public/render.js';

const bytes = (text: string) => new TextEncoder().encode(text).length;
beforeEach(() => { document.body.replaceChildren(); });

describe('bounded actual DOM rendering', () => {
  it('bounds user and note bodies by bytes, including short multibyte strings', () => {
    for (const text of ['界'.repeat(4000), 'x'.repeat(225_000)]) {
      for (const build of [userBubble, noteNode]) {
        const node = build({ text });
        expect(bytes(node.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
      }
    }
  });

  it.each([45_000, 225_000, 1_000_000])('keeps live and completion text bounded at %i characters', length => {
    const entry = { text: '<script>alert(1)</script>\n```typescript\n' + 'x'.repeat(length) };
    const node = assistantNode(entry, { done: false }); document.body.append(node);
    for (let i = 0; i < 20; i++) {
      entry.text += ' hello 世界🐈'; updateAssistant(node, entry.text);
      expect(bytes(node.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
    }
    updateAssistant(node, entry.text, { done: true });
    expect(node.querySelector('script')).toBeNull(); expect(node.querySelector('.codeblock')).toBeNull();
    expect(bytes(node.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
    expect(node.querySelector('.bounded-text-content')!.textContent).toContain('世界🐈');
    expect(node.querySelectorAll('*').length).toBeLessThan(20);
  });

  it('paginates without accumulating nodes, keeps surrogate pairs intact, and follows only the tail', () => {
    const host = document.createElement('div'); document.body.append(host);
    const text = '开头\n' + '中🐈'.repeat(5000) + '\n末尾';
    renderBoundedText(host, text);
    const initial = host.querySelector('.bounded-text-content')!.textContent!;
    expect(initial.endsWith('末尾')).toBe(true);
    (host.querySelector('[data-text-page="previous"]') as HTMLButtonElement).click();
    const previous = host.querySelector('.bounded-text-content')!.textContent!;
    expect(previous).not.toBe(initial);
    renderBoundedText(host, text + ' new output');
    expect(host.querySelector('.bounded-text-content')!.textContent).toBe(previous);
    for (let i = 0; i < 30; i++) (host.querySelector('[data-text-page="next"]') as HTMLButtonElement).click();
    expect(host.querySelector('.bounded-text-content')!.textContent).toContain('new output');
    expect(bytes(host.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
    expect(host.querySelectorAll('.bounded-text-content')).toHaveLength(1);
    expect(host.textContent).not.toContain('\uFFFD');
  });

  it('does not parse unclosed Markdown during streaming, but formats complete small messages', () => {
    const node = assistantNode({ text: '**hello** <img src=x onerror=alert(1)>' }, { done: false });
    expect(node.querySelector('img')).toBeNull(); expect(node.querySelector('strong')).toBeNull();
    updateAssistant(node, '**done**', { done: true });
    expect(node.querySelector('strong')?.textContent).toBe('done');
  });

  it('does not touch tool body or serialize huge arguments while collapsed, including completion', async () => {
    const stringify = vi.fn(() => { throw new Error('must not serialize entire args'); });
    const entry = { name: 'tool', args: { toJSON: stringify, blob: 'a'.repeat(225_000) }, result: 'b'.repeat(225_000), done: false };
    const node = toolCard(entry); document.body.append(node);
    const body = node.querySelector('.tool-body')!;
    expect(body.childNodes).toHaveLength(0);
    fillToolCard(node, { ...entry, done: true });
    expect(body.childNodes).toHaveLength(0); expect(stringify).not.toHaveBeenCalled();
    expect(node.querySelector('.state')?.textContent).toContain('完成');
    node.open = true; node.dispatchEvent(new Event('toggle'));
    expect(bytes(body.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
    node.open = false; node.dispatchEvent(new Event('toggle'));
    expect(body.childNodes).toHaveLength(0);
  });

  it('keeps every multi-edit source accessible through bounded source navigation', () => {
    const node = toolCard({ name: 'edit', args: { edits: [
      { oldText: 'a'.repeat(225_000) + 'OLD_FIRST', newText: 'b'.repeat(225_000) + 'NEW_FIRST' },
      { oldText: 'c'.repeat(225_000) + 'OLD_SECOND', newText: 'd'.repeat(225_000) + 'NEW_SECOND' },
    ] }, done: true });
    document.body.append(node); node.open = true; node.dispatchEvent(new Event('toggle'));
    const select = node.querySelector('.tool-source-select') as HTMLSelectElement;
    select.value = '修改后'; select.dispatchEvent(new Event('change'));
    expect(node.querySelector('.bounded-text-content')?.textContent).toContain('NEW_FIRST');
    (node.querySelector('[data-edit-step="1"]') as HTMLButtonElement).click();
    expect(node.querySelector('.bounded-text-content')?.textContent).toContain('NEW_SECOND');
    expect(bytes(node.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
  });

  it('renders a huge edit patch as bounded escaped text only on expansion', () => {
    const patch = '+<img onerror=alert(1)>\n'.repeat(20000);
    const node = toolCard({ name: 'edit', args: {}, result: '', done: true, details: { patch } });
    document.body.append(node); node.open = true; node.dispatchEvent(new Event('toggle'));
    expect(node.querySelector('img')).toBeNull(); expect(node.querySelectorAll('.diff-row')).toHaveLength(0);
    expect(bytes(node.querySelector('.bounded-text-content')!.textContent!)).toBeLessThanOrEqual(8192);
  });
});

describe('UTF-8 view budgets', () => {
  it('preserves complete Pi tool source for paging, including the final marker', () => {
    const text = 'a'.repeat(225_000) + 'FINAL_MARKER';
    expect(toolResultText({ content: [{ type: 'text', text }] })).toBe(text);
  });
  it('bounds prefixes and tails by bytes without scanning a whole huge string', () => {
    const raw = '😀界'.repeat(10000);
    for (const maxBytes of [1, 3, 4, 7, 1024, 8192]) {
      for (const tail of [false, true]) {
        const slice = boundedTextSlice(raw, { maxBytes, tail });
        expect(bytes(slice.text)).toBeLessThanOrEqual(maxBytes);
        expect(slice.bytes).toBe(bytes(slice.text));
        expect(slice.text).toBe(raw.slice(slice.start, slice.end));
        expect(slice.text).not.toContain('\uFFFD');
      }
    }
  });

  it('caps a latest transcript at forty messages, 64 KiB total and 8 KiB per entry', () => {
    const source = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i), kind: 'assistant', text: `message ${i} ` + '界😀'.repeat(32_000) }));
    const view = boundedTranscriptWindow(source);
    expect(view.entries.length).toBeLessThanOrEqual(40);
    expect(view.entries.at(-1).id).toBe('9999');
    expect(view.textBytes).toBeLessThanOrEqual(65536);
    expect(view.truncated).toBe(true);
    for (const entry of view.entries) expect(bytes(entry.text)).toBeLessThanOrEqual(8192);
  });
});
