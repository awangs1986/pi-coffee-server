# Trusted-root repository service candidate

The accepted 2026-10-29 boundary trusts the existing Host root and preserves native
permissions. This candidate keeps the repository/key worker independent without
requiring a managed native namespace or a separate VM. It does not claim secrecy
against root or malicious processes tampering with same-UID private files.
Ordinary application/model interfaces receive no repository key. Explicit current
administrator recovery export remains a separate authorized operation.

## Service readiness and source consistency

The private `BackupKeyServiceConfig` may select `trustModel: "host-root"`.
Only trusted operator configuration selects this mode; requests and browser inputs
cannot do so. Existing configs without that field retain their historical managed
qualification behavior during migration.

In the trusted-root mode, `qualification` reports `trustModel: "host-root"` and
`sourceConsistency: "per-checkpoint"`. Its `qualified` state means the independent
service boundary is ready, not that every task has a consistent checkpoint.
Repository configuration, explicit key export/offline-copy verification,
existing-point extraction, retention and recovery pins do not require a current
managed source handshake. Existing destination checks, offline-copy activation,
Restic pin/resource limits and current policy authorization remain enforced.

New backup selections require an `expectedCheckpointId` on every scope/task entry.
The key worker consumes only that named sealed checkpoint through bounded IPC and
verifies complete member scope, exact identity, manifest and objects. It never
accepts a live path or a caller-provided consistency Boolean. Changing a live
source revision after sealing does not invalidate an immutable older point.
This change implements no new source capture proof; ordinary source consistency
remains independently required before a new checkpoint can be sealed.

## Explicit trusted backend enrollment

The private, operator-maintained `BackupBrokerPolicy.hostClients` contains one or
more live backend identities:

```ts
{ pid: number, uid: number, boot: string, birth: string }
```

`boot` is the current kernel boot ID and `birth` is the process start-time field
from `/proc/PID/stat`. Up to 32 identities may be enrolled. These are the actual
Host/scheduler processes, not their model children or arbitrary CLI descendants.
There is no self-registration endpoint or request-body PID override.

The client now opens Unix IPC in its actual Node process. For trusted-root mode,
the fixed listener passes the accepted socket descriptor to the worker. The
worker reads the request from that socket and obtains its actual kernel peer
credentials; it rejects supplied `_peer` fields. Direct worker invocation with
forged stdin metadata is refused. Every service operation checks the enrolled
PID, UID, boot and birth identity against the live process, then checks current
application actor, role, routed scope, selected scopes and authority revision.
Recovery-pin heartbeats repeat these checks. UID equality, root UID, process
ancestry and a claimed administrator body do not themselves grant an application
administrator role.

Restart changes a backend's identity: the operator must replace its enrollment
before it can use the service again. A persistent independent scheduler must have
its own enrollment. An ephemeral CLI process is not automatically authorized by
being launched by an enrolled process; a separately approved enrollment or trusted
backend integration is required. This slice does not install or automate that
startup wiring. Policy files remain private and actor/scope revocation remains
independent of enrollment.

Key-worker hardening is local to that independent process. The client does not
harden the Host, set its no-new-privileges bit, or alter native environments, sudo,
Git, gh, network or runtime permissions.

## Integration and evidence boundary

`BackupRepositoryClient` retains its public methods. Unary calls, pin leases and
restored-checkpoint streams use direct peer IPC; no model-visible credential was
added. `BackupCheckpointReceiver.directPeer` selects the same transport when the
caller must retain its real process identity. The private source-export service
remains a separate integration boundary.

Host/scheduler wiring must select and pass each existing sealed checkpoint ID;
a missing ID is rejected in the new mode. Historical named points must remain
exportable after a newer point appears. Source export must retain named scope,
member, path and stream validation. Restore publication still requires the
approved current plan and destination writer/conflict protocol; extraction does
not authorize publication.

Synthetic tests exercise an actual independent listener/worker and pinned Restic,
including configuration without a source listener, offline verification,
source-offline extraction/pins, raw same-UID peer refusal, forged-worker-stdin
refusal and live enrollment/actor revocation. Synthetic sealed-source fixtures
prove transport and repository behavior only. They do not prove production
Pi/Codex capture, install the service, or establish complete backup coverage.
