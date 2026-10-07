# Pi model recovery — 2026-10-07

Tracking: [Server #92](https://github.com/awangs1986/pi-coffee-server/issues/92).
Baseline: GitHub/Gitea main `79637cc8e00549c305c08363088bbf68786c5e7e`.

## Diagnosis

Read-only native metadata confirms that a completed Gemini conversation later
acquired a Meta model-change entry and actually started a Meta response. This is
an execution-model change, not just stale Browser display. The production Host
retained the same PID and zero automatic restarts during this investigation.
There is no Browser trace proving why the reported page refresh occurred.

An isolated synthetic session reproduces the model change with the deployed Pi
1.0.2 CLI and Antigravity 0.9.0 package. The saved session contains a completed
Gemini exchange and high thinking. The deployed adapter reopens it with explicit
Host defaults and returns `openrouter/meta/muse-spark-1.3-contributor`. Removing
only those defaults returns `antigravity/gemini-3.8-flash`, retaining high thinking.
No Browser, real credential, user transcript, provider request or running task is
needed for this reproduction.

The Host can retire an idle native child independently of its own process. On
reopening, the adapter passed global provider/model options as CLI overrides even
when it found an existing native session file. Pi honors those explicit overrides
over its saved native choice. Empty reset bindings had special restoration, but
populated bindings and ordinary conversations were exposed to this defect.

## Change

Global provider/model defaults now apply only when no native session file exists.
Existing conversations omit those overrides and use native Pi restoration. The
established empty-binding model/thinking restoration remains unchanged. No extra
ordinary-session synchronous history scan, browser cache mutation, dependency
upgrade, authentication change, context injection or prompt replay is introduced.

## Verification and limits

- Before the fix, authenticated Host WS tests returned `default` instead of saved
  `selected` for ordinary and populated reset sessions. The existing empty-reset
  path already passed; it remains protected.
- After the fix, three cases use the real pinned Pi CLI to recover model/thinking
  across Host recreation. Opening sends no provider request. The next explicit
  continuation reaches `selected` in a loopback provider fixture, and independent
  new Chat conversations retain the configured Host default.
- Six targeted files / 23 tests pass, covering model policy, reset, fork/Handoff,
  adapter behavior and the Antigravity provider integration.
- The fixed adapter with the actual deployed CLI and Antigravity package reopens
  synthetic Gemini history as Gemini/high while conflicting Host Meta defaults
  remain configured. This metadata probe creates no paid model turn.
- `npm run check` passes: lint, production build, 112 files / 882 tests and all four
  Chromium probes. No timeouts were extended or checks skipped.

The loopback turn verifies native execution selection, not live Gemini provider
availability. Original task data and model settings were not modified. Production
Web/Host remain on `5073c97`; source publication does not activate this correction.
Host activation requires an approved maintenance window for running tasks.
