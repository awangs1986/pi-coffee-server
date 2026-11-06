# Codex Handoff Fork preparation diagnosis

Baseline: deployed GitHub/Gitea main `13e4636ea2b5874a1a65a01077ef3d20f5510955` / 0.83. Scope: Server #39, owned game-client Handoff Fork. The prior 32 MiB patch-budget repair is active; this failure happened after copying, during summary preparation.

Production metadata only: summary preparation used astra/medium and reached its 180-second deadline without an assistant summary completion. The retained rollout recorded interruption at the deadline. Recorded token usage is inherited/cumulative evidence and is not proof of billing for this failed preparation. No other account data, credentials or transcripts are included.

Ranked explanations: source-model preparation selection and fixed deadline; lost completion event; upstream non-response. The observed rollout supports actual unfinished preparation, not a completed answer lost solely by the browser. The HTTP regression exposed the accepted-default mismatch: expected sol/medium but saw the source model/high in both preparation requests. No live provider speed claim is made.

Candidate fix: apply the previously accepted sol/medium default only to temporary Codex Handoff Fork summary/seed turns, restore final Conversation settings, identify the failed phase/model in errors. Preserve the timeout, allowlist, tool restrictions, lifecycle locks and no-automatic-retry policy. Pi, Claude, traditional Fork and manual compression behavior are not changed. A future decision to extend timeouts or add recovery is separate.

Validation: red/green HTTP/native fixture test, phase-specific rejection/source-preservation assertions, targeted Fork suites. Executed `npm run check`: 1,703 tests passed, 136 optional tests skipped, and 17 Chromium probes passed. This is a local candidate check, not a published-source fresh-clone release receipt. No real provider call, new production Fork, service restart, publication or deployment is part of this diagnosis.

Serial review: source ownership and current per-user routing are unchanged; model allowlist enforcement remains in CodexSession.setModel; errors use browser textContent. No new dependencies or secrets. Original source settings and history remain the acceptance contract. Prior local spec freshness edits are included, while their original checkout remains untouched.
