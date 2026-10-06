# MISHU durable tracking release candidate

Implements the approved [Server #64](https://github.com/awangs1986/pi-coffee-server/issues/64)
slice through #69–#76. The [44-story/A29–A35 matrix](../development/mishu-tracking-acceptance-76.md)
records source evidence; broader M01–M13 features remain outside this PR.
No production service or user task was changed.

## Immutable plugin

| Identity | Value |
| --- | --- |
| Version | `0.2.0-tracking.1` |
| Plugin commit | `22b6d6640b77d030797ad717cd76a77cdc342504` |
| Release | [v0.2.0-tracking.1](http://gitea/awangs/pi-coffee-mishu/releases/tag/v0.2.0-tracking.1) |
| Artifact SHA256 | `08ee19d53faa80f4758d615fbf3d1d57d47d84e0a64d52758d2ab08ab49082bd` |
| Consumption | Exact release URL and SHA512 integrity in Server package/lockfile |

The release tag resolves to the stated commit. A fresh download through the
canonical release URL matched the local pack SHA256. All 44 archive files matched
that Git commit byte for byte. The versioned plugin check passed 144 tests.
Installing the candidate changed only the MISHU dependency; no other runtime
package version changed and no new install hook was introduced.

## Standards

Reviewed Server `74679e9...a643cff` and plugin `8b2b2ca...38dad24` against repository
ownership, scope, integration and invariant guidance. No hard violation found.
One nonblocking duplication finding concerned independently advertised and enforced
notification limits. `c4ea9d0` gives the generic queue ownership of foreground
scheduling policy and uses shared limits for report admission. Reviewer verified
closure: zero outstanding Standards findings.

## Spec

One P2 finding: shallow mutation receipts shared nested state with live tasks,
violating the original-result guarantee for identical operation retries.
`c4ea9d0` snapshots ordinary receipts independently, retaining compact stopped-task
references. The public HTTP/WS regression failed before the fix and passed after
late native evidence, report commit and Host restart. Reviewer verified closure:
zero outstanding Spec findings. Release gates below remain separate.

## Security

The pinned source review found no authentication, scope, secret, input-validation
or state-ownership finding. The earlier zero-advisory dependency result is
historical: final installed-package audits then identified
[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) in
`@modelcontextprotocol/sdk@1.27.1` and development-only
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) in
`source-map-js@1.2.1`.

The SDK OAuth credential path was not reachable through the inspected Baizhi/Z.ai
clients: they use fixed endpoints, static authorization headers and no SDK OAuth
provider. This is an affected dependency finding, not evidence of a production
credential leak. A scoped override now resolves `pi-web-access@0.35.0` to SDK
`1.31.0`, retaining the same web-access version and existing fast-uri/undici
overrides. The vulnerable nested SDK and its redundant Hono server dependency are
removed; the already-installed SDK `1.31.0` becomes their shared runtime dependency.
The source-map lock advances only to `1.2.2`, within both css-tree/PostCSS consumers'
existing `^1.2.1` ranges. MISHU's immutable artifact and other package versions are
unchanged by this repair.

A private clean `npm ci` with the revised lock passed both complete and runtime
`npm audit`: zero known advisories at this check. Resolving the actual SDK from
pi-web-access passed connect, listTools, callTool, session DELETE and close with
synthetic static-header transport. No provider account or network was used by that
probe. Build/typecheck/vendor generation and four public integration/rendering
files (24 tests) passed; final fresh-clone complete checks remain separate below.

## Codex final-answer ordering repair

The first installed-artifact Pi→Codex probe admitted two automatic report runs for
one final reply: a complete `final_answer` arrived before the separate native turn
completion, so it was first reported as ongoing progress and then as terminal.
That actual probe failed uniqueness; it is retained as historical failure evidence.
It proved one committed output plus a second admitted run, not two completed outputs.

The production Codex Agent boundary now retains explicit final-answer evidence
until the exact terminal/lost-connection outcome. Browser text remains immediate,
commentary progress remains reportable, and failed/interrupted/lost runs retain
final facts with incomplete/uncertain status. Unknown phases and asynchronous user
questions keep their existing live handling. The 250ms coalescing interval, report
budgets, immutable report snapshots and grant checks are unchanged.

A public HTTP/WS scenario using the production Codex adapter and a deterministic
protocol fixture reproduced two reports instead of one in 2.6 seconds, twice.
The fixture's `agentMessage.phase` field was checked against the pinned 0.159.1
CLI's offline JSON schema and the real synthetic rollout's final-answer phase.
After repair, five cases cover final-only, commentary then final, failed,
interrupted and process-loss outcomes, including a visible final-message/terminal
gap. This is local regression proof; installed actual Browser rerun is still required.

## Final candidate gates

| Gate | Verdict |
| --- | --- |
| Source complete check | PASS: 107 files / 936 tests after final-answer ordering repair |
| Versioned independent plugin check | PASS: 144 tests |
| Artifact identity and source bytes | PASS |
| Patched dependency clean install, all/runtime audit | PASS: zero known advisories at the final patch check |
| Installed SDK compatibility and integration/build | PASS: actual consumer resolution, 24 tests, build/vendor generation |
| Installed-artifact complete Server check | PASS: private clean install, 107 files / 936 tests; immutable plugin, no source override |
| Fresh GitHub clone check | Pending |
| Installed actual Pi→Pi Browser flow | Pending |
| Installed actual Pi→Codex Browser flow | Pending |
| Production activation | Not performed; outside this implementation PR |

Actual model limits remain explicit: configured Meta source returned 404 in later
attempts; successful isolated source samples used `eidolon/gpt-5.6-sol` without
changing production defaults. Cursor requires native login; Claude returned
upstream quota403. Grok online observation and production-adapter Codex automatic
reporting passed their source-candidate walks. Non-Pi passive run recovery remains
unknown and durable correlated dispatch remains Pi-only.

Schema2 migration retains a private original snapshot. Older schema1-only code
refuses the new state; rollback must not copy a historical snapshot into the live
path or revive old grants. Stop the old Host during the established idle cutover:
pretracking binaries do not participate in the new SQLite ownership fence.
