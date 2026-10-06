# Project specification freshness — 2026-10-06

Tracking: [Server #66](https://github.com/awangs1986/pi-coffee-server/issues/66).
Reviewed code baseline: Server main
`5073c97034262775925f7ca8da8c808fec8ed7e2`, identical on GitHub and Gitea at review.
This change edits documentation only; it does not activate a runtime release.

## Confirmed requirements

The owner confirmed the project refocus and requested that specifications remain
current. Their clarified operating model is one physical owner, one machine/OS
login, and Web identities submitting into separate conversations and directories.
Application scoping is retained; this is not a hostile-user OS isolation model.
[ADR-0020](../adr/0020-unified-github-authority.md) already records that boundary.
Older dedicated-VM and company-account rationales remain dated historical evidence.

Keep the following current decisions when editing or implementing a feature:

- GitHub main owns source; Gitea mirrors the same commit. Server owns Web, Host,
  Relay and all native Adapters; Pi-only packages use the independently versioned
  `pi-coffee/packages` directories. MISHU is the approved independent Gitea fork.
- Ordinary Chat is Pi-only and zero-system. Automatic Host/project/runner guidance
  stays out, including after reset/restart. Explicit SSHME requests and a selected
  MISHU role retain their separate opt-in contracts.
- Work has an independent checkout. Native engine login, tools, history and
  automatic compaction remain native. Only explicit Work Pi/Codex takeover changes
  the active engine binding. Fork instead creates a new Conversation and folder.
- Web manages Skills; Host stores and executes native files. Machine-level changes
  are owner-controlled; project scope means one task's checkout.
- Work runner configuration and explicit Conversation-scoped SSHME remain separate.
- Browser disconnection alone is not a crash verdict. The current incident inquiry
  concerns Host/Web abnormal exit, unresponsiveness or automated recovery. No
  browser reconnect implementation is authorized by this documentation refresh.

## Reconciliation and source evidence

| Current claim | Implementation and public-seam evidence | Documentation treatment |
| --- | --- | --- |
| Five Work engines, per-engine readiness and native transports | `src/host/agent-adapter.ts`, `src/host/native/factory.ts`, `src/host/native/{claude,acp}.ts`, `src/shared/protocol.ts`; `test/native-engines.test.ts` | Update domain model, repository entries, README, native contracts and Host interface; retain actual-account limits |
| Ordinary Chat zero-system after reset and restart | `src/host/pi-adapter.ts`, `src/host/pi-environment-extension.ts`, Work-only runner selector in `src/host/server.ts`; `test/chat-context-reset.test.ts` | Remove the contradictory Skill-spec Host sentence; link the authoritative zero-system contract |
| Stable task identity, independent clones and upgrade-safe native stores | `src/host/workspaces.ts`, `src/host/task-storage.ts`, `src/host/native/factory.ts`; `test/task-storage-http.test.ts` | Replace the Task aggregate/worktree definition; mark old directory layout as pre-bundle; remove the Web Chat-to-Work claim |
| Local selection, bounded cache and scoped display ownership | `public/conversation-navigation.js`, `public/conversation-display.js`, `public/conversation-repository.js`; `test/local-first-app.test.ts` | Domain model distinguishes view, native history and delivery; existing navigation contract remains required |
| Existing-task composer shows a model label limited to 12 Unicode characters | `public/app.js` Agent-menu rendering | Correct the stale read-only engine-indicator description without changing the layout |
| Web-managed native Skill roots and shared-owner gate | `src/host/skills.ts`, `/api/skills` in `src/host/server.ts`; `test/skills-http.test.ts` | Add Cursor/Grok roots and current Claude completion; retain collision, source and lifecycle requirements |
| Host follow-up queue versus native steering | `src/shared/protocol.ts`, `src/host/input-queue.ts`, `src/host/native/{claude,acp}.ts`, `public/queue-controls.js`; `test/native-engines.test.ts` | Document Claude/Cursor/Grok follow-ups without claiming immediate steering |
| Independent Pi packages, native compaction and manual Handoff | `package.json`, `package-lock.json`, `src/host/pi-extensions.ts`; `test/pi-package-integration.test.ts` | Replace current aggregate-composition instructions; retain initial pinned versions as historical evidence |
| Current-request MISHU communication and authorization | `src/host/mishu.ts`, pinned MISHU 0.1.6 in `package.json`, `test/mishu-http.test.ts`; [#65](https://github.com/awangs1986/pi-coffee-server/issues/65) | Preserve implemented v1 versus planned complete-secretary stages; no completion claim for #64 |
| Bounded service recovery, separate from task tracking | `scripts/coffee-watchdog.py`, `deploy/watchdog/`; `test/watchdog.test.ts` | Keep service watchdog distinct from MISHU business follow-up |

The source paths above are inspection evidence, not a claim that every listed
test or native account was re-executed. Tests actually run are recorded below.
Original ADRs, acceptance identifiers and implementation evidence remain intact.

## Remaining requirements and environment gates

- [MISHU #64](https://github.com/awangs1986/pi-coffee-server/issues/64) remains open
  and ready for implementation: persistent Task Brief/Reply Obligation, correlated
  event observation, Notification Outbox, delayed-result reporting and restart
  reconciliation. All of its user stories remain required. The 0.1.6 authorization
  interpretation repair does not implement this background responsibility.
- [Cursor/Claude](../spec/cursor-claude.md) and [Grok](../spec/grok-build.md) record
  actual-account gates and missing native capabilities. The owner's later Grok
  login report is not proof of authenticated ACP model acceptance. No provider
  turn or five-engine production certification is performed in this refresh.
- DDNSTO external login remains an unresolved deployment design: exposing Web
  alone does not make internal Gitea OAuth or native file endpoints reachable.
  The owner has not selected a new public authentication/network arrangement;
  this refresh does not expose Gitea or change authentication.
- Existing logs lack per-browser connection timing, so the latest browser
  disconnect time cannot be established. Read-only service inspection through
  Beijing 2026-10-06 15:43 found unchanged Host/Web PIDs since the 06:32 deployment
  and no subsequent crash/recovery record. This observation does not exclude a
  transient request/connection stall or prove every future run healthy.

## Verification and publication boundary

- Before documentation edits: typecheck, `npm run build`, and five selected
  suites (`local-first-app`, `chat-context-reset`, `task-storage-http`,
  `native-engines`, `watchdog`) passed 65 tests against `5073c97`. An initial direct
  test invocation omitted the documented build and failed on generated vendor
  imports; building then running the same suites resolved that setup failure.
- `git diff --check` and relative file-link validation passed (302 references,
  no broken targets at review). The first complete check passed 832 tests and
  caught one documentation-only vocabulary violation in this new audit; the
  wording was corrected without changing code or weakening the scan. Final
  `npm run check` then passed all 104 files / 833 tests. Publication and
  mirror verification are recorded separately in Server #66.
- No code, installed Skill, model login, task data or service is changed by this
  patch. Publication updates source documentation only. Runtime remains the
  previously activated release until a separate authorized deployment.

## Maintenance entry

[AGENTS.md](../../AGENTS.md) now requires the affected current spec and its index
to be updated with a behavior change, retaining unmet acceptance criteria and
dated evidence. [CONTEXT.md](../../CONTEXT.md) supplies current terms;
[docs/index.md](../index.md) routes to feature contracts. This is a maintenance
rule, not an automatic scheduled job or permission to rewrite historical ADRs.
