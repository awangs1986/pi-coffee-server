import { createRequire } from "node:module";
import { dirname, delimiter } from "node:path";

const require = createRequire(import.meta.url);
const disabled=(value:string|undefined)=>["off","false","0","no"].includes(value?.trim().toLowerCase() ?? "");

/** Package roots, not private extension files: Pi discovers extensions, Skills and prompts. */
export function resolveHostPiExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit=env.PI_COFFEE_EXTENSIONS?.trim();
  if(explicit)return disabled(explicit)?[]:[...new Set(explicit.split(delimiter).map(p=>p.trim()).filter(Boolean))];
  const packages:string[]=[];
  if(!disabled(env.PI_COFFEE_SUBAGENTS))packages.push(dirname(require.resolve('pi-subagents')));
  if(!disabled(env.PI_COFFEE_WEB) && !disabled(env.PI_COFFEE_WEB_ACCESS))packages.push(dirname(require.resolve('pi-web-access/package.json')));
  packages.push(dirname(require.resolve('pi-coffee-harness/package.json')));
  if(!disabled(env.PI_COFFEE_LSP))packages.push(dirname(require.resolve('pi-coffee-lsp/package.json')));
  if(!disabled(env.PI_COFFEE_HANDOFF) && !disabled(env.PI_COFFEE_CONTEXT_FOLD))packages.push(dirname(require.resolve('context-handoff/package.json')));
  return packages;
}
