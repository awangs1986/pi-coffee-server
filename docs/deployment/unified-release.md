> Source placement update: [ADR-0021](../adr/0021-pi-only-source-authority.md). Host and Web still use one Server release. Its lockfile pins a separate Pi package commit; record that dependency identity alongside the Server release.

# Unified release procedure

For checked staging and compatible Browser-only activation, use [the repository-owned tools](../development/verification-and-release.md). CLI status and `/api/release` distinguish source, frontend and backend identities; staging never restarts Host/Web.

Before publishing an update, apply the [formal version policy](versioning.md)
and keep the version bump with its source changes. Record each actually deployed
Browser/Web/Host version and SHA, including partial rollout.

1. Fetch GitHub and Gitea and read the reconciliation matrix. Build from the authoritative GitHub main commit, keeping both histories and previous release directories.
2. Run `npm ci && npm run check`. In minimal environments, ensure child login shells also have the Node binary directory in PATH.
3. Start Web with `node dist/src/main.js web` (the compatible `dist/src/web/main.js` entrypoint also accepts existing route-file deployments). Start Host with `node dist/src/main.js host`. Host and Web use the same Git revision even when installed on different machines.
4. Preserve private environment files, routes and task directories. Configure `PI_COFFEE_CODEX_COMMAND` and `PI_COFFEE_CLAUDE_COMMAND` to the installed native CLI or existing private wrapper. `PI_COFFEE_CODEX_BIN` remains compatible. Codex model/effort overrides are `PI_COFFEE_CODEX_MODEL` and `PI_COFFEE_CODEX_EFFORT`; native login remains on Host.
5. Existing dedicated Host routes remain valid. Shared routing uses `PI_COFFEE_SHARED_HOST=1` on Web and `PI_COFFEE_REQUIRE_USER=1` on Host. Route-file authentication derives stable `gitea-<id>` ownership keys and forwards them on HTTP and WS. Earlier signed-cookie deployments preserve their existing login-name keys. Do not switch identity-key formats without an explicit data migration.
6. `PI_COFFEE_SKILL_OWNER` names the authenticated owner key allowed to manage machine-wide Skills. Project Skills remain task scoped. Do not copy native login credentials to Web.
7. Web and Host support explicit project/chat/session root settings. Existing tasks are retained in place. Native terminal conversations from the configured user cwd remain discoverable; their histories do not become Gitea checkouts automatically.
8. After starting or restarting Host, wait for its `/healthz` response before WebSocket checks or reopening ingress. `systemctl is-active` confirms process state, not listener readiness. Probe health, login, the three Work engines, Pi-only Chat, brand menu, search, Context Usage, task path expansion, branch review and native turn review. Test sidebar collapse and refresh. Use `node scripts/probe-workbench-release.mjs <Web URL> <release directory>` to compare served assets with the release.
9. Push GitHub main, then Gitea main. Verify identical SHAs after fetching both. Install a release directory named by that SHA and record service paths plus the asset probe in the Issue. Retain the previous release and data for rollback.

Signed-cookie authentication requires a new login after Web restart, even with a configured signing secret. This keeps logout revocation effective across restarts; task execution and native sessions continue on Host. Route-file authentication retains its existing session-store behavior.

A successful native model response alone is insufficient release evidence.

## Emergency startup

Web and Relay do not load Pi plugins. Host resolves its configured Pi packages
only in the Host role. Missing/unloadable package resources put Pi into a
process-local emergency mode instead of preventing the Web/Host from starting.
An explicit `PI_COFFEE_EMERGENCY=1` selects the same mode for operator recovery.

Emergency mode disables optional Pi extensions (Harness, LSP, handoff, web and
subagents). Native Pi tools, native history, Skills, Host environment guidance,
model allowlists, native authentication and scoped Git credentials remain.
The approved Antigravity provider is retained when installed and enabled. If
that provider is missing or broken, the affected model stays unavailable;
the Host never silently substitutes a model. Codex/Claude retain their native
configuration and sessions; no conversation changes engine automatically.

Pi startup waits for a successful native `get_state` response. A specific native
extension-load failure permits one retry with the minimal extension set, before
any user prompt is submitted. The degraded state is shared by subsequent Pi
starts in this Host process. Existing running Pi sessions are not restarted.
Model/auth/network failures and failures after startup do not trigger this retry.
Missing core runtime libraries, invalid authentication configuration or port
conflicts still fail normally; emergency mode is not an unrestricted retry loop.

The Web displays a persistent Chinese emergency banner. Host `/healthz` reports
the mode and a bounded reason code; authenticated `/api/runtime` and
`/api/engines` expose the same status through the existing user-scoped Web route.
No paths, raw plugin exceptions or credentials are included in that status.
Health `ok` means the service is reachable, not that all plugins are available.
Repair/reinstall the pinned artifacts, remove any explicit emergency override,
then restart Host to restore normal mode. Native account files and task history
are never rewritten by this recovery path. LSP-dependent destructive cleanup
fails closed until its daemon shutdown helper can load.

Acceptance: `test/startup-emergency.test.ts` faults the built production entrypoint;
`test/pi-emergency.test.ts` faults a real Pi extension and completes exactly one
model request through Web/Host, preserving native tools and history.

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

When the allowed model list or default provider selects `antigravity`, Host
explicitly loads the pinned `pi-antigravity` package. `--no-extensions` keeps
ambient plugin copies disabled; it must not omit this approved model provider.
`PI_COFFEE_ANTIGRAVITY=off` disables this automatic provider root. An explicit
`PI_COFFEE_EXTENSIONS` list still replaces all defaults and must name any required
provider package; `off` disables it too. Host children default
`ANTIGRAVITY_NO_EXTRA_TOOLS=1`, using this package for model/auth registration.
Native credentials stay in the Pi agent directory. Muse remains the default.

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

## Watchdog-aware maintenance

When the [local watchdog](watchdog.md) is installed, run
`pi-coffee-watchdog pause --seconds 900` on each affected machine before stopping
its application unit (sudo for the system Web monitor). After the health/version
and served-asset probes pass, run `pi-coffee-watchdog resume`. A pause does not
clear a circuit breaker or native start limit. Keep the watchdog in its own
systemd unit so a Host restart cannot terminate the recovery/verification runner.

## Pi 1.0.1 security patch (2026-10-04, Server #44)

The Server pins the four direct upstream Pi packages to 1.0.1. The official
coding-agent patch replaces vulnerable brace-expansion 5.0.9 with 5.0.12 and no
longer ships the shrinkwrap that prevented a root override from taking effect.
No native source or installed package files are patched. The independent Harness,
LSP and Handoff artifacts remain unchanged, as do model policy and credentials.

Verify the installed dependency tree, not only `npm audit`: an edited root lock
can make the audit appear clean while an upstream shrinkwrap still installs the
older dependency. Fresh `npm ci`, native Pi/subagent integration and the complete
Server check remain release gates. Source pins do not prove production activation;
record the actual deployed Pi version and served assets in the Issue.
