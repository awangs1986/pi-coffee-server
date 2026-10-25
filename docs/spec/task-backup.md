# Task backup and recovery

The accepted complete product contract is [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130), with implementation slices #131–#134 and #138–#141. This source candidate begins #131; it is not a release or a claim that encrypted daily backups or restore publication are implemented.

## Checkpoint first

A source checkpoint is immutable task material captured at a verified consistency-group cut. A repository backup job later saves this material. Job completion does not change `captureAt`. Host and active Agent tasks keep running; new writers revoke capture before side effects. Busy groups retain their previous sealed point. No point means unprotected, and point age over 24 hours is stale.

Host owns `BackupCoordinator`; native source layout is encapsulated by versioned `NativeRecoveryAdapter`. Trusted local jobs consume `sealedCheckpoint`, which validates the seal and streams object hashes. Browser status reads cached bounded metadata, without starting native processes or hashing the whole repository on every refresh. A seal is source-capture evidence; it does not claim repository integrity or a completed restore drill.

## Current source-capture boundary

The Pi 1.1.0 / JSONL v3 adapter maps private sources and records provenance plus managed native process custody. These mechanisms do not establish exclusive control over every future source write: existing OS daemons and unrestricted same-UID tools can launch writers outside the supervised descendant tree. Therefore the actual startup source proof fails closed with `writer-enforcement-unqualified` even for newly allocated sources with intact receipts. There is no environment flag or receipt-only bypass. Synthetic tests attest only the controlled fixture writer set; they are not production isolation evidence. Linux subreaper custody includes managed descendants that double-fork or change session. The configured shared native group uses one fence across scopes. An idle live native process remains a writer; only ordinary lifecycle exit with all descendants gone can establish its cold window. Backup never stops the native process to make that window.

A short synchronous seal publication linearizes the checkpoint against new JavaScript writer admissions. Registry changes, Git/workspace operations, durable queue writes, uploads, MISHU state/memory persistence and native process admissions use the same fence when enabled. Native lifetime custody is separate from source provenance: neither is sufficient alone. A fresh, incomplete, replaced or unowned ledger, an unmanaged writer, or an unsupported source dependency fails closed.

Pi source closure includes current/retained native bindings, native `parentSession` chains inside the owned store, Harness artifacts, workspace files including uncommitted content, task attachments/artifacts, authoritative task/project registry material and pending inputs as notes-only recovery material. The manifest records native adapter/runtime versions, group epoch, per-source recovery keys, native IDs, sizes, modes and checksums. Physical source paths are not exposed in Browser status. Authentication material is not a restore authority; provider reauthentication is required.

This supported configuration requires an explicit owned private Pi agent directory. Standard settings/models/model-catalog files, global instruction files and private prompts/skills/themes have versioned source mappings. Authentication is omitted from restore authority; configuration that embeds credentials must be sanitized/reprovisioned by the restore adapter. External resources, custom extensions and packages without an exact immutable artifact mapping remain incomplete. Legacy global configuration cannot be adopted implicitly. External Git storage/alternates, external/absolute symlinks and hardlinks, unresolved non-Pi historical bindings and unsupported MISHU source schemas/dependencies also fail closed. Versioned MISHU notes, retained binding/revision history, candidate evidence, questions and archived answers are projected as inert `platform/mishu/notes-only-v1` material; [capture details](../reviews/backup-mishu-source-candidate.md) define the mandatory no-authority restore policy. MISHU permission/execution state is never silently copied as restorable authority. Existing source directories cannot be automatically adopted or migrated by adding a marker. The default unrestricted runtime remains visibly unprotected, including new tasks. This candidate does not claim that either existing account has complete coverage or that a production writer-enforcement provider is implemented.

## Interfaces and enablement

`GET /api/backup` uses the existing authenticated Web-to-Host user scope and lists only that user's tasks. The settings menu's Task backup dialog shows state, checkpoint identity, capture time, age, coverage and reasons. Ordinary users can read their own status. Administrator `awangs` is authorized by the authenticated actor forwarded by Web, independently of the routed data scope. Legacy owner routing retains its original default store; its reserved backup scope cannot collide with a real account named `default`. Browser-supplied actor/scope headers do not grant authority. The administrator can request or cancel capture; explicitly configured managed account names can be selected for administration. Unrecognized account/path input is rejected.

`get_backup_status` over the authenticated Host WebSocket returns the same own-scope protection rows; client-supplied foreign scopes are ignored.

`POST /api/backup` supports capture/cancel by task identity and administrator status selection by managed scope. Web applies its normal authenticated route and Origin policy. Capture is bounded to one coordinator operation, 30 seconds, 1 GiB and 100,000 source objects by default; new work has priority. Private checkpoint staging is not published or reused after restart. Trusted consumption verifies sealed materials; corrupted/partial points are not handed to the repository worker.

`PI_COFFEE_BACKUP_ROOT` opts into private source ledgers, shared native custody, writer fences and the coordinator. It must be outside all live source trees. `PI_COFFEE_BACKUP_USERS` is the comma-separated data-scope administration allowlist (routing scope IDs such as `gitea-2`, with `__legacy_default__` for the legacy source), rather than display login names. The actor's own routed source is available without selecting a different scope. Existing runtime behavior is preserved when capture is not configured. Configuring this does not enable daily repository backup, retention or restoration.

## Remaining implementation gates

- #132: encrypted incremental repository, offline recovery package and repository verification.
- #133: approved/idempotent Pi restore, native remapping and safe publication; no pending prompt or historical privilege replay.
- #134: complete Codex native graph, custody, capture and recovery.
- #138–#141: daily 04:00 America/Toronto schedule, persistent alerts, retention, account restore and final verification.
- Complete coverage of existing two-account task sources remains unmet while source provenance/configuration dependencies are unknown. A sealed point in a controlled synthetic Pi fixture is not production or whole-account acceptance.

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
limits](../deployment/backup-schedule.md). This candidate is not production
activation or completion of retention/account recovery and final acceptance.
