# Explicit Web service restart

Owner request, 2026-10-11. [Server #120](https://github.com/awangs1986/pi-coffee-server/issues/120).

`/restart` is reserved by the Browser, independent of Agent engine, native readiness
and conversation creation. It is never an Agent prompt, queue item or Skill.
Additional arguments are rejected. Existing takeover UI remains inert; another
conversation can invoke maintenance.

Only an authenticated, explicitly configured operator may restart. Route-file
identity uses `id:<Gitea ID>`; signed-cookie deployments use `login:<Gitea login>`.
Demo/default users and Host tokens confer no authority. POST requires same-origin
and a strict `{id: UUID, confirmed:true}` body. Commands/units/URLs/credentials
never come from the Browser.

The Browser explicitly confirms the impact: all Web connections disconnect; every
active Agent on the configured Host stops; history/files remain; unfinished
instructions are not automatically resent. Cancel does nothing. This deliberately
allows recovery of a stuck task rather than waiting indefinitely for idle.

`GET /api/restart[?id=<UUID>]` returns availability, machine busy state and only the
caller's receipt. POST durably records a receipt before the worker trigger and
returns 202. UUID receipts make retries idempotent, even after a later operation.
Admission is serialized; fresh requests are blocked while scheduled/running and
for 60 seconds after completion. Corrupt or interrupted admission fails closed.
Receipts contain identity, operation/time/phase/step/reason metadata, never secrets
or transcripts.

An independent systemd path/oneshot, outside Web/Host cgroups, pauses both watchdogs,
restarts and checks Host first, then Web, finally resumes watchdogs. Each command
and health wait is bounded. Host failure prevents the Web step. It never resets
native start limits, broadly kills processes, upgrades code, reboots the VM or
automatically retries/resends. Consumed triggers do nothing; an interrupted running
attempt fails without repeating unknown actions. Killed workers may need manual
watchdog resume; their 900-second pauses also expire. Healthy emergency mode means
liveness, not complete plugin/model functionality.

The tab retains the operation ID and resumes polling after reload without another
POST. Current Web authentication may require login again after restart; the new
login can read its durable receipt. Monitoring is bounded and never re-submits
unknown outcomes. An already-unreachable Web cannot accept this command; watchdog
and operator access remain the out-of-band recovery paths.

Acceptance: authenticated HTTP admission/recovery/isolation; real Browser cancel,
confirmation, offline Agent, reload/no duplicate POST/no native input; worker CLI
ordering, failure, watchdog resume and duplicate/interrupted delivery. Production
installation and actual restart remain separate gates.
