// Run against the actual Web entrypoint before accepting a deployment.
// This catches deployment of the older monolithic shell even when health is green.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3000/');
const release = process.argv[3]; // systemd WorkingDirectory, when OAuth protects HTML
const response = await fetch(base, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10000) });
assert.ok(response.status === 200 || (response.status === 302 && response.headers.get('location') === '/auth/login'), 'Web entrypoint must respond or require its normal login');
assert.ok(response.status === 200 || release, 'OAuth-protected Web: pass the active release directory as the second argument');
const html = response.status === 200 ? await response.text() : await readFile(join(release, 'dist/public/index.html'), 'utf8');
const controls = {
  'Pi Coffee menu': ['brand-menu-btn', 'skills-btn'],
  'Pi/Codex/Claude task selection': ['task-engine', 'task-kind'],
  'Context categories': ['sp-context-legend'],
  'Files and Diff': ['files-toggle', 'workspace-panel', 'files-diff', 'diff-dialog'],
  'Work Agent takeover': ['takeover-dialog', 'takeover-confirm', 'takeover-cancel'],
  'Pending instruction editor': ['queue', 'queue-edit-dialog', 'queue-edit-text'],
  'SSHME connection dialog': ['sshme-dialog', 'sshme-form', 'sshme-connect', 'sshme-platform', 'sshme-forget'],
  'Task details footer': ['project-controls', 'workspace-context'],
};
let failures = 0;
for (const [name, ids] of Object.entries(controls)) {
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  console.log(`${missing.length ? 'FAIL' : 'PASS'} ${name}${missing.length ? `: missing ${missing.join(', ')}` : ''}`);
  if (missing.length) failures++;
}
if (!failures) {
  for (const path of ['app.js', 'recent-conversations.js', 'app.css', 'context-status.js', 'review.js', 'diff.js', 'skills.js', 'runners.js', 'sshme.js', 'queue-controls.js', 'takeover-controls.js']) {
    const asset = await fetch(new URL(path, base), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    const text = await asset.text();
    assert.equal(asset.status, 200, `Asset ${path}`);
    assert.ok(text.length > 100 && !text.trimStart().startsWith('<!doctype'), `Asset ${path} must not be an HTML fallback`);
    if (release) assert.equal(text, await readFile(join(release, 'dist/public', path), 'utf8'), `Served ${path} must match the active complete release`);
  }
  console.log('PASS complete workbench assets');
}
process.exitCode = failures ? 1 : 0;
