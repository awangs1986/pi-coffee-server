# Durable task preparation

Status: **Implemented and activated since 0.94; complete real-user Fork acceptance remains separate**, 2026-11-06.
Baseline: Server 0.84, `eb34dde7fb08420ac9501811482893f0c3215ddd`.
Tracking: [Server #161](https://github.com/awangs1986/pi-coffee-server/issues/161). This contract governs the lifecycle replacement;
the 0.84 baseline is historical; current implementation includes durable preparation.

Accepted planned amendment: [complete-history Codex Handoff Fork](handoff-history-reconstruction.md),
[Server #164](https://github.com/awangs1986/pi-coffee-server/issues/164), uses the
same preparation authority with bounded RAM, qualified context up to 1M tokens,
serial reconstruction and one local-compression/input-size retry allowance.
This narrowly supersedes the exclusions on fresh-context summarization and
automatic retry for that future mode only. Implementation/activation is pending;
the current source behavior and other failure recovery rules below remain.

## Problem Statement

Creating a Chat/Work Conversation or a Fork can outlive the Browser or gateway
request. Today, directory allocation, registry writes, Git operations, native
binding, summary generation and cleanup are coordinated by different callers.
Partial success can leave the user waiting without a reliable answer about what
exists, what is still running and whether retrying would duplicate work. A
successful model reply alone does not prove a usable task or safe cleanup.

The owner requests a structural replacement of this orchestration, rather than
another timeout patch or repeated testing of known old behavior. Current source
inspection shows mismatched transport/stage deadlines, unbounded native calls,
interactive source preflight and duplicate history reads, and registry saves that
rewrite unrelated task exports. These observations do not establish that one
recent commit caused every reported failure.

## Solution

The Host owns one durable preparation operation from accepted intent to a usable
Conversation or an explicit failure/recovery state. The Browser receives an
operation identity promptly, displays its authoritative progress, and reconnects
to that same operation after interruption. Preparation is bounded and does not
silently replay native creation, summary generation or uncertain commands.

Use one internal TaskPreparation module in the existing Host. Preserve independent
workspaces, scoped credentials, native engine behavior and the existing single-VM
deployment. Refactor lifecycle ownership first; retain current Handoff context
semantics behind replaceable Agent preparation adapters.

## User Stories

1. As a Browser User, I want task creation acknowledged before slow preparation, so that I know my request was accepted.
2. As a Browser User, I want reload and reconnect to show the same operation, so that a lost response does not create another task.
3. As a Browser User, I want phase and failure details, so that waiting is distinguishable from a failed operation.
4. As a Browser User, I want only safe recovery actions offered, so that retrying does not repeat unknown side effects.
5. As a Browser User, I want a task marked ready only after its workspace and native binding are validated, so that it can actually open and run.
6. As a Chat User, I want repository-free Pi or Codex creation without Work guidance, so that Chat retains its intended context boundary.
7. As a Work User, I want my selected repository, starting branch and engine retained, so that preparation creates the intended independent clone.
8. As a Work User, I want empty repository initialization and existing privacy-safe Git publication preserved, so that starting from zero still works.
9. As a Fork User, I want current files, staged/unstaged changes and attachments copied independently, so that the new task does not share writable state.
10. As a Fork User, I want the source protected throughout preparation, so that failure cannot alter its history, binding or project files.
11. As a Fork User, I want Traditional Fork to use supported native continuity without a summary turn, so that its semantics remain predictable.
12. As a Handoff Fork User, I want an isolated, bounded summary and a separately seeded target, so that preparation does not resume project work in the source.
13. As a Handoff Fork User, I want original model, thinking and context settings restored before readiness, so that preparation settings do not become my working settings.
14. As a Handoff Fork User, I want saved summaries retained after seed failure, so that explicit resume can reuse completed work.
15. As a Browser User, I want cancellation to report remaining cleanup truthfully, so that a timer does not pretend a native writer has stopped.
16. As a Browser User, I want my unrelated tasks available when one operation is uncertain, so that a local failure does not disable my entire account.
17. As a Browser User, I want internal preparation excluded from ordinary completion notifications, so that MISHU and speech do not treat summaries as completed user work.
18. As an Account Owner, I want operation reads and actions scoped to my identity, so that guessed task or operation IDs reveal no other account's data.
19. As an Operator, I want restart recovery to inspect saved evidence without automatic model work, so that restart does not incur duplicate usage.
20. As an Operator, I want owned runtime and descendant receipts retained until quiescence is proved, so that cancellation preserves backup consistency.
21. As an Operator, I want bounded outputs, deadlines and concurrency, so that stalled preparation cannot grow resources or launch a batch of native sessions.
22. As a Browser User, I want lists to read committed metadata without waiting for unrelated historical exports, so that preparation does not delay navigation.
23. As a Maintainer, I want one operation authority and removable compatibility projections, so that routes cannot disagree about readiness or retry safety.
24. As a Maintainer, I want production-shaped HTTP/WS and Browser-controller acceptance, so that isolated passing mocks do not hide integration failures.

## Implementation Decisions

### TP-01 — Boundary and authority

TaskPreparation exposes start, get, cancel and resume. Start takes authenticated
actor scope, a typed input and a scoped idempotency key. Cancel/resume require an
expected revision. The operation view contains operation ID, target Conversation
ID, kind, revision, status, phase, bounded progress/error and allowed actions.
The actor always comes from authenticated Host routing, never an owner supplied
by the Browser. Every HTTP/WS read, subscription and mutation enforces that scope.

The four initial kinds are create-chat, create-work, native-fork and handoff-fork.
They share lifecycle rules with explicit stage graphs. Unsupported engine/mode
pairs fail before side effects; this refactor does not enlarge engine support.
Web authenticates and forwards. Native protocols stay behind Agent interfaces.

### TP-02 — Durable acceptance and delivery uncertainty

Perform cheap input/ownership/capability validation and persist intent before
slow Git, native or model work. HTTP 202 means accepted, not ready. The client
retains a scoped idempotency identity before dispatch and can reconcile delivery
uncertainty with that identity, including when the initial response was lost.
Equivalent key/payload returns the same operation; a conflicting payload is a
conflict. A timeout, reconnect or reload cannot allocate a new identity or replay
a model request. Validate source admission again when acquiring custody.

### TP-03 — Internal responsibilities

The coordinator owns stage progression, admission, deadlines, cancellation and
recovery. The journal owns intent, revisions, source cut identity and side-effect
receipts. Workspace preparation owns reservations, independent clone/copy, Git
publication and attachments. Agent preparation adapters own native creation,
forking, summary/seed, effective settings and owned runtime receipts. Publication
owns validated readiness/binding transitions and changed-task exports.

These are internal responsibilities, not new services. The native factory resolves
adapters rather than orchestrating entire workflows. Interactive session opening
is not a prerequisite for workspace preparation or source evidence export.

### TP-04 — Persistence and publication

The existing task/project registry remains authoritative for identity, ownership
and final binding. A task references its operation; the journal is authoritative
for in-flight work. Legacy creation/Fork flags are compatibility projections,
not independently writable state machines. Final publication is idempotent and
linked to operation identity/revision. Reconcile a crash between registry and
journal writes from receipts; two atomic file renames are not a transaction.
Reuse existing durable-write, directory-sync and owned-lease primitives. Do not
introduce a second database or import backup workflow logic into preparation.

### TP-05 — Lifecycle, budgets and cancellation

The normal progression is accepted, running a named stage, finalizing, completed.
Failure/cancellation enters cleanup or reconciliation and settles as failed,
cancelled or uncertain. Publish the primary error immediately even while cleanup
is pending. Completed requires validated task publication; cancelled requires
proven cessation of owned work. Late replies cannot reverse a terminal outcome
or overwrite a newer revision.

Use centralized finite operation, stage and cleanup budgets. Every Git/native
preparation call, including history reads and unsubscribe/close, receives a
deadline and cancellation context. Existing 180-second per-turn policy is a
baseline, not an end-to-end bound. Select and document aggregate budgets before
implementation acceptance; no unbounded fallback is allowed. Prompt acceptance
is distinct from native turn completion.

Only operation-owned temporary runtimes may be terminated. Borrowed source
sessions must survive. Retain writer custody, descendant tracking and backup
exclusion until writers are provably quiescent. Incomplete cleanup retains resource
receipts and quarantines the affected operation/task; do not blindly delete locks
or disable unrelated tasks. Revision checks serialize competing actions.

### TP-06 — Source snapshot and Handoff stages

Require an owned, active, ready source with settled foreground/background work,
no queued input and no unanswered questions. Preserve current source locking
through preparation. Capture one immutable/read-only source cut with binding,
generation/leaf evidence, conversation records, Git state identity, attachment
manifest and settings. Export once, without interactive source opening or repeated
complete-history traversal. Preserve source data and independent copy semantics.

Generate a bounded summary in an isolated context under a versioned preparation
policy, then seed a separate target. Verify target context and binding and restore
source model/thinking/context selection before publication. The source supplies
evidence; never prompt it to summarize itself or resume its project work.

For the initial Codex migration, retain the isolated native fork carrying inherited
context, followed by summary and fresh target seed. Keep the deployed sol/medium
preparation default, provider allowlists and existing preparation tool restrictions.
Pi and Claude retain their accepted engine-specific preparation contracts.
A fresh blank summary session reading a source bundle is a separate policy
proposal requiring explicit coverage and input-budget decisions, not part of this
refactor. Neither strategy guarantees upstream provider success.

Adapter results must identify the operation and native turn/binding where supported,
provenance, effective settings, artifacts and cleanup ownership. A text marker or
last historical assistant message alone cannot prove current operation completion.
Reject oversized required evidence explicitly; retain it without silent truncation,
fabricated native transcript translation, automatic multi-stage summaries or batch
model calls. Never substitute Traditional Fork for failed Handoff.

### TP-07 — Recovery matrix

Journal intent before side effects and record receipts immediately afterward.
Use stable ownership plus process/lease generations; a task ID alone is not proof.

| Interruption | Required recovery |
| --- | --- |
| Intent exists, folder absent | Reconcile ownership and safely allocate the reserved destination. |
| Folder exists, registry record absent | Adopt only with a matching Host-owned reservation receipt; never adopt arbitrary files. |
| Git push response lost | Inspect the exact scoped ref and expected head/tree before deciding whether retry is safe. |
| Native create/fork result unknown | Recover a provable owned binding or mark uncertain; do not create another thread. |
| Model turn accepted, result unknown | Inspect owned turn evidence; do not automatically generate again. |
| Summary saved, seed absent/failed | Explicit resume reuses the validated summary and starts only the remaining permitted stage. |
| Target validated, publication interrupted | Publish the same binding idempotently. |
| Cleanup incomplete | Retain error/resource ownership and bounded reconciliation; no blind unlock. |

Restart may reconcile passive evidence and safe metadata. Additional model work
requires explicit resume. Ambiguous irreversible effects block dependent stages
until reconciled. Do not promise exactly-once native creation when the engine
cannot prove it. Existing interrupted legacy tasks remain inspectable and are not
automatically replayed or retroactively assigned fabricated ownership receipts.

### TP-08 — Custody, readiness and metadata

Backup custody retains its consistency role behind a stable execution contract.
Output/error representation, byte limits, stdin, deadlines and descendant ownership
must agree with custody enabled or disabled; never bypass custody to make creation
pass. Preserve existing shared-native-storage consistency grouping.

Check readiness only for the selected engine, caching with engine/configuration/
account identity and deliberate invalidation. Distinguish missing credentials
from transient inspection failure; do not launch every CLI during admission.
Persist authoritative transitions before display exports. Export only changed task
metadata, coalesce optional display work, and report export degradation separately.
Lists read a committed snapshot without waiting for all historical exports.

### TP-09 — Product boundaries

Chat skips Git and Work-only runner/environment instructions. Preserve the accepted
Pi/Codex Chat matrix and native Chat instruction rules. Work retains scoped
Gitea/GitHub selection, empty-repository initialization, privacy-safe Git publication
and independent clones. Fork still does not implicitly commit, push or create a
remote repository. Preserve native execution permissions, account grants, explicit
SSHME and ordinary interactive behavior.

Preparation events are distinct from user-run completion: no incidental coffee
completion icons, MISHU wakes or speech deliveries from summary/seed turns.
Bound admission and preserve the existing high-risk batch policy. No automatic
concurrent wave of native/model conversations is introduced.

### TP-10 — Migration sequence

1. Establish operation contracts, revision rules and the transition/recovery acceptance matrix.
2. Extract bounded Agent preparation execution and ownership-aware cleanup.
3. Move new Chat/Work creation into durable coordination with accept/query compatibility.
4. Move native/Handoff Fork into explicit snapshot, summary, seed and publication stages; remove duplicate source preflight/export.
5. Unify Browser progress/actions and incremental metadata exports; delete replaced orchestration branches.

There must never be two writers preparing the same task. Negotiate capability
before enabling new Browser actions; preserve legacy records and readable errors.
Rollback must retain journals, bindings and receipts and must not send a partially
prepared task through the old creator. A permanent wrapper around competing old
and new implementations is not completion of this refactor.

## Testing Decisions

Use the already agreed public HTTP/WS and Browser-controller seams with a
production-shaped Host composition. Include actual workspace storage, native
adapter integration and ordinary writer custody. Fake external provider/native
protocol replies and forge transport as needed; do not replace the entire factory
in the test meant to verify orchestration. Use local disposable Git repositories
for real clone/copy/state assertions. Existing Fork HTTP/native, workspace and
Browser-controller tests provide prior art.

| Acceptance | Observable requirement |
| --- | --- |
| TP-AC01 | All four operation kinds promptly persist intent; selected-engine readiness and capability errors are distinguished. |
| TP-AC02 | Lost initial response, gateway timeout, reconnect and repeated same-key requests resolve to one operation/task; conflicting payload/revision is rejected. |
| TP-AC03 | Chat has no Git/Work runner stages; Work preserves selected branch, scoped forge, empty-repository and privacy-safe publication behavior. |
| TP-AC04 | Both Fork modes preserve source settings/history/files and independent staged/unstaged state/attachments; unsupported modes never fall back. |
| TP-AC05 | Handoff summary/seed results belong to the current operation; historical markers, late and out-of-order events cannot publish readiness. |
| TP-AC06 | Never-returning native request, missing terminal event, stalled history read/unsubscribe, process death and Git hang produce bounded failure/uncertainty. |
| TP-AC07 | Inject crashes at every recovery-matrix boundary; recover the same identity, retain artifacts and perform zero automatic model replays. |
| TP-AC08 | Explicit resume after seed failure reuses saved summary; cancellation/revision races cannot kill borrowed sessions or publish a cancelled target. |
| TP-AC09 | Stale owner epochs, surviving descendants and backup contention preserve custody; uncertain cleanup affects only necessary tasks. |
| TP-AC10 | Large history/patch/attachment boundaries are deterministic, bounded and preserve evidence; custody-on/off contracts agree. |
| TP-AC11 | Cross-account guessed operation/task IDs cannot read or mutate state; test synthetic accounts, not another user's production data. |
| TP-AC12 | Lists remain available despite unrelated export backlog; publication failures recover without a duplicate binding. |
| TP-AC13 | Preparation produces no ordinary completion/MISHU/speech events; unsupported or legacy records remain readable without fabricated receipts. |
| TP-AC14 | Browser reload/dialog reopen shows durable stage/error/actions, including cleanup pending; no progress timer triggers a new operation. |

Implement with red-to-green regressions, run the canonical repository check, and
verify the exact release in a fresh clone before deployment. After implementation,
one separately owner-authorized deployed Handoff Fork proves the end-to-end
workspace, summary, distinct native binding, HTTP/WS reopening and retained settings.
A model reply alone is insufficient. No live provider calls, old-version reruns,
new sessions or deployment are authorized by this documentation update itself.

## Out of Scope

- Changing VM topology, adding services/queues, rewriting Host language or replacing native CLIs.
- Migrating takeover or manual in-place compression before mapping their different binding/source-retention semantics.
- Making fresh blank-context summarization the default, changing model policy or broadening supported Fork engines.
- Relaxing permissions/custody, bypassing provider restrictions, or promising provider availability or drift-free summaries.
- Automatically deleting failed evidence, releasing source protection mid-Fork, retrying unknown model work or creating batch conversations.
- Replacing account authorization, Git authority, native transcript storage or the Conversation registry.

## Further Notes

This specification supersedes scattered preparation orchestration requirements
only where explicitly stated. Existing product rules remain in
[Conversation Fork](conversation-fork.md), [workspace creation](gitea-workspaces.md),
[native engines](native-agent-engines.md), [Chat/Work directories](conversation-workspaces.md),
[Chat environment boundaries](session-environment.md) and
[batch execution](batch-agent-execution.md).

Related work: [Fork #39](https://github.com/awangs1986/pi-coffee-server/issues/39),
[Git privacy #160](https://github.com/awangs1986/pi-coffee-server/issues/160).
Source authority remains [ADR-0021](../adr/0021-pi-only-source-authority.md).

Baseline evidence: Server 0.84 was activated and one owner-authorized Handoff Fork
passed, as recorded on #39. This proves that attempt, not the lifecycle guarantees
above. The older 0.83 attempt timed out during summary; it does not establish a
single upstream cause. The 0.84 scoped sol/medium repair is not this refactor.

Implementation anchors at the reviewed baseline: [Host entry points](../../src/host/server.ts),
[workspace registry](../../src/host/workspaces.ts), [native factory](../../src/host/native/factory.ts),
[Fork preparation](../../src/host/fork.ts), [native RPC](../../src/host/codex/rpc.ts),
[Codex adapter](../../src/host/codex-adapter.ts), [durable storage primitives](../../src/host/restore-files.ts).
Regression prior art: [Fork HTTP](../../test/conversation-fork.test.ts),
[native subprocess integration](../../test/fork-native-http.test.ts),
[Browser controller](../../test/fork-ui.test.ts).

## Current implementation (since 0.94, reviewed 2026-11-06)

The implementation owns the coordinator in `src/host/task-preparation.ts`,
execution budgets in `src/host/preparation-execution.ts`, native Fork policy in
`src/host/native/fork-preparation.ts` and Browser polling/recovery in
`public/task-preparation.js`. This implementation was activated in 0.94;
activation does not establish every acceptance criterion below.

- Budgets: 600 seconds per operation, 120 seconds per stage, at least 180 seconds
  for summary/seed, and 10 seconds for cleanup. Admission permits two active
  preparations per workspace authority. Uncertain operations retain task/source
  custody. Timeout never proves that a writer stopped.
- Explicit resume supports known failed creation readiness/workspace stages and
  known terminal Codex seed failure. The latter reuses the saved summary and
  target native binding. Resume waits for the previous execution's resource
  release. Other interrupted native outcomes remain quarantined, with no replay.
- Restart can complete publication passively only when cleanup and publication
  receipts match the durable target. An accepted intent that never started can
  be resumed explicitly. Interrupted work is otherwise uncertain.
- Codex Handoff keeps the inherited-context temporary fork, then seeds a distinct
  target. Preparation policy version 1 uses `gpt-6.1-sol` / `medium`; working
  settings are restored. Source inspection reads paginated native evidence and
  accepts an idle unloaded thread. Other adapters may use an owned inspection
  session; this is not an interactive Host registry open.
- Since Server 1.00, Fork history capture, persistence and saved-history reads
  share a 256 MiB evidence ceiling. Codex reads 20 turns per page with a 32 MiB
  per-page ceiling and releases raw page data after projection. Evidence is
  hashed and written in entry-sized pieces; artifact readers allocate against
  actual checked file size. These are byte budgets, not model context settings.
  Summaries remain capped at 256 KiB and embedded Claude history at 1 MiB.
  Summary digests and native result receipts belong to the current operation.
- Directory reservations are inode-bound and never adopt pre-existing folders.
  Kernel lease files persist after release; legacy lock directories are refused,
  not deleted. Committed list reads do not await unrelated task exports.
- Browser enables preparation only when advertised. The legacy low-level
  `conversation` endpoint remains for compatible clients; modern task records
  cannot open until their preparation is ready. Legacy Fork routes delegate to
  the coordinator. Manual compression and takeover remain separate workflows.

Regressions exercise HTTP acceptance/idempotency/scope, resume/cancel,
workspace allocation, cold-source Handoff, changed-artifact refusal, process-crash
reconciliation, and Browser recovery. They use synthetic native/provider replies.
The exhaustive crash-boundary/resource matrix and an owner-authorized deployed
Fork remain release acceptance work; do not infer those results from unit checks.

### Large Fork evidence (1.00)

Long, idle Codex sources can exceed 32 MiB because completed tools retain their
output. Within the 256 MiB ceiling, retain every projected history entry and its
content; do not truncate history to pass admission. The cumulative native-page
bytes and canonical saved history each obey that ceiling. Individual native
pages and metadata remain bounded at 32 MiB; the existing 10,000-turn traversal
ceiling, ownership, idle/background checks and source consistency checks remain.

Private evidence writes use an exclusive temporary file, file sync, atomic
rename and directory sync. Saved reads validate canonical path, ownership,
single-link regular-file status, actual size and stability during reading;
unknown top-level history fields or changed digests prevent reuse. Legacy
pretty-printed evidence with the same verified content remains readable.
Oversized evidence fails visibly before model preparation and retains the source.
No failed Fork is automatically replayed. Git's staged patch budget remains
32 MiB, independently of conversation evidence.

Public HTTP/native-fixture acceptance covers both Fork modes beyond 32 MiB,
unchanged source content, total/per-page rejection, active work on later pages,
saved-evidence integrity and failed-seed reuse. A private read-only inspection
of the reported long source verifies the failing gate, not an actual deployed
Fork. [Review and acceptance boundaries](../reviews/fork-large-evidence-20261109.md).

### Public completion and lifecycle custody (0.95)

A durable completed journal does not advertise Browser readiness while the owned
execution tail still holds lifecycle custody. The public operation projects
`finalizing` and the task projects `creating` until that tail settles; the source
Fork indicator also remains preparing. Notify subscribers again after releasing
the operation. Thus a public completed result can be followed immediately by an
ordinary task action, without a transient lifecycle-lock rejection. Restart can
still use the durable completion receipt without replaying native work.

## Shared lifecycle admission (0.97 candidate)

[Architecture maintenance](architecture-maintenance.md) centralizes owned task
holds. Source and target are held before source-idle checks and durable acceptance
writes, closing the archive-during-admission race. Existing completed-tail and
uncertain-cleanup semantics remain. This changes Coffee lifecycle coordination,
not upstream Pi or native execution semantics.

## Codex empty Work binding (0.98)

A completed directory/clone/native-start sequence does not prove that an empty
Codex thread survives preparation cleanup. Work creation must mark its known
empty context just as Chat creation does. Opening the same prepared Conversation
may recreate only that empty native context, preserving the project, local files,
settings, Conversation ID and retired native ID. No synthetic model turn is used
to force native persistence.

Two independent facts are required: current scoped Host authority for empty
context and a Coffee sidecar explicitly marking the exact native ID empty. Only
recognized native missing-thread/rollout responses admit recovery. Prompt
admission revokes authority before dispatch; a missing used transcript, unknown
native outcome, authorization error or arbitrary timeout never admits replacement.

For older prepared Work records without `nativeContextEmpty`, the coordinator
may derive it only from a completed `create-work` receipt with the matching
publication digest, completed native-binding/cleanup stages, a ready active task,
and no accepted request, run status, Fork, takeover, context reset, recovery or
retained binding. Rebinding then persists the explicit marker through the scoped
workspace transaction. Invalid or absent proof remains a visible failure.

Public acceptance: `test/codex-prepared-work-http.test.ts` exercises the production
Host entry, local Git fixture, asynchronous preparation, cold native reopen,
legacy receipt recovery, proof mismatch refusal, first message and refusal to
replace a missing used transcript. The native fixture models empty history as
unavailable after process cleanup. Source tests and actual service activation
remain separate; the original reported task must be reopened after activation.
