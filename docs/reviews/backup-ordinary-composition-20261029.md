# Ordinary Host backup composition evidence — 2026-10-29

Candidate for [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130),
under the accepted [trusted-root operating boundary](backup-trusted-root-20261029.md).
No production account data, credentials, service enrollment, deployment or provider
request was used. The operator startup launcher has a separate implementation and
acceptance record; this report does not imply an installed daily service.

## Composition and tested boundaries

The ordinary `main.ts` path constructs the actual source authority, one descendant
custodian, one physical fence and the durable recovery publication gate. Actual
Workspaces use that custodian for Host Git. Actual Pi/Codex factories use the same
bound fence and custody, and the configured Codex version probe also retains
descendant custody. Native privileges, HOME, environment, normal tools and network
policy are preserved. The authority constructs the coordinator from actual scoped
Workspaces/native-root descriptors, rather than accepting a source-known Boolean.

The private profile distinguishes fresh-only allocation, no enrollment, and
existing-source enrollment/requalification. Existing enrollment verifies real
completed history lifecycle evidence, the complete current source graph and a
first sealed native checkpoint. All configured capture budgets apply to this
initial materialization. The capture limits do not hide older valid seals. The composition also rereads
the private source policy for the actual broker actor, administrator role, full
source scope grants and expected authority revision before initial enrollment or
requalification. Matching an OS UID or configured administrator name is insufficient.

The public HTTP `repository-backup` seam binds an explicit checkpoint ID, or binds
one existing latest ID for older clients. Missing/foreign IDs fail without falling
forward. Ordinary restore extraction requires the authenticated independent broker;
destination publication still requires its current physical/source/approval checks.

## Test claims and coverage

| Test claim | Evidence |
| --- | --- |
| Repository readiness remains independent of an unstarted native source. | Actual main, key listener and real Restic; unstarted capture remains unavailable. |
| Preexisting data in fresh-only mode stays untouched and unqualified while ordinary task creation continues. | Main fixture sentinel and successful HTTP task/repository operations. |
| A private profile cannot inject a `known` flag, and unrelated enrolled directories cannot qualify actual source paths. | Invalid-profile startup refusal before listeners; unrelated-root actual Pi history test remains unavailable. |
| Actual Pi history produces distinct complete cuts; an explicitly selected older cut remains exportable while a real Pi session is open. | Actual main/Pi RPC, local synthetic extension command, public HTTP, key listener/worker, Restic and extraction; old bytes present and newer bytes absent. |
| Existing Codex history can qualify and requalify after same-boot Host restart, and its older point survives. | Actual pinned Codex app-server history, main restart, named old-point broker export and extracted synthetic history. |
| An explicit old ID cannot silently select a newer point or another account's point. | Public Host HTTP with real Restic; missing/foreign IDs refused, compatibility ID persisted exactly. |
| The Codex version probe preserves native environment and cannot release a surviving helper's writer custody at timeout. | Actual subprocess/environment receipt, five-second timeout, active custody and exclusive lease refusal, eventual actual exit. |

These are business rules protected by the tests, not a claim of full product
acceptance. The direct HTTP selection test uses a synthetic recovery adapter to
isolate that route. The actual main tests exercise real ordinary authority,
custody, native adapters and independent repository services.

## Scoped verification

Candidate `8e75a08` (ordinary integration `67cd896` plus native boot followup
`78060d4`) passed build and **3 files / 11 tests, no skips**, in 118.75 seconds.
Files: `ordinary-backup-composition`, `ordinary-codex-version` and
`backup-http-exact-point`. The actual native binaries and real Restic were supplied
explicitly; no hidden skipped integration was counted as green.

Private evidence directory: `/home/awang/tmp/backup-implementation-130/`.
Build: `ordinary-boot-build.log`. Complete scoped run: `ordinary-main-all1.log`.
Each run used a separate synthetic systemd unit with `Nice=15`, `CPUQuota=200%`,
`MemoryMax=4G`, `IOWeight=10`, `TasksMax=256`, and one test worker.

Supplementary current-source authorization tests passed **5 / 5** after four
negative cases (reader, removed actor, stale revision and missing scope) failed
against the previous name-only authorization. Together with version regression,
`ordinary-auth-green.log` records 2 files / 8 tests, no skips, in 13.17 seconds.
This supplementary run is not the final integrated cold-audit acceptance.

## Mutation probe

Four production mutants were applied individually, tested and restored byte for
byte; compile failures were not counted as kills. The final source diff contained
only the intended documentation change. This is a targeted probe, not exhaustive
mutation coverage.

| Mutant | Observed failing claim |
| --- | --- |
| Skip existing-source qualification before capture. | Actual Pi source stays `unavailable` instead of becoming `protected`. |
| Drop the version probe's configured native environment. | Synthetic HOME and environment receipt differ. |
| Ignore the explicit HTTP checkpoint ID. | Returned checkpoint ID/capture time are from the newer point. |
| Reinstate the managed-profile prerequisite for restore extraction. | Actual ordinary restore planning fails at the obsolete broker guard instead of reaching the current active-destination guard; the expected broker recovery pin is no longer reached. |

Logs: `ordinary-mutations1.log`, `ordinary-composition-mutants.json`, and
`ordinary-mutant-*.log`. All four mutants were killed by the relevant assertions. Three additional
source-authorization mutants individually removed the current administrator-role,
authority-revision and scope-grant comparisons. Each failed with unauthorized
`qualified` versus expected `unknown`; all were restored byte for byte. Their
logs are `ordinary-auth-mutants.log`, `ordinary-authority-mutants.json` and
`ordinary-mutant-current-source-*.log`. Total recorded targeted probes: seven,
zero survivors.

## Failures retained and limits

- The existing-mode tracer first failed because the old profile reader rejected
  that mode (`ordinary-existing-red.log`), then passed after integration.
- The first Codex extraction assertion attempted to read a directory as a file
  (`ordinary-codex-main.log`). The test now reads the named rollout sources.
- A subsequent Codex repeat timed out (`ordinary-codex-main2.log`); its root cause
  is not established. A diagnostic repeat completed in 31.24 seconds and the
  complete scoped run passed. Temporary trace statements were removed; synthetic
  HTTP and shutdown operations now have explicit diagnostic time budgets. Do not
  describe this as a proven product shutdown fix.
- One earlier isolated unit did not start its tests because its shared wrapper
  file was missing (`ordinary-pi-seeded-unit-failure.log`). The recreated private
  wrapper is retained in the workspace artifacts; this was not a product-test
  assertion failure.
- Earlier retained Pi fixture failures involved disabled background-job extension
  status, metadata-only empty history, native in-memory context not refreshed after
  a direct test append, and reused durable request IDs. The successful fixture
  uses the normal local slash-command path and official `navigateTree` without a
  model request. Product idle/empty-history safeguards were not disabled.
- Initial existing-source qualification still requires a real history lifecycle.
  A bounded backup-owned native audit is being integrated so first enablement does
  not require a user to manually open a cold conversation. This operational gap is
  not covered by the eleven-test pass above.
- Same-boot process restart is not a whole-machine reboot. Current-boot custody
  reconciliation and unattended cold audit require their separate evidence.
- Source coverage for arbitrary detached daemons, remote jobs or custom producers
  is not established by these tests. Current authorization, account scope and
  explicit producer coverage remain mandatory.

Whole-feature canonical checks, browser verification, independent review, fresh
clone acceptance and deployment are owned by the integrating workflow.
