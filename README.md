> Source placement: this repository owns Host, Web, Relay and native Agent adapters. Pi Harness/tools/LSP/Skills are maintained in [pi-coffee](https://github.com/awangs1986/pi-coffee) and consumed as a pinned package. See [ADR-0021](docs/adr/0021-pi-only-source-authority.md).

# PI Coffee Server

A browser workbench backed by native Pi, Codex CLI and Claude Code on the owner's machine. New conversations default to Pi Chat. Work tasks bind Pi, Codex or Claude at creation and use independent project checkouts. Agent choice is fixed for that task.

This repository owns Web, gateway, Relay and Host. GitHub is the source authority; Gitea mirrors the same main revision. See [AGENTS.md](AGENTS.md), the [documentation map](docs/index.md), and the [reconciliation decision](docs/adr/0020-unified-github-authority.md).

## Check

Node 22.19 or newer is required.

```sh
npm ci
npm run check
```

## Run

```sh
npm run start:host
npm run start:web
```

Configure credentials through private environment files, never repository files. Web and Host may run on different machines from the same source revision. The [release runbook](docs/deployment/unified-release.md) covers identity, native engines and verification.

The compact workbench includes Gitea projects, task paths and branches, opt-in file review, Context Usage, Skills, attention indicators, native account usage and per-turn changes. Pi's Chat/Work harness and LSP CLI remain Pi-specific. Native account login and native history remain on the Host; disconnecting the browser does not cancel work.
