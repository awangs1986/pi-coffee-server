// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createEngineDirectory } from '../public/engine-directory.js';
import { createAnswerDeliveries } from '../public/answer-deliveries.js';
import { appendPluginVersions } from '../public/plugin-versions.js';
import { assistantNode } from '../public/render.js';
import { renderConversationPreview } from '../public/conversation-preview-view.js';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

it('offers one preview and the original download for image and Markdown deliverables',async()=>{
 vi.useFakeTimers();
 const root=document.createElement('div');document.body.append(root);
 root.append(assistantNode({id:'a',text:'[drawing](../artifacts/map.svg)'}));
 const paths=['../artifacts/map.svg','../artifacts/memo.md','../artifacts/archive.zip'];
 const deliveries=createAnswerDeliveries({root,context:()=> 'owner/task',endpoint:path=>'/download/'+path,
   load:async()=>[{key:'native-message:a',files:paths.map(path=>({path,available:true}))}]});
 deliveries.refresh();await vi.advanceTimersByTimeAsync(100);
 expect([...root.querySelectorAll<HTMLButtonElement>('button[data-preview-path]')].map(b=>b.dataset.previewPath).sort()).toEqual(paths.slice(0,2).sort());
 expect(root.querySelectorAll('a[data-delivery-path]')).toHaveLength(2);
});

it('recovers a temporary delivery lookup and offers a bounded manual retry on prolonged failure',async()=>{
 vi.useFakeTimers();
 const root=document.createElement('div');document.body.append(root);root.append(assistantNode({id:'a',text:'done'}));
 let ok=false,reads=0;
 const deliveries=createAnswerDeliveries({root,context:()=> 'a',endpoint:()=>'/original',
   load:async()=>{reads++;if(!ok)throw Object.assign(Error('temporary'),{status:503});return [{key:'native-message:a',files:[{path:'a.zip',available:true}]}];}});
 deliveries.refresh();deliveries.refresh();
 await vi.advanceTimersByTimeAsync(65);ok=true;
 await vi.advanceTimersByTimeAsync(4000);
 expect(root.querySelector('.answer-delivery')?.getAttribute('href')).toBe('/original');
 ok=false;deliveries.refresh(true);
 await vi.advanceTimersByTimeAsync(15000);const exhausted=reads;
 deliveries.refresh();await vi.advanceTimersByTimeAsync(15000);
 expect(reads).toBe(exhausted);expect(root.querySelector('.answer-delivery')).not.toBeNull();
 ok=true;root.querySelector<HTMLButtonElement>('.answer-files-status button')!.click();
 await vi.advanceTimersByTimeAsync(100);
 expect(root.querySelector('.answer-files-status')).toBeNull();expect(reads).toBe(exhausted+1);
});

it('downloads an older retained answer through authoritative history beyond one metadata batch', async () => {
  vi.useFakeTimers();
  const root = document.createElement('div');
  document.body.append(root);
  const entries = Array.from({length: 46}, (_, i) => ({kind:'assistant', id:'row-'+i, text:'Reply '+i}));
  renderConversationPreview(root, {entries}, {cached:false});
  root.querySelector('button')!.click();
  const list = createAnswerDeliveries({root, context:()=>'alice/task', endpoint:path=>'/files/'+path,
    load:async (keys: string[]) => {
      if (keys.length > 40) throw Error('Oversized batch');
      return keys.includes('native-message:row-0') ? [{key:'native-message:row-0', files:[{path:'old.zip', available:true}]}] : [];
    }});
  list.refresh();
  await vi.advanceTimersByTimeAsync(100);
  expect(root.querySelector('[data-delivery-key="native-message:row-0"] .answer-delivery')?.getAttribute('href')).toBe('/files/old.zip');
  renderConversationPreview(root, {entries});
  list.refresh();
  expect(root.querySelector('[data-delivery-key], .answer-delivery')).toBeNull();
});

it('queries only newly visible answer keys after an older page has already been checked',async()=>{
 vi.useFakeTimers();
 const root=document.createElement('div');document.body.append(root);root.append(assistantNode({id:'first',text:'one'}));
 const queries:string[][]=[];
 const files=createAnswerDeliveries({root,context:()=> 'task',endpoint:()=>'/download',load:async(keys:string[])=>{queries.push(keys);return [];}});
 files.refresh();await vi.advanceTimersByTimeAsync(100);
 const second=assistantNode({id:'second',text:'two'});root.append(second);
 files.refresh(false,[second]);await vi.advanceTimersByTimeAsync(100);
 expect(queries).toEqual([['native-message:first'],['native-message:second']]);
});

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
