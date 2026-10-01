> Source placement update: [ADR-0021](../adr/0021-pi-only-source-authority.md). Host and Web still use one Server release. Its lockfile pins a separate Pi package commit; record that dependency identity alongside the Server release.

# Unified release procedure

1. Fetch GitHub and Gitea and read the reconciliation matrix. Build from the authoritative GitHub main commit, keeping both histories and previous release directories.
2. Run `npm ci && npm run check`. In minimal environments, ensure child login shells also have the Node binary directory in PATH.
3. Start Web with `node dist/src/main.js web` (the compatible `dist/src/web/main.js` entrypoint also accepts existing route-file deployments). Start Host with `node dist/src/main.js host`. Host and Web use the same Git revision even when installed on different machines.
4. Preserve private environment files, routes and task directories. Configure `PI_COFFEE_CODEX_COMMAND` and `PI_COFFEE_CLAUDE_COMMAND` to the installed native CLI or existing private wrapper. `PI_COFFEE_CODEX_BIN` remains compatible. Codex model/effort overrides are `PI_COFFEE_CODEX_MODEL` and `PI_COFFEE_CODEX_EFFORT`; native login remains on Host.
5. Existing dedicated Host routes remain valid. Shared routing uses `PI_COFFEE_SHARED_HOST=1` on Web and `PI_COFFEE_REQUIRE_USER=1` on Host. Route-file authentication derives stable `gitea-<id>` ownership keys and forwards them on HTTP and WS. Earlier signed-cookie deployments preserve their existing login-name keys. Do not switch identity-key formats without an explicit data migration.
6. `PI_COFFEE_SKILL_OWNER` names the authenticated owner key allowed to manage machine-wide Skills. Project Skills remain task scoped. Do not copy native login credentials to Web.
7. Web and Host support explicit project/chat/session root settings. Existing tasks are retained in place. Native terminal conversations from the configured user cwd remain discoverable; their histories do not become Gitea checkouts automatically.
8. Probe health, login, the three Work engines, Pi-only Chat, brand menu, search, Context Usage, task path expansion, branch review and native turn review. Test sidebar collapse and refresh. Use `node scripts/probe-workbench-release.mjs <Web URL> <release directory>` to compare served assets with the release.
9. Push GitHub main, then Gitea main. Verify identical SHAs after fetching both. Install a release directory named by that SHA and record service paths plus the asset probe in the Issue. Retain the previous release and data for rollback.

Signed-cookie authentication requires a new login after Web restart, even with a configured signing secret. This keeps logout revocation effective across restarts; task execution and native sessions continue on Host. Route-file authentication retains its existing session-store behavior.

A successful native model response alone is insufficient release evidence.

## Pi model selection policy

`PI_COFFEE_PI_ALLOWED_MODELS` optionally limits Host-managed Pi sessions to a
comma-separated list of exact `provider/model-id` values. Missing configuration
preserves native discovery; an explicitly empty or malformed list fails startup.
The Pi adapter filters discovery and rejects other `set_model` values. It handles
`/model provider/model-id` locally, without a model turn, using the same policy.
Model commands cannot be queued into an active turn. A resumed session whose
current model is no longer approved must select an allowed model before sending;
the adapter does not silently run it with a different model. Codex and Claude Code
are unaffected. Existing native credentials remain in the VM.

The owner's deployment policy from [Server #22](http://gitea:3000/awangs/pi-coffee-server/issues/22):

```ini
PI_COFFEE_PI_ALLOWED_MODELS=openrouter/meta/muse-spark-1.3-contributor,antigravity/gemini-3.8-flash
PI_COFFEE_PROVIDER=openrouter
PI_COFFEE_MODEL=meta/muse-spark-1.3-contributor
```

Only approved models available in the native registry are offered. Missing native
registration/authentication is not replaced with a fabricated model definition.
This governs Host-managed model selection, not standalone CLI installations or
arbitrary programs launched in the owner's unrestricted VM.

## Temporary storage and live-task rollout

Host allocates temporary storage on disk under `~/.cache/pi-coffee/runtime-tmp`;
`PI_COFFEE_TMP_ROOT` can select another private disk-backed directory. Native
children inherit TMPDIR/TMP/TEMP. Do not point this root at tmpfs, task workspaces,
or native account stores. Graceful shutdown removes only the current Host's run
directory after native shutdown. Retain crash remnants until confirmed unused.
The check runner owns and removes its separate temporary run directory even when
tests fail. Explicit `/tmp` paths in user commands bypass these environment settings.

Before replacing a Host, query all routed user scopes for active turns and queued
input. A conversation delivering the deployment itself also counts as active.
Stage the new Host while it is busy; never kill all `codex app-server` processes
by name. Browser asset improvements may be rolled out compatibly while Host
activation is pending; record this as a partial rollout, with both release IDs.

Graceful Host stop now drains accepted HTTP workspace operations even when their
browser/gateway connection has disappeared. Allow sufficient service stop time
for the configured remote Git operation timeouts (the current deployment uses
`TimeoutStopSec=300`). Check both active turns/queues and workspace operation
markers during rollout. If a prior release exited before cleaning up a marker,
stop ingress and the owning Host, inspect the task's Git status and live Git
processes, and preserve an audited copy of the stale marker before clearing it.
Do not clear a marker that still belongs to a live operation.
