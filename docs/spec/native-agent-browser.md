# Native-engine support in the existing Browser Shell

Status: **M4 merged; M5 production deployment and combined acceptance completed**. See [M4 evidence](../reviews-native-agents-m4-20260923.md) and [M5 production evidence](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/reviews/native-agents-m5-20260923.md).
Date: 2026-09-23. Tracking: [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6).
Depends on: [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48) for the additive Host contract and activation.
Canonical contract: [Agent native-engine SPEC](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/native-agent-engines.md).

## Problem Statement

Browser Users want to communicate with their own authenticated native Codex or Claude Code in the same PI Coffee interface used for Pi. Before this integration the Browser Shell understood Pi-specific Events and controls. A new engine must not appear to support Pi's Harness modes, tool configuration, LSP or compaction merely because it shares the browser.

The owner requires the existing left task list, center conversation/composer and right changes panel to remain clean and concise. Gitea Project selection, independent task directories, files and code review must continue working without a second interface or workspace manager.

## Solution

Consume the Agent-owned additive Host contract for engine discovery, Task binding, supported capabilities, normalized Events and lifecycle. Add a compact engine choice within the existing task-creation entry and a concise engine indicator for an existing Task. Preserve current pane placement, Gitea identity/routing, file streaming and Git review controls.

The Server remains a transparent gateway. It does not run engines, parse native CLI protocols, own provider authentication or store native histories. Pi retains its existing customizations; native Codex and Claude Code retain their own behavior and official user authentication in the User VM.

## User Stories

1. As a Browser User, I want to choose an installed engine in the current task-creation entry, so that I can use Pi, Codex or Claude Code without navigating to another application.
2. As a Browser User, I want existing Tasks to retain their engine, so that reopening a Task cannot accidentally use another native Session.
3. As a Browser User, I want a compact engine indicator, so that I know which agent I am addressing without extra toolbar clutter.
4. As a Browser User, I want missing installation, authentication and unsupported-version states distinguished, so that I know what to resolve in my VM.
5. As a Browser User, I want Gitea login and VM routing to remain unchanged, so that I do not need another platform account.
6. As a Browser User, I want native sign-in instructions to direct me to the official CLI flow, so that the Browser Shell does not request provider passwords or subscription tokens.
7. As a Browser User, I want Project and starting-branch selection to work with every supported engine, so that each code Task starts in the correct independent Checkout.
8. As a Browser User, I want Pi-only local Chat Workspace creation to work without a Repository, so that non-code tasks still retain their files.
9. As a Browser User, I want Workspace type, engine identity and native mode clearly distinguished, so that Chat/Work labels do not imply Pi policies for another engine.
10. As a Browser User, I want the VM, Project, complete copyable path, actual branch and synchronization status visible in the existing context area, so that my work location is clear.
11. As a Browser User, I want streamed answers and tool activity rendered accurately, so that native work is observable.
12. As a Browser User, I want native questions and approval requests shown in the existing interaction surface, so that supported requests can be answered without rewriting their meaning.
13. As a Browser User, I want unavailable model, reasoning, queueing or compaction controls hidden or explained, so that the interface does not acknowledge unsupported actions.
14. As a Browser User, I want refresh and reconnect to show the same Task and run, so that a connection problem does not duplicate a prompt.
15. As a Browser User, I want an uncertain submission retained with a clear warning, so that I can check native history before sending again.
16. As a Browser User, I want stop feedback to distinguish a requested interruption from confirmed completion, so that I understand whether work is still running.
17. As a Browser User, I want background or unknown writer state visible when it blocks a Git/lifecycle action, so that I can resolve the cause.
18. As a Browser User, I want original uploads, previews and downloads to remain scoped to the current Task, so that files do not cross tasks when I switch between Tasks using different engines.
19. As a Browser User, I want the existing Diff, Checks, Checkpoint and Gitea PR workflow to work for native-engine edits, so that code collaboration remains consistent.
20. As a Browser User, I want archive and restore to retain the local directory and native history, so that task-list management remains non-destructive.
21. As a Browser User, I want cleanup results to identify retained native data or a failed deletion, so that the UI never falsely reports complete removal.
22. As a Browser User, I want the sidebar collapse, narrow-window controls and dialogs to remain usable, so that adding engines does not reintroduce layout defects.
23. As a maintainer, I want old Hosts to keep supporting Pi in the updated Browser Shell, so that rollout can be incremental.
24. As a maintainer, I want gateway forwarding to remain independent of native protocols, so that engine upgrades are contained in the Agent Runtime.
25. As a maintainer, I want evidence to distinguish a mocked capability list from a real native run, so that implementation status is accurate.

