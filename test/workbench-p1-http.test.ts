import { afterEach, expect, it, vi } from 'vitest';
import { HostServer } from '../src/host/server.js';
import { WebServer } from '../src/web/server.js';

const shutdown: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of shutdown.splice(0).reverse()) await close();
});

it('lists the supported engines without a native probe and forwards one readiness read without waiting for Grok', async () => {
  const grok = Promise.withResolvers<{ id: 'grok'; name: string; available: boolean }>();
  const probe = vi.fn(async (id: string) => id === 'grok' ? grok.promise : { id: 'codex' as const, name: 'Codex', available: true });
  const factory = {
    list: async () => [], delete: async () => false,
    create: async () => { throw Error('No native thread'); },
    engineAvailability: probe,
  };
  const host = new HostServer({ port: 0, token: 'fixture', requireUser: true, factory, scopeForUser: () => ({ factory }) });
  await host.start();
  shutdown.push(() => host.close());
  const web = new WebServer({ port: 0, allowUnauthenticated: true, defaultUser: 'alice', hostToken: 'fixture', hostUrl: `ws://127.0.0.1:${host.address().port}/host` });
  await web.start();
  shutdown.push(() => web.close());
  const base = `http://127.0.0.1:${web.address().port}`;
  try {
    const catalog = await fetch(base + '/api/engines/directory');
    expect(catalog.status).toBe(200);
    expect(await catalog.json()).toMatchObject({ engines: expect.arrayContaining([{ id: 'codex', name: 'Codex' }]), chatEngines: ['pi', 'codex'] });
    expect(probe).not.toHaveBeenCalled();
    const pending = fetch(base + '/api/engines/grok');
    await vi.waitFor(() => expect(probe).toHaveBeenCalledWith('grok'));
    const codex = await fetch(base + '/api/engines/codex', { signal: AbortSignal.timeout(2000) });
    expect(await codex.json()).toMatchObject({ engine: { id: 'codex', available: true } });
    grok.resolve({ id: 'grok', name: 'Grok Build', available: false });
    expect(await (await pending).json()).toMatchObject({ engine: { id: 'grok', available: false } });
    expect((await fetch(`http://127.0.0.1:${host.address().port}/api/engines/codex`)).status).toBe(401);
  } finally {
    grok.resolve({ id: 'grok', name: 'Grok Build', available: false });
  }
});

