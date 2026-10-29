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
and the new complete cut. Pending local/delegated operations, journal failures,
unregistered producers and unknown delegation cannot be blanket cleared by a
native receipt. A never-enrolled but otherwise clean Host may also restart and
later enroll. No capture or root proof is visible outside the private asynchronous
provisional context while enrollment is in progress.

This protocol is currently **same-boot Host restart only**. Native custody rejects
old-boot receipts, even after a new normal lifecycle. Machine reboot/custody history
reconciliation, crash-history recovery and additional producer handoffs remain
unimplemented; old receipts must not be erased to manufacture qualification.

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
fence as Workspaces and native factories. The scope descriptors are trusted main
configuration. The graph must include every configured scope, including an empty
legacy default if main constructs it. Every configured root must cover an actual
validated native/workspace source; every actual source must be under an enrolled
canonical same-device root. Resolved separate SQLite roots and sibling Chat/task
roots must be included. Root inventory is still not user authorization.

Normal Host initialization must finish `Workspaces.list()`/startup reconciliation
before requesting enrollment. That reconciliation is a real fenced writer, and
running it inside a cut correctly revokes the cut. Enrollment does not bypass the
fence or silently run the normal initialization under a fake read-only callback.
The provisional bound lease borrows the already held physical cut; it never
reacquires EX or permits recovery publication. A newly admitted writer revokes
this cut before any source effect, and no enrollment is committed afterward.

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
inventory, machine-reboot reconciliation, remote runner lifecycle, all native
feature parity, Restic recovery or installed daily scheduling. Main/service/key
integration and full acceptance remain required before #130/#131/#141 can close.
