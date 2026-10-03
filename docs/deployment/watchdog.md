# Bounded local watchdog

Version **1.0.0**. Tracking: [Server #34](https://github.com/awangs1986/pi-coffee-server/issues/34).
The watchdog is an independent Python standard-library oneshot plus a systemd
timer. Install one on each machine that owns a monitored service; use a local
health address. A network failure between machines must not restart either
machine's otherwise healthy service. It does not execute models, inspect user
transcripts, publish code or reboot the VM.

## Recovery contract

- Check `systemctl show` and the target's bounded `/healthz` response every 30 seconds.
  Health requires HTTP 200, `ok: true` and the expected `host`/`web` role.
- Restart a running but unhealthy target only after three consecutive failures.
  Start a failed/inactive target; never issue broad process-name kills.
- Ignore activating/deactivating/reloading units while systemd owns the transition.
  A failed service-manager read is observation failure, not permission to restart.
- Persist an attempt before invoking `systemctl --no-block`. Failed action commands
  spend the same budget. Wait five minutes between recovery attempts.
- Allow at most three watchdog recoveries per unresolved incident and per 30-minute
  window. Ten minutes of uninterrupted health resets an unlatched incident budget
  while retaining the rolling 30-minute attempt history. Maintenance, unknown
  observations and gaps over 90 seconds restart healthy observation.
  Exhausted incidents latch open even after the window expires or the watchdog
  itself restarts. `start-limit-hit` also latches immediately. Some systemd
  versions retain `exit-code` after denying further starts; in that case bounded
  watchdog requests consume their budget and then latch without resetting the
  native limit.
- Native crash recovery remains `Restart=on-failure`, with `RestartSec=10s`,
  `StartLimitIntervalSec=1800` and `StartLimitBurst=3`. The shared systemd limit
  bounds actual process starts from both recovery mechanisms. The watchdog never
  invokes `reset-failed`; a permanent misconfiguration cannot turn into a reset loop.
- Circuit-open state remains latched until explicit `rearm`, even if someone
  manually fixes/starts the service. Rearm backs up the previous status first.
- A missing new state file initializes a budget; malformed existing state fails
  closed and is retained. A file lock prevents overlapping manual/timer checks.
  State writes are atomic, fsynced, private and on disk, not under `/tmp`.

A responsive health route proves service liveness, not successful model calls,
provider connectivity, correct assets, or task completion. Native task/provider
slowness is not a recovery trigger. Restarting a genuinely unresponsive Host may
interrupt its current turn; the watchdog does not automatically resend it.
Service outages caused by a stopped VM or broken operating system need external
recovery. Existing graceful stop deadlines remain authoritative.

## Install and operating paths

Source files are `scripts/coffee-watchdog.py` and `deploy/watchdog/*`.
Use immutable per-commit release directories and record the source SHA in RELEASE.
Keep the application runtime release unchanged when installing only this monitor.
Back up existing configuration/drop-ins before replacement. A manager daemon-reload
applies policy without restarting a healthy application; enable/start only the
new timer and perform one healthy check.

| Owner | Program/config/state | Manager |
| --- | --- | --- |
| User VM Host | `~/.local/share/pi-coffee-watchdog/releases/<sha>/`, `~/.config/pi-coffee-watchdog/config.json`, `~/.local/state/pi-coffee-watchdog/` | user |
| Web machine | `/opt/pi-coffee-watchdog/releases/<sha>/`, `/etc/pi-coffee/watchdog.json`, `/var/lib/pi-coffee-watchdog/` | system |

The installed `pi-coffee-watchdog` wrapper supplies the correct config/state paths.
On Web use `sudo pi-coffee-watchdog ...`; on the Host use the normal VM owner.

```sh
pi-coffee-watchdog status
journalctl --user -u pi-coffee-watchdog.service -n 30 --no-pager
# Planned restart, upgrade or intentionally stopped service: pause first.
pi-coffee-watchdog pause --seconds 900
# After independently verifying the application:
pi-coffee-watchdog resume
```

Maintenance pause expires automatically after at most 24 hours. It suppresses
watchdog actions but does not disable systemd's native crash policy. An expired
pause or explicit resume starts a new failure streak without erasing restart
budgets. Deployment scripts must pause on every affected machine before stopping
application units; otherwise intentionally inactive services will be recovered.

After correcting the underlying configuration, explicitly reset the native limit,
start the named unit and rearm its watchdog target:

```sh
systemctl --user reset-failed pi-coffee-workbench-host.service
systemctl --user start pi-coffee-workbench-host.service
pi-coffee-watchdog rearm host
```

For Web the equivalent commands use sudo, the system manager,
`pi-coffee-web.service` and target `web`. Inspect status afterward. Neither resume
nor a watchdog service restart clears a circuit breaker.

## Validation and release boundary

`python3 scripts/test-watchdog.py` drives the CLI against a real local HTTP
fixture and disposable service-manager process. It covers healthy/no action,
failure streaks, cooldown, start versus restart, durable exhaustion, native
start-limit latch, transitioning units, observation errors, expiring maintenance,
failed recovery commands, healthy reset/rearm, corrupted state and health shape.
`test/watchdog.test.ts` runs this suite as part of `npm run check`.

A separate disposable systemd service should prove that a dead fixture is started,
an unhealthy fixture is restarted, and exhausted recovery stops across separate
watchdog processes. Production acceptance checks healthy application PIDs remain
unchanged, timer activation, effective rate limits and status. Record actual
installation evidence in Issue #34; do not simulate failures on production.
