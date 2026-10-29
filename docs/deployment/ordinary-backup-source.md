# Ordinary Host backup source composition

Source candidate for [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130)
and the [2026-10-29 trusted-root decision](../reviews/backup-trusted-root-20261029.md).
This does not install or enroll an existing production source.

The ordinary Host selects its private source configuration with
`PI_COFFEE_ORDINARY_SOURCE_PROFILE=/absolute/private/profile.json`. It requires
`PI_COFFEE_BACKUP_ROOT` and `PI_COFFEE_BACKUP_BROKER_CLIENT`. No browser request can
select a trust model, change the profile or supply a source qualification Boolean.
The optional historical managed profile remains separate; selecting both profiles
is an invalid configuration. Unconfigured Host execution retains its current path.

```json
{
  "schema": 1,
  "root": "/private/backup-authority",
  "configuration": "/private/source-configuration.json",
  "graph": "/private/source-graph.json",
  "sourceSocket": "/private/sealed-source.sock",
  "sourcePolicy": "/private/sealed-source-policy.json",
  "enrollment": { "mode": "fresh", "actor": "awangs" }
}
```

The profile is a bounded owner-private regular file. Authority configuration and
graph use `TrustedSourceAuthority`'s explicit producer/root contract. Its current
fresh bootstrap supports one actual `host` producer and allocates the declared
nonexistent source roots before ordinary scope construction. `mode: "none"` only
opens the authority; it never asserts that preexisting data has been enrolled.
An existing root, unestablished native custody, unresolved writer operation or
reopened authority remains unknown. Failing to enroll does not disable ordinary
work or independent repository extraction. Requalification must use the separate
certified producer/native lifecycle and native closure protocol; a marker, empty
process scan, stub command or a successful restart is insufficient.

Paths continue to come from existing Host settings and native configuration:
workspace, task data, Pi sessions and effective agent directory, Codex home and its
actual resolved SQLite home. The Host verifies these actual paths against the
source authority before declaring coverage. The source profile does not relocate
native roots, change HOME, network access, model configuration, Skills, runner
configuration, approval policy or sandbox mode. Source authority and backup stores
must be outside the source trees they protect.

One `NativeWriterCustody` and `PhysicalWriterFence` protect the shared native graph.
The authority's exact `writerFence('host')` is shared by the coordinator, scope
registries, native factories and ordinary writers. Real descendant custody holds
the shared physical lock; capture needs its exclusive counterpart. The existing
durable publication gate still fences an incomplete approved recovery. Browser
detachment preserves task execution; capture does not stop processes or shorten
the configured idle policy to create a cut.

Scopes loaded by the Host share one grouped recovery adapter. Every Pi/Codex member
and its historical native dependencies must resolve within that cut. Existing
configured backup scopes are prepared at startup; dynamically loaded scopes join
the same inventory. Unknown or unsupported members are not silently dropped from
a qualified shared group.

The named source endpoint uses the [independent key service's delegated producer
policy](trusted-root-backup-key-service.md#named-sealed-checkpoint-source). Source
capture and exporting an already sealed point remain independent. Configuration,
explicit recovery export, offline-copy verification and existing-point extraction
require current broker authority, not a live source cut or a managed profile.
Actual recovery publication still requires current destination qualification,
held physical exclusion, exact approval, conflict checks and durable intent.

HTTP `repository-backup` accepts an optional `checkpointId` together with `taskId`.
The Host validates that exact seal for the authenticated scope/task before invoking
the broker. A missing, foreign or damaged requested point fails without falling
forward. Existing clients without the field select the current existing seal once
and submit its exact ID; the operation never captures new live material. Independent
CLI and resumed schedules likewise retain explicit immutable checkpoint selection.

Startup enrollment of the source authority does not enroll the Host with the key
service, enroll a scheduler, or register the fixed key listener with the source
export policy. Those private live process identities remain explicit operator
configuration and must be refreshed through the approved lifecycle.
