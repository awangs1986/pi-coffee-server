# Encrypted checkpoint repository (candidate #132)

This is source implementation, not an activated production backup. Native source
qualification, secret isolation from unrestricted model processes, scheduler and
restore publication remain independent release gates. No service, disk mount or
production secret is installed by this change.

## Supported backend

Linux amd64 Restic **0.19.1**, repository format 2, local filesystem backend only.
The executable is selected by an absolute Host configuration path; neither PATH
search nor a browser-supplied executable is accepted. Each command streams SHA256
verification against the reviewed pin.

- Upstream release: <https://github.com/restic/restic/releases/tag/v0.19.1>
- Archive: `restic_0.19.1_linux_amd64.bz2`
- Archive SHA256: `f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c`
- Executable SHA256: `20d4142678d0d95ec11a4759def1b73fd9190abc9ca19e4b62d067c0b387e639`
- Upstream `SHA256SUMS` SHA256: `fb520966ee01d2a3d4219c66762c66efa56300833b6f639f36082b7462f91cb8`
- Upstream checksum signature fingerprint:
  `CF8F18F2844575973F79D4E191A6868BD3F7A907`, key obtained from
  <https://restic.net/gpg-key-alex.asc>. The signature verifies; key identity is
  anchored to that HTTPS source, not an independently established web of trust.

Installation is an explicit operator step: download that release's archive,
`SHA256SUMS` and signature over HTTPS; verify signature and archive checksum before
decompression, then verify the executable checksum above. Keep the executable
non-writable by group/others. Do not substitute the historical 0.18.0 probe binary.
No automatic installer/download or package manager mutation is performed.

The [2026-10-25 scoped dependency review](../reviews/restic-0191-security.md) checks exact upstream `go.mod` and bundled Go1.26.4
against OSV. Upstream's repository advisory page has no published advisories, but
transitive module/stdlib queries **do** return advisories. This is not an
advisory-free artifact. The supported operation surface excludes network backends,
servers, FUSE mounts, templates, user dictionaries and external helper commands.
Keep the detailed scoped reachability review with release evidence and recheck
advisories before activation; enabling remote transports invalidates this review.

## Operator flow

Build with Node22 and `npm ci && npm run build`. The following are command shapes,
not instructions to activate production during development. `ROOT` is a private
Host-owned backup control directory outside task/native roots and outside the
backup destination. `DISK` already exists, belongs to the backup worker and has no
group/other access. The application never creates a missing destination or mounts,
formats, adopts an existing repository, or falls back to a system-disk path.

```sh
node dist/src/backup-cli.js configure --root ROOT --destination DISK --binary PINNED_RESTIC
node dist/src/backup-cli.js export --root ROOT --output NEW_PRIVATE_OFFLINE_COPY.json
node dist/src/backup-cli.js verify --root ROOT --recovery PRIVATE_OFFLINE_COPY.json
node dist/src/backup-cli.js run --root ROOT --scope ACCOUNT --task TASK_ID
node dist/src/backup-cli.js status --root ROOT --scope ACCOUNT
```

Export creates a new 0600 file and never writes a recovery package to stdout.
Save it independently of the system disk, keep it private, then provide the saved
copy back to verification. The repository remains disabled until this copy can
decrypt its repository identity and pass an authenticated complete repository read in
an isolated temporary HOME without the source password. Losing every key copy
makes the encrypted data unrecoverable. The package contains the repository
locator/identity, backend checksum, secret and compatibility/recovery instructions.

An offline drill needs no original runtime directory, Web, Host, model, or source
secret; an explicitly relocated mounted directory is accepted only if the supplied
copy decrypts the recorded repository ID:

```sh
node dist/src/backup-cli.js verify-offline --recovery PRIVATE_OFFLINE_COPY.json --destination DISK --binary PINNED_RESTIC
```

For a scheduled all-task selection, `run --root ROOT --selection PRIVATE_JSON`
accepts an array of `{ "scope": "ACCOUNT", "taskId": "TASK_ID" }`. It consumes
only `ROOT/checkpoints/sealed` through BackupCoordinator's verified boundary.
It cannot capture live native sources or publish restored tasks.

The current application wiring refuses repository administration with a visible
activation-unavailable diagnostic: unrestricted models share its UID, so no
enforceable key boundary has been qualified. There is no environment Boolean
that overrides this gate. The trusted standalone worker/CLI service must run
under a separately enforced credential/namespace boundary before production use.
The synthetic fixture workflow exercises that service without running models.

