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
to produce a checkpoint. Codex native format is currently qualified at CLI 0.159.1; unknown formats are refused. Current fixture acceptance and production boundaries
are recorded in [the PB-2.1 report](../reviews/personal-backup-pb21.md).

## Gitea and login configuration

Set `PI_COFFEE_GITEA_BACKUP_PROFILE` to one private JSON file. The current
implementation qualifies **Gitea 1.27.3, SQLite3, local storage**, using stopped
writers and a stable filesystem copy. Other database/storage backends fail
explicitly; a production database has not been inspected or qualified by these
fixture tests. List every used repository/attachment/LFS/package/avatar/actions
location, configuration and secret file; the job checks configured local paths.
Include the Web/Host environment files, OAuth callback/client settings, connection
materials, `PI_COFFEE_TASK_USER_MAP`, native store paths and scope bindings in the
configuration roots. Do not include browser session/cookie databases.

Example structure (replace paths and commands for the actual installation):

```json
{
  "schema": 1,
  "binary": "/opt/gitea/gitea",
  "version": "1.27.3",
  "appIni": "/srv/gitea/custom/conf/app.ini",
  "workPath": "/srv/gitea",
  "roots": {"gitea": "/srv/gitea", "coffee": "/private/coffee-configuration"},
  "coffee": {
    "configurationFiles": ["/private/coffee-configuration/host.env", "/private/coffee-configuration/web.env"],
    "bindings": [
      {"accountId": "1", "scope": "__legacy_default__", "projects": "/home/owner/coffee/projects"},
      {"accountId": "2", "scope": "gitea-2", "projects": "/home/owner/coffee/second/projects"}
    ]
  },
  "checkStopped": ["/private/check-gitea-stopped"],
  "start": ["/usr/bin/systemctl", "--user", "start", "gitea.service"],
  "allowServicePause": false,
  "url": "http://127.0.0.1:3000/"
}
```

`checkStopped` must exit zero only when **all Gitea writers are stopped**. A
running service leaves an explicit gap unless an owner-approved maintenance
window has been configured. Only after that approval may the profile include
`stop` and `allowServicePause: true`. This pauses Gitea, copies data, and starts it
before encrypting the copy; it never stops Host or model tasks. Saving the normal
daily plan then includes that trusted profile. Browser requests cannot provide
commands or arbitrary service configuration. The panel exposes separate service
points, capture times, last error and preview/confirmation. Partial service/chat
failure is not overall success; the successful component is not backed up again
for the other component's bounded retries.

For local use: `backup-cli.js gitea-backup --root ROOT --profile PROFILE`,
`gitea-status`, `gitea-preview --job JOB`, then
`gitea-confirm --id OP --digest DIGEST`. Default recovery requires absent roots.
`gitea-preview --mode replace` requires stopped writers and retains the previous
root at the preview's `previousData` path. Confirm checks the reviewed target;
repeat the same confirmation after an interruption. Once publication completes,
service startup retries preserve Gitea's subsequent writes. No automatic cleanup
of retained previous roots is provided.

## Offline recovery: shortest path

Obtain the matching recovery artifact independently from GitHub or keep a copy
beside the recovery instructions. The build command below creates an independent
CLI directory; it does not include any live credentials or require npm/Gitea
packages at recovery time:

```sh
npm run build
node scripts/package-recovery.mjs --output /private/new-recovery-tool --restic /opt/restic-0.19.1
```

The artifact contains the CLI, native kernel helper, pinned Restic, version/hash
manifest and these instructions. Requirements: Linux amd64, Node 22.19+ in the
22.x line (tested 22.23.2), Python 3, `ionice`, and a working systemd user manager.
Gitea 1.27.3 is separately obtainable from its official GitHub release. Install
matching Pi/Codex/Server versions before native reconnection; source versions are
recorded in the sealed manifests. The qualified Codex version is 0.159.1.

1. Save the administrator recovery package to a private file (mode 0600). Keep
   the backup disk intact. Start with a new private runtime directory on the
   source filesystem. No old Host/Web token or local password is needed:

   ```sh
   node TOOL/src/backup-cli.js offline-open --root ROOT --recovery KEYFILE --destination DISK --binary TOOL/restic
   node TOOL/src/backup-cli.js offline-list --root ROOT
   node TOOL/src/backup-cli.js offline-import --root ROOT --snapshot FULL_SNAPSHOT_ID
   ```

   Import each selected native/service snapshot. Listing reads metadata only;
   import authenticates the selected data, verifies sealed manifests and rebuilds
   its job catalog. Repeating an import is idempotent. Other history stays on disk
   and is not eagerly read. Wrong keys/repository IDs are refused.

2. For Gitea loss, extract its saved private profile and review roots, account IDs,
   scope/legacy bindings, versions and service commands:

   ```sh
   node TOOL/src/backup-cli.js offline-gitea-profile --root ROOT --job SERVICE_JOB --output NEW_STAGING --profile NEW_PRIVATE_PROFILE
   node TOOL/src/backup-cli.js gitea-preview --root ROOT --profile NEW_PRIVATE_PROFILE --job SERVICE_JOB
   node TOOL/src/backup-cli.js gitea-confirm --root ROOT --profile NEW_PRIVATE_PROFILE --id OP --digest DIGEST
   ```

   This restores Gitea and the selected Coffee configuration roots and starts
   Gitea with the reviewed command. Missing parent directories/tools may be
   recreated manually before preview. The restored profile records original
   paths; changed roots or account bindings require choosing a compatible point
   or an explicit manual migration, not guessing from usernames. The minimum
   supported automatic path is the original layout. Use `offline-extract --job
   JOB --output NEW_DIRECTORY` for checked materials before a manual migration.

3. Start the matching Host/Web using the restored configuration, with this ROOT
   as `PI_COFFEE_BACKUP_ROOT`. Verify Gitea version, Web/Host health, each Gitea
   account ID and its configured scope/root, and sign in again. Old browser
   sessions do not survive restarting Web. If only chats were lost, skip all
   Gitea/configuration restoration and keep the healthy services.

4. Use the normal panel or `restore-cli.js collection-preview` and
   `collection-confirm` above to reconnect selected native jobs. The restored
   Host credential can now be used in the private CLI profile; it was not needed
   to begin offline decryption. Repeating the same confirmation resumes the
   durable account collection. Existing healthy tasks/configuration remain.

5. Check separately: historical messages and attachments; original Pi/Codex
   native ID and reopen; provider authentication. Revoked/expired credentials
   require normal native login. Recovery never submits old inputs. The current
   fixture evidence includes Pi context loading and actual Codex read/resume;
   a new provider turn is **not verified**.

Legacy native snapshots and recovery packages remain readable. New service
archives have a separate tag and manifest; no native snapshot conversion or
repository reinitialization occurs. A recovered partial catalog treats other
snapshots as unknown, so automatic retention does not silently delete them.
