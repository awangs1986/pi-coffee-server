# Task backup and recovery

**2026-10-29 owner decision:** preserve existing native permissions and trust
existing Host root. Version one covers accidental deletion, corruption and
source-disk loss; it does not defend against Host-root execution. No mandatory
namespace/no-sudo/no-network profile or external root-proof key authority is
required. Normal interfaces must not disclose keys; application administrator,
account authorization and complete source consistency remain mandatory.
See the [accepted trust boundary and remaining implementation gates](../reviews/backup-trusted-root-20261029.md)
and [historical permission review / actual failed canonical check](../reviews/backup-native-permission-20261028.md).
Storage, scheduling and recovery component passes do not close source integration.
See [ordinary-source integration evidence and remaining gates](../reviews/backup-ordinary-source-20261029.md)
for the current candidate; historical managed-profile results retain their original scope.

The accepted complete product contract is [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130), with implementation slices #131–#134 and #138–#141. The candidate implementation covers source checkpoints, the encrypted repository, Pi/Codex recovery, scheduling, retention and account plans. The reviewed work is on `feat/backup-pi-codex-130` and its normally merged implementation branches, initially based on `33306539b6f5d86ae67178f4361f7c82bd6d5a9a`, with GitHub/Gitea main `21f856b60c99b1c06bb312743ba69a4a9f69868c` normally merged. The ordinary-source composition baseline is `de1e857`; `3bbf0e6` identifies the retained earlier failed canonical run, not the current candidate. Source behavior and isolated acceptance do not establish installed daily protection or complete production coverage. Final integrated acceptance remains #141.

## Checkpoint first

A source checkpoint is immutable task material captured at a verified consistency-group cut. A repository backup job later saves this material. Job completion does not change `captureAt`. Host and active Agent tasks keep running; new writers revoke capture before side effects. Busy groups retain their previous sealed point. No point means unprotected, and point age over 24 hours is stale.

Host owns `BackupCoordinator`; native source layout is encapsulated by versioned `NativeRecoveryAdapter`. Trusted local jobs consume `sealedCheckpoint`, which validates the seal and streams object hashes. Browser status reads cached bounded metadata, without starting native processes or hashing the whole repository on every refresh. A seal is source-capture evidence; it does not claim repository integrity or a completed restore drill.

## Accepted ordinary-permission architecture (source candidate)

Repository readiness and access to existing sealed points are independent of
live source qualification. Exact selected checkpoint IDs, immutable manifests,
complete members, hashes, current actor/scope authority and original capture ages
remain required. Restore publication independently requires an approved plan and
destination writer exclusion.

A missing source history is not a prerequisite for restoring that history.
Ordinary Pi/Codex planning and publication now use a separate
[restore destination capability](../development/restore-destination-authority.md):
current application authority, exact configured scope/root/producer identities,
unchanged journal and real physical exclusion remain mandatory. Tagged dead-local
operations remain recorded, not cleared by recovery. Fresh destination allocation
can prove a never-launched custody directory without fabricating a native
observation. Replacement still needs a fresh source safety point. Original path
mapping, approved revision/digest, conflict preimages and the durable publication
gate remain required. Restoration then returns to actual native auditing and
source capture; destination qualification never serves as a source-cut claim.

Source qualification requires actual writer admission and descendant lifetime
leases plus an explicit, verified producer/delegation topology. Root trust does
not prove a cut; an empty FD scan, matching hashes or a Boolean cannot certify
coverage. Unknown source writers remain visible without restricting their native
execution. First and later Pi/Codex points and restoration must pass with existing
permissions before this feature is complete. See the [decision](../reviews/backup-trusted-root-20261029.md).

## Current ordinary source-capture boundary

The Pi 1.1.0 / JSONL v3 and Codex 0.159.1 adapters participate in
`TrustedSourceAuthority` through the actual ordinary Host composition. The
private ordinary source profile explicitly declares roots, producer inventory,
application authorization and fresh/existing enrollment mode. The accepted
operating assumptions are trusted Host root and complete admission integration
for every source producer. They do not establish arbitrary daemon or remote
writer coverage. Unaccounted producers, replaced roots, incomplete graphs and
uncertain custody remain unqualified while ordinary execution stays available.
See [configuration and actual main evidence](../deployment/ordinary-backup-source.md).

