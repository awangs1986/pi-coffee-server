# Pi 1.0.2 consumer upgrade

Tracking: [Server #46](https://github.com/awangs1986/pi-coffee-server/issues/46),
[Pi #9](https://github.com/awangs1986/pi-coffee/issues/9).
Plugin policy: [Pi 1.0.2 contract](https://github.com/awangs1986/pi-coffee/blob/main/docs/spec/pi-102-native-integration.md).

Use the official Pi 1.0.2 family, npm pi-subagents 0.75.0, pi-web-access 0.35.0,
pi-antigravity 0.9.0 and independent immutable Coffee artifacts: Harness 0.3.1,
LSP 0.4.6 and Handoff 0.2.0-experimental.5. npm 0.75.0 contains the upstream
Pi 1.0 child-launch fix and replaces the unreleased subagents source archive.
Keep consumer lock integrity; Pi no longer publishes an npm shrinkwrap.

Start from current Server main, preserving newer Fork, GitHub authorization,
local-first synchronization, queued input and busy-view behavior. The binding
feedback correction shows pending progress and confirms the selected project
and account after refresh. It changes no authorization, token or task binding.

Run fresh `npm ci && npm run check`. Verify public native Pi integration,
bounded official Serper retrieval, an actual matching background child and
cancellation/settlement, LSP, Handoff, reconnect history and account feedback.
Inspect exact audit/lifecycle scripts. Native real-model autonomy, all external
language servers and semantic Handoff fidelity remain separate evaluations.

Stage a separate release from mirrored main and a separate terminal runtime.
Native Pi package management registers the selected roots once, preserving
resource filters, provider/model/thinking choices and credentials. Back up
settings/search configuration as `.before-pi102` before switching. Preserve
original sessions, task folders, private route/environment files and old artifacts.
Lens stays removed; optional Antigravity uses the official compatible release.

The owner requested PR delivery and will merge and deploy. No main update, live
activation or public release is performed by this change. Merge/release the Pi
plugin PR first, then merge this consumer once its immutable release artifacts
are available. Candidate consumer verification can use the locally packed
artifacts with the same lock integrity; this does not establish that the release
URLs are already published.

During a later authorized Host upgrade, wait for active turns, queues,
background work and workspace operations to settle; this deployment conversation
counts. Pause the bounded watchdog during the planned switch, gracefully restart,
wait for `/healthz`, and verify live public command discovery and native plugin
versions. Keep a scoped automatic rollback on failed readiness. Host selection
alone does not imply Web deployment or browser acceptance: independently verify
served asset identity and account feedback after any Web rollout. See the
[release runbook](unified-release.md).

## Integration acceptance, 2026-10-04

The plugin releases are now published from mirrored Pi main `eb39338`; public
artifacts match the consumer lock. The Server candidate includes main `fce594a`
and repairs Refresh overwriting pending binding feedback. See the
[integration review](../reviews/pi-102-integration-20261004.md) and Issue #46 for
source, native/browser acceptance and the separate idle-first activation receipt.
