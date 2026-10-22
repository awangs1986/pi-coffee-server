# Codex manual Handoff candidate — 2026-10-22

Baseline: GitHub/Gitea main `ef76d15856f6ef7543379428a96c87efd4728211`.
Candidate Server version: 0.49. Codex Handoff protocol: 0.1.0.
Contract: [manual Handoff](../spec/manual-handoff.md#codex-manual-handoff-accepted-2026-10-22).

## Scope

The existing lower-right task-details button explicitly confirms and requests
Codex Handoff. One tool-free native Fork generates a summary; after that child
closes, one fresh native thread accepts the summary. Only verified preparation
can replace the active binding. No automatic scheduling, bulk starts, native
account changes, CLI upgrades or service restarts are part of this candidate.

The original Conversation, cwd, task files and visible history remain. Model,
effort, speed, context preset, Plan mode and title survive. Native Goal metadata
is task intent in the summary; autonomous Goal execution is not inherited.
Ordinary Codex `/compact` and automatic compaction keep their native semantics.

## Acceptance evidence

- Initial public Host WS regression failed because the requested Handoff did not
  replace the native binding; the former adapter only performed native compaction.
- Native-adapter/Host tests use a synthetic App Server with enforced preparation
  restrictions. The Handoff tests cover Chat and Work, settings/history retention,
  generation failure and original-task continuation, missing confirmation, native
  compaction separation, duplicate/settings rejection, reconnect, Stop, Chat reset
  after Handoff, and Host shutdown draining preparation without commit/replay.
- The complete `npm run check` passed: 165 test files / 1260 tests, production
  build, JS lint, and all Chromium probes. After the final shutdown-tail repair,
  the Handoff and Host server suites passed 75 tests; final TypeScript validation
  and whitespace checks also passed.
- Chromium drove the real lower-right menu button and confirmed cancellation,
  stale-selection fencing, explicit `mode: handoff` with drift acceptance, native
  slash-compaction separation and the Stop control. Browser page errors: none.
- Security review followed authenticated socket scope through task binding and
  private evidence storage. No new arbitrary RPC/path/native-ID input, transcript
  download route, dependency, or credential material was introduced. Preparation
  uses the established disabled-tool/MCP and read-only/no-network policy.
- Original history prefixes remain disk-backed recovery evidence rather than a
  permanently retained complete-history array in the new live adapter.

Verification here uses synthetic native sessions, not the user's model account.
It establishes orchestration and UI behavior, not provider access, summary quality,
complete recovery of facts already lost to earlier native compaction, or zero drift.
Historical test fixture mistakes (fixture executable/action/response shape) were
corrected; they are not counted as product failure evidence.

## Publication and activation boundary

This report is source-candidate evidence. It does not claim a fresh-clone release
gate, remote publication, production activation, or a successful real-provider
Handoff. Publication requires the current source-bound review/final verification
workflow. Activation requires the exact published commit, fresh-clone verification,
and explicit maintenance authorization. Original native threads/evidence are
retained for inspection on both successful and failed operations.
