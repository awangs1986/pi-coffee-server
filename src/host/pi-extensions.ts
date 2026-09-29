import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { resolvePiExtensions } from "pi-coffee";
import { resolveHandoffExtension } from "context-handoff/protocol";

const require = createRequire(import.meta.url);

/** Compose pinned Pi plugins without copying their implementation into Host. */
export function resolveHostPiExtensions(env: NodeJS.ProcessEnv = process.env): string[] {
  const defaults=resolvePiExtensions({});
  const withoutContext=new Set(resolvePiExtensions({PI_COFFEE_CONTEXT_FOLD:"off"}));
  const oldContext=defaults.find(path=>!withoutContext.has(path));
  // Compatibility identification for the immutable aggregate revision, which has no named Harness export.
  const oldHarness=defaults.find(path=>path.endsWith("/harness/extension.js"));
  if(!oldHarness)throw new Error("Pinned Pi aggregate no longer exposes the expected Harness entry; review integration before upgrading");
  const harness=fileURLToPath(import.meta.resolve("pi-coffee-harness"));
  const handoffOff=["off","false","0","no"].includes(env.PI_COFFEE_HANDOFF?.toLowerCase() ?? "");
  const extensions=resolvePiExtensions(env).flatMap(path=> {
    if(path===oldContext)return handoffOff ? [] : [resolveHandoffExtension()];
    return [path===oldHarness ? harness : path];
  });
  // Explicit replacement lists retain their meaning, including the "off" switch.
  if (!env.PI_COFFEE_EXTENSIONS?.trim() && !["off","false","0","no"].includes(env.PI_COFFEE_LSP?.toLowerCase() ?? "")) {
    const manifestPath=require.resolve("pi-coffee-lsp/package.json");
    const manifest=require(manifestPath);
    extensions.push(...manifest.pi.extensions.map((entry:string)=>resolve(dirname(manifestPath),entry)));
  }
  return [...new Set(extensions)];
}
