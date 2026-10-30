# Ordinary backup service startup (candidate)

This operator entry point completes process enrollment for the trusted-Host-root
configuration. It does not install services, enable a schedule, change native
permissions or authorize production backup/restore. Use it only with reviewed
private configuration and the immutable release being tested.

`dist/src/host/ordinary-backup-start.py` accepts exactly a private configuration
path and one fixed role: `key`, `host`, `scheduler` or `cli`. It never accepts a
PID, an executable, shell text or arbitrary command arguments from a request.
The operator configuration fixes canonical Node/Python/release paths. Application
administrator, actor, scope and revision still come from current private policies;
Linux UID or launching this program does not supply an application role.

## Private configuration

All files and the startup-state directory must be owned by the operator and
private, with canonical paths and no symlinks. The executables must use their
resolved absolute paths. Existing source/native configuration is unchanged.

```json
{
  "schema": 1,
  "root": "/PRIVATE/backup-startup",
  "releaseRoot": "/ABSOLUTE/IMMUTABLE/RELEASE",
  "node": "/ABSOLUTE/CANONICAL/NODE",
  "python": "/ABSOLUTE/CANONICAL/PYTHON",
  "keyConfig": "/PRIVATE/key-config.json",
  "sourcePolicy": "/PRIVATE/source-policy.json",
  "brokerProfile": "/PRIVATE/broker-client.json",
  "backupRoot": "/PRIVATE/source-backup",
  "operator": { "command": "status", "options": { "scope": "OWN_SCOPE" } }
}
```

The key configuration uses `trustModel: "host-root"`, this operator's UID and the
fixed release's `dist/src/backup-key-worker.js`. The client profile contains the
current actor, data scope and authorization revision; it carries no repository key.
The source policy's application grants remain independently authoritative. A
source actor downgrade or source revision change does not block access to already
saved repository points; actual source export and new capture still enforce those
grants. Malformed or unsafe private configuration is refused.

## Roles and ordering

Use the configured Python executable for these commands:

```sh
python /RELEASE/dist/src/host/ordinary-backup-start.py /PRIVATE/startup.json key
python /RELEASE/dist/src/host/ordinary-backup-start.py /PRIVATE/startup.json host
python /RELEASE/dist/src/host/ordinary-backup-start.py /PRIVATE/startup.json scheduler
python /RELEASE/dist/src/host/ordinary-backup-start.py /PRIVATE/startup.json cli
```

`key` replaces itself with the fixed hardened Unix listener. It enrolls that
exact PID/UID/boot/birth as the parent of the fixed worker. It binds a random
private staged socket, durably records its inode/owner, links the public name
without replacement, then accepts clients. The key process uses a minimal service
environment; Host/native environments are preserved independently. `host` replaces itself with the normal
`main.js host`; it preserves cwd, HOME, environment and native privileges. It adds
only the configured backup root/client settings, refusing a contradictory existing
value. Keep the existing Host environment files, native paths and settings.
`scheduler` runs the independent `backup-cli.js schedule-daemon` with the fixed
backup root and client profile. It does not depend on a browser or Web process.

A role's actual Node/Python process retains the launcher's PID and start time,
plus an inherited kernel role lease. A second live instance is refused. Restart
replaces only that role's known dead enrollment; unrelated backend grants and all
application fields remain unchanged. A deliberately removed enrollment is not
silently restored. No ancestor or arbitrary model child inherits registration.

First setup starts the key role before enabling the source and scheduler. Once
configured, a temporary missing/refusing key listener does not prevent the Host
or scheduler from starting: their own process identity is enrolled, source grants
are preserved and a bounded warning reports the repository outage. A wrong live
listener identity is refused. Do not add `Requires`, `BindsTo` or `PartOf` from the
Host to the backup service: stopping a backup service must not stop active tasks.
`After` ordering may be used for startup convenience only. Schedule configuration,
offline recovery-copy verification and destination checks are separate prerequisites
for actual daily writes; starting the daemon alone does not enable protection.

The `cli` role uses only an allowlisted `backup-cli.js` operation from private
`operator` configuration. Supported operations are status/configure/export/verify,
run/recover/rotate, schedule-configure/tick/status and retention-preview/status/execute.
Each has fixed named options; executable selection and arbitrary arguments are
rejected. `run` requires a selection file with explicit checkpoint IDs. Export
writes only to the explicitly chosen private output path. Offline copy verification
and current application authorization remain mandatory in the existing CLI.

## Identity, durability and failure handling

For an already running key listener, startup observes actual socket peer credentials,
then checks live UID, kernel boot/start time and the entire fixed command line.
The non-dumpable worker/listener may deny `/proc/PID/exe`; no hardening is weakened
to read it. Canonical fixed service files plus the trusted operator's service
provenance are an explicit assumption, not a claim that argv proves kernel
executable identity or resists Host-root tampering.

Private `host/scheduler/key/cli.lock` files are permanent kernel lease anchors.
`policy.lock` serializes startup transactions and listener receipts. Operator
policy edits must use that same lock or stop startup attempts first. Never remove
these lock files to break a live lease. The bounded, fsynced transaction journal
stores exact before/after policy and state bytes with a configuration/content
digest. Restart rolls forward only matching preimages or already applied results;
a newer policy/revocation or changed configuration causes refusal without overwrite.
The journal is removed only after all updates are durable. Failed exec leaves a
stale identity that cannot authenticate and is replaced only after proven death.

A crashed key listener's socket is removed only with its recorded path, device,
inode, change time, exact dead process and the exclusive role lease. A live endpoint
or an unknown replacement is preserved. The fixed listener records socket ownership
before linking the public name. A crash before the receipt can leave an unknown
private stage, which is preserved and does not occupy the public endpoint. A
recorded stage or linked endpoint can be reclaimed after its owner dies. The
pre-link receipt binds the inode and random stage name; the completed receipt
also binds the final change time. Socket paths are bounded to 100 bytes. Initial
configuration and service installation remain operator work; no production unit
is changed by tests.
