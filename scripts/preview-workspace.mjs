// Local UI preview of the SPEC §1.1 workspace shell with a FAKE Pi: no VM, no model, no login.
// Starts Transfer + Host + Web against a throw-away project root with a few Git branches so the
// three-column layout, the bottom-bar branch selector, uploads and previews can be inspected in a
// browser. Nothing here is a deployment mode; see docs/deployment/runbook.md for real VMs.
//
//   npm run build && node scripts/preview-workspace.mjs
//   PORT=3000 PI_COFFEE_PREVIEW_BIND=0.0.0.0 node scripts/preview-workspace.mjs     # reachable from another machine
//   PI_COFFEE_PREVIEW_TRANSFER_URL=https://files.example  ...                        # browser-facing URL of the file port
//     (only needed behind a reverse proxy that maps ports to host names; the fake VM file port is then
//      published there. The product's own answer to this is the pending same-origin file gateway, SPEC §7.3.)
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Workspaces } from '../dist/src/host/workspaces.js';
import { HostServer } from '../dist/src/host/server.js';
import { TransferServer } from '../dist/src/host/transfer.js';
import { WebServer } from '../dist/src/web/server.js';

const exec = promisify(execFile);
const git = (cwd, args) => exec('git', ['-c', 'user.name=Preview', '-c', 'user.email=preview@localhost', ...args], { cwd });
const bind = process.env.PI_COFFEE_PREVIEW_BIND ?? '127.0.0.1';
const webPort = Number(process.env.PORT ?? 3000);
const transferPort = Number(process.env.PI_COFFEE_PREVIEW_TRANSFER_PORT ?? 53317);

const root = await mkdtemp(join(tmpdir(), 'coffee-preview-'));
const workspaces = new Workspaces(join(root, 'projects'));
const lab = await workspaces.createProject('coffee-lab');
await writeFile(join(lab.path, 'README.md'), '# coffee-lab\n\nPreview project. Files here live in the fake VM project root.\n');
await git(lab.path, ['add', '.']); await git(lab.path, ['commit', '-q', '-m', 'docs: readme']);
await git(lab.path, ['branch', 'feature/branch-selector']);
await git(lab.path, ['branch', 'fix/file-tree-column']);
// A Gitea-like remote (bare clone) so remote-tracking branches show up in the selector.
const remote = join(root, 'gitea-remote.git');
await git(root, ['clone', '--bare', '--quiet', lab.path, remote]); await git(remote, ['branch', 'release/0.1']);
await git(lab.path, ['remote', 'add', 'origin', remote]); await git(lab.path, ['fetch', '--quiet', 'origin']);
await workspaces.createProject('docs');

const history = new Map();
const factory = {
  list: async () => [...history.keys()].map((id) => ({ id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: history.get(id).length, preview: history.get(id)[0]?.text ?? '' })),
  delete: async (id) => history.delete(id),
  create: async ({ sessionId: id }) => {
    const cwd = await workspaces.cwd(id);
    let current = { provider: 'preview', id: 'fake-pi' };
    const listeners = new Set(); let streaming = false;
    const emit = (event) => { for (const l of listeners) l(event); };
    return {
      backgroundState: async () => ({ known: true, active: 0 }),
      getHistory: async () => ({ entries: history.get(id) ?? [], leafId: null }),
      getState: async () => ({ isStreaming: streaming, messageCount: history.get(id)?.length ?? 0 }),
      getModels: async () => ({ models: [{ provider: 'preview', id: 'fake-pi', source: 'native' }, { provider: 'preview-relay', id: 'fake-relay', source: 'relay' }], current, thinkingLevels: ['off', 'low'], thinkingLevel: 'off' }),
      getCommands: async () => [], getExtensions: async () => [], getStats: async () => ({ tokens: { total: 1234 }, cost: 0 }),
      rename: async () => {}, setModel: async (provider, model) => { current = { provider, id: model }; }, setThinkingLevel: async () => {},
      compact: async () => {}, respondUi: async () => {}, steer: async () => {}, followUp: async () => {}, abort: async () => {}, stop: async () => {},
      onEvent: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
      prompt: async (text) => {
        streaming = true; emit({ type: 'agent_start' });
        emit({ type: 'message_start', message: { role: 'user', content: [{ type: 'text', text }] } });
        emit({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text }] } });
        const branch = (await git(cwd, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
        await writeFile(join(cwd, 'diagram.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="160"><rect width="420" height="160" rx="12" fill="#f3eadc"/><text x="24" y="70" font-size="22" font-family="sans-serif">PI Coffee preview</text><text x="24" y="110" font-size="14" font-family="monospace">${branch}</text></svg>`);
        await writeFile(join(cwd, 'notes.md'), `# Notes\n\nGenerated by the fake Pi for **${text.slice(0, 40)}**.\n\n- worktree branch: \`${branch}\`\n- this file is in the conversation worktree on the (fake) VM\n`);
        const reply = `这是预览用的假 Pi。当前 worktree 分支 \`${branch}\`。\n\n我在工作区写了两个文件：\n\n![diagram](diagram.svg)\n\n[notes.md](notes.md)`;
        for (const piece of reply.match(/[\s\S]{1,24}/g)) { emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: piece } }); await new Promise((r) => setTimeout(r, 40)); }
        emit({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } });
        history.set(id, [...(history.get(id) ?? []), { kind: 'user', id: 'u' + Date.now(), text }, { kind: 'assistant', id: 'a' + Date.now(), text: reply }]);
        streaming = false; emit({ type: 'agent_settled' });
      },
    };
  },
};

const transfer = new TransferServer({ host: bind, port: transferPort, advertiseHost: bind === '0.0.0.0' ? undefined : bind, workdir: root, workspaces, allowUnscoped: false });
if (process.env.PI_COFFEE_PREVIEW_TRANSFER_URL) transfer.publicUrl = () => process.env.PI_COFFEE_PREVIEW_TRANSFER_URL.replace(/\/$/, '');
await transfer.start();
const host = new HostServer({ port: 0, host: '127.0.0.1', token: 'preview-token', factory, workspaces, transfer });
await host.start();
// allowUnauthenticated: the fake stack has no identity; anyone reaching the port sees the throw-away project root.
const web = new WebServer({ host: bind, port: webPort, hostUrl: `ws://127.0.0.1:${host.address().port}/host`, hostToken: 'preview-token', publicDir: fileURLToPath(new URL('../dist/public', import.meta.url)), allowUnauthenticated: bind !== '127.0.0.1' });
if (process.env.PI_COFFEE_PREVIEW_TRUST_PROXY) {
  // Behind a TLS-terminating preview proxy the browser Origin is https://… while this server speaks http.
  // Preview only: normalise the header so the anonymous same-origin check passes. Never do this in a deployment.
  web.http.prependListener('request', (req) => { if (req.headers.origin && req.headers.host) req.headers.origin = `http://${req.headers.host}`; });
}
await web.start();

console.log(JSON.stringify({
  web: `http://${bind}:${web.address().port}/`,
  files: transfer.publicUrl(),
  projects: ['coffee-lab (main, feature/branch-selector, fix/file-tree-column, origin/release/0.1)', 'docs (empty)'],
  note: 'Fake Pi, temp project root, anonymous single-user Web. Ctrl+C removes everything.',
}, null, 2));

const shutdown = async () => { await web.close(); await host.close(); await transfer.close(); await rm(root, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
