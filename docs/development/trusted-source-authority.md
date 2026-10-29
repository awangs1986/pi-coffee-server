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

The initial slice supports **fresh allocation only**. `enrollFresh` authenticates
the administrator, requires every target root to be absent, then creates and
records those directories. Existing roots, including empty ones or directories
with old provenance markers, are rejected and preserved. A partial allocation
failure retains files and does not create a qualified enrollment. There is no
adopt-existing, clear-unknown, operator-Boolean or fake cold-export shortcut.
Verified legacy cold enrollment and producer requalification remain unimplemented.
Every reopening of a persisted enrollment is unqualified in this slice, including
a clean restart. This prevents revival of prior coverage after journal failures;
it is an explicit unfinished operation, not an acceptable final backup lifecycle.

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
for local native descendants. A failed callback leaves a durable unresolved
operation; timeout, authority restart or missing completion does not clear it.
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
`{lease,evidence}`. An empty or unknown custody directory still refuses capture.
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

## Evidence scope

Focused tests exercise the public authority/admission/capture interface with real
kernel leases, an ordinary native custodian and a separate delayed writer process.
They cover initial/later coordinator-sealed checkpoints, synchronous invalidation, detached delegated
completion, pending operations across reopen, producer loss, root/config/graph
drift, unregistered producers, concurrent authority refusal and invalid enrollment.
These are synthetic supported-topology observations. They do not prove actual
production producer inventory, a remote runner lifecycle, native feature parity,
actual native checkpoint materialization, Restic recovery or installed daily scheduling.
The ordinary Pi/Codex custody tests belong to the separate physical-custody slice;
end-to-end authority composition remains required before #131 or #141 can close.