## Implementation Decisions

1. **NB-01 — Canonical provider contract.** Consume the Agent native-engine contract and its capability/version negotiation; do not duplicate runtime types or independently define native authentication, thread identity or lifecycle semantics in the Server. Activation is blocked until the Agent public contract is available. Browser design/tests can proceed against the agreed fixtures before deployment.
2. **NB-02 — Layout preservation.** Keep existing panes, navigation and theme. In the native-engine creation UI, offer exactly three Agent choices: Pi, Codex and Claude Code. Show unavailable choices disabled with an explanation based on Host readiness; do not pretend that an older Host supports them. Place this selection in the existing new-task controls. Once the Task is created, replace selection with a compact read-only Agent indicator; do not provide an in-place engine switch, including before the first prompt or after archive/restore. Show it only where useful; no separate native-engine dashboard or permanent toolbar. The earlier withdrawn A/B/C layout proposals are not revived.
3. **NB-03 — Workspace and engine separation.** New conversation defaults to Pi Chat. Only Pi may create a Chat Workspace. Work offers Pi, Codex and Claude Code with a selected Gitea Project and branch; choosing Chat resets the new-task Agent to Pi. Enforce the same rule at the Host API. Pre-correction native local tasks retain their original identity/history and remain accessible. Continue creating workspaces through the Host. Submit the selected engine and existing creation parameters, not browser-selected absolute paths, native IDs or VM endpoints. Existing Tasks cannot change engine in place; failed-start recovery retains the original selection. Using another engine requires a new Task. Pi Chat/Work runtime controls are Pi-only; native modes appear only when the Host supplies authoritative capabilities and values.
4. **NB-04 — Discovery and failure states.** Render Host-confirmed engine availability, readiness and capabilities. Pi-only older Hosts remain usable; absence of new capability fields is not proof that another engine exists. Distinguish unsupported features from expired native authentication or a disconnected VM. Never silently switch the Task's engine or create an empty replacement conversation to hide an error.
5. **NB-05 — Native behavior.** Display native messages, tools and supported requests through the common presentation contract. Do not insert Pi prompts, tools, LSP, Skills, plugin panels or context-recovery actions into native-engine Tasks. Keep Agent and Model controls distinct. The model menu contains only models supported by the Task's bound engine and appears only when that engine supports selection. A model change cannot switch Agent or replace its native Session binding. A supported Claude model used by Pi remains a Pi Task; Claude Code is a separate Agent choice. Leave unsupported token-cost/context estimates unknown rather than filling them with Pi values. Native permission requests remain native requests; the trusted VM model does not authorize the browser to auto-approve them.
6. **NB-06 — Authentication boundary.** Gitea OAuth remains platform identity. Provider authentication completes through the user's official engine flow in the User VM. The Server provides no provider password form, token import/export, shared provider account, subscription relay or SDK-login substitute. Sanitized readiness/action guidance may be displayed without exposing provider credential contents. Model traffic from these native engines does not acquire the Pi Relay configuration through browser selection.
7. **NB-07 — Delivery and reconnect.** Preserve the Task selection epoch and request correlation rules. A late response for another Task/run cannot alter the current selection, controls, review or dialog. Distinguish accepted prompt, running turn, native input request, interruption, failure and completion. Retain uncertain input and reconcile native history before any user-directed resend; do not automatically replay it on reconnect.
8. **NB-08 — Git and lifecycle.** Retain existing Host actions for status, Diff/Checks, Checkpoint, push and Gitea PR. Show actual branch and stale/offline states. Explain Host rejections for active or unknown writers. Archive preserves data and ongoing work; permanent cleanup uses Host-provided scope/results and cannot claim native history was deleted if it remains. No Server-owned Git execution or native Session deletion is introduced.
9. **NB-09 — Files.** Preserve the current upload/preview/download gateway and Conversation-scoped authorization. Original selected bytes remain in the User VM even when the engine accepts inline images. Pass only supported explicit user selections. Artifact preview stays separate from the code changes surface. The gateway must not persist file bodies or provider/native-history contents.
10. **NB-10 — Rollout.** Deploy the compatible Host first, then enable Browser Shell controls by advertised capability. Preserve existing Pi flows across mixed versions. A rollback disables unsupported actions while keeping affected Tasks visible and their data intact. The existing frontend audit branch remains separate; this SPEC does not implicitly merge or deploy it, but implementations must preserve its accepted correctness fixes.

