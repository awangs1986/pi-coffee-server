import { createRequire } from 'node:module';
import { realpath, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PLUGIN_REPOSITORIES, pluginIntegrity, pluginVersion, type CoffeePluginName, type PluginRelease } from '../shared/plugin-release.js';

const require = createRequire(import.meta.url);
const PI_TAG = 'candidates/pi-1.4.0-dcbcc743';
const PI160_TAG = 'candidates/pi-1.6.0-3d61b424';
const MISHU_TAG = 'candidates/pi-1.6.0-1cc31cbe';
const PI_COMMIT = 'dcbcc74367a53fd0355e3b2befdf7a0752beee88';
const PI160_COMMIT = '3d61b424a98e56643a21e109b9ed9f8a768b7d03';
const MISHU_COMMIT = '1cc31cbeec1fda4c61bb86ef422f5fb15b359678';
/** Qualified release tag and digest pairs. An unrecorded artifact is shown without a source claim. */
const qualified = {
  'pi-coffee-harness': { tag:PI160_TAG, commit:PI160_COMMIT, version:'0.3.5', integrity:'sha512-DHcNgkLYvOFURKsFFpbXWsV0OJIoAfm1OB0FGAlz9PqgW48Gy2aZ+AmtZ4PjoSoqAtz5lyveNm1ZEQy01o9hDg==' },
  'pi-coffee-lsp': { tag:PI_TAG, commit:PI_COMMIT, version:'0.4.8', integrity:'sha512-BGEMamwEgmYNOSwHp9ZLGqs5/A1RRh/aH7e4/1ls/45v7QP2vZqe962b+2Ltmhd8mrVEG5PgzDX1U3RxpVAtQw==' },
  'context-handoff': { tag:PI160_TAG, commit:PI160_COMMIT, version:'0.2.0-experimental.8', integrity:'sha512-wrf1vR4itFiVMIAD2PtUKOTBx2QRK6fJULd3F02gsoszs3YQydNXHeWIAQSbP9hnrCz2a7eh1OZm1wTlGUq61A==' },
  'pi-coffee-mishu': { tag:MISHU_TAG, commit:MISHU_COMMIT, version:'0.4.0-experience.3', integrity:'sha512-RhxZXNjHqOpKyW/LFNLEu0EinSGdEXOZASBVLTcjI1mNptH/diSPsNw65jCj1S+/1KDQt8aAMTU1tg2xkjlUvw==' },
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
