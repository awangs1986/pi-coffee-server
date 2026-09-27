import { WORK_TOOLS } from "../dist/src/harness/mode.js";
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { RpcClient } from '@earendil-works/pi-coding-agent';
import { resolvePiExtensions } from '../dist/src/pi-extensions.js';

// Deterministic transport probe, not an evaluation of a real model's decisions.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reports = [];
// Pi Lens is not bundled: its peer range does not support the pinned Pi release.
const lensModes = process.argv.includes("--with-pi-lens") ? [false, true] : [false];
for (const lensEnabled of lensModes) reports.push(await probe(lensEnabled));
console.log(JSON.stringify({ ok: reports.every(r => r.ok), model: 'local scripted fixture', reports }, null, 2));
if (reports.some(r => !r.ok)) process.exitCode = 1;

async function probe(lensEnabled) {
  const root = await mkdtemp(join(tmpdir(), 'coffee-toolchain-'));
  const workspace = join(root, 'workspace');
  const agentDir = join(root, 'agent');
  await mkdir(workspace); await mkdir(agentDir); await mkdir(join(workspace, '.picode'));
  execFileSync('git', ['init', '-q', workspace]);
  const steps = [
    { name: 'write', args: { path: 'marker.txt', content: 'alpha\n' }, expected: /wrote/i },
    { name: 'read', args: { path: 'marker.txt' }, expected: /alpha/ },
    { name: 'edit', args: { path: 'marker.txt', edits: [{ oldText: 'alpha', newText: 'beta' }] }, expected: /replaced|edited|applied/i },
    { name: 'bash', args: { command: 'node -e "if(require(\'fs\').readFileSync(\'marker.txt\',\'utf8\')!==\'beta\\n\')process.exit(1);console.log(\'BASH_OK\')"' }, expected: /BASH_OK/ },
    { name: 'bash', args: { command: 'rg beta marker.txt' }, expected: /beta/ },
    { name: 'bash', args: { command: 'find . -name marker.txt' }, expected: /marker.txt/ },
    { name: 'bash', args: { command: 'ls .' }, expected: /marker.txt/ },
    { name: 'git', args: { action: 'status' }, expected: /marker.txt/ },
    { name: 'search_tools', args: { action: 'search', query: 'web' }, expected: /web:/ },
    { name: 'search_tools', args: { action: 'activate', capability_id: 'web' }, expected: /Activated web/ },
    { name: 'web_search', args: { query: 'fixture evidence', delegate: false }, expected: /example.com/ },
    { name: 'search_tools', args: { action: 'activate', capability_id: 'subagent' }, expected: /Activated subagent/ },
  ];
  let cursor = 0; let calls = 0; const missing = []; const observed = []; const requestTools = [];
  const server = createServer(async (req, res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || '{}');
      if (req.url === '/v1/search/serper') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ responseId: 'probe', queries: ['fixture evidence'], results: [{ title: 'Fixture evidence', url: 'https://example.com/fixture', snippet: 'Synthetic local evidence' }] })); return;
      }
      if (++calls > 35) { res.writeHead(500); res.end('probe request limit'); return; }
      const names = (input.tools ?? []).map(t => t.function?.name).filter(Boolean);
      requestTools.push(names);
      let step = steps[cursor++];
      while (step && !names.includes(step.name)) { missing.push(step.name); step = steps[cursor++]; }
      const delta = step ? { role: 'assistant', tool_calls: [{ index: 0, id: `probe-${cursor}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] } : { role: 'assistant', content: 'Probe completed.' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: step ? 'tool_calls' : 'stop' }]) res.write(`data: ${JSON.stringify({ id: 'probe', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [choice] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { probe: { baseUrl: baseUrl + '/v1', api: 'openai-completions', apiKey: 'synthetic-fixture', models: [{ id: 'fixture', name: 'fixture', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 2048 }] } } }));
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
  const inspection = join(root, 'inspect.mjs'); const snapshotsPath = join(root, 'snapshots.json');
  await writeFile(inspection, `import {writeFileSync} from 'node:fs'; export default function(pi){const snapshots=[]; const save=(label)=>{snapshots.push({label,active:pi.getActiveTools(),registered:pi.getAllTools().map(t=>t.name)});writeFileSync(${JSON.stringify(snapshotsPath)},JSON.stringify(snapshots));};pi.on('session_start',()=>save('session_start'));pi.registerCommand('toolchain-inspect',{description:'Local probe snapshot',handler:async(args)=>save(args)});}`);
  const extensions = resolvePiExtensions({ PI_COFFEE_AGENT_DIR: agentDir, PI_COFFEE_PI_LENS: lensEnabled ? 'on' : 'off' });
  const client = new RpcClient({ cliPath: join(repo, 'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'), cwd: workspace, provider: 'probe', model: 'fixture',
    env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_COFFEE_SEARCH_URL: baseUrl, PI_COFFEE_SCHEDULER_DIR: join(root, 'admission'), PI_SUBAGENTS_TEMP_ROOT: join(root, 'children'), PI_LENS_HOME: join(root, 'lens-home'), PILENS_DATA_DIR: join(root, 'lens-data'), PI_LENS_DISABLE_LSP_INSTALL: '1', PI_LENS_DISABLE_TOOL_INSTALL: '1' },
    args: ['--offline', '--no-session', ...extensions.flatMap(p => ['--extension', p]), '--extension', inspection] });
  const errors = [];
  const unsubscribe = client.onEvent(event => {
    if (event.type === 'extension_error') errors.push(String(event.error ?? event.message ?? event).slice(0, 500));
    if (event.type === 'tool_execution_end') {
      const text = (event.result?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
      observed.push({ tool: event.toolName, isError: event.isError === true, text });
    }
  });
  let report;
  try {
    await client.start();
    await client.prompt('/work');
    await client.prompt('/toolchain-inspect work_baseline');
    await client.promptAndWait('Run the deterministic local toolchain fixture.', undefined, 90000);
    await client.prompt('/toolchain-inspect after_activation');
    const snapshots = JSON.parse(await readFile(snapshotsPath, 'utf8'));
    const work = snapshots.find(s => s.label === 'work_baseline');
    const requiredLens = ['lens_diagnostics', 'lsp_diagnostics', 'module_report', 'read_symbol', 'read_enclosing', 'symbol_search', 'pi_lens_activate_tools'];
    const unexpectedLensActive = lensEnabled ? requiredLens.filter(name => work?.active.includes(name)) : [];
    const checks = steps.map((step, i) => ({ tool: step.name, ...(step.label ? { label: step.label } : {}), ok: observed[i]?.tool === step.name && !observed[i]?.isError && step.expected.test(observed[i]?.text ?? ''), ...(!step.expected.test(observed[i]?.text ?? '') || observed[i]?.isError ? { detail: observed[i]?.text.slice(0, 350) ?? 'not executed' } : {}) }));
    const firstRequestLens = lensEnabled ? requiredLens.filter(name => requestTools[0]?.includes(name)) : [];
    report = { lensEnabled, ok: JSON.stringify(requestTools[0]) === JSON.stringify([...WORK_TOOLS, "recall_folded"]) && checks.every(c => c.ok) && errors.length === 0 && missing.length === 0 && unexpectedLensActive.length === 0 && firstRequestLens.length === 0, checks, missing, unexpectedLensActive, unexpectedLensInModelRequest: firstRequestLens, snapshots, extensionErrors: errors, markerCorrect: (await readFile(join(workspace, 'marker.txt'), 'utf8')) === 'beta\n', requests: calls };
  } catch (error) { report = { lensEnabled, ok: false, error: String(error), extensionErrors: errors, stderr: client.getStderr().slice(-1200) }; }
  finally { unsubscribe(); await client.stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(root, { recursive: true, force: true }); }
  return report;
}
