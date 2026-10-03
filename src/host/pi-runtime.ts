import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolveHostPiExtensions } from './pi-extensions.js';

const require = createRequire(import.meta.url);
export interface PiRuntimeStatus {
  mode: 'normal' | 'emergency';
  reason?: 'operator_requested' | 'plugin_unavailable' | 'extension_startup_failed';
}

/** Process-local degradation: no account/config edits and no automatic prompt replay. */
export class HostPiRuntime {
  private state: PiRuntimeStatus = { mode: 'normal' };
  private roots: string[] = [];
  private lsp?: typeof import('pi-coffee-lsp');
  private constructor(private env: NodeJS.ProcessEnv) {}

  static async load(env: NodeJS.ProcessEnv = process.env): Promise<HostPiRuntime> {
    const runtime = new HostPiRuntime(env);
    if (env.PI_COFFEE_EMERGENCY === '1') runtime.degrade('operator_requested');
    else {
      try {
        runtime.roots = resolveHostPiExtensions(env);
        if (runtime.roots.some(path => !existsSync(path))) throw new Error('Missing configured extension');
        // LSP integration is optional, and is never imported by the Web role.
        if (runtime.roots.some(path => path.endsWith('/pi-coffee-lsp'))) runtime.lsp = await import('pi-coffee-lsp');
      } catch {
        runtime.degrade('plugin_unavailable');
      }
    }
    return runtime;
  }

  status = (): PiRuntimeStatus => ({ ...this.state });
  extensions = (): string[] => [...this.roots];
  skills(): string[] { return this.lsp?.resolvePiSkills() ?? []; }
  path(): string { return this.lsp?.withCoffeeLspPath().PATH ?? this.env.PATH ?? ''; }

  recoverStartup(error: unknown, startedInEmergency = this.state.mode === 'emergency'): boolean {
    // Only native extension-load diagnostics qualify. Auth/model/network failures
    // and errors after start are not retried, and no user prompt is resent.
    if (startedInEmergency || !(error instanceof Error) ||
      !/Failed to load extension|Extension load errors/.test(error.message)) return false;
    // Another concurrent catalog/session start may already have degraded the
    // shared runtime. This caller still gets its one retry on the new roots.
    if (this.state.mode !== 'emergency') this.degrade('extension_startup_failed');
    return true;
  }

  private degrade(reason: NonNullable<PiRuntimeStatus['reason']>): void {
    this.state = { mode: 'emergency', reason };
    this.lsp = undefined;
    this.roots = [];
    // Keep the approved Gemini provider when available; never silently choose
    // another model, bypass the allowlist, or modify native authentication.
    const needsProvider = this.env.PI_COFFEE_PROVIDER === 'antigravity' ||
      (this.env.PI_COFFEE_PI_ALLOWED_MODELS ?? '').split(',').some(id => id.trim().startsWith('antigravity/'));
    const disabled = (value: string | undefined) => ['off', 'false', '0', 'no'].includes(value?.trim().toLowerCase() ?? '');
    if (needsProvider && !disabled(this.env.PI_COFFEE_ANTIGRAVITY) && !disabled(this.env.PI_COFFEE_EXTENSIONS)) {
      try { this.roots.push(dirname(require.resolve('pi-antigravity/package.json'))); } catch { /* affected model remains unavailable */ }
    }
    console.warn(`[pi-coffee] Pi emergency mode: ${reason}; optional plugins disabled. Repair packages and restart Host to restore them.`);
  }
}
