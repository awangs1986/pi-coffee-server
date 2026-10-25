import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectPiRecoveryConfiguration } from '../src/host/pi-recovery-config.js';

test('ordinary native model and reasoning settings are recoverable while authentication requires fresh login', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-config-recovery-'));
  try {
    await writeFile(join(root, 'settings.json'), JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'example', defaultThinkingLevel: 'high' }));
    await writeFile(join(root, 'models.json'), JSON.stringify({ providers: { fixture: { models: [{ id: 'example' }] } } }));
    await writeFile(join(root, 'auth.json'), JSON.stringify({ fixture: 'synthetic-auth-must-not-be-restored' }));
    const graph = await collectPiRecoveryConfiguration({ agentDir: root });
    expect(graph.sources.map(x => x.recoveryKey).sort()).toEqual(['native-config/file/models.json', 'native-config/file/settings.json']);
    expect(graph.policy.reauthenticationRequired).toBe(true);
    expect(graph.policy.authenticationRestored).toBe(false);
    await graph.validate();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('private prompt files are included but external configured resources are never silently omitted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-config-recovery-'));
  try {
    await mkdir(join(root, 'prompts'));
    await writeFile(join(root, 'prompts', 'review.md'), 'Review the current task.');
    await writeFile(join(root, 'settings.json'), JSON.stringify({ prompts: ['./prompts/review.md'] }));
    const graph = await collectPiRecoveryConfiguration({ agentDir: root });
    expect(graph.sources.map(x => x.recoveryKey).sort()).toEqual(['native-config/file/prompts', 'native-config/file/settings.json']);
    await writeFile(join(root, 'settings.json'), JSON.stringify({ prompts: ['../unowned/review.md'] }));
    await expect(graph.validate()).rejects.toThrow();
    await expect(collectPiRecoveryConfiguration({ agentDir: root })).rejects.toThrow('External Pi resource');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('configured packages require exact artifact identities supplied by the trusted release consumer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-config-recovery-'));
  try {
    const source = '/trusted-release/node_modules/fixture-package';
    await writeFile(join(root, 'settings.json'), JSON.stringify({ packages: [{ source, extensions: [] }] }));
    await expect(collectPiRecoveryConfiguration({ agentDir: root })).rejects.toThrow('Unmapped Pi package');
    const graph = await collectPiRecoveryConfiguration({ agentDir: root, immutablePackages: { [source]: 'fixture-package@1.0.0#locked-fixture-artifact' } });
    expect(graph.policy.immutablePackages).toEqual([{ source, artifact: 'fixture-package@1.0.0#locked-fixture-artifact' }]);
    await graph.validate();
    await writeFile(join(root, 'settings.json'), JSON.stringify({ packages: [source + '-other'] }));
    await expect(collectPiRecoveryConfiguration({ agentDir: root, immutablePackages: { [source]: 'fixture-package@1.0.0#locked-fixture-artifact' } })).rejects.toThrow('Unmapped Pi package');
  } finally { await rm(root, { recursive: true, force: true }); }
});
