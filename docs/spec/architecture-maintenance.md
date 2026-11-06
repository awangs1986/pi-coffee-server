# P0/P1 framework maintenance

Status: implemented source candidate for Server 0.97, 2026-11-06.
Baseline: deployed 0.96 `a6ad4d1`; GitHub/Gitea main was 0.95 `aa4439e` at review.
Tracking: [release #81](https://github.com/awangs1986/pi-coffee-server/issues/81),
[lifecycle #161](https://github.com/awangs1986/pi-coffee-server/issues/161),
[Takeover policy #162](https://github.com/awangs1986/pi-coffee-server/issues/162).

## Accepted scope

The owner wants accumulated features to remain consistent with the original
framework, not a general redesign. Inspect and change only Coffee-owned code,
not upstream Pi internals. Preserve the same-VM topology, Web authentication and
forwarding, Host execution/data ownership, native engine behavior, independent
task directories, and existing layout. Keep Pi-only packages and optional plugins
independent. Deliver focused slices and select verification by risk.

P0 closes release identity and progress gaps. P1 concentrates selected Conversation
state and Task lifecycle rules and reconciles stale specifications. Backup-mode
simplification and completion-speech sequencing are P2 and remain out of scope.

## P0: observable release facts

- Each admitted verification attempt records its own source, run ID, process identity,
  timestamps, active step and completed steps before executing commands. Preserve
  the previous receipt separately; it cannot stand in for the new attempt.
  Reuse, publication and staging require the exact verified commit, even when
  another commit contains identical source bytes.
- Normal failures record `failed`; handled interruption records `interrupted`.
  `verify --status` observes the recorded process identity and reports an abandoned
  `running` attempt as interrupted; missing evidence remains unknown. It never
  resumes commands automatically.
- `release-audit` observes source/main refs, actual running Web/Host process manifests,
  frontend identity and verification status independently. Unknown, different,
  dirty-source or interrupted evidence cannot be labelled aligned. Identity
  observation is not publication approval or a substitute for served-asset probes.
  Loaded systemd configuration is not evidence of a completed service restart.
- Keep current release and old release separately. A source push, healthy old
  process, staged package or old successful check is not a new activation.
- A batch reconciliation may publish multiple release commits only if every
  recorded first-parent VERSION transition obeys +0.01 or +0.10. All existing
  source/review, ancestry, selected credentials and remote-lease checks remain.

## Risk-based verification

Default is the complete repository plan. Changes to runtime code, browser logic,
authorization, dependencies, scripts, data handling or unknown paths require it.
The low-risk plan is explicit, requires a clean committed tree and an ancestor
base, and admits only documentation, top-level public CSS and version-only package
metadata. It always lints, builds and checks the documentation contract. CSS also
runs the no-model Chromium probes. Dependency or executable changes in package
metadata are rejected. Publication requires that low-risk base to equal the exact
expected remote main; staging revalidates the selected plan and changed paths.

Urgent operator-authorized activation remains a separate exception and must
record unfinished checks. It never creates a successful canonical receipt.
This P1 change touches lifecycle execution and therefore uses the complete plan.
Tests exercise our integration contract; upstream Pi's internal test suite is not
part of this work. No real model turns or production conversation fan-out is used.

## P1: selected Conversation ownership

One `applyConversationSelection` transaction handles existing and new selections:
validate the target, preserve the current draft/scroll, detach execution transport,
invalidate old callbacks, reset settings/transfers, select the next view and restore
only that Conversation's cache/draft. Reconnect uses the same execution-detachment
path. Native execution, display synchronization, and local selection retain distinct
lifetimes. Preserve browser history, independent URLs, cached model preview,
attachment drafts and delivery uncertainty; never replay a prompt on navigation.

## P1: Task lifecycle ownership

`holdTaskLifecycle` synchronously acquires the complete task set or refuses it.
The operation owns an idempotent release closure; a later cleanup cannot release
another operation's hold. The existing scoped Set remains a read-only observation
view for HTTP/WS admission. All Coffee writers use the owned hold operation.

Fork acquires source and target protection before asynchronous source-idle checks
and durable acceptance writes. Failure before execution releases only its own
hold. Completed operations release after their execution tail; uncertain cleanup
retains protection. Restart restores uncertain operations' holds.

`requireTaskIdle` centralizes live work, queue, pending questions, background
certainty and post-await rechecking for existing mutation callers. Native-state
inspection is explicit where previously required. Archive's existing behavior,
Takeover adoption, preparation recovery and MISHU dispatch remain separate
business workflows; this does not merge them into one state machine.

## Evidence and limits

| Contract | Implementation | Public verification |
| --- | --- | --- |
| Current attempt and interruption | `scripts/verify.mjs`, `scripts/lib/process-observation.mjs` | `test/developer-verification.test.ts` |
| Runtime/source mismatch | `scripts/release-audit.mjs` | `test/release-audit.test.ts` |
| Low-risk admission and version history | `scripts/lib/verification-risk.mjs`, `scripts/publish.mjs` | `test/verification-risk.test.ts`, `test/developer-publish.test.ts` |
| Selection/draft/model isolation | `public/app.js` | `test/local-first-app.test.ts`, browser probes |
| Lifecycle hold and idle checks | `src/host/task-lifecycle.ts`, Host/Preparation/MISHU callers | `test/task-preparation-crash.test.ts`, `test/takeover.test.ts`, scoped HTTP checks |

The new Fork admission regression failed with archive HTTP 200 while durable
acceptance was paused; it expects 409 during the protected window. The verification
regression failed because a running attempt still exposed a previous passed receipt.
Both were corrected without invoking a provider. Source verification, repository
publication, live activation and real-user acceptance remain separate evidence.
