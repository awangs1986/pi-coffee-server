# MISHU durable tracking release candidate

Implements the approved [Server #64](https://github.com/awangs1986/pi-coffee-server/issues/64)
slice through #69–#76. The [44-story/A29–A35 matrix](../development/mishu-tracking-acceptance-76.md)
records source evidence; broader M01–M13 features remain outside this PR.
No production service or user task was changed.

## Immutable plugin

| Identity | Value |
| --- | --- |
| Version | `0.2.0-tracking.2` |
| Plugin commit | `6e6d267687fc5a3615c4933a5b6af55f1c3b4f42` |
| Release | [v0.2.0-tracking.2](http://gitea/awangs/pi-coffee-mishu/releases/tag/v0.2.0-tracking.2) |
| Artifact SHA256 | `f3b497be9e9c7ab678b6bb6927345ad7a6cb0170608bf446295d35b829f3bb42` |
| Consumption | Exact release URL and SHA512 integrity in Server package/lockfile |

The release tag resolves to the stated commit. A fresh download through the
canonical release URL matched the local pack SHA256. All 44 archive files matched
that Git commit byte for byte. The versioned plugin check passed 149 tests.
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

## Existing-task input repair

A subsequent real installed Codex walk failed before observing the target: the
source supplied correct task/run/revision/operation identity plus matching redundant
target routing. The strict Host rejected that noncanonical body, and the source
truthfully reported that tracking had not begun. This failed walk did not exercise
the final-answer repair and is not counted as passing acceptance.

Tracking.2 normalizes get/observe/update/stop/dispatch inputs only after a fresh
scoped saved-task lookup and unique current configured-contact proof. Only matching
redundant routing fields are removed. Unknown, empty, stale or conflicting fields
reject; operation/run IDs and revisions are never generated or rewritten. Host
schema and authorization remain unchanged, and report-origin rejection precedes
lookup. Plugin and actual native Pi/public Host regression tests failed before the
repair and passed afterward. Focused Spec and Security reviews found no new issue.

## Verification provenance

Source and package evidence is distinct from final operational acceptance:

| Evidence | Result and scope |
| --- | --- |
| Earlier installed Server check | 107 files / 936 tests at `e382965`, tracking.1; historical |
| Versioned tracking.2 plugin check | 149 checks passed |
| Tracking.2 artifact/source identity | 44 archive files match the tagged commit |
| Observe normalization regressions | 149 plugin checks and 88 scoped Server tests passed |
| Earlier actual Pi→Pi Browser walk | Passed with tracking.1; historical, not tracking.2 acceptance |
| Earlier actual Pi→Codex Browser walks | Failed; repairs and exact failure boundaries recorded above |
| Final source/installed/fresh-clone and actual Browser gates | Exact candidate receipts and outcomes recorded in PR #78 and Issue #64/#76 |
| Production activation | Outside this implementation PR |

Latest main `17e85f6` is merged with normal ancestry, retaining #81 publication
checks, release identity and dependency updates. Final publication follows the
[review-bound verification workflow](../development/verification-and-release.md):
commit reviewed source, record review, run the canonical release check, publish the
exact feature SHA, independently verify its fresh clone, then run installed actual
Pi→Pi and Pi→Codex Browser acceptance. Operational receipts stay outside source so
the checked source fingerprint is not invalidated by recording its own outcome.
PR readiness requires those gates; source mapping alone is not acceptance.

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
