# Install /restart

[Contract](../spec/service-restart.md). This restarts currently configured services;
it does not fetch source, change release paths or upgrade packages.

1. Use an exact fresh-verified release. Its `dist/maintenance/` contains the worker
   and unit/config templates. Keep an immutable root-owned worker directory and
   adapt the service's `ExecStart`. Install the path/service templates in
   `/etc/systemd/system`; keep the oneshot independent of Web/Host cgroups.
2. Determine Web's actual service user with `systemctl show -p User
   pi-coffee-web.service`. Create disk-backed `/var/lib/pi-coffee/restart`, mode
   0700, owned by that user. Root worker receipts retain this directory's owner.
   The hardened Web unit uses `ProtectSystem=strict`: install the supplied
   `web-spool.conf` as its own drop-in to allow only this additional writable path.
3. Create root-owned `/etc/pi-coffee/restart.json`, mode 0600, from the example.
   Keep exactly Host then Web; each target specifies absolute executable argv for
   pause/restart/resume and its `/healthz` address/role. Config cannot be a symlink
   or group/world writable. Browser input never supplies these values. SSH remote
   command strings are operator-owned; use existing dedicated SSH access, bounded
   timeouts and pinned host keys. Passwords belong in private stores, not argv.
4. Verify exact service/watchdog paths, SSH access and health without mutation;
   check unit syntax and exercise commands in a disposable fixture. Enable only
   `pi-coffee-restart.path`. The service has no retry and a 930-second deadline.
5. Back up private Web environment, then configure
   `PI_COFFEE_RESTART_STATE_DIR=/var/lib/pi-coffee/restart` and
   `PI_COFFEE_RESTART_OPERATORS=id:1` using the actual operator ID. Signed-cookie
   deployments use `login:awangs` instead. New Web runtime activation requires an
   approved maintenance window. Before posting, probe authenticated availability,
   denied users and origin rejection without restarting.
6. Real `/restart` stops running tasks: require the stated UI confirmation and
   record before/after service identity, health, versions, login and served assets.
   Preserve original service shutdown deadlines and newer Browser assets.

`operation.json` is current state, `receipts/` retains per-ID evidence and
`request.json` is only a trigger. After a killed worker, inspect systemd journal and
exact service health, resume watchdogs if necessary, and run the oneshot once to
fail the interrupted attempt without re-execution. Expired scheduled requests
also fail. Stale `admission.lock`, corrupt state or invalid config requires inspected
manual recovery; never clear unknown state/start limits merely to force a retry.
Retain prior config, units and worker release for rollback. Health verifies
liveness only, not successful model calls or task completion.