it('persists new files under the native answer identity and hides attachments, old files and other accounts', async () => {
  const { mkdtemp, writeFile, mkdir, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { once } = await import('node:events');
  const { Workspaces } = await import('../src/host/workspaces.js');
  const { WebSocket } = await import('ws');
  const root = await mkdtemp(join(tmpdir(), 'coffee-answer-file-'));
  shutdown.push(() => rm(root, { recursive: true, force: true }));
  const stores = {
    alice: new Workspaces(join(root, 'alice'), {taskRoot: join(root, 'alice-bundles')}),
    bob: new Workspaces(join(root, 'bob'), {taskRoot: join(root, 'bob-bundles')}),
  };
  const task = await stores.alice.createChatConversation('sample');
  await writeFile(join(task.cwd, 'old.html'), '<p>old</p>');
  await writeFile(join(root, 'unrelated.html'), '<p>other</p>');
  let emit = (_event: unknown) => {};
  const factory = { list: async () => [], delete: async () => false, create: async () => ({
    onEvent: (listener: (value: unknown) => void) => { emit = listener; return () => {}; },
    getState: async () => ({isStreaming: false, messageCount: 0}),
    getHistory: async () => ({entries: [], leafId: null}),
    stop: async () => {},
    prompt: async () => {
      emit({type:'agent_start'});
      await mkdir(join(task.cwd, 'output'));
      await writeFile(join(task.cwd, 'output', 'report.html'), '<p>report</p>');
      await writeFile(join(task.taskRoot!, 'artifacts', 'report.docx'), 'doc fixture');
      await writeFile(join(task.taskRoot!, 'attachments', 'input.pdf'), 'input');
      await symlink(join(root, 'unrelated.html'), join(task.cwd, 'other.html'));
      emit({type:'message_end',message:{role:'assistant',timestamp:123,content:[{type:'text',text:'Finished'}]}});
      emit({type:'agent_settled'});
    },
  }) };
  const start = async () => {
    const host = new HostServer({ port: 0, token: 'answer-fixture', requireUser: true, factory,
      scopeForUser: user => ({factory, workspaces: user==='alice' ? stores.alice : stores.bob}) });
    await host.start();
    shutdown.push(() => host.close());
    return host;
  };
  const get = (host: InstanceType<typeof HostServer>, user='alice', key='pi-message:123') => fetch(
    `http://127.0.0.1:${host.address().port}/api/conversations/${task.id}/deliveries?` + new URLSearchParams({key}),
    {headers:{ authorization:'Bearer answer-fixture', 'x-pi-coffee-user':user }},
  );
  let host = await start();
  expect((await get(host)).status).toBe(200);
  const ws = new WebSocket(`ws://127.0.0.1:${host.address().port}/host`, {headers:{authorization:'Bearer answer-fixture','x-pi-coffee-user':'alice'}});
  shutdown.push(async () => ws.terminate());
  const frames: Array<{type: string}> = [];
  ws.on('message', bytes => frames.push(JSON.parse(bytes.toString())));
  await once(ws,'open');
  ws.send(JSON.stringify({v:1,type:'open',sessionId:task.id}));
  await vi.waitFor(() => expect(frames.some(frame => frame.type==='opened')).toBe(true));
  ws.send(JSON.stringify({v:1,type:'prompt',requestId:'example',text:'create result'}));
  await vi.waitFor(() => expect(frames.some(frame => frame.type==='answer_deliveries_changed')).toBe(true));
  const first = await (await get(host)).json();
  expect(first.deliveries).toEqual([{
    key:'pi-message:123', files:[
      {path:'../artifacts/report.docx', available:true},
      {path:'output/report.html', available:true},
    ],
  }]);
  expect(await (await get(host,'alice','pi-message:456')).json()).toEqual({deliveries:[]});
  expect((await get(host,'bob')).status).toBe(404);
  ws.terminate();
  await host.close();
  await rm(join(task.cwd,'output','report.html'));
  host = await start();
  expect((await (await get(host)).json()).deliveries[0].files).toContainEqual({path:'output/report.html',available:false});
});

it('reports qualified source separately from the selected Host plugin and omits local paths', async () => {
  const { mkdtemp, writeFile, mkdir, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readPluginProvenance } = await import('../src/host/plugin-provenance.js');
  const root = await mkdtemp(join(tmpdir(),'coffee-plugin-status-'));
  shutdown.push(() => rm(root,{recursive:true,force:true}));
  await copyFile('package-lock.json',join(root,'package-lock.json'));
  const manifests = new Map<string,string>();
  async function packageRoot(folder: string, name: string, version: string, bundled = true) {
    const dir = join(root,folder);
    await mkdir(dir);
    const path = join(dir,'package.json');
    await writeFile(path,JSON.stringify({name,version,privatePath:'/never-public'}));
    if (bundled) manifests.set(name,path);
    return dir;
  }
  const lsp = await packageRoot('stock-lsp','pi-coffee-lsp','0.4.8');
  await packageRoot('stock-harness','pi-coffee-harness','0.3.4');
  const overridden = await packageRoot('custom-root','pi-coffee-harness','9.0.0',false);
  await packageRoot('stock-handoff','context-handoff','0.2.0-experimental.7');
  await packageRoot('stock-mishu','pi-coffee-mishu','0.4.0-experience.2');
  const factory = {list:async()=>[],delete:async()=>false,create:async()=>{throw Error('No native thread');}};
  const host = new HostServer({port:0,token:'plugin-fixture',factory,requireUser:true,
    pluginProvenance: () => readPluginProvenance({releaseDir:root,selectedRoots:[lsp,overridden],mishuEligible:true,resolvePackage:name=>manifests.get(name)}),
  });
  await host.start();
  shutdown.push(() => host.close());
  const web = new WebServer({port:0,allowUnauthenticated:true,defaultUser:'alice',hostToken:'plugin-fixture',
    hostUrl:`ws://127.0.0.1:${host.address().port}/host`});
  await web.start();
  shutdown.push(() => web.close());
  const endpoint = `http://127.0.0.1:${web.address().port}/api/release`;
  const response = await fetch(endpoint);
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.hostPlugins).toEqual(expect.arrayContaining([
    expect.objectContaining({name:'pi-coffee-lsp', state:'selected', installedVersion:'0.4.8', effectiveVersion:'0.4.8',
      artifactVersion:'0.4.8', integrity:expect.stringMatching(/^sha512-/), source:expect.objectContaining({commit:'dcbcc74367a53fd0355e3b2befdf7a0752beee88'})}),
    expect.objectContaining({name:'pi-coffee-harness',state:'override',installedVersion:'0.3.4',effectiveVersion:'9.0.0'}),
    expect.objectContaining({name:'context-handoff',state:'disabled'}),
    expect.objectContaining({name:'pi-coffee-mishu',state:'conditional',source:{repository:'awangs/pi-coffee-mishu',
      tag:'candidates/pi-1.4.0-08fbd13',commit:'08fbd13bee42a3106555c92cd432d359b7d4cfec'}}),
  ]));
  expect(JSON.stringify(data)).not.toContain(root);
  expect(JSON.stringify(data)).not.toContain('never-public');
  const { readFile } = await import('node:fs/promises');
  const lockPath = join(root,'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath,'utf8'));
  delete lock.packages['node_modules/pi-coffee-lsp'].integrity;
  await writeFile(lockPath,JSON.stringify(lock));
  const unknown = await (await fetch(endpoint)).json();
  expect(unknown.hostPlugins.find((plugin:{name:string})=>plugin.name==='pi-coffee-lsp')).not.toHaveProperty('source');
});
