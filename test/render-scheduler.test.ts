import { describe, expect, it } from 'vitest';
import { createRenderScheduler } from '../public/render-scheduler.js';

function fixture(extra = {}) {
  let clock = 0;
  const frames = new Map<number, () => void>();
  let id = 0;
  const scheduler = createRenderScheduler({
    requestFrame: (fn: () => void) => { frames.set(++id, fn); return id; },
    cancelFrame: (key: number) => frames.delete(key),
    now: () => clock,
    ...extra,
  });
  const view = { userScope: 'alice', conversationId: 'A', epoch: 'one', viewGeneration: 1 };
  scheduler.setView(view);
  return { scheduler, view, frames, advance: (ms: number) => { clock += ms; }, frame() {
    const [key, fn] = frames.entries().next().value!;
    frames.delete(key); fn();
  } };
}

describe('frame-budgeted render queue', () => {
  it('coalesces thousands of dirty notifications to the latest entity revision', () => {
    const f = fixture(); const seen: number[] = [];
    for (let i = 1; i <= 1000; i++) f.scheduler.schedule({ entityId: 'm', entityRevision: String(i), run: () => seen.push(i) });
    expect(f.scheduler.pendingCount).toBe(1); expect(f.frames.size).toBe(1);
    f.frame(); expect(seen).toEqual([1000]); expect(f.scheduler.pendingCount).toBe(0);
  });

  it('yields after its budget and resumes bounded continuations on another frame', () => {
    const f = fixture(); const seen: number[] = [];
    let i = 0;
    const step = () => { seen.push(++i); f.advance(3); return i < 5 ? step : undefined; };
    f.scheduler.schedule({ entityId: 'm', entityRevision: '1', run: step });
    f.frame(); expect(seen).toEqual([1, 2]); expect(f.frames.size).toBe(1);
    f.frame(); expect(seen).toEqual([1, 2, 3, 4]); f.frame(); expect(seen).toHaveLength(5);
  });

  it('rejects stale conversation, user, epoch, generation and entity revisions', () => {
    const f = fixture(); const seen: string[] = [];
    f.scheduler.schedule({ ...f.view, entityId: 'm', entityRevision: '9007199254740994', run: () => seen.push('latest') });
    expect(f.scheduler.schedule({ entityId: 'm', entityRevision: '9007199254740993', run: () => seen.push('old') })).toBe(false);
    for (const mismatch of [{ userScope: 'bob' }, { conversationId: 'B' }, { epoch: 'two' }, { viewGeneration: 0 }]) {
      expect(f.scheduler.schedule({ ...f.view, ...mismatch, entityId: 'm', entityRevision: '9007199254740995', run: () => seen.push('wrong') })).toBe(false);
    }
    f.frame(); expect(seen).toEqual(['latest']);
    f.scheduler.schedule({ entityId: 'next', entityRevision: '1', run: () => seen.push('late A') });
    f.scheduler.setView({ ...f.view, conversationId: 'B', viewGeneration: 2 });
    expect(f.frames.size).toBe(0); expect(f.scheduler.pendingCount).toBe(0);
  });

  it('drops obsolete continuation if its step queues a newer revision', () => {
    const f = fixture(); const seen: string[] = [];
    f.scheduler.schedule({ entityId: 'm', entityRevision: '1', run: ({ isCurrent }: any) => {
      f.scheduler.schedule({ entityId: 'm', entityRevision: '2', run: () => seen.push('new') });
      expect(isCurrent()).toBe(false);
      return () => seen.push('obsolete continuation');
    } });
    f.frame(); expect(seen).toEqual(['new']);
  });

  it('keeps other jobs running after a failed view callback and caps queue size', () => {
    const errors: unknown[] = []; const f = fixture({ maxPending: 2, onError: (e: unknown) => errors.push(e) });
    f.scheduler.schedule({ entityId: 'one', run: () => { throw new Error('view failed'); } });
    f.scheduler.schedule({ entityId: 'two', run: () => undefined });
    expect(f.scheduler.schedule({ entityId: 'three', run: () => undefined })).toBe(false);
    f.frame(); expect(errors).toHaveLength(1); expect(f.scheduler.pendingCount).toBe(0);
    f.scheduler.dispose(); expect(f.scheduler.schedule({ entityId: 'm', run() {} })).toBe(false);
  });
});