Existing-source enrollment requires current administrator/role/scope/revision,
actual native history evidence, complete current source closure and a new sealed
checkpoint under the exact physical exclusive lease. It cannot be enabled by a
marker, supplied PID list, empty scan, hash or Boolean. Cold data can be inspected
without opening a viewer or submitting a prompt: backup owns a bounded Pi
SessionManager SDK reader or independent Codex `thread/read` connection. It
preserves native history/settings and closes only its own helper. New user work
cancels this audit and takes priority. Pi SDK parsing is not RPC resume or provider
continuation. See [owned-reader contract](../development/native-source-handoff.md#unattended-owned-native-audit).

Native and ordinary Git descendants retain real shared locks even after their
request process exits. An idle live user native process remains a writer; backup
does not stop it or shorten its idle policy to obtain a cut. The configured shared
native group uses one fence across scopes. `GroupedRecoveryAdapter` materializes
all registered in-scope members under one physical lease, then publishes one
manifest/checkpoint/capture time with member-owned sources. Restore verifies the
original group seal before projecting a selected member. Independent captures
cannot be combined by copying timestamps or renaming group IDs.

A Host restart requires requalification. Schema2 custody binds actual kernel boot
and command identity. Tagged local pending operations may reconcile only after
their exact previous owner is proven gone, current native evidence and complete
capture pass, and a durable reconciliation receipt is recorded before the atomic
journal update. Legacy/unowned/delegated/live/uncertain operations are retained;
callbacks are never replayed. Prior-boot fixtures have been simulated, but no
real machine reboot has been tested. Receipt history remains intact and scanning
is O(total receipts); an archive/index protocol is future work, not an implemented
scalability guarantee. See [reconciliation](../development/trusted-source-authority.md#interrupted-local-host-operation-reconciliation).

The historical managed namespace profile remains optional and separately gated.
Its distinct-identity/read-only-device installation evidence is not a prerequisite
of the accepted ordinary-permission design. Neither profile is installed by
setting a Browser option, and no existing production account is claimed protected.

A short synchronous seal publication linearizes the checkpoint against new JavaScript writer admissions. Registry changes, Git/workspace operations, durable queue writes, uploads, MISHU state/memory persistence and native process admissions use the same fence when enabled. Native lifetime custody is separate from source provenance: neither is sufficient alone. A fresh, incomplete, replaced or unowned ledger, an unmanaged writer, or an unsupported source dependency fails closed.

Pi source closure includes current/retained native bindings, native `parentSession` chains inside the owned store, Harness artifacts, workspace files including uncommitted content, task attachments/artifacts, authoritative task/project registry material and pending inputs as notes-only recovery material. The manifest records native adapter/runtime versions, group epoch, per-source recovery keys, native IDs, sizes, modes and checksums. Physical source paths are not exposed in Browser status. Authentication material is not a restore authority; provider reauthentication is required.

Source closure requires an explicit owned Pi agent directory. Standard settings/models/model-catalog files, global instruction files and private prompts/skills/themes have versioned source mappings. Authentication is omitted from restore authority; configuration that embeds credentials must be sanitized/reprovisioned by the restore adapter. External resources, custom extensions and packages without an exact immutable artifact mapping remain incomplete. Legacy global configuration cannot be adopted implicitly. External Git storage/alternates, external/absolute symlinks and hardlinks, unresolved historical bindings outside the supported Pi/Codex graph and unsupported MISHU source schemas/dependencies also fail closed. Versioned MISHU notes, retained binding/revision history, candidate evidence, questions and archived answers are projected as inert `platform/mishu/notes-only-v1` material; [capture details](../reviews/backup-mishu-source-candidate.md) define the mandatory no-authority restore policy. MISHU permission/execution state is never silently copied as restorable authority. Existing source directories cannot be adopted or migrated by adding a marker; explicit existing-source qualification above is required. An unconfigured or unqualified ordinary Host remains visibly unprotected. Preserving unrestricted native permissions is compatible with qualified capture under the accepted producer assumptions; it is not itself a reason to reject every new task. No production account has been enrolled or accepted by these synthetic tests.

## Interfaces and enablement

`GET /api/backup` uses the existing authenticated Web-to-Host user scope and lists only that user's tasks. The settings menu's Task backup dialog shows state, checkpoint identity, capture time, age, coverage and reasons. Ordinary users can read their own status. Administrator `awangs` is authorized by the authenticated actor forwarded by Web, independently of the routed data scope. Legacy owner routing retains its original default store; its reserved backup scope cannot collide with a real account named `default`. Browser-supplied actor/scope headers do not grant authority. The administrator can request or cancel capture; explicitly configured managed account names can be selected for administration. Unrecognized account/path input is rejected.

`get_backup_status` over the authenticated Host WebSocket returns the same own-scope protection rows; client-supplied foreign scopes are ignored.

`POST /api/backup` supports capture/cancel by task identity and administrator status selection by managed scope. Web applies its normal authenticated route and Origin policy. Capture is bounded to one coordinator operation, 30 seconds, 1 GiB and 100,000 source objects by default; new work has priority. Private checkpoint staging is not published or reused after restart. Trusted consumption verifies sealed materials; corrupted/partial points are not handed to the repository worker.

`PI_COFFEE_BACKUP_ROOT` opts into private source ledgers, shared native custody, writer fences and the coordinator. It must be outside all live source trees. `PI_COFFEE_BACKUP_USERS` is the comma-separated data-scope administration allowlist (routing scope IDs such as `gitea-2`, with `__legacy_default__` for the legacy source), rather than display login names. The actor's own routed source is available without selecting a different scope. Existing runtime behavior is preserved when capture is not configured. Configuring source capture alone does not install the independent daemon or enable repository writes. A scoped Unix broker connection and verified offline recovery copy are required. Normal Host startup constructs no direct key-root repository fallback. The source Host refreshes seals at natural cold windows without provider requests; repository scheduling consumes existing seals independently.

The [fixed-role startup launcher](../deployment/ordinary-backup-startup.md)
accepts only a private profile and `key`, `host`, `scheduler` or `cli` role. It
refreshes actual process identities under permanent role locks and a durable
policy-update journal. It preserves application roles/scopes/revisions and
refuses live duplicate roles or unknown replacement listeners. Host startup and
ordinary task creation remain available during a temporary key-service outage;
backup readiness still reports the outage. Operator policy edits must take the
same `policy.lock` or stop startup attempts; arbitrary external file edits are
not protected by a compare-and-swap guarantee. The source/key sockets publish
through distinct private staging names with durable owner/inode evidence and
no-replace linking. Recovery reclaims only proven-dead, matching, connection-refused
owned endpoints. Templates do not install services or make Host depend on a
backup unit. See [startup evidence](../reviews/backup-ordinary-startup-20261029.md).

## Candidate components and acceptance gates

- #132 implements the pinned local Restic repository, actual authenticated read-back, target identity checks, offline key copy/rotation and independently capped engine workers. [Repository contract](../deployment/task-backup-repository.md).
- #133/#134 implement reviewed Pi 1.1.0 JSONL-v3 and Codex 0.159.1 native-store recovery, current authorization, revision/digest approval, original identity and missing-only default. Explicit replacement requires a fresh repository-read safety point and exact current preimages. [Recovery contract](../development/task-recovery.md).
- #138 implements the independent daily daemon and persistent scoped incidents. #139 implements exact administrator retention plans and bounded real recovery pins. #140 implements account checkpoint vectors and retained-date browsing. [Schedule](../deployment/backup-schedule.md), [retention](../deployment/backup-retention.md).
- Publication first acquires the task lifecycle lane and an actual physical exclusive group lease. Registry, every staged/target preimage and native merge conflicts are checked without changing live sources. Only then are the durable group gate and publication intent recorded; MISHU authority retirement and display/index invalidation run under that same exact operation/digest/lease capability before native and registry writes. A rejected untouched plan can be revised or cancelled without freezing healthy neighboring writers. Once intent or side effects exist, the gate remains durable after process/kernel-lease death until the same approved job rolls forward. Pending startup reads preserve authoritative registry preimages; generic writers cannot impersonate that capability.
- Pi tasks sharing a native parent bind shared material to one approved publisher. A selected missing task may retain a healthy registered neighbor's parent only with exact current registry/native-chain ownership and inode/content witnesses, rechecked at publication. An unknown file with identical bytes is still a conflict.
- The separate historical managed-profile cold enrollment and its concrete private maintenance wiring implement verified frozen-source capture, typed relocation, repository-read verification and approved account publication. An operator may supply an existing immutable sealed export or a fixed Pi/Codex source profile in a real read-only legacy namespace view; the software does not create snapshots or retire active production execution itself. Unknown roots remain unavailable. A marker, hash or caller-supplied Boolean cannot establish exclusive writer control. Real read-only block-backed and distinct-identity installation acceptance remains unverified. See [cold enrollment](../deployment/cold-legacy-enrollment.md).
- #141 must reconcile all 45 stories and ticket criteria, canonical checks, actual Browser/Host paths, test audit, independent review and fresh checkout evidence. Distinct-UID installation and read-only snapshot/device qualification remain unverified historical managed-profile tests, not prerequisites of the accepted trusted-root design. Ordinary-permission first/later cuts, existing cold sources and same-boot Host restart have isolated real-native evidence. Final integrated capture/repository/native-recovery acceptance and provider continuation are separate gates; no provider turn was authorized or executed. Production activation/recovery requires separate authorization.

Claude, Cursor and Grok remain explicitly deferred/excluded. Their current execution implementations remain available; their writers/dependencies cannot be ignored when they affect an in-scope source.

## Independent schedule candidate (#138)

`BackupJobRunner` persists local-date/revision dispatches, three bounded attempts
(initial, +15, +60 minutes), worker observations and scoped incidents. An
independent CLI daemon polls every 30 seconds without Web, a browser or a model.
It consumes the authenticated Host task inventory and only sealed source points;
repository coverage uses confirmed successful saved points. An outage retains
last confirmed metadata and visibly marks coverage unknown. Original capture
age is separate from job completion and worker observation. Shared kernel leases
and stable repository request IDs reconcile controller death and response loss.
Ordinary status is scope-owned; only the authenticated administrator may update
a plan within the trusted managed allowlist. See [configuration and operational
limits](../deployment/backup-schedule.md). This candidate is not production activation. Retention and account recovery are
implemented source components; their final integrated acceptance remains #141.
