# Independent daily backup schedule (candidate)

Server #138 schedules sealed Pi/Codex points without a browser, Web process,
MISHU or provider request. This document describes source code, not an installed
service or complete two-account production coverage. Source qualification, the
separate key service and final integration acceptance remain required.

## Identities and configuration

Run the scheduler as the trusted source service identity, separated from model
executors and the key service. It reads checkpoint seals and a private broker
client profile; it must not have access to the key service's private root.
`--broker-profile` is the production connection. The older local repository CLI
mode is for explicitly trusted operators and isolated fixtures, never a Host
fallback when a broker is absent or unavailable.

`ROOT/schedule` contains private policy, worker observations, scoped inventory,
last confirmed repository-point metadata and the durable attempts/alert journal.
The kernel flock authority `runner.lock` is permanent: never delete it to recover
an allegedly stale process. Process death releases its FD. Another worker fails
with `schedule_busy` rather than removing or guessing ownership. Repository
operations have their own serialization and survivor reconciliation.

The administrator can save the local time and IANA zone in Task backup. The Host
supplies the managed scope allowlist and trusted inventory connection. Browser
JSON cannot select a token file or URL. An operator can alternatively write a
private policy and run:

```sh
node dist/src/backup-cli.js schedule-configure --root ROOT --broker-profile PRIVATE_CLIENT.json --policy PRIVATE_POLICY.json
node dist/src/backup-cli.js schedule-status --root ROOT --broker-profile PRIVATE_CLIENT.json --scope OWN_SCOPE
node dist/src/backup-cli.js schedule-tick --root ROOT --broker-profile PRIVATE_CLIENT.json
node dist/src/backup-cli.js schedule-daemon --root ROOT --broker-profile PRIVATE_CLIENT.json
```

Policy schema:

```json
{
  "revision": "new-unique-policy-revision",
  "scopes": ["configured-scope-a", "configured-scope-b"],
  "timeZone": "America/Toronto",
  "hour": 4,
  "minute": 0,
  "host": {
    "url": "http://CONFIGURED_HOST_BIND:8790",
    "tokenFile": "/PRIVATE/SOURCE/host-token",
    "actor": "awangs"
  }
}
```

Use actual data-scope IDs rather than display usernames; the reserved legacy
scope is `__legacy_default__`. The token file must be a private regular file,
never an inline token in policy, argv or a public Issue. Use the real Host bind;
loopback is not assumed. In Host startup configure the trusted connection with
`PI_COFFEE_BACKUP_INVENTORY_URL` (the actual Host origin) and
`PI_COFFEE_BACKUP_INVENTORY_TOKEN_FILE` (an absolute private token-file path).
Both must be supplied together. Browser JSON cannot override them. Host schedule
status/configuration gets a fresh client bound to the actual authenticated actor
and data scope; it never borrows the independent daemon's privileged identity. The Host publishes an authenticated task inventory,
including tasks without any checkpoint. A manual inventory publication does not
prove current completeness. Private schedules and profiles are not repository
artifacts and must not be committed.

## Dispatch and recovery

The default is 04:00 America/Toronto. A run is identified by local date and policy
revision. A newly activated revision does not backfill before its activation
local date. Clock rollback, Toronto DST transitions and worker restarts do not
repeat that instance. If several days were missed, only the latest due date is
considered. A failed/partial attempt may retry at absolute +15 and +60 minutes
from the first attempt, for at most three dispatches.

The daemon checks every 30 seconds. SIGTERM stops later ticks and lets the
current operation converge. An interrupted or response-lost write is reconciled
using its stable repository request ID before another dispatch is considered.
A surviving live Restic process is not killed or unlocked to make a retry work.
Unknown write state stays visibly uncertain; it cannot become success by age.

Saving a plan does not install or start the daemon. The UI reports whether any
worker observation exists and whether it is more than two minutes old. Review
[the service template](examples/pi-coffee-backup-scheduler.service), replace all
paths and apply the source/executor/key identity deployment qualification before
separately approving installation. No production enablement command is implied
by this source implementation.

## Coverage and alerts

The scheduler saves existing sealed points while a consistency group is busy.
The Host's source lifecycle owns safe creation of new points; the scheduler
never reads live native files or pauses a task to manufacture an idle window.
Repository success, checkpoint capture and recovery verification remain separate.
`captureAt` is preserved; job finish and worker observation never refresh point
age. Deferred Claude/Cursor/Grok tasks remain visible as excluded.

Each managed scope has persistent failure, stale-point, unprotected-task,
inventory-unavailable and repository-unavailable incidents. Observations update
one open incident; recovery records one resolution. HTTP and WebSocket status
show only the selected authenticated scope; administrator selection uses the
managed allowlist. No external messages, polling browser or model reminder is
required.

If Host is offline, known seals can still be saved, but inventory coverage is
unknown. If the key service is offline, the last confirmed repository metadata
remains visible with an explicit unavailable state. A newer source seal whose
repository write failed cannot replace an older saved point or resolve its
stale alert. Authoritative successful repository status refreshes the cache, so
retention deletion is not concealed by stale cached points.

## Evidence and limits

Isolated synthetic scopes, the pinned real Restic executable and actual Host
HTTP/WS exercise daily/retry/DST, live-writer old-point saves, outages and scoped
status. An actual scheduler controller SIGKILL after a repository success but
before its response is journalled is recovered without a second backup job;
a concurrent scheduler fails at the kernel lease. Removing stable request IDs
or uncertainty handling causes the crash/transport regression to fail.

These are process-crash and transport tests, not power-loss, production disk,
actual distinct-UID deployment or provider-continuation acceptance. Complete source
checks, complete acceptance matrix and independent review remain parent #141.

## Capture resource bounds

The Host passes trusted startup bounds to its coordinator:
`PI_COFFEE_BACKUP_MAX_BYTES` defaults to 1073741824,
`PI_COFFEE_BACKUP_MAX_FILES` to 100000, and
`PI_COFFEE_BACKUP_CAPTURE_TIMEOUT_MS` to 30000 (maximum 1800000).
Values must be positive safe decimal integers. Invalid values stop startup before
listeners open. Overflow/deadline failure keeps the previous seal and reports
unprotected/waiting/failed coverage; it cannot publish an incomplete checkpoint.
These are operator settings, not Browser request parameters. No direct repository
key-root fallback is constructed by normal Host startup; without a scoped broker
connection repository actions stay unavailable.
