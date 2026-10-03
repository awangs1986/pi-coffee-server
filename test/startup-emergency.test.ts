import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';

async function launch(role: 'web' | 'host', missing: string, check: (url: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'coffee-emergency-'));
  await mkdir(join(root, 'agent'));
  const codex = join(root, 'codex.mjs');
  await writeFile(codex, `#!/usr/bin/env node\nif(process.argv.includes('--version'))console.log('codex-cli 0.159.1');else await import(${JSON.stringify(pathToFileURL(resolve('test/fixtures/fake-codex-app-server.mjs')).href)});`, {mode:0o700});
  const child = spawn(process.execPath, ['--import', resolve('test/fixtures/missing-plugin.mjs'), resolve('dist/src/main.js'), role], {
    env: { PATH: process.env.PATH, HOME: root, PI_OFFLINE: '1',
      COFFEE_TEST_MISSING_PLUGIN: missing, PI_COFFEE_WEB_PORT: '0', PI_COFFEE_HOST_PORT: '0',
      PI_COFFEE_ALLOW_UNAUTHENTICATED: '1', PI_COFFEE_HOST_TOKEN: 'fixture-token',
      PI_COFFEE_TRANSFER_BIND: 'off', PI_COFFEE_AGENT_DIR: join(root, 'agent'),
      PI_COFFEE_WORKDIR: join(root, 'work'), PI_COFFEE_SESSION_DIR: join(root, 'sessions'),
      PI_COFFEE_TMP_ROOT: join(root, 'tmp'),
      PI_COFFEE_CODEX_COMMAND: codex, PI_COFFEE_CODEX_HOME: join(root,'codex-home'), CODEX_HOME:join(root,'codex-home'),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
  try {
    const address = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout: ' + output)), 10000);
      const poll = setInterval(() => {
        const found = output.match(role === 'web' ? /Web http:\/\/127\.0\.0\.1:(\d+)/ : /Host ws:\/\/127\.0\.0\.1:(\d+)/);
        if (found) { clearInterval(poll); clearTimeout(timer); accept('http://127.0.0.1:' + found[1]); }
      }, 20);
      child.once('exit', () => { clearInterval(poll); clearTimeout(timer); reject(new Error('Startup failed: ' + output)); });
      child.once('error', reject);
    });
    await check(address);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(root, { recursive: true, force: true });
  }
}

it.each(['pi-coffee-lsp', 'context-handoff'])('Web starts without Host-only package %s', async missing => {
  await launch('web', missing, async url => {
    expect(await (await fetch(url + '/healthz')).json()).toMatchObject({ ok: true, role: 'web' });
    expect((await fetch(url + '/')).status).toBe(200);
  });
});

it.each(['pi-coffee-lsp', 'context-handoff', 'pi-coffee-harness'])('Host exposes emergency mode when %s is missing', async missing => {
  await launch('host', missing, async url => {
    expect(await (await fetch(url + '/healthz')).json()).toMatchObject({ ok: true, role: 'host', runtime: { mode: 'emergency' } });
    expect((await fetch(url + '/api/engines')).status).toBe(401);
    const response = await fetch(url + '/api/engines', { headers: { Authorization: 'Bearer fixture-token' } });
    expect(await response.json()).toMatchObject({ runtime: { mode: 'emergency' }, engines: expect.arrayContaining([expect.objectContaining({ id: 'pi', available: true }),expect.objectContaining({id:'codex',available:true})]) });
    expect((await fetch(url+'/api/runtime')).status).toBe(401);
    const socket=new WebSocket(url.replace('http','ws')+'/host',{headers:{Authorization:'Bearer fixture-token'}}),frames:any[]=[];
    socket.on('message',data=>frames.push(JSON.parse(String(data))));
    try {
      await once(socket,'open');socket.send(JSON.stringify({v:1,type:'get_model_catalog',engine:'codex',requestId:'native-codex'}));
      await expect.poll(()=>frames.find(f=>f.requestId==='native-codex'),{timeout:5000}).toMatchObject({type:'model_catalog',engine:'codex',models:expect.arrayContaining([expect.objectContaining({provider:'codex',id:'gpt-fake'})])});
    } finally {socket.terminate();}
  });
},15000);
