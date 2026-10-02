# Repository map

Start here when choosing source ownership, locating a plugin or updating a dependency.
GitHub main is authoritative; Gitea mirrors the same commits and repository layout.

| Change | Source | Mirror | Entry |
| --- | --- | --- | --- |
| Web UI, gateway, Host, Relay, native Pi/Codex/Claude adapters | [pi-coffee-server](https://github.com/awangs1986/pi-coffee-server) | [awangs/pi-coffee-server](http://gitea:3000/awangs/pi-coffee-server) | This repository's AGENTS.md and docs/index.md |
| Pi plugins and releases | [pi-coffee](https://github.com/awangs1986/pi-coffee) | [awangs/pi-coffee](http://gitea:3000/awangs/pi-coffee) | [Canonical package map](https://github.com/awangs1986/pi-coffee/blob/main/REPOSITORIES.md) |
| Harness prompts, Chat/Work, Git, discovery | [packages/harness](https://github.com/awangs1986/pi-coffee/tree/main/packages/harness) | Same path in Pi mirror | README, package.json, CHANGELOG.md |
| LSP tool, diagnostics, CLI and Skill | [packages/lsp](https://github.com/awangs1986/pi-coffee/tree/main/packages/lsp) | Same path in Pi mirror | README, package.json, CHANGELOG.md |
| Manual Handoff and original-evidence recovery | [packages/context-handoff](https://github.com/awangs1986/pi-coffee/tree/main/packages/context-handoff) | Same path in Pi mirror | README, SPEC.md, package.json |

Each plugin is independently versioned and released. The standalone Harness/LSP/
Handoff repositories are historical; maintain code only in the unified directories.
Official web/subagent plugins remain external upstream packages. Pi customizations
do not alter native Codex or Claude tools or authentication.

## Consumed and deployed versions

Server's `package.json` and `package-lock.json` specify the actual immutable plugin
artifacts. A Pi repository's latest main does not automatically update this Server.
The P0–P9 candidate removes the historical aggregate. Maintained package roots
are discovered by native Pi; Host starts with --no-extensions plus the selected
explicit roots to avoid executing a second configured/discovered plugin copy.
User/project Skills and context remain native Pi resources. An explicit
PI_COFFEE_EXTENSIONS list replaces the default set; off loads no extensions.
See [candidate evidence](docs/development/pi-099-p0-p9-evidence.md).

Use [the release runbook](docs/deployment/unified-release.md) and recorded deployment
evidence to identify the running service. A source push or package release alone is
not a production deployment. Plugin installation/release/rollback is documented in
[the Pi release guide](https://github.com/awangs1986/pi-coffee/blob/main/docs/releases/README.md).
