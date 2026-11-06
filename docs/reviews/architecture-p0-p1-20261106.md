# P0/P1 architecture maintenance review

Source baseline: Server 0.96 `a6ad4d1`; release candidate: 0.97 on
`fix/architecture-p0-p1`. GitHub and Gitea main both named 0.95 `aa4439e` when
fetched for this review. The publication includes the retained 0.96 ancestry and
its [previous policy review](takeover-authorization-20261106.md).

The owner approved the P0/P1 scope, focused delivery slices and risk-based checks.
Serial review follows the repository's batch-execution policy; no review Agents,
real provider turns or production test Conversations were started.

## Standards and architecture

No remaining blocking findings in the scoped diff. Web authentication/forwarding,
Host task/data ownership, engine interfaces, independent task directories and the
single-VM topology remain. Pi package code and dependencies are unchanged apart
from the Server's formal version fields.

- One Browser selection transaction now invalidates settings/transfers/callbacks
  and restores only the selected draft/model/history preview. Reconnection shares
  transport detachment while execution, display and selection retain separate
  lifetimes. The existing DOM/controller tests remain the behavior contract.
- Lifecycle writers in Host, Preparation and MISHU use owned, idempotent release
  handles. The scoped Set remains the admission read view. Asynchronous Takeover
  transfers its handle to its completion tail. Uncertain preparation retains
  custody, and restart restores that custody. MISHU retains its intentional
  release before prompt/queue delivery; this is not a new dispatch design.
- Verification writes current progress before commands, observes abandoned
  attempts, and binds reuse/publication/staging to the exact commit. The release
  audit reads actual process directories rather than future systemd settings.
  It is diagnostic evidence, never an activation or publication grant.
- Low risk is a closed documentation/style allowlist. Runtime changes in this
  candidate use the complete plan. Every preserved VERSION transition still
  follows the owner's increment policy; remote leases and normal ancestry remain.

## Spec reconciliation

[The current maintenance contract](../spec/architecture-maintenance.md) maps each
behavior to implementation and public verification. Current task-preparation
implementation, 0.96 activation and Takeover policy no longer compete with stale
candidate/retired-command descriptions in the index, backlog or multi-user spec.
Historical evidence is retained with its date. Complete live Fork acceptance
remains open; source tests do not settle it. P2 backup-mode and speech sequencing
work is excluded.

## Security

No remaining findings in the five scoped categories. Changed lifecycle handlers
still resolve the authenticated `UserSlot` before workspace/native access; the
new helper receives only that scope's holds and introduces no cross-user lookup.
Account-selected Git publication, exact expected-ref checks and no global
credential fallback are retained. CLI configuration is trusted operator input,
uses argv execution, and is not a Web endpoint. Audit output excludes process
paths and credentials. No dependency, secret or browser credential was added.
Read-only Takeover authorization remains the earlier explicitly named transcript
exception, with no restored reference API.

## Reproductions and verification

- Paused Fork admission allowed source archive with HTTP 200. The public HTTP
  regression now expects and receives 409 while acceptance is pending.
- Running verification still displayed the previous pass. The CLI regression
  now observes running progress and a SIGTERM interruption, with the old receipt
  preserved separately; a vanished process reports interrupted.
- Low-risk fresh verification rejected its own conflicting plan arguments. A
  local-forge regression now runs the approved plan against the exact fresh SHA.
- A simulated systemd reload reported the configured next release while an old
  process still ran. The audit regression now reports the real process release.
- Identical source bytes at a different commit reused old verification and could
  publish with it. Public verification and isolated-forge regressions now refuse
  that identity substitution.
- Build and mechanical lint passed. The focused tooling/documentation run passed
  36 tests across seven files. Lifecycle, Browser and MISHU checks are followed by
  the final source-bound complete plan; its result is recorded in private receipts
  and the corresponding Issues rather than assumed here.

The earlier isolated 0.96 check had one documentation-vocabulary failure among
1,720 passing tests and 136 skips. This candidate fixes that wording; it does not
retroactively label the earlier receipt passed. Source publication, exact fresh
clone verification and activation remain separately reported outcomes. At source
review, production still runs 0.96; this review does not authorize a restart.
