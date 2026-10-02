# Native Codex and Claude Code integration

Status: **M0–M5 implemented, merged and deployed**. See [M5 deployment evidence](../reviews/native-agents-m5-20260923.md) and [supported capabilities](../deployment/native-agents.md).
Date: 2026-09-23. Owner decisions were synthesized from the current discussion.
Tracking: [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48). Browser delivery: [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6).
Parent: [Agent map](http://gitea:3000/awangs/pi-coffee/issues/1).

## Problem Statement

Browser Users want to use their own authenticated Codex and Claude Code installations through the existing PI Coffee Browser Shell, while retaining each engine's native behavior. Before this integration the Host owned Pi Sessions, the Browser Shell understood Pi-specific Events, and runtime setup injected Pi-specific configuration. Replacing a launch command would not correctly handle native history, identity, lifecycle, or capabilities.

Users also need the same Gitea workflow regardless of engine: choose a Project and starting branch, receive an independent Checkout, edit code, inspect changes, create a Checkpoint, and open a pull request. They should not need a second workspace manager, shared writable clone, or redesigned interface.

## Solution

Extend the User VM Host with engine-specific Adapters for Pi, Codex, and Claude Code. Keep one Browser Shell, the transparent Web Server, existing Gitea identity and routing, and the existing Workspace and file services. Each Task remains one Conversation on one User VM with one stable Workspace, and additionally binds to one Agent Engine and its own native Session identity.

Pi retains the existing PI Coffee customizations. Codex and Claude Code retain their native prompts, tools, Skills, context management, configuration, authentication and permission behavior. The platform translates supported interactions and displays capabilities; it does not rebuild their agent loops or inject the Pi Harness. Users authenticate through each installed engine's own supported flow in their User VM.

This maintained contract is implemented for the pinned native CLI versions. [M5 deployment evidence](../reviews/native-agents-m5-20260923.md) distinguishes production Browser/API acceptance from deterministic fixtures and records the remaining optional capability limits.

## User Stories

1. As a Browser User, I want to select an installed Agent Engine when creating a Task, so that I can use Pi, Codex, or Claude Code in the same Browser Shell.
2. As a Browser User, I want Pi to remain the default for existing Tasks, so that upgrading does not reinterpret my conversations.
3. As a Browser User, I want a Task's engine to remain fixed, so that reopening it always resumes the correct native Session.
4. As a Browser User, I want unavailable engines to have an explanatory state, so that a missing installation does not produce a broken Task.
5. As a Browser User, I want the engine name to remain visible without an additional permanent toolbar, so that the interface stays clean.
6. As a Browser User, I want the existing three-pane layout to remain, so that adding engines does not change how I navigate.
7. As a Browser User, I want to choose a Gitea Project and starting branch, so that each engine starts from the intended code.
8. As a Browser User, I want every code Task to receive an independent clone and Conversation Branch, so that simultaneous Tasks do not share local Git state.
9. As a Browser User, I want a Pi-only local Chat Workspace without a Repository, so that conversations and their attachments still have a dedicated directory.
10. As a Browser User, I want Workspace type and native engine mode to remain distinct, so that choosing a directory does not silently alter agent behavior.
11. As a Browser User, I want VM identity, Project, complete local path, actual branch and synchronization status to remain available, so that I know where work happens.
12. As a Browser User, I want rename, refresh and reconnect to retain the same Workspace, so that my local work remains stable.
13. As a Browser User, I want failed creation to retain a recoverable identity, so that retries do not create duplicate clones or native Sessions.
14. As a Browser User, I want to send prompts and receive streamed responses, so that the native engine is usable from the browser.
15. As a Browser User, I want tool activity, results and failures displayed accurately, so that I can understand ongoing work.
16. As a Browser User, I want unsupported controls hidden or disabled with a reason, so that the UI does not promise unavailable features.
17. As a Browser User, I want model and reasoning controls to reflect the selected engine, so that Pi settings are not presented as universal capabilities.
18. As a Browser User, I want native user-input and permission requests to be actionable, so that execution does not stall invisibly.
19. As a Browser User, I want browser disconnects to leave native work running, so that network interruptions do not cancel Tasks.
20. As a Browser User, I want reconnection to show native history and current run state, so that I can continue without submitting a duplicate prompt.
21. As a Browser User, I want uncertain delivery reported honestly, so that an interrupted connection does not cause automatic resubmission.
22. As a Browser User, I want the stop action to target only my Task, so that another Task is not interrupted.
23. As a Browser User, I want background work distinguished from a completed foreground response, so that I know whether the Workspace still has writers.
24. As a Browser User, I want unsupported queueing or steering made explicit, so that messages are not silently lost or given different semantics.
25. As a Browser User, I want original attachments saved in my Task's Workspace, so that files survive reconnects independently of inline model input.
26. As a Browser User, I want image delivery to follow the engine's actual capabilities, so that unsupported images are not falsely reported as seen.
27. As a Browser User, I want to preview and download artifacts through the existing scoped file service, so that switching engines does not change file ownership.
28. As a Browser User, I want code changes displayed through ordinary Git state, so that review does not depend on a particular engine's tool names.
29. As a Browser User, I want platform Checkpoint and push operations to confirm the remote SHA, so that a local commit is not mistaken for synchronized code.
30. As a Browser User, I want platform-created pull requests to use Gitea, so that the workflow does not depend on an engine's GitHub integration.
31. As a Browser User, I want branch drift and disconnected remote checks shown truthfully, so that the platform does not push the wrong branch.
32. As a Browser User, I want archive to retain native history and local files, so that hiding a Task does not destroy its data or stop its work.
33. As a Browser User, I want permanent cleanup to identify retained and removed data, so that native history or attachments are not silently lost or falsely claimed deleted.
34. As a Browser User, I want code continuation to create a new Task from a verified remote Checkpoint, so that another engine can continue the code without pretending to inherit another engine's context.
35. As a VM owner, I want Codex and Claude Code to load their own native settings, so that PI Coffee does not redefine their design.
36. As a VM owner, I want Pi's prompts, LSP, tool discovery, plugins and compaction policies confined to Pi, so that enabling another engine does not inherit those customizations.
37. As a VM owner, I want authentication to complete through the engine's official flow, so that PI Coffee does not collect my provider login credentials or subscription tokens.
38. As a VM owner, I want native authentication and configuration isolated from the Pi Relay, so that my native CLI uses its intended upstream connection.
39. As a VM owner, I want missing or expired authentication reported without deleting the Task, so that I can sign in and resume my work.
40. As a VM owner, I want version upgrades tested before activation, so that a protocol change does not damage existing Sessions.
41. As a maintainer, I want the existing public Host interface to remain the primary test boundary, so that adapters can change without tests depending on their internals.
42. As a maintainer, I want legacy Pi clients and Tasks to remain compatible during rollout, so that adopting a new engine does not require simultaneous replacement of every component.
43. As a maintainer, I want engine health failures contained within the affected engine or Session, so that Pi and other running Tasks remain available.
44. As a maintainer, I want evidence to distinguish API tests, native CLI tests and deployment, so that specification publication is not mistaken for delivered support.

## Implementation Decisions

1. **NE-01 — Repository ownership.** The Agent Runtime owns engine Adapters, Session lifecycle, the canonical Host protocol, Workspace/Gitea operations, file scopes and durable Task bindings. The Server owns the Browser Shell, Gitea OAuth, fixed routing and transparent transport. It does not launch engines, inspect provider credentials or own native history. The frozen V5 baseline remains untouched.
2. **NE-02 — Native-engine boundary.** Introduce the Agent Engine and Agent Adapter concepts around the existing Pi Adapter interface. Common operations include start/resume, prompt, Events, history projection, current run state, supported cancellation and native interaction responses. Engine-specific operations are capability-gated. Avoid either forcing all engines to emulate Pi or building three unrelated Host protocols.
3. **NE-03 — Pi customization isolation.** Preserve Pi's current Chat/Work policies, prompts, tools, LSP Skill/CLI integration, plugins, search/subagent configuration and context-fold behavior. Move automatic Pi configuration injection behind the Pi Adapter. Do not install or inject those customizations, system prompts, tool restrictions, environment overrides or Relay routing into Codex or Claude Code. Existing ordinary project instructions remain subject to each engine's native discovery rules; the platform must not synthesize Pi instructions into another engine's project configuration.
4. **NE-04 — Native permissions.** Preserve the trusted User VM owner deployment and its existing Git/file service boundaries. No new PI Coffee command sandbox or approval tier is introduced. This does not remove Codex or Claude Code's own permission, approval, trust or sandbox behavior, and the platform must not automatically enable bypass settings. Surface supported native requests and use native user configuration without rewriting it to imitate Pi.
5. **NE-05 — Stable identity.** Persist the selected engine, native Session identifier when established, owning VM, Workspace identity and creation/binding state. A native Session identifier is scoped by engine and VM; it is not assumed to equal the platform Conversation ID. Existing records without engine metadata resolve to Pi. Keep native identity out of authorization decisions supplied by the browser. A missing native transcript must produce a recoverable error, not an empty replacement Session.
6. **NE-06 — Engine creation and explicit takeover.** New tasks choose Pi, Codex or Claude Code. Ordinary creation retries, reconnects, model changes and archive/restore preserve the engine and native binding. Only the owner-confirmed [Work Pi/Codex takeover](agent-takeover.md) may replace the active binding, after drift consent and successful reconstruction in a fresh native session. Chat remains Pi and cannot upgrade; Claude is not switchable. Persist authoritative native IDs; never resend uncertain prompts or silently fall back to another engine. Validate the registered workspace before starting an Agent.

7. **NE-07 — Workspace identity versus mode.** Keep Chat and Project Workspace semantics, independent clones, assigned branches, paths and file ownership unchanged. The existing Chat/Work product labels must not claim that Codex or Claude Code is running Pi's Chat/Work policy. Native planning, reasoning or permission modes are native capabilities, not automatic translations of Pi slash commands. A native mode change does not move the Workspace.
8. **NE-08 — Codex transport.** Prefer the installed native Codex App Server using its documented local stdio protocol behind the Host. Keep the process and native history in the User VM and translate thread/turn/item lifecycle into the common Host contract. No MCP layer or externally exposed Codex listener is required. Pin and record the verified CLI/protocol version; generate or consume version-appropriate schemas where provided. Experimental upstream interfaces are a version-validation requirement, not a claim of stable support across arbitrary releases.
9. **NE-09 — Claude Code transport.** Run the unmodified official Claude Code CLI through a documented programmatic/streaming interface supported by the pinned release. Preserve native tools, prompt behavior, project/user settings, native history and official authentication. Validate stream delivery, continuation and cancellation before choosing the concrete transport. Do not use screen scraping, undocumented provider endpoints, extracted subscription tokens or a patched binary. If a required operation lacks a supported interface, report its capability as unavailable and record the precise gap rather than inventing equivalent behavior.
10. **NE-10 — Authentication and service boundary.** Continue using Gitea identity for the Browser Shell and fixed VM routing. Each user separately authenticates their native engine through its official flow in their User VM. The CLI manages its own credential storage and provider requests; Browser Shell, Web Server and Host must not extract, pool or intermediate provider passwords, subscription credentials or session tokens. Coarse engine/authentication readiness may be exposed through supported status interfaces without credential contents. Provider authentication recovery is not Gitea logout and must not erase Workspace or history.
11. **NE-11 — Native CLI versus SDK.** The selected Claude route is a remote interface to the user's own unmodified CLI. The third-party ClaudeCodeUI implementation is technical prior art, not authorization or proof of equivalent authentication rights. Do not substitute an Agent SDK product using subscription credentials. Any later SDK design needs its own supported API-key/cloud-provider authentication and explicit scope decision. Native authentication does not exempt the product from applicable service terms; no claim of blanket legal approval is made.
12. **NE-12 — Capability discovery.** Host reports configured engines, installation/version/readiness and per-engine support for history, cancellation, native questions/approvals, models, reasoning, images, queueing/steering, compaction and background-work state as applicable. Distinguish unsupported, unauthenticated, unavailable and temporarily failed. Never fabricate Pi-compatible model lists, token costs, permission states or command catalogs. Model selection is separate from Agent Engine selection: list only models supported by the bound engine, and allow changes only where its native capabilities permit them. A model/provider name never changes the Task's engine; for example, selecting a supported Claude model within Pi still uses Pi, not Claude Code. Do not represent another Agent Engine as a model-menu option. Readiness checks must not trigger paid model turns. Complete histories and secrets stay in the User VM.
13. **NE-13 — Public interface compatibility.** Extend the existing Host HTTP/WebSocket interface additively with engine selection, stable binding metadata and capability information. Supply engine-neutral presentation Events for new engines while retaining the deployed Pi vocabulary during migration. Normalize responses in the owning Host Adapter, not in the gateway. Capable browsers may request new engines; older clients keep working with Pi and receive explicit unsupported-operation responses instead of misleading Pi-shaped data for a non-Pi Task. Document concrete schemas and version negotiation before implementation is considered complete.
14. **NE-14 — Lifecycle and delivery.** The Host owns runs independently of viewers. Browser/gateway disconnect only detaches a Bridge; it does not interrupt the CLI. Reconnect reconstructs completed history from the native source plus a bounded in-flight replay and authoritative run state. Host restart or CLI failure must distinguish idle, running, interrupted, awaiting input and unknown state. Do not automatically replay uncertain prompts or restart interrupted model work. Acknowledged receipt is separate from successful run completion.
15. **NE-15 — Native interaction and cancellation.** Correlate responses with the correct Conversation, native run and outstanding request; reject stale or cross-Task responses. Preserve native approval meaning and never auto-approve because Pi has no platform permission prompts. Cancellation uses a supported native operation and waits for a terminal state before claiming completion. One Task's stop/disconnect must not kill another Task or an unrelated shared process. A completed foreground answer is not proof that background writers have stopped.
16. **NE-16 — Gitea reuse.** Keep the existing CodeForge and ordinary Git operations for Project registration, branch selection, independent cloning, status/Diff/Checks, Checkpoint, remote-SHA confirmation and Gitea pull requests. Launch every engine in its registered Workspace. Preserve the existing Conversation Branch authority, branch-mismatch detection and offline/stale states. The engine may perform ordinary Git through its own tools; platform status reads actual repository state afterward. Platform PR creation does not depend on a provider's GitHub-specific integration. An existing code Checkpoint can seed a new Task using another engine without transferring native history.
17. **NE-17 — Writers and destructive lifecycle.** Replace Pi-specific lifecycle assumptions with adapter-reported foreground/background state at existing workspace-operation guards. Unknown writer state must not be treated as idle. Checkpoint, PR and permanent cleanup must not race active writers; retain the current behavior of rejecting/deferring these actions with an actionable reason. Archive remains non-destructive and does not stop already-running work. Before cleanup, quiesce all owned writers and uploads, verify the exact native binding, and honor explicit local/history deletion scope. If native history deletion cannot be safely supported, report retained data or block that requested complete cleanup; never report complete erasure.
18. **NE-18 — Files and native data.** Reuse the scoped streaming upload, preview, artifact and download interfaces. Retain original bytes before submitting selected inline images; pass only explicitly selected files/references supported by that engine. Native transcripts and credential stores remain in their native User VM locations, associated by the binding; they need not be moved into the Checkout. Preserve platform-owned data exclusions. Distinguish native secrets/runtime state from legitimate versioned project instruction or Skill files; do not blanket-ignore or delete all engine-named project configuration.
19. **NE-19 — Minimal Browser Shell change.** Keep the task list, conversation/composer and changes panel. Add compact engine selection to the existing new-task entry and a compact engine indicator with explicit Pi/Codex Work takeover for eligible existing Tasks. Gate controls by capabilities and keep Workspace type, engine identity and native mode distinct. Pi-specific controls remain Pi-only. Do not introduce another navigation system, VM manager or theme redesign.
20. **NE-20 — Upgrade and rollout.** Register only configured native installations and record verified versions; do not install, authenticate, upgrade or replace a user's CLI as a side effect of creating a Task. Deploy a backward-compatible Host before enabling new Browser Shell controls. Test Pi regressions throughout. Rollback disables new engine creation while preserving bindings, directories and native transcripts; unsupported existing Tasks remain visible with a clear state. Server rollout depends on the Agent public contract, not on copying implementation internals.

## Testing Decisions

1. **Primary seam.** Prefer the existing public Host HTTP/WebSocket seam for one shared black-box contract suite parameterized by engine. Drive public requests and inspect public responses plus authorized filesystem/Gitea results. Do not assert adapter class names, internal call counts, private transcript formats or speculative output wording. Use deterministic fake native processes/transports for protocol faults and races, rather than paid model calls for every case.
2. **Existing prior art.** Reuse the Host server, protocol, Pi Adapter, Conversation Workspace, Gitea client/workspace, transfer and lifecycle test patterns. The Server already has authenticated HTTP/WebSocket gateway tests and Browser Shell continuity tests. Extend those existing boundaries; do not introduce a second generic test framework or a separate suite for every UI component.
3. **Browser coverage.** Add targeted tests through the real Browser Shell controller for engine selection, capability gating, native request dialogs and reconnect errors. Reuse current responsive-layout probes to show that the three-pane layout remains intact. These complement the main Host contract; they do not replace it with mocked-success screenshots.
4. **Small real-engine acceptance.** For each new engine, use the owner's installed, officially authenticated CLI and a disposable/synthetic Gitea Project. Run one short code task and one local-file task, proving prompt/tool streaming, registered cwd, original attachment handling, reconnect/native resume, a targeted stop, platform Checkpoint/PR and archive/restore. Reuse deterministic tests for the failure matrix; no repeated paid-run matrix, new VM provisioning, destructive snapshot rehearsal or exhaustive performance certification is required.
5. **Version and native fidelity.** Capture the engine version, integration transport and credential-free launch/configuration evidence. Prove Pi customization is absent from the other engines' launch setup and that required native settings are loaded by the documented mechanism. If semantic fidelity or a native operation cannot be observed at the supported interface, report that boundary explicitly rather than asserting equivalence to the terminal UI.

| Acceptance ID | Observable result |
|---|---|
| NE-AC01 | Legacy Pi Tasks retain engine, native history, Workspace and current Chat/Work behavior after migration; no new default routing is introduced. |
| NE-AC02 | A new Task records Pi, Codex or Claude Code and one Workspace, then binds the authoritative native ID; duplicate creation and uncertain-start recovery do not create another clone or resend a prompt. Implicit engine changes are rejected, leaving the original binding intact; explicit Work takeover follows its separate consent and transaction contract. |
| NE-AC03 | Same native IDs from different engines cannot cross-open history, authorize files or receive each other's responses. |
| NE-AC04 | Missing CLI, unsupported version or missing authentication produces an actionable state with retained Task data and no fallback to another engine. |
| NE-AC05 | Each engine receives the registered cwd and its own native configuration; Pi prompts, Skills, LSP injection, Relay overrides and permission bypasses do not leak into the other engines. |
| NE-AC06 | Text/tool Events stream in order and surface failures; unsupported queueing, images, compaction or controls are explicit rather than acknowledged as successful. Model selection is scoped to the bound engine and cannot change it. |
| NE-AC07 | Refresh and gateway disconnect leave the same run alive; reconnect/resume recovers native history and status without duplicate prompts or false completion. |
| NE-AC08 | Host/native-process failure marks interrupted or unknown work honestly; restarting the Host does not automatically repeat a model turn. |
| NE-AC09 | Native questions/approvals route to the owning Task; stale answers are rejected and unanswered requests remain visible on reconnect when supported. |
| NE-AC10 | Stop affects only the requested run; terminal status and background activity are distinguished, including delayed completion and unsupported child-state reporting. |
| NE-AC11 | Original file bytes survive upload/download and reconnect in the owning Workspace; wrong-user/VM/Conversation access is rejected for every engine. |
| NE-AC12 | Two Tasks using the same Project, including different engines, get independent clones and branches; Project type does not inject Pi runtime mode. |
| NE-AC13 | Diff and actual branch reflect native edits; Checkpoint confirms the Gitea SHA and PR targets the correct Repository/branches; drift/offline state cannot appear synchronized. |
| NE-AC14 | Checkpoint, PR and cleanup reject/defer active or unknown writers; ordinary platform locks are not presented as restrictions on the VM owner's own commands. |
| NE-AC15 | Archive retains files, native history and existing work; explicit cleanup affects only the verified binding and reports partial failure or retained native data truthfully. |
| NE-AC16 | Code continuation creates a new Task/branch from a verified remote SHA, with no claim of native context migration or unversioned-file transfer. |
| NE-AC17 | Old Pi clients continue operating, new clients handle old Hosts, and unsupported new-engine operations fail clearly; gateway forwarding remains transparent. |
| NE-AC18 | Provider credentials and transcript bodies do not appear in central persistence, logs, Issues or test evidence; the native-login route is not silently replaced by an SDK subscription-token route. |

Run the documented repository checks from a fresh clone before implementation acceptance. Record the exact revisions, versions, commands, minimal real-engine results and unverified capabilities in the implementation Issues. Creating this SPEC or passing the existing Pi suite does not satisfy native-engine acceptance.

## Out of Scope

- Unverified native CLI versions and provider/model combinations outside the recorded release.
- Sharing one native Session between engines, changing a Task's engine outside explicit Work takeover, converting native transcript formats or transferring live model context across VMs.
- Rebuilding Codex or Claude Code prompts, tools, Skills, context management, permission behavior or internal agent loops with Pi components.
- Modifying the Claude Code binary, scraping its UI/private provider endpoints, provider credential pooling, subscription-token relays, quota resale, or offering provider login forms owned by PI Coffee.
- A Claude Agent SDK product that reuses subscription login; such a route requires a separate scope/authentication decision.
- Automatically adding Pi's LSP integration to other engines, forcing MCP, or requiring additional externally reachable engine services.
- Replacing the current layout, adding platform worktrees/local merge orchestration, or adding VM/container lifecycle management.
- Complete parity with every native terminal feature, a complete history-cache redesign, or unrelated frontend backlog features.
- Claiming legal approval from open-source availability, a third-party UI example, or the user's ownership of an account alone.

## Further Notes

- Implementation is divided into [M0–M5](../development/native-agents-m0-m5.md), with one delivery Issue per milestone. Native transport feasibility precedes Adapter acceptance; source research does not count as a completed real-engine probe.

- [ADR-0013](../adr/0013-native-agent-engines.md) records the engine boundary and the scope refinements to earlier Pi-specific decisions. The [Pi Agent contract](./pi-agent.md), [Gitea Workspace contract](./gitea-workspaces.md) and [Conversation Workspace contract](./conversation-workspaces.md) remain authoritative within their respective scopes.
- The main implementation Issue is [Agent #48](http://gitea:3000/awangs/pi-coffee/issues/48); the separate Server Issue is [Server #6](http://gitea:3000/awangs/pi-coffee-server/issues/6). The Agent public contract is a prerequisite for Server activation. Existing frontend fixes remain a separate review; this feature does not merge or deploy them implicitly.
- Read implementation state from code and acceptance evidence. The implemented Host factory, lifecycle guards and Browser Shell now consume the additive engine contract. The dated evidence identifies tested behavior and remaining capability limits.
- The testing seam was presented to the owner during synthesis. The default is public-interface regression plus a small real-engine smoke, consistent with the owner's preference for proving the workflow without excessive testing; broader execution remains an implementation choice only if a demonstrated failure warrants it.
- Sources inspected on 2026-09-23: [Codex App Server](https://developers.openai.com/codex/app-server), [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance), and [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview). The distinction between an end user's official login to hosted unmodified Claude Code and third-party SDK authentication must remain explicit. Applicable terms should be rechecked before release; this SPEC is not a provider's written approval.
- [ClaudeCodeUI runtime at revision 6c51fcaa76c250af70561fad7312c5a7f841a733](https://github.com/siteboon/claudecodeui/blob/6c51fcaa76c250af70561fad7312c5a7f841a733/server/modules/providers/list/claude/claude-runtime.provider.js) demonstrates streaming, native ID mapping and interruption through the Agent SDK. It is technical prior art only; this SPEC neither adopts its authentication path nor copies its implementation. The selected native CLI transport and pinned-version verification are recorded in the implementation evidence and deployment runbook.

## Pi-only Chat creation — owner correction, 2026-09-23

Agent #60 / Server #4 supersedes engine-independent Chat creation. New Chat
Tasks default to Pi and reject Codex/Claude at the Host HTTP creation boundary
before persisting a workspace. Work supports all three engines with a Gitea
Project and independent Checkout. Engine bindings change only through the explicit Work takeover contract. Native local
tasks created before this correction remain accessible; their identity, files
and history are not migrated or relabeled by this change.

Pi account import into Web Server is a possible future direction only. No
credentials move in this change; native Codex/Claude authentication and VM data
ownership remain unchanged.
