# Backup retention candidate (#139)

This is source-candidate documentation, not an installed cleanup service or a
production deletion receipt. Use isolated repositories for development. Production
activation, identity qualification and restore acceptance remain separate gates.

## Preview and explicit execution

The authenticated backup administrator (`awangs`) opens the backup panel and selects
a managed account. “预览当前账号保留计划” produces a durable plan containing exact
snapshot identities, keep reasons, scope, time zone, revision and approval digest.
No deletion starts on preview. Download the JSON when the list exceeds the display
limit, then use “批准并执行此计划” to approve that concrete revision. Ordinary users
cannot preview or execute cleanup and receive no pin/retention administration data.

The independent CLI supports the same concrete approval:

```sh
node dist/src/backup-cli.js retention-preview --root ROOT --broker-profile PRIVATE_CLIENT --scopes '["alice","bob"]' --time-zone America/Toronto
node dist/src/backup-cli.js retention-status --root ROOT --broker-profile PRIVATE_CLIENT --scope alice
node dist/src/backup-cli.js retention-execute --root ROOT --broker-profile PRIVATE_CLIENT --plan PLAN_ID --revision REVISION --digest APPROVAL_DIGEST
```

`PRIVATE_CLIENT` is the administrator's scoped Unix broker client profile; Host
HTTP connections use their actual authenticated actor and selected data scope.
The Host never needs repository passwords for these controls. A trusted standalone
repository administrator may use `--root ROOT` instead; do not give that private
key root to ordinary Host/model processes. Saving a schedule does not install a
retention daemon, and cleanup is never implicitly enabled by opening the panel.

## Policy and active recovery protection

For each selected scope the policy takes the union of the latest 30 local civil
days, 12 Monday-based weeks and 12 calendar months containing verified points.
The newest original `captureAt` represents each period. Job finish time does not
promote old captured material. The default time zone is `America/Toronto`;
year/week boundaries and repeated daylight-saving hours use that zone.

Every task's last verified point is additionally kept, including archived tasks.
Unknown/unverified snapshots and material outside the selected scopes are kept.
A different account's activity cannot remove another account's only point. Mixed
snapshots retain all their blocks if any keep reason applies. Deferred engines
(Claude/Cursor/Grok) are not counted as protected Pi/Codex material.

Restore pins bind an operation/revision to an existing verified repository job.
Their default and maximum expiry is 24 hours. A running recovery holds permanent
kernel-lock file descriptors with an active lease bounded to 30 minutes. Even if
the receipt expires or release is requested, live descriptors keep the snapshot.
The authenticated broker streams a heartbeat; lost/expired leases prevent further
publication. A caller must check the lease at material and publication boundaries.
The UI exposes expiry, release request and active protection separately.

## Staleness, crash and audit

Execution holds repository exclusion and compares the current catalog/pins with
the approved preview. A new snapshot or pin makes a preview stale: preview again
instead of extending deletion beyond the approved identities. Cleanup runs exact
`forget` identities, `prune`, then an authenticated `check --read-data`. Deleted
jobs become retired and disappear from eligible recovery points.

Durable plan phases record interruption. “核对并继续此计划” reconciles actual
remaining snapshots before continuing the same approved identity set; new active
references protect remaining targets and can require a fresh plan. It never adds
new deletion candidates. Kept points must still restore after cleanup; a Restic
exit code alone is insufficient acceptance.

A killed recovery controller can itself restart: its permanent kernel lock is
released by the kernel. Legacy unknown recovery-lock directories are preserved
and rejected rather than deleted. Repository recovery also refuses a live or
unknown operation owner/worker and uses only Restic's normal stale-lock cleanup.
No force-unlock or lock-age-based eviction is used.

Synthetic acceptance covers encrypted incremental snapshots, HTTP permissions,
CLI preview, cross-process live pins after expiry/release, old-point and second
scope recovery after prune, three actual SIGKILL cleanup windows with new recovery
processes, and a killed recovery controller. Mutation probes remove last-task
protection and remaining-identity reconciliation and must fail. This does not
prove physical media reliability, real power-loss behavior, distinct service UID
production installation, or provider continuation.
