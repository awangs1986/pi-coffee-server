# ADR-0020: GitHub authority and one source repository

Status: Pi implementation placement superseded by [ADR-0021](0021-pi-only-source-authority.md). Host/Web placement and GitHub-first publication remain accepted. Originally accepted, 2026-09-27. Supersedes the repository placement in ADR-0011 (split repositories), and earlier Gitea-first publication instructions.

## Decision

The owner chose: keep Host in the current GitHub repository. `https://github.com/awangs1986/pi-coffee-server` owns Browser, gateway, Relay, Host, Pi harness/LSP, and Codex/Claude adapters. Components remain independently runnable and communicate through their existing boundaries. There is no new Agent GitHub repository.

Gitea `http://gitea:3000/awangs/pi-coffee-server` mirrors the identical main commit. Gitea continues to provide product identity, project hosting and internal Issues; those roles do not make its divergent source tree the release authority. The former Gitea `pi-coffee` repository remains readable as history.

The deployment supports one physical owner, one native machine login, and separately authenticated Web participants submitting into distinct conversations and directories. These directories provide application-level privacy, not an OS sandbox. Native provider login stays on the Host. Per-user routing to independent Hosts remains compatible.

Every shared Host API selects the same authenticated user scope as WebSocket sessions. Workspace state, lifecycle locks, file grants and broadcasts belong to that scope. Project Skills belong to the immutable task engine. Machine-level Skills are shared native settings and can be managed only by the configured VM owner (`PI_COFFEE_SKILL_OWNER`); other Web participants use project scope.

## Reconciliation and release

Preserve GitHub's newer shared Host/Codex/P0–P4 behavior and recover the complete Gitea workbench plus its supporting runtime APIs. Neither baseline replaces the other wholesale. Record pinned baselines and verification in the reconciliation report.

Push only ordinary merge commits and fast-forward updates. GitHub main, Gitea main, the release checkout, and the served release must identify one coherent revision. Older documentation remains historical where explicitly marked superseded; this decision takes precedence for topology and source authority.
