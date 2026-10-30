import { createHash } from 'node:crypto';
import { lstat, realpath, readdir, readFile } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { BackupError } from './backup.js';

type ConfigurationSource = { id: string; recoveryKey: string; role: 'native'; path: string };
export interface PiRecoveryConfigurationOptions {
  agentDir: string;
  includeAuthentication?: boolean;
  /** Exact configured package source -> immutable artifact identity. Supplied by
   * the trusted release consumer, never inferred from a name or browser input. */
  immutablePackages?: Record<string,string>;
}

/** Captures standard mutable Pi configuration without turning it into current
 * authentication authority. External resource graphs need explicit mappings. */
export async function collectPiRecoveryConfiguration(options: PiRecoveryConfigurationOptions) {
  const root = resolve(options.agentDir);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) throw new BackupError('unsafe_source', 'Unsafe Pi configuration root');
  const selected = new Set<string>();
  const packages: { source: string; artifact: string }[] = [];
  const regular = new Set([...(options.includeAuthentication?['auth.json']:[]),'settings.json', 'models.json', 'models-store.json', 'web-search.json', 'AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md']);
  const resources = new Set(['skills', 'prompts', 'themes']);
  const names = await readdir(root);
  let settings: Record<string,unknown> = {};
  if (names.includes('settings.json')) {
    const path = join(root, 'settings.json'), info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new BackupError('configuration_incomplete', 'Invalid Pi settings source');
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupError('configuration_incomplete', 'Invalid Pi settings');
    settings = value as Record<string,unknown>;
  }
  for (const key of ['skills', 'prompts', 'themes', 'extensions']) {
    const configured = settings[key];
    if (configured === undefined) continue;
    if (!Array.isArray(configured) || configured.some(item => typeof item !== 'string')) throw new BackupError('configuration_incomplete', 'Unsupported Pi resource declaration');
    for (const item of configured as string[]) {
      if (item.startsWith('!')) continue;
      if (options.immutablePackages && Object.hasOwn(options.immutablePackages, item)) { packages.push({ source: item, artifact: options.immutablePackages[item] }); continue; }
      if (key === 'extensions') throw new BackupError('configuration_incomplete', 'Custom extension storage requires a versioned recovery mapping');
      const path = resolve(root, item), rel = relative(root, path);
      if (!rel || rel.startsWith('..') || isAbsolute(rel) || item.includes('*') || item.includes('?')) throw new BackupError('configuration_incomplete', 'External Pi resource requires a recovery mapping');
      selected.add(rel.split('/')[0]);
    }
  }
  if (settings.packages !== undefined) {
    if (!Array.isArray(settings.packages)) throw new BackupError('configuration_incomplete', 'Unsupported Pi package declaration');
    for (const entry of settings.packages) {
      const source = typeof entry === 'string' ? entry : entry && typeof entry === 'object' ? entry.source : undefined;
      if (typeof source !== 'string' || !options.immutablePackages || !Object.hasOwn(options.immutablePackages, source) || !options.immutablePackages[source]) throw new BackupError('configuration_incomplete', 'Unmapped Pi package source');
      packages.push({ source, artifact: options.immutablePackages[source] });
    }
  }
  for (const name of names) {
    if (name === 'auth.json'&&!options.includeAuthentication || name === '.pi-coffee-backup-source') continue;
    if (!regular.has(name) && !resources.has(name) && !selected.has(name)) throw new BackupError('configuration_incomplete', 'Unknown mutable Pi configuration source');
    selected.add(name);
  }
  const sources: ConfigurationSource[] = [];
  const identity = new Map<string,string>();
  const inspect = async (path: string): Promise<string> => {
    const info = await lstat(path);
    if (info.isSymbolicLink() || await realpath(path) !== path) throw new BackupError('unsafe_source', 'Unsafe Pi resource path');
    return JSON.stringify([info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs]);
  };
  for (const name of [...selected].sort()) {
    const path = join(root, name), info = await lstat(path);
    if (!info.isFile() && !info.isDirectory()) throw new BackupError('unsafe_source', 'Unsupported Pi configuration object');
    identity.set(path, await inspect(path));
    sources.push({ id: 'pi-config-' + createHash('sha256').update(name).digest('hex').slice(0,24), recoveryKey: 'native-config/file/' + name, role: 'native', path });
  }
  const rootIdentity = JSON.stringify([rootInfo.dev, rootInfo.ino]);
  return {
    sources,
    policy: { schemaVersion: 1, reauthenticationRequired: true, authenticationRestored: false, immutablePackages: packages },
    validate: async () => {
      const current = await lstat(root);
      if (JSON.stringify([current.dev, current.ino]) !== rootIdentity || await realpath(root) !== root) throw new BackupError('capture_revoked', 'Pi configuration root changed');
      const currentNames = (await readdir(root)).filter(name => !['.pi-coffee-backup-source',...options.includeAuthentication?[]:['auth.json']].includes(name)).sort();
      if (JSON.stringify(currentNames) !== JSON.stringify(names.filter(name => !['.pi-coffee-backup-source',...options.includeAuthentication?[]:['auth.json']].includes(name)).sort())) throw new BackupError('capture_revoked', 'Pi configuration graph changed');
      for (const [path, before] of identity) if (await inspect(path) !== before) throw new BackupError('capture_revoked', 'Pi configuration changed');
    },
  };
}
