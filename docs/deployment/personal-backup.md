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
historical point is never replaced by a newer one. Missing Pi configuration and
authentication files are restored in personal mode; existing configuration wins.
Credentials may need native login again. Old inputs are never automatically sent.

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

The preview supplies the operation/revision/digest; repeat confirmation to resume
the same operation after a disconnect. An incompatible staging filesystem is
reported before confirmation. Necessary writer leases and durable publication
records prevent accidental overwrite; they do not protect against the owner.

Only normal Host/native writers in this configured topology are coordinated.
An uncoordinated writer makes new capture unavailable until a stable source can
be established; existing repository points remain readable. No task is stopped
to produce a checkpoint. Complete Gitea, account-set, scheduling and standalone
source-loss recovery acceptance is tracked separately in #145–#150.