## Testing Decisions

- Use the existing public Host HTTP/WebSocket seam as the primary cross-repository contract. Reuse gateway authentication/streaming and Browser Shell continuity tests; do not test private CLI messages in Server unit tests.
- Drive the actual browser controller against deterministic Host capability, history, Event and failure fixtures. Assert user-visible behavior, task identity and outgoing public requests rather than DOM implementation details or internal callback counts.
- Cover exactly three Agent choices with readiness gating, read-only Agent identity immediately after creation, rejected engine changes before the first prompt and after archive/restore, recovery with the same selection, model choices scoped to the bound engine, legacy Pi defaults, missing CLI/auth/version states, capability-gated controls, native request correlation, stale responses, uncertain delivery and targeted cancellation.
- Cover cross-task file scope, actual branch/offline status, busy/unknown-writer rejections, archive retention, cleanup partial results and old/new Host compatibility. Reuse existing Gitea/file contract tests rather than creating another workspace manager fixture.
- Reuse responsive checks for sidebar collapse/expand, review visibility, long context, small windows and native interaction dialogs. New engine controls must not alter the overall layout or hide the composer.
- For final integration, use the same small real-engine acceptance flows recorded by the Agent Issue through the actual Browser Shell and gateway, rather than launching a second exhaustive paid-run matrix. Verify engine selection, prompt/tool stream, Workspace path, a reconnect, a scoped attachment, code changes and supported stop/Gitea operations. Record which operations were real and which were fixtures.
- Require repository checks from a fresh clone and record evidence in this Issue and the Agent Issue. Passing current Pi tests or publishing a SPEC is not acceptance of native-engine support. Do not repeat destructive VM snapshot tests or build an unrelated performance program.

## Out of Scope

- Production deployment (owned by M5).
- Native CLI processes, provider credential storage, model traffic routing, native transcript conversion or Agent protocol implementation inside the Web Server.
- A new login system, new VM provisioning, a unified subscription pool, or an SDK product impersonating native CLI authentication.
- Changing Pi customizations, applying them to other engines, engine switching inside an existing Task, or moving the three main panes.
- Reintroducing platform worktrees/local merge coordination, a new workflow orchestrator, or unrelated browser history/cache features.
- Claiming complete feature parity with native terminal interfaces or provider legal approval.

## Further Notes

Implementation follows the [M0–M5 plan](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/development/native-agents-m0-m5.md). M4 ([pi-coffee-server #7](http://gitea:3000/awangs/pi-coffee-server/issues/7)) is the Server delivery; M1 provides the public contract/fixtures and M2/M3 are prerequisites for real-engine activation. M5 records combined release evidence.

The Agent implementation is [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48); this Server delivery is [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6). The [native-engine SPEC](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/spec/native-agent-engines.md) owns the requirements and references, and [ADR-0013](http://gitea:3000/awangs/pi-coffee/src/branch/main/docs/adr/0013-native-agent-engines.md) owns the architecture boundary.

The existing [frontend audit](http://gitea:3000/awangs/pi-coffee-server/issues/4) and its PR remain separate. M4 and M5 are merged and deployed; pinned versions, acceptance and limitations are recorded in the M5 evidence. No authentication or Gitea policy change is inferred from the existence of third-party UI projects.

## Navigation correction — 2026-09-23

See [Arena navigation and review](arena-navigation.md). Global Project/archive
commands belong in the upper-left brand menu. Review is opt-in through the folder
icon. Pi credential import into Web Server is a future possibility, not an accepted
implementation or a change to native Codex/Claude authentication.

## Codex model selection before task creation — 2026-09-27

[Server #21](http://gitea:3000/awangs/pi-coffee-server/issues/21) corrects the
new-task model picker. A Work draft with Codex selected can read the native model
catalog and choose a model before creating the task or sending its first message.
Discovery runs through the authenticated, user-scoped Host factory; it must not
create a native thread, clone a project, run a model turn, or expose credentials.
The Host advertises `modelCatalog` in Codex engine availability; older Hosts retain
the existing model selection after task creation.

Selection remains local to the draft. Switching Agent or task discards it, and
late discovery replies cannot replace the current Agent's choices. Creating the
task applies an explicitly selected model through the normal session interface.
The first prompt waits for history and model confirmation; a rejected model
restores the draft without sending it using a fallback model. Reasoning controls
continue to use the opened session's authoritative capabilities.
