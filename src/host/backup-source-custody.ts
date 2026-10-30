import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, open, readFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export type BackupSourceOwnership = { state: 'owned' } | { state: 'unknown'; reason: string };
const markerName = '.pi-coffee-backup-source';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Source provenance, never an external-writer detector. Allocation precedes any
 * native launch. An adapter must ALSO require native descendant custody, complete
 * source-graph coverage and fenced admissions from every managed writer. Existing
 * directories cannot be adopted by attaching a marker or a supported=true flag.
 * Keep this ledger outside both task material and native stores; never restore it
 * from a backup as if historical authority were a current writer guarantee. */
export class BackupSourceCustody {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  async allocate(path: string): Promise<void> {
    const source = resolve(path);
    if (source === this.root || source.startsWith(this.root + '/') || this.root.startsWith(source + '/')) throw Error('Source and custody ledger must be separate');
    await this.checkedDirectory(dirname(source), false);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const ledger = await this.checkedDirectory(this.root);
    // Deliberately non-recursive and non-idempotent: EEXIST is not evidence of
    // ownership, including an empty legacy directory or a prior crashed allocation.
    await mkdir(source, { mode: 0o700 });
    const info = await this.checkedDirectory(source), id = randomUUID();
    await this.writeJson(source, markerName, { schema: 1, id });
    await this.writeJson(this.root, this.name(source), { schema: 1, id, source, dev: info.dev, ino: info.ino, uid: info.uid, ledgerDev: ledger.dev, ledgerIno: ledger.ino });
  }

  async owns(path: string): Promise<BackupSourceOwnership> {
    try {
      const source = resolve(path);
      const ledger = await this.checkedDirectory(this.root), info = await this.checkedDirectory(source);
      const record = await this.readJson(join(this.root, this.name(source)));
      const marker = await this.readJson(join(source, markerName));
      if (record.schema !== 1 || marker.schema !== 1 || typeof record.id !== 'string' || !uuid.test(record.id) || marker.id !== record.id || record.source !== source || record.dev !== info.dev || record.ino !== info.ino || record.uid !== info.uid || record.ledgerDev !== ledger.dev || record.ledgerIno !== ledger.ino) throw Error('Source custody changed');
      return { state: 'owned' };
    } catch { return { state: 'unknown', reason: 'source-custody-unestablished-or-changed' }; }
  }

  private name(source: string) { return createHash('sha256').update(source).digest('hex') + '.json'; }
  private async checkedDirectory(path: string, privateMode = true) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path) || info.uid !== process.getuid?.() || privateMode && (info.mode & 0o077) !== 0) throw Error('Source custody path unavailable');
    return info;
  }
  private async readJson(path: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 8192) throw Error('Source custody receipt unavailable');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  private async writeJson(dir: string, name: string, value: unknown) {
    const temp = join(dir, randomUUID() + '.tmp');
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temp, join(dir, name));
    const parent = await open(dir, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
}
