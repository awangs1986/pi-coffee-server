# PI Coffee documentation map

## Current authority

[ADR-0020](adr/0020-unified-github-authority.md) defines GitHub as the source authority and retains Host in `pi-coffee-server`. Gitea mirrors the same source revision while continuing to provide product login, projects and Issues. Earlier repository split and per-user-VM-only documents are historical where they conflict with this decision.

## Read by task

- Source reconciliation or release: [comparison and acceptance](reviews/repository-unification-20260927.md), [AGENTS.md](../AGENTS.md), [BACKLOG.md](../BACKLOG.md).
- Product workbench: [Arena navigation](spec/arena-navigation.md), [Context Usage](spec/context-usage.md), [task directories](spec/conversation-workspaces.md), [Skills](spec/skill-management.md).
- Agent integration: [native engines](spec/native-agent-engines.md), [native browser](spec/native-agent-browser.md), [shared Host](adr/0010-one-shared-user-vm-with-gitea-identity-and-per-user-folders.md), [Codex adapter](adr/0011-agent-seam-admits-codex-app-server.md).
- Pi-only tools: [Chat/Work prompts](spec/harness-prompt.md), [work tools](spec/work-tools.md), [LSP CLI](spec/lsp-middle-layer.md). Pi customization does not change native Codex or Claude tools.
- Runtime boundaries: [wire protocol](protocol.md), [Host interface](host-interface.md), [invariants tests cite by id](INVARIANTS.md).
- Deployment: [unified release runbook](deployment/unified-release.md). Historical environment-specific evidence remains under `docs/deployment/evidence/`.

Issues carry scope, status and acceptance evidence; checked-in code and tests carry implemented behavior. [Server recovery Issue #17](http://gitea:3000/awangs/pi-coffee-server/issues/17) is the current reconciliation entrypoint. Picode/V5 is a frozen reference.
