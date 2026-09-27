# Pi 0.87.1 on unified main — 2026-09-27

Tracking: [Server #18](http://gitea:3000/awangs/pi-coffee-server/issues/18).
Source authority: [ADR-0020](../adr/0020-unified-github-authority.md).
Baseline: GitHub and Gitea main both `57f2f73d58a6de73cfbf77ff5805dc1701c65f66`.

## Change

The four direct `@earendil-works/pi-*` packages move from 0.84.4 to exactly 0.87.1, with the corresponding lockfile and upstream provider SDK changes. No Pi core patch, Host interface change or workbench replacement is included.

The first install exposed invalid peer dependencies. Pi Lens 4.1.3 excludes the new Pi TUI version, and the inspected 4.3.0 release still excludes 0.87.1. The application therefore stops bundling Pi Lens. The supported LSP route remains the existing `coffee-lsp` CLI and Skill. An explicitly installed Pi-compatible Lens can still be selected; opting in without it now produces a clear configuration error. The toolchain probe checks the bundled runtime by default, with the separate optional Lens probe available through `--with-pi-lens`.

The optional `pi-mcp-adapter` moves from 2.32.1 to 2.37.0, whose declared peer range accepts Pi 0.87.1. It stays disabled by default. This is not an MCP-based LSP migration. `context-fold` 0.4.0, `pi-subagents` 0.63.0, the Web plugin and LSP servers retain their existing pins. The context-management development conversation and the historical P0–P7 branch are not merged through this upgrade.

## Verification

Use Node >=22.19.0 and ensure `node`, `git` and `rg` are available to child shells.

```sh
npm ci
npm run check
node node_modules/@earendil-works/pi-coding-agent/dist/cli.js --version
npm ls --depth=0
npm audit
node scripts/smoke-toolchain.mjs
node scripts/smoke-subagents.mjs
node scripts/smoke-web-access.mjs
```

- Initial four-package upgrade: existing 49 files / 314 tests passed, but the dependency tree reported the two incompatible optional peers. Passing tests alone did not satisfy installation acceptance.
- The optional-Lens missing-package regression failed with the raw module-resolution error, then passed with the actionable configuration error. The separately installed explicit opt-in path also passes.
- Final development check: 49 files / 315 tests passed, including real Pi RPC Chat/Work provider serialization, switching and restart, context recovery, native child execution, LSP, scoped Host/gateway behavior and native Codex/Claude compatibility.
- CLI reports `0.87.1`. `npm ls --depth=0` succeeds; `npm audit` reports zero vulnerabilities.
- The first toolchain run failed because it unconditionally enabled the now-unbundled Lens probe. After making that probe explicit, a missing `rg` in this shell's PATH caused the search command to fail. With the required executable on PATH, all 12 scripted tool calls passed with zero extension errors. Subagent and Web extension probes also passed.
- The built application booted with isolated temporary task/session roots on loopback and ephemeral ports. The release asset probe passed all five workbench control groups and exact asset comparison; an unknown asset returned HTTP 404. The process was stopped afterwards. This is a local HTTP/asset check, not production UI acceptance.
- Targeted independent dependency/security review found no concrete finding. Download URLs use the npm registry; expected lifecycle scripts were reviewed. This is not a comprehensive upstream source audit.

Fresh-clone acceptance and published source identities are recorded in Server #18 before completion.

Local evidence: `/tmp/pi-0871-main-check-final.log`, `/tmp/pi-0871-lens-red.log`, `/tmp/pi-0871-lens-green.log`, `/tmp/pi-0871-toolchain-red.log`, `/tmp/pi-0871-main-toolchain.json`, `/tmp/pi-0871-main-subagents.json`, `/tmp/pi-0871-main-web-access.json`, `/tmp/pi-0871-main-audit.json`, and `/home/awang/tmp/verify-pi-0871-xolmslfk/`.

## Limits and publication

Tests use local scripted provider endpoints and synthetic disposable projects. They establish integration compatibility, not autonomous behavior of a paid remote model. No production default model, provider login, existing task data or running service is changed. Optional Lens and external MCP servers are not certified by these checks. The reconciliation acceptance matrix remains unchanged; deployment must separately follow the unified release procedure and record real UI/API evidence.

Publish GitHub main first, then fast-forward the Gitea mirror and fetch both to verify the same SHA. This task updates source main; it does not claim a production deployment.
