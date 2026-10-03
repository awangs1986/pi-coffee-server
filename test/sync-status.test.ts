// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncStatus } from '../public/sync-status.js';
import { readFileSync } from 'node:fs';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('selected conversation sync cat', () => {
  it('animates only the selected syncing conversation and ignores late old-conversation state', () => {
    const host = document.createElement('div'); document.body.append(host);
    const status = createSyncStatus(host);
    status.select('A'); status.update({ conversationId: 'A', state: 'syncing' });
    expect(host.querySelector('.running-cat')).not.toBeNull();
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-running')).toBe('true');
    status.select('B');
    status.update({ conversationId: 'A', state: 'synced' });
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-state')).toBe('idle');
    status.update({ conversationId: 'B', state: 'syncing' });
    status.update({ conversationId: 'A', state: 'error' });
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-running')).toBe('true');
    status.update({ conversationId: 'B', state: 'synced' });
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-running')).toBe('false');
    status.dispose();
  });

  it.each(['error', 'timeout', 'offline'])('stops animation on %s and leaves retry explicit', state => {
    const host = document.createElement('div'); document.body.append(host);
    const retry = vi.fn(); const status = createSyncStatus(host, { onRetry: retry });
    status.select('A'); status.update({ conversationId: 'A', state: 'syncing' });
    status.update({ conversationId: 'A', state, message: '<b>网络缓慢</b>' });
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-running')).toBe('false');
    expect(host.querySelector('b')).toBeNull();
    (host.querySelector('.sync-retry-button') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalledWith('A');
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-running')).toBe('false');
    status.dispose();
  });

  it('times out a hung sync without touching any conversation body or disabling controls', () => {
    vi.useFakeTimers(); const host = document.createElement('div'); document.body.append(host);
    const status = createSyncStatus(host, { timeoutMs: 100 });
    status.select('A'); status.update({ conversationId: 'A', state: 'syncing' });
    vi.advanceTimersByTime(101);
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-state')).toBe('timeout');
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-running')).toBe('false');
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(host.querySelector('[inert]')).toBeNull(); status.dispose();
  });

  it('does not extend the timeout on progress and protects a later selection from the old timeout', () => {
    vi.useFakeTimers(); const host = document.createElement('div'); document.body.append(host);
    const status = createSyncStatus(host, { timeoutMs: 100 });
    status.select('A'); status.update({ conversationId: 'A', state: 'syncing' });
    vi.advanceTimersByTime(60); status.update({ conversationId: 'A', state: 'syncing', message: '同步中' });
    vi.advanceTimersByTime(41);
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-state')).toBe('timeout');
    status.select('B'); status.update({ conversationId: 'B', state: 'synced' });
    vi.advanceTimersByTime(1000);
    expect(host.querySelector('.conversation-sync-status')?.getAttribute('data-state')).toBe('synced'); status.dispose();
  });

  it('ships reduced-motion styles that suppress every cat animation', () => {
    const css = readFileSync('public/app.css', 'utf8');
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(css).toMatch(/\.running-cat[\s\S]*?animation:\s*none\s*!important/);
  });
});
