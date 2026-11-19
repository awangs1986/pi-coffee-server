export const PLUGIN_REPOSITORIES = {
  'pi-coffee-harness': 'awangs1986/pi-coffee',
  'pi-coffee-lsp': 'awangs1986/pi-coffee',
  'context-handoff': 'awangs1986/pi-coffee',
  'pi-coffee-mishu': 'awangs/pi-coffee-mishu',
} as const;

export type CoffeePluginName = keyof typeof PLUGIN_REPOSITORIES;
type Selection = 'selected' | 'disabled' | 'conditional' | 'missing' | 'override';
export interface PluginRelease {
  name: CoffeePluginName;
  state: Selection;
  installedVersion?: string;
  effectiveVersion?: string;
  artifactVersion?: string;
  integrity?: string;
  source?: { repository: string; tag: string; commit: string };
}
export const pluginVersion = (value: unknown) => typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(value)
  && value.length <= 64 ? value : undefined;
export const pluginIntegrity = (value: unknown) => typeof value === 'string' && /^sha512-[a-zA-Z0-9+/]{86}==$/.test(value) ? value : undefined;

/** The Web accepts only the small release identity schema, never arbitrary Host fields. */
export function publicPluginReleases(value: unknown): PluginRelease[] | undefined {
  if (!Array.isArray(value)) return;
  const result: PluginRelease[] = [];
  const seen = new Set<string>();
  for (const row of value.slice(0,8)) {
    if (!row || typeof row.name !== 'string' || !Object.hasOwn(PLUGIN_REPOSITORIES,row.name) || seen.has(row.name)) continue;
    if (!['selected','disabled','conditional','missing','override'].includes(row.state)) continue;
    const name = row.name as CoffeePluginName;
    const item: PluginRelease = { name, state: row.state };
    for (const field of ['installedVersion','effectiveVersion','artifactVersion'] as const) {
      const version = pluginVersion(row[field]);
      if (version) item[field] = version;
    }
    const integrity = pluginIntegrity(row.integrity);
    if (integrity) item.integrity=integrity;
    const source = row.source;
    if (integrity && source?.repository === PLUGIN_REPOSITORIES[name]
        && typeof source.tag === 'string' && /^candidates\/pi-[0-9.]+-[a-f0-9]{7,8}$/.test(source.tag)
        && typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit)
        && source.commit.startsWith(source.tag.split('-').at(-1))) {
      item.source = { repository:source.repository, tag:source.tag, commit:source.commit };
    }
    result.push(item);
    seen.add(name);
  }
  return result;
}
