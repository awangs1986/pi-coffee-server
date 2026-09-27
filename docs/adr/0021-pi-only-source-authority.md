# ADR-0021: Pi-only source authority

Accepted, 2026-09-27, by explicit owner decision. This supersedes ADR-0020's placement of Pi implementation in the unified Server repository. GitHub `awangs1986/pi-coffee` now owns Pi prompts, Harness, capabilities, tools, LSP, subagents, context extensions and Skills. Host, Browser, gateway, Relay and native Pi/Codex/Claude adapters remain in `awangs1986/pi-coffee-server`.

Each GitHub main is authoritative for its scope, with the same-named Gitea main mirroring its exact SHA. Preserve normal ancestry and historical branches. The Server consumes an immutable Pi package revision through its public interface instead of maintaining a second implementation. Package versions and Server releases are independently identified; the two repositories are not expected to have the same commit.

This is a source-ownership decision. It does not change VM topology, user-scoped task ownership, model defaults, context policy or production services. Existing unmerged experiments remain separate until reviewed and accepted.
