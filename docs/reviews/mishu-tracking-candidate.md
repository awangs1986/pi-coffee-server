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

No block, fix-before-ship or note finding in the pinned source review. Checks
followed runtime capabilities through scoped task/report/dispatch authorization,
actual native report tool denial, direct-user history restoration, state ownership
and migration, and bounded startup discovery. Secrets, input validation, scoped
data access and dependencies were examined. The runtime dependency audit reported
zero known vulnerabilities; final artifact installation is checked separately.

## Final candidate gates

| Gate | Verdict |
| --- | --- |
| Source complete check | PASS: 107 files / 931 tests after review fixes |
| Versioned independent plugin check | PASS: 144 tests |
| Artifact identity and source bytes | PASS |
| Installed-artifact complete Server check | Pending |
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
