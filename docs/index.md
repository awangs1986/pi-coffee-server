# PI Coffee documentation map

## Current authority

[ADR-0021](adr/0021-pi-only-source-authority.md) assigns Pi-only implementation to [pi-coffee](https://github.com/awangs1986/pi-coffee). This repository retains the latest Host, Web, Relay and native Agent adapters and consumes a pinned Pi package. Each GitHub main is authoritative for its scope and has an identical Gitea mirror. ADR-0020 remains historical for the earlier unification.

## Read by task

- Source reconciliation or release: [comparison and acceptance](reviews/repository-unification-20260927.md), [AGENTS.md](../AGENTS.md), [BACKLOG.md](../BACKLOG.md).
- Product workbench: [Arena navigation](spec/arena-navigation.md), [Context Usage](spec/context-usage.md), [task directories](spec/conversation-workspaces.md), [upgrade-safe task bundles](spec/task-storage.md), [Skills](spec/skill-management.md).
- Code forges: [Gitea workspaces](spec/gitea-workspaces.md) and [GitHub repositories as Work Projects](adr/0022-github-work-projects.md).
- Diff panel: [@pierre/diffs renderer, per-file loading and line comments](adr/0023-pierre-diff-renderer.md); layout and behavior in [Arena navigation](spec/arena-navigation.md#diff).
- Agent integration: [native engines](spec/native-agent-engines.md), [native browser](spec/native-agent-browser.md), [shared Host](adr/0010-one-shared-user-vm-with-gitea-identity-and-per-user-folders.md), [Codex adapter](adr/0011-agent-seam-admits-codex-app-server.md).
- Pi-only tools: [Chat/Work prompts](spec/harness-prompt.md), [work tools](spec/work-tools.md), [LSP CLI](spec/lsp-middle-layer.md). Pi customization does not change native Codex or Claude tools.
- Runtime boundaries: [wire protocol](protocol.md), [Host interface](host-interface.md), [invariants tests cite by id](INVARIANTS.md).
- Deployment: [unified release runbook](deployment/unified-release.md). Historical environment-specific evidence remains under `docs/deployment/evidence/`.

Issues carry scope, status and acceptance evidence; checked-in code and tests carry implemented behavior. [Server recovery Issue #17](http://gitea:3000/awangs/pi-coffee-server/issues/17) is the current reconciliation entrypoint. Picode/V5 is a frozen reference.

- [Pi 0.87.1 main upgrade](reviews/pi-0.87.1-main-20260927.md): pinned runtime, optional-plugin compatibility and reproducible checks; [Server #18](http://gitea:3000/awangs/pi-coffee-server/issues/18).

- [Pi package consumer integration](development/pi-package-consumer.md): dependency pin, migration evidence and preservation of current Host/Web behavior; [Server #19](http://gitea:3000/awangs/pi-coffee-server/issues/19).

- [Harness ffd23ea deployment](deployment/harness-ffd23ea-20260929.md): standalone plugin rollout on the existing Host; Server #29, with the pre-existing slash-command limitation tracked in #30.

- [Experimental manual Handoff](spec/manual-handoff.md): same-Conversation recovery, independent plugin version, native automatic compaction; GitHub Server #2.
