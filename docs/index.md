# PI Coffee documentation map

Start with [the repository map](../REPOSITORIES.md) before choosing a source directory or upgrading a plugin.

## Current authority

[ADR-0021](adr/0021-pi-only-source-authority.md) assigns Pi-only implementation to [pi-coffee](https://github.com/awangs1986/pi-coffee). This repository retains the latest Host, Web, Relay and native Agent adapters and consumes a pinned Pi package. Each GitHub main is authoritative for its scope and has an identical Gitea mirror. ADR-0020 remains historical for the earlier unification.

## Read by task

- Source reconciliation or release: [comparison and acceptance](reviews/repository-unification-20260927.md), [AGENTS.md](../AGENTS.md), [BACKLOG.md](../BACKLOG.md).
- Product workbench: [Arena navigation](spec/arena-navigation.md), [Context Usage](spec/context-usage.md), [task directories](spec/conversation-workspaces.md), [upgrade-safe task bundles](spec/task-storage.md), [Skills](spec/skill-management.md).
- Existing Gitea repository picker: [contract](spec/gitea-workspaces.md#existing-gitea-repository-selection-2026-09-30), [Server #5](https://github.com/awangs1986/pi-coffee-server/issues/5).
- Code forges: [Gitea workspaces](spec/gitea-workspaces.md) and [GitHub repositories as Work Projects](adr/0022-github-work-projects.md).
- Diff panel: [@pierre/diffs renderer, per-file loading and line comments](adr/0023-pierre-diff-renderer.md); layout and behavior in [Arena navigation](spec/arena-navigation.md#diff).
- Agent integration: [native engines](spec/native-agent-engines.md), [native browser](spec/native-agent-browser.md), [shared Host](adr/0010-one-shared-user-vm-with-gitea-identity-and-per-user-folders.md), [Codex adapter](adr/0011-agent-seam-admits-codex-app-server.md).
- Pi-only tools: [Chat/Work prompts](spec/harness-prompt.md), [work tools](spec/work-tools.md), [LSP CLI](spec/lsp-middle-layer.md). Pi customization does not change native Codex or Claude tools.
- Runtime boundaries: [wire protocol](protocol.md), [Host interface](host-interface.md), [invariants tests cite by id](INVARIANTS.md).
- Deployment: [unified release runbook](deployment/unified-release.md). Historical environment-specific evidence remains under `docs/deployment/evidence/`.
- Startup recovery: [emergency mode](deployment/unified-release.md#emergency-startup), optional Pi plugin degradation without changing native accounts or replaying prompts; [Server #41](https://github.com/awangs1986/pi-coffee-server/issues/41).

Issues carry scope, status and acceptance evidence; checked-in code and tests carry implemented behavior. [Server recovery Issue #17](http://gitea:3000/awangs/pi-coffee-server/issues/17) is the current reconciliation entrypoint. Picode/V5 is a frozen reference.

- [Pi 0.87.1 main upgrade](reviews/pi-0.87.1-main-20260927.md): pinned runtime, optional-plugin compatibility and reproducible checks; [Server #18](http://gitea:3000/awangs/pi-coffee-server/issues/18).

- [Pi package consumer integration](development/pi-package-consumer.md): dependency pin, migration evidence and preservation of current Host/Web behavior; [Server #19](http://gitea:3000/awangs/pi-coffee-server/issues/19).

- [Harness ffd23ea deployment](deployment/harness-ffd23ea-20260929.md): standalone plugin rollout on the existing Host; Server #29, with the pre-existing slash-command limitation tracked in #30.

- [Experimental manual Handoff](spec/manual-handoff.md): same-Conversation recovery, independent plugin version, native automatic compaction; GitHub Server #2.

- [Versioned plugin monorepo consumption](development/plugin-monorepo.md): unified Pi source, independent release artifacts and preserved legacy integration pin.

- [Runtime upgrade and plugin composition](development/plugin-monorepo.md#pi-0991-runtime-upgrade-2026-09-29): Pi 0.99.1, independently versioned plugins and Codex CLI 0.159.1; [Server #4](https://github.com/awangs1986/pi-coffee-server/issues/4).

- [Pi 0.99 upgrade plan P0–P10](development/pi-099-upgrade-plan-20260930.md): native-first core/plugin upgrades, RPC completion, child-runtime parity and legacy assembly removal; [impact audit](research/pi-099-upgrade-impact-20260930.md).
- Native Codex Skill completion: [contract](spec/skill-management.md#codex-completion-2026-09-30), [Server #10](https://github.com/awangs1986/pi-coffee-server/issues/10).

- Native context presets, Codex totals/compaction and send-gated attachments: [context contract](spec/context-usage.md#native-context-controls-2026-09-30), [attachment boundary](spec/task-storage.md#attachment-send-boundary-2026-09-30), [Server #11](https://github.com/awangs1986/pi-coffee-server/issues/11).

- Compact transcript file summaries: [contract](spec/arena-navigation.md#compact-transcript-file-summaries-2026-09-30), [Server #12](https://github.com/awangs1986/pi-coffee-server/issues/12).

- Latest-turn edited-file summaries: [contract](spec/arena-navigation.md#compact-transcript-file-summaries-2026-09-30), [Server #13](https://github.com/awangs1986/pi-coffee-server/issues/13).

- Windows test computer with WSL: [contract](spec/test-runners.md), [Server #14](https://github.com/awangs1986/pi-coffee-server/issues/14), [single-Windows correction #15](https://github.com/awangs1986/pi-coffee-server/issues/15).

- Session environment and consent guidance: [contract](spec/session-environment.md), [Server #16](https://github.com/awangs1986/pi-coffee-server/issues/16).

- SSHME assistance on the Web user’s computer: [contract](spec/sshme.md), [Server #17](https://github.com/awangs1986/pi-coffee-server/issues/17).

- Editable pending instructions: [contract](spec/input-queue.md), [Server #18](https://github.com/awangs1986/pi-coffee-server/issues/18).

- Work Pi/Codex takeover: [current contract](spec/agent-takeover.md), [Server #19](https://github.com/awangs1986/pi-coffee-server/issues/19).
- [2026-10-01 specification freshness audit](reviews/spec-freshness-20261001.md): current behavior, corrected stale clauses and historical boundaries.

- Readable first-user title fallback: [navigation contract](spec/arena-navigation.md#first-user-title-fallback-2026-10-01), [Server #20](https://github.com/awangs1986/pi-coffee-server/issues/20).

- Fixed 500K upper context preset: [current contract](spec/context-usage.md#native-context-controls-2026-09-30), [Pi #5](https://github.com/awangs1986/pi-coffee/issues/5), [Server #11](https://github.com/awangs1986/pi-coffee-server/issues/11).

- Fast conversation switching and bounded runtime resources: [contract](spec/conversation-switching.md), [Server #21](https://github.com/awangs1986/pi-coffee-server/issues/21).

- Confirmed, lightweight conversation rename: [contract](spec/arena-navigation.md#confirmed-conversation-rename-2026-10-01), [Server #22](https://github.com/awangs1986/pi-coffee-server/issues/22).

- Confirmed question delivery and batched history rendering: [protocol](protocol.md#confirmed-dialog-answers-2026-10-01), [Server #23](https://github.com/awangs1986/pi-coffee-server/issues/23).

- Blocking Codex questions and legacy asynchronous-question compatibility: [confirmed question contract](protocol.md#confirmed-dialog-answers-2026-10-01), `scripts/probe-codex-questions.mjs`.

- [Pi 1.0 upgrade and activation](deployment/pi-100-upgrade.md): immutable plugin/source pins, native checks and separate production activation.

- Codex model/effort restoration after Host restart: [native lifecycle contract](spec/native-agent-engines.md), [probe and evidence](development/codex-model-restore.md), [Server #30](https://github.com/awangs1986/pi-coffee-server/issues/30).

- [Bounded local watchdog](deployment/watchdog.md): independent Web/Host liveness recovery, durable circuit breaker and maintenance pause; [Server #34](https://github.com/awangs1986/pi-coffee-server/issues/34).

- Per-user GitHub OAuth accounts and task-scoped Git/gh: [contract](spec/github-accounts.md), [Server #36](https://github.com/awangs1986/pi-coffee-server/issues/36).
- GitHub OAuth App provisioning and production acceptance: [activation guide](deployment/github-accounts.md).
- Conversation Fork: [native and Handoff modes](spec/conversation-fork.md), [Server #39](https://github.com/awangs1986/pi-coffee-server/issues/39). Independent task snapshots preserve source conversations and scoped authorization.

- [Historical PR salvage review](reviews/legacy-pr-salvage-20261003.md): current-main recovery and rejection map for five old Gitea PRs; [Server #31](https://github.com/awangs1986/pi-coffee-server/issues/31).

- [Draft thinking selection](spec/native-agent-browser.md#thinking-selection-before-task-creation--2026-10-03): Pi/Codex model-specific choices, medium default and first-prompt acknowledgement; [Server #33](https://github.com/awangs1986/pi-coffee-server/issues/33).

- Local-first conversation synchronization, bounded live rendering and pixel status/welcome animations: [contract](spec/local-first-conversation-sync.md), [durable display-index decision](adr/0024-durable-display-index.md).

- [T1–T4 workbench refinements, Server #42](https://github.com/awangs1986/pi-coffee-server/issues/42): responsive conversation actions, compact welcome, sidebar running cat, account-wide testing guidance and explicitly invoked conversation-scoped SSHME.

- Inline image preview/download: [task-storage contract](spec/task-storage.md#inline-conversation-images-2026-10-04), [Server #43](https://github.com/awangs1986/pi-coffee-server/issues/43).

- Review corrections and busy conversation switching: [Server #44](https://github.com/awangs1986/pi-coffee-server/issues/44), [sync contract](spec/local-first-conversation-sync.md#review-corrections-2026-10-04-server-44), [Pi security patch](deployment/unified-release.md#pi-101-security-patch-2026-10-04-server-44).

- Latest history after busy switching: [Server #45](https://github.com/awangs1986/pi-coffee-server/issues/45), [freshness and reader-intent contract](spec/local-first-conversation-sync.md#latest-history-correctness-after-selection-2026-10-04-server-45).

Latest-history selection regression and acceptance: [2026-10-04 evidence](reviews/latest-history-switch-20261004.md).
