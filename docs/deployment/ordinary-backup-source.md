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
`mode: "existing"` with an explicit administrator enables existing-data enrollment
and restart requalification. It requires an actual completed native history
lifecycle under the same custody and physical fence, checks every configured
scope and source root with the pinned Pi/Codex adapters, and seals an initial
complete checkpoint before committing enrollment. The coordinator is constructed
by this authority from actual Host Workspaces and native store descriptors.
`PI_COFFEE_BACKUP_MAX_BYTES`, `PI_COFFEE_BACKUP_MAX_FILES` and
`PI_COFFEE_BACKUP_CAPTURE_TIMEOUT_MS` also bound that initial enrollment.

An existing root in fresh-only mode, unestablished native custody or unresolved
writer operation remains unknown. Failing to enroll does not disable ordinary
work or independent repository extraction. A marker, empty process scan, stub
command or successful restart is insufficient. Earlier sealed points remain
readable after lowering the limits for new captures.

Paths continue to come from existing Host settings and native configuration:
workspace, task data, Pi sessions and effective agent directory, Codex home and its
actual resolved SQLite home. The Host verifies these actual paths against the
source authority before declaring coverage. The source profile does not relocate
native roots, change HOME, network access, model configuration, Skills, runner
configuration, approval policy or sandbox mode. Even the configured Codex
`--version` subprocess uses actual descendant custody and the same fence; its
five-second / 8 KiB observation budget does not release a surviving helper's
physical writer lease. Source authority and backup stores
must be outside the source trees they protect.

One `NativeWriterCustody` and `PhysicalWriterFence` protect the shared native graph.
The authority's exact `writerFence('host')` is shared by the coordinator, scope
registries, native factories and ordinary writers. Real descendant custody holds
the shared physical lock; capture needs its exclusive counterpart. The existing
durable publication gate still fences an incomplete approved recovery. Browser
detachment preserves task execution; capture does not stop processes or shorten
the configured idle policy to create a cut.

Scopes loaded by the Host share one authority-created grouped recovery adapter. Every Pi/Codex member
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

The actual Host subprocess tests exercise Pi and Codex without provider requests:
real native history, completed lifecycle, exact old seal selection while another
session is active, independent key listener/worker, Restic storage and extraction,
and a same-boot Host restart. These are isolated synthetic fixtures, not production
enrollment, a whole-machine reboot or installation of a daily service. See the
[composition evidence](../reviews/backup-ordinary-composition-20261029.md).
