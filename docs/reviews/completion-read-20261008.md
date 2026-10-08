# Viewed completion reminder — 2026-10-08

Issue: [Server #100](https://github.com/awangs1986/pi-coffee-server/issues/100).
Baseline: `040efb831092eb0079a0a12480d1bd72225b7d4a`, identical GitHub/Gitea main.
Contract: [viewed completion acknowledgement](../spec/arena-navigation.md#viewed-completion-acknowledgement--2026-10-08-server-100).

## Diagnosis and resulting behavior

The actual Browser sidebar recreated coffee whenever `runStatus` was settled,
even after unread attention cleared. This followed the old #79 contract, which
#100 supersedes. The first real Chromium regression failed twice with
`Reading the latest completed reply must clear the coffee indicator` (`1 !== 0`).

Native completion stays durable and independent of reading. Each settled run has
a stable identity; viewing its actual latest reply acknowledges that identity in
bounded, account-scoped Browser metadata. Refresh does not restore an already-read
reminder. A later completion can display coffee again. Other browser profiles have
independent read state. Native history proof travels with its stable history-read
boundary; replay and rendering fences prevent older content consuming newer runs.

## Verification

`npm run check` passed on the final implementation: 908 tests in 116 files, build,
ESLint and five real Chromium HTTP/WS probes. The completion probe covers grouped
and ungrouped views, hidden tabs, stale history, read persistence after reload,
a subsequent completion, untouched/interrupted rows and running cats.

Public controller and Host WS regressions cover indexed freshness and actual
rendered revisions, old scroll positions, final-reply content paging, live Pi and
Codex rendering, native history completion during loading, completion during export,
and partial replay of two runs. Filesystem failure injection verifies reset rollback
preserves completion identity. Independent Browser receipt writes preserve both
accounts and interleaved tabs. These regressions were observed failing before their
respective fixes, then passing. Synthetic transports and native fixtures make no
external model calls and contain no user transcripts or credentials.

## Review

Standards, Spec and Security reviews were independent. Findings concerning reset
rollback, stale history proof, competing tabs, content paging, successful native
rereads, delayed export replay and partial replay were fixed and covered by
regressions. Final reviewers reported no remaining findings. No dependencies,
HTTP actions or execution permission changes were introduced.

## Release boundary

This is a source candidate. Publishing its branch and PR does not activate it.
Production Web/Host services were not restarted or changed for this repair. Pending
repository-free Codex Chat and MISHU candidates remain separate and intact. A fresh
public clone must pass the canonical check before this candidate is reported ready.
