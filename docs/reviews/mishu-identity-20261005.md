# MISHU identity repair — 2026-10-05

Tracking: [Server #59](https://github.com/awangs1986/pi-coffee-server/issues/59).

Selected-but-disabled Chat received no plugin role context. Enabled guidance was
added to systemPrompt, which zero-system Chat removes. The real native Pi/Harness
provider test reproduced the missing identity in both extension load orders.

The independent plugin now appends one bounded transient native custom message
with the selected MISHU application role and freshly checked permission state.
It replaces stale custom identity, remains out of durable history, and leaves
ordinary unselected Chat untouched. Coordination remains explicitly off until
user setup; unknown status removes tools. No user task history or settings were
changed during this diagnosis.

Independent source: `cd9d47e60654529d02097b47e5d7c49c640a0803`.
Immutable package: `pi-coffee-mishu@0.1.2` from Gitea `v0.1.2`.
SHA-256: `7bc278a481ec56be1391fe34ca708ecd154f21f35e0da25e39d9ccd66fa7920e`.
A fresh Gitea clone passed all 118 package tests; its npm pack matched the
original artifact exactly. Server consumes the package without changing Harness
or native Agent implementations; current main's Chat, sidebar and dialog fixes
are retained.

## Acceptance

- Native Pi/Harness actual HTTP payloads: both load orders, selected-disabled
  identity, explicit setup, tool execution, disable, unavailable Host, deselection,
  one identity per request, and no identity persisted in native history.
- Installed Server package at public HTTP/WS: identity before/after setup,
  disable and context reset, zero system/developer messages, selected status
  retained without restoring authorization.
- Isolated real Muse model: application role identified as MISHU, coordination off
  before setup, information-only after setup, off after disable. The underlying
  model name stays truthful. Synthetic prompts only, no cross-conversation sends.
  An upstream model_not_found occurred during intermediate runs; final strict
  three-stage run passed, with at most one retry of the read-only identity request.
- Chromium Web/Host/native Pi: menu selection, setup dialogs, Grok fixture message
  and receipt, refresh persistence, deselection and wrong-Origin rejection passed.
- Security review: no findings; artifact and lock integrity match, no new
  dependencies/install hooks, dependency audit zero vulnerabilities.

Local private evidence: `.scratch/identity-server-red.log`,
`.scratch/identity-server-green.log`, `.scratch/mishu-012-fresh-check.log`,
`/home/awang/tmp/verify-mishu-identity-aKbeU7/evidence.json`, and
`/home/awang/tmp/verify-mishu-mXxEMX/` (synthetic browser screenshots).
Final Server/fresh-clone checks and production activation are recorded in the
Issue. Publication alone does not establish activation. Production rollout must
wait for all scopes' active, queued and waiting-answer tasks, including the
initiating conversation, and preserve workspace operations and previous releases.
