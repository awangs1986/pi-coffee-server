# Trusted-owner source authority candidate

This bounded source component follows the 2026-10-29 decision to preserve native
permissions and trust the source Host administrator. It does not defend against
hostile root. It does not install a service, change permissions, migrate existing
tasks, or enable production backup. Main/native/source-export/key-service wiring
and actual deployment qualification remain separate work.

`TrustedSourceAuthority` composes an actual `PhysicalWriterFence`, a private
durable admission ledger, and typed enrollment. It adds no namespace, no-sudo
setting, model proxy, network restriction or native configuration override.
Ordinary key APIs continue to require their own authorization and must not expose
key bytes. This module never reads a backup key.

## Observed facts and operating assumptions

Enrollment records actual source directory device/inode/UID identities, live
producer boot/PID/birth/UID identities, and digests of private versioned
configuration and graph inventory files. A kernel owner lease prevents two
authority instances from adopting the same journal concurrently. Source cuts use
the physical writer fence and its actual native descendant custody.

Those facts do not discover every potential source writer. The explicitly recorded
operating assumptions are `trusted-source-root` and
`all-source-producers-use-admission-v1`. The administrator must enumerate every
source-producing authority and install its admission integration. A producer PID
being alive is identity evidence, not proof that all of its code uses admission.
The graph inventory is trusted adapter input, not a substitute for Pi/Codex
version-specific graph, SQLite/WAL, native-history and shared-store validation.
An empty process/FD scan, an ownership marker or a caller's `known:true` cannot
establish coverage. Deployment with an unaccounted source-writing daemon, shared
mount or remote callback remains unqualified.

`enrollFresh` still creates only absent roots and preserves any existing source.
Existing data uses `enrollExisting`, and persisted enrollment uses `requalify`.
`qualifyExisting` chooses between these two from the private journal. These are
real cold-enrollment operations, not ownership markers or operator exemptions.
They require one explicitly configured cooperating Host, the actual ordinary
native lifecycle handoff, complete native closure materialization, and a newly
sealed checkpoint under the exact held physical cut before the enrollment is
committed. See [native lifecycle evidence](native-source-handoff.md).

Normal native activity supplies the receipt; backup never launches, resumes or
stops sessions to obtain one. Each nonempty Pi/Codex store needs an observed
binding in its complete current inventory, not a forced reopen of every archived
task. Extra producer authorities remain unknown until their own actual handoff
adapters exist. Source directories retain their permissions (including owned
0755 directories); group/world writable source roots are refused. Private
configuration/journal/checkpoint controls remain private, with no chmod/migration.

A reopened journal remains unknown until requalification. Only the explicit
`authority-reopened` issue may be cleared, after exact config/graph/root continuity
and the new complete cut. Pending delegated/legacy/unowned operations, journal failures, unregistered
producers and unknown delegation cannot be cleared by a native receipt. Newly
tagged local operations have the explicit dead-producer protocol below; no
operation is replayed or blanket cleared. A never-enrolled but otherwise clean Host may also restart and
later enroll. No capture or root proof is visible outside the private asynchronous
provisional context while enrollment is in progress.

Schema2 native custody additionally binds launch/receipt to the actual kernel
boot and command digest. Intact prior-boot local processes cannot survive into
the current kernel, but old observations alone never qualify a source: current
native lifecycle proof and complete source validation remain required. Old
receipts are preserved and hashed; there is no public boot override. Legacy
unbound prior-boot custody and current-boot uncertain/lost custody remain unknown.
The tests simulate persisted prior-boot records explicitly; no production or real
machine reboot is claimed. See the native lifecycle evidence document for the
separate bounded receipt-archive performance gap.

## Public integration contract

`open({root,configuration,graph,fence,authorize})` owns the journal until `close`.
The supplied physical fence must be the same source group used by native custody
and platform admissions. Configuration and graph files are canonical private
regular files owned by this service identity. The configuration schema is:

```json
{
  "schema": 1,
  "groupId": "shared-native",
  "owner": {
    "administrator": "awangs",
    "operatingAssumption": "all-source-producers-use-admission-v1"
  },
  "roots": [{"id": "task-data", "path": "/private/new-source"}],
  "producers": [
    {"id": "host", "kind": "host"},
    {"id": "runner", "kind": "delegation-broker"}
  ]
}
```

