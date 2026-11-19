// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createEngineDirectory } from '../public/engine-directory.js';
import { createAnswerDeliveries } from '../public/answer-deliveries.js';
import { appendPluginVersions } from '../public/plugin-versions.js';
import { assistantNode } from '../public/render.js';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it('enables an independently checked engine while a second probe is pending and retries only the failed engine', async () => {
  const delayed = Promise.withResolvers<Response>(), login = Promise.withResolvers<Response>();
  const ok = (body: unknown) => new Response(JSON.stringify(body));
  const read = vi.fn(async (path: string) => {
    if (path.endsWith('/directory')) return ok({independentReadiness:true,engines:[{id:'codex'},{id:'grok'}]});
    if (path.endsWith('/grok')) return delayed.promise;
    if (path.endsWith('/grok/retry')) return login.promise;
    return ok({engine:{id:'codex',available:true}});
  });
  let rows: Array<{id: string; available?: boolean; checking?: boolean; stale?: boolean; retry?: boolean}> = [];
  const directory = createEngineDirectory({fetch:read, ids:['codex','grok'], onChange: next => { rows = next; }});
  directory.setScope('alice');
  try {
    await vi.waitFor(() => expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({id:'codex',available:true}), expect.objectContaining({id:'grok',checking:true}),
    ])));
    delayed.resolve(new Response('',{status:503}));
    await vi.waitFor(() => expect(rows.find(row=>row.id==='grok')).toMatchObject({available:false,retry:true}));
    const first = directory.retry('grok'), duplicate = directory.retry('grok');
    expect(first).toBe(duplicate);
    login.resolve(ok({engine:{id:'grok',available:true}}));
    await first;
    expect(rows.find(row=>row.id==='grok')?.available).toBe(true);
    expect(read.mock.calls.map(call=>call[0])).toEqual(['/api/engines/directory','/api/engines/codex','/api/engines/grok','/api/engines/grok/retry']);
  } finally { directory.setScope(undefined); }
});

it('keeps a delivery on its own answer across a history repaint and leaves other replies empty', async () => {
  vi.useFakeTimers();
  const root = document.createElement('div');
  document.body.append(root);
  const one = {id:'a',sourceMessageKey:'pi-message:100',text:'已完成'},
    two = {id:'b',sourceMessageKey:'pi-message:200',text:'已完成'};
  root.append(assistantNode(one),assistantNode(two));
  let scope = 'alice/task', available = true;
  const load = vi.fn(async () => [{key:'pi-message:200',files:[{path:'report.html',available},{path:'details.docx',available:true}]}]);
  const deliveries = createAnswerDeliveries({
    root, context:()=>scope, load, endpoint:path=>'/download?path='+encodeURIComponent(path),
  });
  deliveries.refresh();
  await vi.advanceTimersByTimeAsync(60);
  expect(root.firstElementChild!.querySelector('.answer-deliveries')).toBeNull();
  const group = root.lastElementChild!.querySelector('details.answer-deliveries')!;
  expect(group.hasAttribute('open')).toBe(false);
  expect(group.querySelector('a')?.getAttribute('href')).toBe('/download?path=report.html');
  root.replaceChildren(assistantNode(one),assistantNode(two));
  deliveries.refresh();
  expect(root.lastElementChild!.querySelectorAll('.answer-deliveries a')).toHaveLength(2);
  expect(load).toHaveBeenCalledTimes(1);
  available=false;deliveries.refresh(true);await vi.advanceTimersByTimeAsync(60);
  expect(root.lastElementChild!.textContent).toContain('report.html · 文件不可用');
  expect(root.lastElementChild!.querySelectorAll('.answer-deliveries a')).toHaveLength(1);
  scope='bob/other';deliveries.refresh();
  expect(root.querySelector('.answer-deliveries')).toBeNull();
});

it('shows actual Host selection independently from the artifact pin, with an older Host fallback', () => {
  const panel = document.createElement('div');
  appendPluginVersions(panel,[{name:'pi-coffee-lsp',state:'override',installedVersion:'0.4.8',
    effectiveVersion:'0.5.0',artifactVersion:'0.4.8',integrity:'sha512-example'}]);
  expect(panel.textContent).toContain('LSP · 使用本地覆盖');
  expect(panel.textContent).toContain('安装 0.4.8 · 选用 0.5.0');
  expect(panel.textContent).toContain('源码来源未核实');
  panel.replaceChildren();
  appendPluginVersions(panel,undefined);
  expect(panel.textContent).toContain('当前 Host 未提供插件版本明细');
});
