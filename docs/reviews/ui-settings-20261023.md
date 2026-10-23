# UI candidate code review — 2026-10-23

Baseline: `58d4f55cae6a352f50d0babcf9e32403579f09af` (GitHub/Gitea main).
Initial command: `git diff 58d4f55...HEAD`.
Initial commits: `ab67a5c` (owner artwork), `9db172a` (four UI requests).
Review fixes are included in the subsequent commit carrying this report.

The primary reviewer performed the axes serially, per the repository's explicit
batch-Agent policy. No review subagents or live provider turns were started.
Sources: AGENTS.md, REPOSITORIES.md, docs/agents/sidebar.md, the current navigation,
local-first synchronization and MISHU contracts, and release/versioning guidance.
The code-review smell baseline was considered as judgement, not hard violations.

## Standards

No actionable documented-standard violation or baseline-smell finding remains.
The review preserves Server/Host boundaries, scoped browser selection fences,
independent Pi packages, the user's artwork and the unpublished 0.53 release number.
Fixtures exercise public controller/HTTP/browser boundaries rather than only
private implementation helpers. Publication and activation remain separate.

## Spec

Five reproduced findings, all corrected:

1. Confirm could write the entire opening snapshot over later native metadata,
   even when the user edited only Display. This contradicts “Confirm saves the
   chosen values.” Track edited fields; keep unedited state authoritative.
2. Choosing a Pi model synthesized `speed=standard`, then emitted `set_speed` to
   Pi. This violates the Codex-only Speed contract. Normalize/apply speed only
   for Codex and only when edited or required by an explicit model change.
3. After the confirmation deadline, abandoned model/context pending flags could
   keep sending disabled and reject subsequent metadata. This violates the
   bounded failure/recovery contract. Clear abandoned state and reread without
   mutation replay; preserve the draft. Explicit rejection stops immediately.
4. Selecting takeover after editing another setting silently discarded those
   edits. This contradicts “Confirm saves the chosen values” and the separate
   takeover confirmation. Require saving/cancelling the existing draft first,
   preserving it, and keep other fields disabled during takeover selection.

5. Opening the new-task menu before its initial catalog arrived left its model
   row permanently disabled until reopening, despite successful discovery. This
   violates the new-task model selection contract. Refresh untouched draft fields
   on catalog arrival while preserving explicit edits and engine-request fencing.

Controller regressions first reproduced all five defects. Fixes are covered in
`test/local-first-app.test.ts` and `test/native-agents.test.ts`.

## Security

No block, fix-before-ship or note findings. No unanswered security question.

Checked clean: no added secrets; GIFs use the existing flat, extension-allowlisted
public asset resolver, with no arbitrary paths or task-file exposure. Menu labels
use text nodes; inserted SVG geometry is code-owned. Settings remain on existing
authenticated/scoped RPC paths. No data query, authorization or tenant boundary
was loosened. Manifest/lockfile changes are root release metadata only; dependency
versions, URLs and install scripts are unchanged.

## Verification and publication boundary

Validation completed: the broad `npm run check` passed 165 test files / 1,278
cases and all 16 configured Browser probes. After the late initial-catalog fix,
the latest two affected controller suites passed all 224 cases (including the
additional catalog regression), and final lint passed. The five new regressions
were each observed failing before their fixes. The earlier 1,274-case evidence
in navigation-settings-20261023.md applies to the pre-review candidate.

Private logs: review-red.log, review-takeover-red.log, review-catalog-red.log,
review-final-controllers.log, review-final-check.log and review-final-lint.log.
This local review does not assert remote publication, production activation or
fresh-clone release verification. No service restart is part of this request.
