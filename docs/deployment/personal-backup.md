# Personal backup and recovery (PB-2.1 candidate)

Current contract: [task backup](../spec/task-backup.md), Server #144–#150.
This is a source candidate, not a production activation receipt.

The personal Host uses `PI_COFFEE_PERSONAL_BACKUP=1`, an absolute
`PI_COFFEE_BACKUP_ROOT` on the source filesystem for checkpoints/recovery staging,
and `PI_COFFEE_RESTIC_BINARY` pointing at the reviewed Restic executable. The
encrypted repository destination may be on a different disk. Keep existing
Host/Web login and native settings. Do not combine personal mode with the old
managed/ordinary source profiles or independent broker profile. Existing legacy
entry points and archive formats remain available for migration.

The owner signs in through Gitea, configures the existing backup directory,
downloads the recovery package and verifies the saved copy once. Keep the package
separately (the owner may save it to their mailbox). The UI then offers checkpoint
capture, repository backup, preview and one confirmation to restore. A selected
historical point is never replaced by a newer one. Missing Pi/Codex configuration and
authentication files are restored in personal mode; existing configuration wins.
Credentials may need native login again. Old inputs are never automatically sent.

## Daily worker

Save the daily plan in the normal backup panel (default 04:00 America/Toronto).
Personal mode derives its private inventory connection from the existing Host
token and bound address; no separate broker profile is needed. Configure enrolled
scopes using the existing `PI_COFFEE_BACKUP_USERS` setting. Run this independent
command under the owner's normal service manager:

```sh
node dist/src/backup-cli.js schedule-daemon --root /private/backup-runtime
```

It survives closing the browser and does not require an Agent. Service installation
and production activation remain operator steps. The saved personal policy
automatically runs 30 daily / 12 weekly / 12 monthly retention after a successful
daily backup; it protects referenced points and the last complete point. Retention
progress/error is persistent and visible in schedule status. An interrupted
deletion resumes its existing plan; a stale untouched preview is replanned.
Automatic retention has bounded retries rather than an unbounded cleanup loop.
The CLI also accepts `schedule-tick` for a system timer or a manual worker check.

For normal local recovery while Host is available, the existing restore CLI also
accepts a private owner profile:

```json
{"schema":3,"endpoint":"http://127.0.0.1:8790/","token":"<existing Host token>","scope":"__legacy_default__"}
```

Use the actual bound Host URL and scope (`__legacy_default__` for the legacy owner,
or an enrolled scope). Store the profile privately; do not put the token in shell
arguments, chat or the repository. This profile does not create a new actor/role
service. Nonlocal endpoints require HTTPS.

```sh
node dist/src/restore-cli.js preview --profile /private/recovery.json --task TASK --job JOB
node dist/src/restore-cli.js confirm --profile /private/recovery.json --id OPERATION --revision REVISION --digest DIGEST
```

For one account, use `account-preview --jobs JOB` followed by `account-confirm`
with the returned operation/revision/digest. For all enrolled accounts at a
selected repository point:

```sh
node dist/src/restore-cli.js collection-preview --profile /private/recovery.json --scopes alice,bob --jobs JOB
node dist/src/restore-cli.js collection-confirm --profile /private/recovery.json --id OPERATION --digest DIGEST
```

The panel offers the same all-enrolled-accounts selection. One owner confirmation
drives the durable account operations; incomplete results remain visible and the
same command resumes them. Missing-only recovery keeps healthy current tasks.
If a preceding account creates a shared native database, the next unpublished
missing-only plan is refreshed against that committed result, preserving the
original selected checkpoints and unchanged account inventory. A replacement
approval is never silently refreshed this way. Completed accounts are not replayed.

The preview supplies the operation/revision/digest; repeat confirmation to resume
the same operation after a disconnect. An incompatible staging filesystem is
reported before confirmation. Necessary writer leases and durable publication
records prevent accidental overwrite; they do not protect against the owner.

Only normal Host/native writers in this configured topology are coordinated.
An uncoordinated writer makes new capture unavailable until a stable source can
be established; existing repository points remain readable. No task is stopped
to produce a checkpoint. Codex native format is currently qualified at CLI 0.159.1; unknown formats are refused. Complete Gitea, account-set, scheduling and standalone
source-loss recovery acceptance is tracked separately in #145–#150.
