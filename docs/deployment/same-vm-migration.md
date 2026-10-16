# Same-VM Web migration

## Accepted topology

For the current two-person deployment, Web, Host and native Agent CLIs share one
VM but retain independent service units. Existing Gitea identities, per-user GitHub
authorization, task roots, native sessions and routing scopes remain unchanged.
This is deployment simplification, not a merger of accounts or process lifecycles.
The migration does not require a Host restart or a model turn.

## Configuration and data checklist

- Keep the public origin `http://webserver:3000`; change its LAN DNS record from
  the retired Web machine to the shared VM. Verify resolution on user computers,
  not just the destination VM. Existing Gitea and GitHub OAuth callbacks remain.
- Bind Web port 3000 on the destination. Check it is unused before staging.
- Preserve OAuth application credentials, all route IDs, tokens, `legacyDefault`
  flags and shared routing mode. Store copies privately, never in Git.
- Move `PI_COFFEE_ROUTES_FILE` and `PI_COFFEE_RESTART_STATE_DIR` to destination
  private paths. Do not copy a pending maintenance request as runnable work.
- Retain Host's existing LAN bind during migration; traffic to the VM's own
  address stays local. Moving Host to loopback is a separate rollout because
  it can affect routed operations and requires a restart.
- Preserve task/attachment/native credential locations on Host. Web identity
  sessions are in memory in this deployment; expect a fresh browser login.
- Install destination Web, watchdog target and maintenance worker separately
  from Host. `/restart` must target the two local services, not the retired Web.
- Use the currently verified immutable release for the topology migration.
  Do not silently combine unpublished frontend changes with service relocation.

## Stop-before-start migration protocol

`scripts/migrate-web.py` consumes an operator-owned private JSON plan with
`source` and `target` objects. Each supplies argv arrays for `preflight`, `status`,
`fence`, `activate`, and `verify`. `status` emits JSON booleans `active` and
`fenced`. No shell evaluation or user-supplied Web input is accepted.

1. Back up unit/configuration files. Stage the target without starting it; keep
   its Web unit masked. Check release identity, port availability, Host health,
   route preservation, credentials and public-origin DNS.
2. Disable source watchdog/restart triggers, stop any pending maintenance worker,
   stop source Web, verify process and listener absence, and persistently mask
   its unit. A failed or unreachable source probe aborts activation.
3. Start destination Web only after the source is confirmed stopped and fenced.
   Verify health and served asset hashes, then enable destination maintenance
   and monitoring. Confirm source remains fenced before recording completion.

The orchestrator holds an exclusive lock and records phases atomically. Re-running
completed migration verifies both sides rather than starting another instance.
Interrupted migrations require explicit rollback before retry. Local state cannot
prevent an administrator manually unmasking a retired service; operational policy
must preserve the source fence.

Rollback always fences and verifies destination shutdown before reactivating
source. If destination shutdown cannot be confirmed, rollback stops rather than
risking two active Web services. Restore public DNS to the source address when
rolling back; the script does not administer LAN DNS. Service rollback alone does
not prove clients can resolve the restored endpoint.

## Verification and current staging evidence

`test/web-migration.test.ts` exercises success/idempotence, source fencing failure,
source observation failure, target verification failure and unconfirmed target
shutdown during rollback. A synthetic controller rejects any dual-active state.
These tests use no production accounts or native model sessions.

On 2026-10-16, source Web and Host were verified at `d835f00` / v0.27. Target
configuration was staged privately with its Web unit masked; neither service was
restarted. Production preflight rejected the old DNS record as `DNS_NOT_READY`.
This is staging evidence, not a completed migration. After cutover additionally
verify both users' login, project visibility, current conversation updates,
attachment download, OAuth callback origin, served assets and maintenance wiring.
Do not trigger actual Agent turns or `/restart` merely to test configuration.

## Activation outcome (2026-10-16)

After the owner changed LAN DNS, both names resolved to 192.168.100.123 and
preflight passed. The first cutover automatically rolled back because its probe
incorrectly requested the non-public `/release-manifest.json` (404). The probe was
corrected to verify the local release identity plus publicly served asset bytes.
The retry completed successfully, including stop-before-start source fencing.

- Source 192.168.100.101: Web inactive, PID zero, service persistently masked;
  watchdog timer and restart path disabled.
- Destination 192.168.100.123: Web healthy at the unchanged public origin;
  Web and Host both run immutable `d835f00` / v0.27.
- Host PID 1871718 remained unchanged; native tasks were not restarted.
- Cross-machine HTTP health, workbench asset checks, expected Gitea callback,
  anonymous restart denial, and both local watchdog health targets passed.
- Full source check: 140 test files / 1,168 tests plus the browser probes passed.
- New browser login and interactive checks by both real users remain manual
  acceptance items; no user conversation contents or model turns were inspected.

The separately committed browser connection-establishment fix is not included in
this topology-only activation. Private operator plans, unit/config backups and
migration state remain outside Git. A rollback also requires restoring LAN DNS.