The graph schema is `{schema:1,groupId,roots:[{id,scope,engine}]}`. Every configured
root appears exactly once; engine is `pi`, `codex`, or `shared`. This binds the
source-root inventory; task/native bindings still belong to recovery adapters.
`enrollFresh(actor,[{id,pid}])` observes each producer's real process identity.
Configuration/graph changes or directory replacement invalidate existing cut
assertions as well as subsequent capture qualification.

`runWriter(producer,operation,run)` synchronously revokes a capture and acquires
writer admission before invoking `run`. One synchronous atomic/fsynced mutation
path persists admission and completion; there is no competing asynchronous save
that can overwrite newer journal state. The operation is persisted before effects
begin when the journal is healthy. `runDelegated` requires a registered
delegation-broker integration whose returned promise covers the actual remote or
daemon job through its completion callback, not merely command acceptance, SSH
exit or queue submission. Native subreaper custody remains independently required
for local native descendants. A failed delegated callback leaves a durable
unresolved operation; timeout, authority restart or missing completion does not
clear it. A settled local request error ends its logical admission, while actual
native descendants independently continue blocking capture through custody.
This slice offers no remote job reconciliation or SSH execution implementation.

Unregistered or identity-lost producers still run through the admission API, but
persistently invalidate source coverage. Journal failure or a closed authority
also allows ordinary callbacks after successful physical admission, while
immediately poisoning local capture and attempting durable invalidation. No old
enrollment automatically resumes after reopen, even if that invalidation could
not be saved. Duplicate pending operation identities remain refused. Actual
physical recovery exclusion, including an unreadable recovery gate, is never
bypassed. This is not a fallback around an in-progress irreversible restore.
`invalidateCoverage` records negative writer observations and has no inverse API
that treats a later empty scan as proof.

`qualification()` reports enrollment/admission state, not proof of a cold native
runtime. `capture()` additionally acquires the real physical cut and returns
`{lease,evidence}`. Tracked active journal operations report `writers_active` (waiting); saved or
unowned pending operations report `writers_unknown`. An empty or unknown custody
directory still refuses capture.
Use `lease.assertValid()` throughout source materialization and immediately before
atomic seal publication; always release it. Evidence contains the enrollment ID,
coverage revision, graph/configuration digests and named operating assumptions,
without private source paths. A restart with pending operations reports unknown;
there is no replay of their effects.

**The coordinator must use `writerFence(producer)`, not the underlying physical
fence after a separate source-proof query.** The bound fence validates exact
authority evidence on every lease assertion, including the final synchronous
seal publication. It also supplies synchronous durable `beginWriter` admission.
Publication retains the original physical lease object/capability and delegates
`runRecoveryPublication` to that same physical authority. The module-private
provenance map exposed by `trustedSourcePhysicalFence` lets native factories
verify the exact underlying custody/fence pair without accepting a caller Boolean.

Main must call `verifyRoots(actualConfiguredPaths)` for its actual workspace,
task, native session/configuration and resolved SQLite roots. An unrelated valid
enrollment is not source proof. The method checks current enrolled root identity,
canonical existing paths, same-device descendants and symlink rejection. It does
not authorize account access, infer task ownership, validate native layouts or
permit omitting a shared/deferred dependency from the recovery adapter's graph.

`createNativeCoordinator({producer,scopes,checkpointRoot})` constructs the actual
Pi/Codex/combined/grouped recovery adapters on each cut, using the same bound
fence as Workspaces and native factories. Each Workspaces must also carry the
actual Git command custody bound to that physical fence; matching only the
logical writer fence is insufficient. The scope descriptors are trusted main
configuration. The graph must include every configured scope, including an empty
legacy default if main constructs it. Every configured root must cover an actual
validated native/workspace source; every actual source must be under an enrolled
canonical same-device root. Optional `maxBytes`, `maxFiles` and
`captureTimeoutMs` are validated positive safe-integer limits, preserved in both
initial enrollment and later captures. Initial enrollment's deadline also covers
native materialization/handoff, and grouped materialization uses the byte/file
budgets. Existing complete points keep their original identity/capture time after
a failed capture under lower limits; inventory has independent bounded metadata
reads (32 MiB, one million objects), not the new-capture file limit.
Resolved separate SQLite roots and sibling Chat/task
roots must be included. Root inventory is still not user authorization.

Normal Host initialization must finish `Workspaces.list()`/startup reconciliation
before requesting enrollment. That reconciliation is a real fenced writer, and
running it inside a cut correctly revokes the cut. Enrollment does not bypass the
fence or silently run the normal initialization under a fake read-only callback.
The provisional bound lease borrows the already held physical cut; it never
reacquires EX or permits recovery publication. A newly admitted writer revokes
this cut before any source effect, and no enrollment is committed afterward.

