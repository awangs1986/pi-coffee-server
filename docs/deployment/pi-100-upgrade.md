# Native Pi 1.0 upgrade and activation

Tracking: [Server #25](https://github.com/awangs1986/pi-coffee-server/issues/25)
and [Pi #6](https://github.com/awangs1986/pi-coffee/issues/6).

## Reviewed composition

| Component | Selected identity |
| --- | --- |
| Pi coding-agent / agent-core / ai / tui | 1.0.0 |
| pi-web-access | Official npm 0.35.0 |
| pi-subagents | Official source version 0.74.0 at `10694a673cb077b4d3ec6a6cfe68acb6c28b83a5` |
| pi-coffee-harness | Immutable harness/v0.2.2 release artifact |
| pi-coffee-lsp | Immutable lsp/v0.4.5 release artifact |
| context-handoff | Immutable context-handoff/v0.2.0-experimental.4 release artifact |
| Shared typebox | 1.3.34 |

Plugin policy is owned by [the Pi 1.0 integration contract](https://github.com/awangs1986/pi-coffee/blob/main/docs/spec/pi-100-native-integration.md).
Host, Web, Relay and native Codex/Claude adapters remain here.

The npm subagents 0.74.0 artifact cannot start background children on Pi 1.0
because Pi removed the agent-core/node export. The pinned official source includes
upstream PR #2634 plus the preceding unreleased changes (20 commits since v0.74.0).
It is consumed directly via an immutable GitHub source URL and lock integrity,
without a Coffee fork or node_modules patch. Keep this pin until a tested official
npm release includes the fix; a package version string alone cannot identify it.

## Configuration and acceptance

`configure-native-pi.mjs` reports the actual native CLI version instead of a stale
literal. It creates private `.before-pi100` backups independently of old
`.before-pi099` backups. Native package resource filters, personal extensions,
default model/provider and search credentials remain preserved. Web stays on
reviewed dynamic activation, 6,000-character content slices and workflow=none.

Use `npm ci && npm run check` in a fresh clone. The existing public integration
suite covers native Serper response IDs and bounded retrieval, a real child
reporting Pi 1.0 and cancellation/settlement, Web/Host reconnect history,
LSP settlement, explicit same-session Handoff and failure/timeout ownership.
Use the new Handoff package version when verifying committed results. This
upgrade does not migrate transcripts or change the latest Host/Web feature set.

Native Pi now rejects a provider without an explicit model. Preserve paired
consumer settings; no silent model substitution is an upgrade strategy.
Fullscreen TUI is Pi's new default; native tuiMode=regular remains available.
MCP/codemode and experimental autonomous Handoff are not enabled by this update.

## Staging, activation and rollback

1. Verify identical source SHA in GitHub and Gitea and immutable Coffee artifact
   checksums/integrities. Retain the prior release directory and task data.
2. Install a separate Server release from that commit, run its fresh-clone check
   and preserve private route/environment/native account files in place.
3. Use `node scripts/prepare-terminal-pi.mjs /absolute/new-runtime-directory` to
   create a standalone reviewed Pi runtime. This stages packages and a separate
   agent directory; it does not change PATH, private accounts or running services.
4. The terminal's additional Antigravity plugin may move to tested 0.9.0. Legacy
   pi-lens 4.3.0 still rejects Pi TUI 1.0 in normal peer resolution. Do not force
   it or load duplicate LSP providers; retain the old package for rollback and
   select Coffee LSP for the new runtime.
5. Before production activation, query every routed scope for active turns,
   queued input and workspace operations. This deployment conversation counts.
   Explain the restart impact and obtain the owner's consent. Never kill all
   Codex processes by name. Follow [the unified release procedure](unified-release.md).
6. Activate the matching Host/Web release only when safe, then probe health and
   served asset identity. Record both runtime source and deployed source in the
   Issue. A passing check or plugin release does not mean production was deployed.
7. Roll back by restoring the retained launch target and package declarations;
   retain credentials, sessions, project folders and immutable prior artifacts.

Pi's native shrinkwrap retains the inherited high brace-expansion 5.0.9 advisory.
The dependency audit has no newly introduced advisory; it is not clean. Root
undici overrides do not rewrite native Pi's shrinkwrapped nested dependencies.
Live provider autonomy and semantic Handoff fidelity remain separate evaluations.
