import { test, expect } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, rename, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupSourceCustody } from '../src/host/backup-source-custody.js';

test('an existing empty native store cannot be silently adopted as a completely managed source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-custody-'));
  try {
    const source = join(root, 'native'); await mkdir(source, { mode: 0o700 });
    const custody = new BackupSourceCustody(join(root, 'ledger'));
    await expect(custody.allocate(source)).rejects.toThrow();
    expect((await custody.owns(source)).state).toBe('unknown');
    expect(await readdir(source)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('newly allocated source provenance survives a controller restart but not replacement of the source directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-custody-'));
  try {
    const source = join(root, 'native'), ledger = join(root, 'ledger');
    const custody = new BackupSourceCustody(ledger);
    await custody.allocate(source);
    expect(await new BackupSourceCustody(ledger).owns(source)).toEqual({ state: 'owned' });
    await rename(source, join(root, 'original'));
    await mkdir(source, { mode: 0o700 });
    expect((await custody.owns(source)).state).toBe('unknown');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a copied ownership marker and ledger do not grant authority to another source or a symlink alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'source-custody-'));
  try {
    const source = join(root, 'native'), ledger = join(root, 'ledger');
    const custody = new BackupSourceCustody(ledger);
    await custody.allocate(source);
    await cp(source, join(root, 'copy'), { recursive: true });
    expect((await custody.owns(join(root, 'copy'))).state).toBe('unknown');
    await symlink(source, join(root, 'alias'));
    expect((await custody.owns(join(root, 'alias'))).state).toBe('unknown');
    await cp(ledger, join(root, 'copied-ledger'), { recursive: true });
    expect((await new BackupSourceCustody(join(root, 'copied-ledger')).owns(source)).state).toBe('unknown');
  } finally { await rm(root, { recursive: true, force: true }); }
});