Host status wiring is opt-in via `PI_COFFEE_BACKUP_ROOT` and absolute
`PI_COFFEE_RESTIC_BINARY`. The authenticated administrator (default `awangs`) can
configure an existing destination, explicitly download/verify a recovery package,
and back up selected managed scope checkpoints through `/api/backup`. Ordinary
users see only their own repository points/jobs and no key, native bindings,
repository locator or execution control. The Browser dialog starts no polling
while closed. Source checkpoint age is never replaced by job time.

## Failure and recovery contract

The runtime records private destination directory inode/device/owner and Linux
mount identity, and separately records repository directory identity. Every
command checks identity, pins the directory by inherited descriptor, and bypasses
no Restic lock. Missing/replaced/unmounted destinations fail closed. Free space is
checked against selected sealed bytes plus a 32 MiB margin; this is a conservative
admission check, not a promise that the filesystem cannot fill during execution.

Every Restic command runs in an independent transient user scope with a 1 GiB
memory ceiling, no swap, one CPU quota and 64 tasks. IO weight 10 is requested;
where the kernel does not delegate an IO controller, idle IO scheduling still
is required and checked, alongside nice15. The supervisor
checks the actual cgroup limits before it accepts execution; unavailable enforcement
refuses execution. It never falls back to the Host cgroup. Raw key envelopes also
have bounded sizes and scrypt parameters before engine execution.

Each job is durably written before repository work. Success requires a real Restic
summary, tagged snapshot discovery, complete authenticated repository read,
isolated restore, sealed manifest digest and exact object-tree verification.
Nonzero native exits, write limits, cancellation, changed destination and corrupt
packs cannot become a successful journal. A partial or orphan snapshot is not a
successful recovery point merely because it exists.

The independent command supervisor receives permission to launch Restic only after
its process birth identity and operation nonce are durable. A killed controller
therefore leaves a live worker detectable. Recovery refuses a live/unknown owner,
supervisor or process group; it checks operation directory inode and nonce before
reclaiming its own lock. It never uses `--no-lock` or `unlock --remove-all`.

```sh
node dist/src/backup-cli.js recover --root ROOT
```

Recovery uses Restic's normal stale-lock cleanup, then reconciles each unfinished
job's exact tagged snapshot. A complete repository read plus isolated sealed-tree
verification must pass before an ambiguous completed snapshot can be committed as
success; otherwise the job remains failed or the operation refuses safely.

Recovery key rotation uses `rotate --root ROOT` or the protected administrator
control. It generates a new independent password, atomically switches the runtime
secret pointer and disables backup until a new offline copy is exported/verified.
Only then are the recorded previous Restic key and its runtime password retired.
Export, rotation, verification and revocation have audit events without secrets.
Old offline copies cannot decrypt after this verified retirement.

The trusted `extract(jobId, newPrivateDirectory, optionalOfflineCopy)` service API
restores and authenticates a successful point into a **new** directory. It does
not replace Host registries, grant native execution, resume tools, restore roles,
or bypass the later restore planner's current authorization/compatibility checks.

0600/0700 storage and no key in status/logs do not by themselves isolate secrets
from an unrestricted model shell sharing the Host's UID. Activation must qualify
a worker/native namespace or credential boundary that actually denies that read;
do not call this production model-secret isolation based only on file modes.

## Reproduction

`npm run build` prepares the independent supervisor. Ordinary tests refuse
unreviewed binaries and exercise scoped HTTP/Browser permissions. Real engine
acceptance is explicit:

```sh
PI_COFFEE_TEST_RESTIC=/absolute/verified/restic node node_modules/vitest/vitest.mjs run test/backup-repository.test.ts
```

The synthetic private test covers encrypted baseline/unchanged/changed snapshots,
offline copy verification with source password removed, CLI operation without Web,
old-point restore, undeclared sealed files, missing/replaced targets, real
RLIMIT_FSIZE write failure, actual native-lock controller death and surviving
worker refusal, encrypted-pack corruption, and recovery-key rotation/revocation.
RLIMIT_FSIZE is a write-failure simulation, not a real disk capacity/media test. Private
directory identity tests are not a physical disk or power-loss qualification.
