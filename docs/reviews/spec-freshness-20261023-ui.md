# UI spec freshness — 2026-10-23

## Baseline and scope

Reviewed source: `1bc2b27968addeeb7d30ee2c0ed71b93147c314d`, branch
`feat/user-running-cat`, candidate v0.53. The checkout was clean before this
refresh. The only subsequent changes in this task are documentation; no code,
package pin, service, ticket state or deployment was changed.

Scope is the owner artwork, four requested navigation/settings changes and the
five fixes in [the serial code review](ui-settings-20261023.md). Adjacent old
statements in the same navigation contract are corrected where accepted decisions
already supersede them. This is not a fresh audit of all Host behavior, the entire
MISHU product backlog, OAuth implementation or the running deployment.

Sources refreshed:

- [Arena navigation](../spec/arena-navigation.md)
- [Codex speed and queue controls](../spec/codex-speed-and-queued-input.md)
- [Conversation-first delivery](../spec/conversation-delivery.md)
- [Local-first synchronization: animation section](../spec/local-first-conversation-sync.md#synchronization-and-login-animations)
- [MISHU: logo navigation](../spec/mishu.md#logo-navigation-2026-10-23)

## Reconciliation and evidence

Paths below refer to the pinned source baseline, not an assumed GitHub release.

| Claim | Treatment | Implementation and acceptance evidence |
| --- | --- | --- |
| Chat only allows Pi; other engines are Work-only | Superseded by accepted repository-free Codex Chat; retain Host-advertised admission, Pi default and Work-only engine reset | [loadEngines/renderProjectContext/canTakeover](../../public/app.js), [native-engine contract](../spec/native-agent-engines.md#repository-free-codex-chat--2026-10-08-server-98), [controller tests](../../test/native-agents.test.ts) |
| GitHub uses a shared Host token and VM Git login | Replace with the accepted user-scoped account decision; this does not independently reverify OAuth | [account contract](../spec/github-accounts.md), [account UI](../../public/github-accounts.js), GitHub picker in [app](../../public/app.js) |
| Empty groups remain sidebar drop targets; priority status reorders rows | Superseded: hide empty project/custom projections, retain metadata/move destinations/Manage groups; preserve recent-activity ordering and pins | renderSessionListContent/openGroupMenu in [app](../../public/app.js), [sidebar rules](../../public/sidebar.js), [group regressions](../../test/native-agents.test.ts) |
| A hidden empty group is deleted or inaccessible | Incorrect: deletion still checks archived and retained assignments; special Ungrouped remains a drop target | sidebarGroupMembers in [sidebar](../../public/sidebar.js), Manage groups in [app](../../public/app.js) |
| Each settings selection immediately saves and closes | Superseded by explicit owner request: local draft, Confirm, outside/Escape cancellation; initial catalog can update an open menu | stageAgentSetting/renderAgentDraft/confirmAgentSettings in [app](../../public/app.js), [controller regressions](../../test/local-first-app.test.ts), [initial-catalog regression](../../test/native-agents.test.ts) |
| Saving a draft restores every opening value | Corrected: only edited fields and necessary normalization; untouched fields follow refreshed metadata | confirmAgentSettings/renderAgentDraft in [app](../../public/app.js), [review regressions](../../test/local-first-app.test.ts) |
| Multi-setting save is atomic | Not claimed: model/effort/context/speed are sequential and confirmed; rejection stops, timeout rereads without replay; prior successes remain | confirmAgentSettings/applySpeed in [app](../../public/app.js), [review](ui-settings-20261023.md) |
| Takeover may silently discard other edited fields | Corrected: save/cancel other edits first; takeover remains separate drift consent | stageAgentSetting/renderAgentDraft in [app](../../public/app.js), [takeover regression](../../test/native-agents.test.ts) |
| MISHU actions all live at the logo menu's first level | Superseded: one parent with viewport-bounded secondary menu; unchanged admission/permissions | [markup](../../public/index.html), [handlers](../../public/app.js), [styles](../../public/app.css), [desktop/mobile probe](../../scripts/probe-navigation-settings.mjs) |
| Running artwork is the former CSS/SVG cat | Superseded by owner-supplied original 64px GIF; 28px sidebar, static reduced-motion source; sync errors hide the cat | [sync-status](../../public/sync-status.js), [CSS](../../public/app.css), [asset endpoint/test](../../test/web-server.test.ts), [sync test](../../test/sync-status.test.ts) |
| Detailed/Compact and queue controls are still unimplemented candidates | Preserve dated history, point to later recorded delivery status and current source; no new live deployment assertion | [delivery contract](../spec/conversation-delivery.md), [speed/queue contract](../spec/codex-speed-and-queued-input.md) |

The older MISHU source-status heading is explicitly historical. Current package
metadata pins 0.4.0-experience.1; planned/unmet MISHU requirements are not erased or
marked complete because that pin exists. Historical publication/acceptance notes
remain evidence of their dates, not live deployment receipts.

## Unresolved gaps — requirements retained

### G1: Reselecting the current display mode does not retry

The delivery contract requires retry after failed/stale display reads.
`chooseDisplayMode(mode)` can call `requestDisplaySync()` for the current mode,
but its reachable caller `confirmAgentSettings` only calls it when
`d.display !== displayMode`. The confirmed menu cannot currently exercise that
same-mode retry. Preserve the retry requirement. This is a source-traced finding;
no new runtime reproduction or repair was performed in this documentation task.

### G2: Fast-to-unsupported-model compound save is not ordered correctly

The speed contract requires saving Standard before an unsupported model. The
menu normalizes its local speed to Standard, while Confirm writes model first.
[CodexSession.updatePreferences](../../src/host/codex-adapter.ts) rejects that
model while stored speed remains Fast. Automatic draft normalization therefore
does not demonstrate an automatic native downgrade. Saving 1x separately before
changing model remains the required supported path. Keep the backend restriction;
record the misleading compound-save flow as an integration/UX gap, not as a
waived requirement. This is source inspection, not an additional provider test.

## Verification boundary

Prior executed evidence is [the review report](ui-settings-20261023.md): broad
`npm run check` passed 165 files / 1,278 tests and 16 Browser probes; the subsequent
late-catalog fix passed the latest two controller suites (224 tests) and lint.
The earlier [UI acceptance record](../development/navigation-settings-20261023.md)
belongs to the pre-review candidate. These numbers are historical executed checks,
not newly run tests in this refresh.

This documentation task checked the diff and 53 newly added local link
destinations/fragments, including existence of the linked source/test paths. It does
not rerun runtime tests, inspect production health, certify a deployed revision,
or claim that the two newly recorded gaps have been fixed. Local documentation
changes still require the normal source publication and release workflow.
