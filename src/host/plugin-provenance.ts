import { createRequire } from 'node:module';
import { realpath, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PLUGIN_REPOSITORIES, pluginIntegrity, pluginVersion, type CoffeePluginName, type PluginRelease } from '../shared/plugin-release.js';

const require = createRequire(import.meta.url);
const PI_TAG = 'candidates/pi-1.4.0-dcbcc743';
const MISHU_TAG = 'candidates/pi-1.4.0-08fbd13';
const PI_COMMIT = 'dcbcc74367a53fd0355e3b2befdf7a0752beee88';
const MISHU_COMMIT = '08fbd13bee42a3106555c92cd432d359b7d4cfec';
/** Qualified release tag and digest pairs. An unrecorded artifact is shown without a source claim. */
const qualified = {
  'pi-coffee-harness': { tag:PI_TAG, commit:PI_COMMIT, version:'0.3.4', integrity:'sha512-PFokh1JTe4X8uIT5/qFPSu2tZpLG3A8bDu18NjsCeckdd2l41I03YDixf4fUw3ag+/U1VOq6PpH8RWTv996G0A==' },
  'pi-coffee-lsp': { tag:PI_TAG, commit:PI_COMMIT, version:'0.4.8', integrity:'sha512-BGEMamwEgmYNOSwHp9ZLGqs5/A1RRh/aH7e4/1ls/45v7QP2vZqe962b+2Ltmhd8mrVEG5PgzDX1U3RxpVAtQw==' },
  'context-handoff': { tag:PI_TAG, commit:PI_COMMIT, version:'0.2.0-experimental.7', integrity:'sha512-/obHxjR7DDpfTJDu2aU6UDXbLgr0OBlOXJZTtTar4Ti65nS5rszm8MhsNBpro6Jzf1y0bAaqs10K0rc/tHi2AA==' },
  'pi-coffee-mishu': { tag:MISHU_TAG, commit:MISHU_COMMIT, version:'0.4.0-experience.2', integrity:'sha512-7p8XqQM/FnfgZFGS8rLGYfOvcee6epan7i8BePZK2Hki6UOujnA5pviDBADum2KJ2PCYnFQMKBJ0u124qdMjiA==' },
} satisfies Record<CoffeePluginName, { tag:string; commit:string; version:string; integrity:string }>;

type LockEntry = { version?: unknown; resolved?: unknown; integrity?: unknown };
async function readManifest(path: string) {
  try {
    const root = dirname(await realpath(path));
    const { name, version } = JSON.parse(await readFile(path,'utf8'));
    if (typeof name === 'string') return { name, version:pluginVersion(version), root };
  } catch { /* Missing or invalid package. */ }
}
function bundledManifest(name: CoffeePluginName) {
  try { return require.resolve(name+'/package.json'); } catch { return; }
}
function provenance(name: CoffeePluginName, entry: LockEntry | undefined): PluginRelease['source'] {
  const pin = qualified[name];
  if (!entry || entry.version!==pin.version || entry.integrity!==pin.integrity || typeof entry.resolved!=='string') return;
  const {tag, commit} = pin;
  const repository = PLUGIN_REPOSITORIES[name];
  const expected = '/awangs/'+repository.split('/')[1]+'/releases/download/'+tag+'/'+name+'-'+pin.version+'.tgz';
  try {
    if (decodeURIComponent(new URL(entry.resolved).pathname) === expected) return { repository, tag, commit };
  } catch { /* Unrecognized artifact identity. */ }
}

export async function readPluginProvenance({ releaseDir, selectedRoots, mishuEligible, resolvePackage = bundledManifest }: {
  releaseDir: string;
  selectedRoots: string[];
  mishuEligible: boolean;
  resolvePackage?: (name: CoffeePluginName) => string | undefined;
}): Promise<PluginRelease[]> {
  let lock: Record<string, LockEntry> = {};
  try { lock = JSON.parse(await readFile(join(releaseDir,'package-lock.json'),'utf8')).packages ?? {}; }
  catch { /* Read installed versions even in legacy checkouts without a lockfile. */ }
  const selected = await Promise.all(selectedRoots.slice(0,64).map(root=>readManifest(join(root,'package.json'))));
  const names = Object.keys(PLUGIN_REPOSITORIES) as CoffeePluginName[];
  return Promise.all(names.map(async name => {
    const packagePath = resolvePackage(name);
    const manifest = packagePath ? await readManifest(packagePath) : undefined;
    const bundled = manifest?.name===name ? manifest : undefined;
    const roots = selected.filter(item=>item?.name===name);
    const override = roots.some(item=>item?.root!==bundled?.root);
    const state = override ? 'override' : !bundled ? 'missing' : roots.length ? 'selected'
      : name==='pi-coffee-mishu' && mishuEligible ? 'conditional' : 'disabled';
    const entry = lock['node_modules/'+name];
    return {
      name, state, installedVersion:bundled?.version,
      effectiveVersion:state==='selected' || state==='conditional' ? bundled?.version
        : state==='override' && roots.length===1 ? roots[0]?.version : undefined,
      artifactVersion:pluginVersion(entry?.version), integrity:pluginIntegrity(entry?.integrity),
      source:provenance(name,entry),
    };
  }));
}