## Interrupted local Host operation reconciliation

New local admission records carry the exact actual kernel process identity,
configuration/graph digests, source enrollment generation (or null), origin and a
checksum over the complete operation/tag. The checksum detects accidental
corruption; it is not authentication against trusted source root. Ordinary
application authorization and private authority ownership are still required.
`qualified-host` tags require the actual enrolled Host identity. A
`configured-host-startup` tag may be issued only by code-owned admission for the
single explicitly configured Host with valid private configuration/graph; this
covers first startup and repeated crashes before requalification. Unknown or
multiple producers receive no such recovery tag. Old records are never retrofitted.

Requalification may provisionally consider only the unchanged exact set of tagged
local operations whose configuration/graph/generation/checksum still agree.
Their previous owner must be demonstrably gone: actual kernel boot differs, its
PID no longer exists, or the real kernel PID has a different birth identity.
Read denial, unreadable identity or UID ambiguity remains unknown. A live exact
owner remains unknown even if it no longer appears busy. Native custody, the
actual physical EX lease and complete current Pi/Codex source graph must still
qualify; producer death is not source closure or remote completion proof.

The provisional context permits these exact pending entries only internally. Any
new admission/revision change revokes the cut. A complete new native checkpoint
must seal before a private fsynced reconciliation receipt records every operation,
its owner/death proof, prior/new enrollment, current native handoff and preserved
prior-boot ledger digest, and checkpoint identity. Only then does the atomic
journal update clear those exact IDs and link the receipt. The new journal state
is a candidate value: a failed rename restores the prior in-memory state before
poisoning backup coverage, so later ordinary writes cannot persist an uncommitted
clear/enrollment. Fresh enrollment uses the same publication failure rule.
Failures preserve the
pending records, including across later ordinary work. The original callback is
never replayed. An unlinked receipt after an interrupted commit is retained; a
retry must obtain fresh current proof/cut. A linked receipt's contents/integrity
are checked on normal evidence and before later requalification; losing it cannot
be bypassed by restarting again.

Delegated operations, legacy or unowned local records, negative writer coverage
and unsupported producer topologies remain unavailable. They need explicit
separate completion/recovery protocols, not a timeout, root flag or guessed scan.
The source authority exposes no clear-pending or supplied-death Boolean.

Initial authorization is rechecked immediately before committing enrollment.
Existing-source enrollment revalidates its exact held cut and journal after this
asynchronous policy check; fresh allocation revalidates config/graph digests,
source roots and producer identities. Policy withdrawal prevents enrollment,
reconciliation receipt and source grant. A checkpoint already sealed while the
initial policy permitted the read remains private local material; export still
requires current policy and valid source authority. No rollback deletes user data.

## Evidence scope

Focused tests exercise the public authority/admission/capture interface with real
kernel leases, an ordinary native custodian and a separate delayed writer process.
They cover initial/later coordinator-sealed checkpoints, synchronous invalidation, detached delegated
completion, pending operations across reopen, producer loss, root/config/graph
drift, unregistered producers, concurrent authority refusal and invalid enrollment.
`test/trusted-existing-enrollment.test.ts` additionally runs real offline Pi and
pinned Codex native history/resume/normal-close lifecycles, actual complete
checkpoint materialization, later ordinary writes/cuts, passive same-boot Host
restart, and a joint Pi/Codex cut across two synthetic scopes. It rejects no-op or
forged handoffs, missing stores/scopes, extra producers, graph drift, interrupted
operations and new writes during enrollment. No provider/model round is submitted.

These synthetic supported-topology observations do not prove production producer
inventory, actual machine-reboot acceptance, remote runner lifecycle, all native
feature parity, Restic recovery or installed daily scheduling. Main/service/key
integration and full acceptance remain required before #130/#131/#141 can close.

`test/trusted-local-reconciliation.test.ts` uses real child Host processes that
exit while their actual local admission is pending, then verifies a new complete
point and linked durable reconciliation. It covers qualified/first/repeated
startup ownership, damaged/legacy/delegated refusal, incomplete native closure,
resource/receipt failures, lost receipt on later restart, concurrent admission,
actual Workspaces/native deletion and explicitly simulated prior-boot records
with a real current native lifecycle. Fixture sources are synthetic only.
