import { fileURLToPath } from "node:url";
import { resolvePiExtensions } from "pi-coffee";
import { resolveHandoffExtension } from "context-handoff/protocol";

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
  return [...new Set(resolvePiExtensions(env).flatMap(path=> {
    if(path===oldContext)return handoffOff ? [] : [resolveHandoffExtension()];
    return [path===oldHarness ? harness : path];
  }))];
}
