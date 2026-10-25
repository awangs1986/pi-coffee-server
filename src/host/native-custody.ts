import { mkdir, lstat, realpath, readFile, readdir, open, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type NativeCustodyState = { state: 'quiescent' } | { state: 'active' | 'unknown'; reason: string };
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Custody of launched descendants only. This does NOT prove exclusive ownership
 * of a native store or workspace: the recovery adapter must prove that separately.
 * A live native process is a writer even when its RPC reports idle. No capture
 * operation stops a runtime or its descendants to obtain a quiescent result. */
export class NativeWriterCustody {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }

  async prepare(command: { executable: string; args?: string[];cwd?:string;env?:Record<string,string|undefined> }): Promise<{ cliPath: string; env: Record<string,string> }> {
    if (process.platform !== 'linux') throw Error('Native writer custody requires Linux');
    if (!command.executable || !Array.isArray(command.args ?? [])) throw Error('Invalid native command');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.checkedDirectory(this.root);
    const id = randomUUID(), dir = join(this.root, id);
    await mkdir(dir, { mode: 0o700 });
    await this.atomicJson(dir, 'command.json', { schema: 1, id, executable: command.executable, args: command.args ?? [] });
    await this.atomicJson(dir, 'state.json', { schema: 1, id, state: 'prepared' });
    return {
      cliPath: fileURLToPath(new URL('./native-custody-launcher.mjs', import.meta.url)),
      env: { PI_COFFEE_CUSTODY_DIR: dir, PI_COFFEE_CUSTODY_ID: id },
    };
  }

  async state(): Promise<NativeCustodyState> {
    if (process.platform !== 'linux') return { state: 'unknown', reason: 'native-custody-unavailable' };
    try {
      await this.checkedDirectory(this.root);
      const ids = await readdir(this.root);
      if (!ids.length) return { state: 'unknown', reason: 'native-custody-unestablished' };
      const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      let active = false;
      for (const id of ids) {
        if (!idPattern.test(id)) throw Error('Unknown custody entry');
        const dir = join(this.root, id);
        await this.checkedDirectory(dir);
        const command = await this.readJson(join(dir, 'command.json'));
        const receipt = await this.readJson(join(dir, 'state.json'));
        if (receipt.schema !== 1 || command.schema !== 1 || receipt.id !== id || command.id !== id || receipt.boot !== boot) throw Error('Unknown custody receipt');
        if (receipt.state === 'quiescent') continue;
        if (receipt.state !== 'active' || !Number.isSafeInteger(receipt.pid) || receipt.pid < 1 || typeof receipt.birth !== 'string') throw Error('Incomplete custody');
        const processStat = await readFile(`/proc/${receipt.pid}/stat`, 'utf8');
        const fields = processStat.slice(processStat.lastIndexOf(')') + 2).split(' ');
        if (fields[19] !== receipt.birth || fields[0] === 'Z' || fields[0] === 'X') throw Error('Custody owner changed');
        active = true;
      }
      return active ? { state: 'active', reason: 'native-writers-active' } : { state: 'quiescent' };
    } catch { return { state: 'unknown', reason: 'native-custody-incomplete' }; }
  }

  private async checkedDirectory(path: string) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path) || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw Error('Custody path unavailable');
  }
  private async readJson(path: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw Error('Custody receipt unavailable');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  private async atomicJson(dir: string, name: string, value: unknown) {
    const temp = join(dir, randomUUID() + '.tmp');
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temp, join(dir, name));
    const parent = await open(dir, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
}

/** Live admission policy wrapper used by an old Host during natural handoff. */
export class AdmissionNativeCustody extends NativeWriterCustody {
 constructor(root:string,private policy:import('./managed-launch-policy.js').ManagedLaunchPolicy){super(root);}
 override async prepare(command:Parameters<NativeWriterCustody['prepare']>[0]){this.policy.assertLegacyAllowed();return super.prepare(command);}
}
