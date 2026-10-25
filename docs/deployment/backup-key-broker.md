# Independent backup key broker candidate

Server #132 supplements the encrypted repository with a local service that owns
its keys. This document describes source and deployment prerequisites; it does
not install principals, services, permissions, mounts, credentials or tasks.

`BackupRepositoryClient` is the Host boundary. Its configuration contains only a
fixed Unix endpoint, expected service UID, authenticated actor, routed data scope
and authority revision. It imports no key-root reader. `BackupKeyService` and
`BackupRepository` run in the independent backup service. Host messages cannot
choose an executable, argument vector, source path, password path or destination.

## Current qualification

The service verifies its real UID and kernel process protection. Both its Python
transport and post-exec Node worker use non-dumpable mode and NoNewPrivs. The
backup service UID must differ from the Host and managed source UID. A fresh
SO_PEERCRED-authenticated source-owner RPC must report mechanically enforced
protected-only admission, naturally drained legacy lifetimes, current policy
revision and live kernel process identity. Missing, unknown, stale or same-UID
qualification refuses key activation; status still explains the exact boundary.
There is no `supported=true` switch.

The local trust base includes the kernel and human host-root administrator.
Host-root-capable model sessions must naturally drain before local activation, or
source/key authority must live outside their host-root domain. Existing tasks are
not stopped. A different UID alone cannot defeat host root. Future model launches
must use the actual managed namespace/writer gate, with no key/control socket,
host procfs, service bus, unrestricted network or privilege path exposed.

Development evidence proves actual namespace denial of a synthetic secret,
control socket, host process root, service bus and nested user namespaces, with
zero effective capabilities and NoNewPrivs. It also proves kernel peer checks and
same-UID activation refusal. **Distinct host-UID installation is unverified** on
this development account: no UID mapper or noninteractive administrative access
is available. This is an explicit remaining deployment prerequisite, not a
successful separate-principal test.

## Fixed local protocol

The Python `backup-unix-peer.py` transport reads Linux SO_PEERCRED on both ends,
checks socket ownership/inode, bounds request/response frames to 1 MiB, rejects
caller peer claims and duplicate JSON fields, allows four concurrent handlers,
and never logs bodies. The configured Node handler is fixed; messages contain no
shell command. Regular replies have one JSON envelope. Source transfers use
bounded NDJSON chunks and a separate aggregate limit.

Each request carries authenticated `context.actor` separately from
`context.dataScope`; neither is copied from Browser operation fields. The current
service-owned authority file specifies administrator, per-actor scope grants and
revision. The worker re-reads it for every operation, after source qualification,
and again after checkpoint transfer. Stale revisions, current role revocation,
unknown scope and ordinary foreign-scope requests fail closed. A user cannot gain
administrator access by being on a managed data route or holding a Host token.

Allowed control operations are status, jobs, qualification, configure, backup,
explicit recovery export/verification, rotation, interrupted-job recovery and named restore-material extraction.
Only explicit administrator export returns a recovery package. Status and errors
contain no secret. Mutation audit records actor, data scope, revision, operation,
result and time without request bodies or passwords. Web wiring must stream an
explicit administrator export as a protected no-store download; it is not a
regular status response or ordinary file grant.

The service's trusted configuration fixes destination and pinned Restic binary;
`configure` takes no request path. A backup selects only scope/task/checkpoint
identities. The fixed source service authenticates the backup principal, resolves
its own sealed checkpoint and exports the exact manifest/object tree. The
receiver stages it under a private per-request root, enforces path/type/order,
size/count and content bounds, rejects extras/truncation/identity mismatch, and
verifies the seal and every object before Restic. Plain transfer staging is
removed after the repository operation, including failure. Restic retains its
independent verified cgroup budget and native lock rules.

Restore material uses a bounded private five-minute export lease bound to the
current actor, routed scope and authority revision. The service extracts the
selected successful repository job privately, then streams only its named sealed
checkpoints over the authenticated endpoint. The Host supplies a new private local
staging directory to its client; that path never enters IPC. Each received manifest
and object is verified before publication. Closing the lease removes service
material under an exclusive kernel lock; expired completed leases can be collected
without racing active streams. Incomplete crash remnants remain private and count
against the eight-export capacity until an operator reconciles them.

## Installation templates and operator entry

[Service template](../../deploy/backup-key-broker/pi-coffee-backup-key.service),
[configuration example](../../deploy/backup-key-broker/config.example.json) and
[authority example](../../deploy/backup-key-broker/authority.example.json) are
reviewable source. Example UID numbers are placeholders, not discovered accounts.
The owner must provision distinct service principals, a socket-only shared
control group, backup-owned private key/state/destination directories, immutable
runtime paths and the dedicated backup account's user manager for engine scopes.
The source endpoint and future executor profile must actually qualify. No template
is automatically installed or enabled.

Keep key root and policy files private to the backup principal. The Unix socket
parent belongs to the service, has no other-user access, and grants only the
trusted Host/control group traversal; the socket is 0660. Never mount that parent,
the service user bus, or key root into a model namespace. Replacing the authority
file with a new revision is an operator action under the service principal; Host
configuration must use the corresponding current revision.

After the authorized owner installation, command shapes are:

```sh
node dist/src/backup-key-broker-cli.js serve --config /etc/pi-coffee/backup-key-broker.json
node dist/src/backup-key-broker-cli.js qualification --socket /run/pi-coffee-backup/control.sock --service-uid SERVICE_UID --actor awangs --data-scope ACCOUNT --revision REVISION
node dist/src/backup-key-broker-cli.js configure --socket /run/pi-coffee-backup/control.sock --service-uid SERVICE_UID --actor awangs --data-scope ACCOUNT --revision REVISION
node dist/src/backup-key-broker-cli.js export --socket /run/pi-coffee-backup/control.sock --service-uid SERVICE_UID --actor awangs --data-scope ACCOUNT --revision REVISION --output NEW_PRIVATE_OFFLINE_COPY.json
```

Export creates a new 0600 file and never prints the package to stdout. `verify`
accepts `--recovery PRIVATE_COPY`; `backup` accepts a private selection file;
`status`, `rotate` and `recover` use the same authenticated control context.
Listener startup refuses an existing endpoint and never unlinks a different
service's socket. Control disconnect is not cancellation of a durable job.

Root integration still owns main/Web/Browser wiring, current authority policy
lifecycle and source/scheduler/restore composition. Existing application gates
remain until actual qualification. No production or separate-UID acceptance is
claimed by these private synthetic protocol tests.
