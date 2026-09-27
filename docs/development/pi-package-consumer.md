# Standalone Pi package consumer

[Server #19](http://gitea:3000/awangs/pi-coffee-server/issues/19), paired with [Pi #70](http://gitea:3000/awangs/pi-coffee/issues/70), implements [ADR-0021](../adr/0021-pi-only-source-authority.md).

The Pi extraction source is Server `112ef53a0e2b04bd9d7cf283faa04754bc84c9ab`. Before applying the consumer change, current Server main advanced to `0b79fa594095363fedbf61fd0c87853a3f17d941`; that update and its Pi rejection/queue fixes, frontend changes and regression tests are preserved. Its Browser, Host, Relay and native Pi/Codex/Claude implementations are retained. Pi-specific modules and their tests move into the Pi repository. Existing unmerged historical Agent branches are preserved, not used to overwrite current Server behavior.

`package.json` pins `pi-coffee` to an immutable GitHub commit; the lockfile resolves that same commit. Git installation builds the Pi package through its `prepare` script. Runtime assembly imports the public package interface. The Host's only lifecycle import change is the source of `stopLspDaemon`; native Agent adapters are unchanged. Context attribution types come from Pi, while wire validation remains here. The Context Usage probe uses the same public package import.

Run `npm ci && npm run check` in a fresh clone. The package integration regression crosses Web → Host → actual Pi RPC with a scripted local provider and verifies browser reconnect history. The remaining Host, scoped workspace, native-engine and workbench tests stay here. Pi's own repository owns RPC/CLI/toolchain and package-content checks. Tests were moved, not retired because of failures.

Publish each GitHub main before its Gitea mirror and verify each pair's SHA. The Server commit and its pinned Pi commit are different identities. Existing production releases are unchanged until a separate deployment follows the release matrix and records UI/API acceptance.

Pi package revision: `0278a99d1a83084113afa057467e7271c12cdb74`. The container installation permits the package preparation step so a Git dependency supplies compiled exports before Server compilation.

The lockfile uses the explicit HTTPS Git URL, not npm's generated SSH shorthand. This allows a public fresh installation without a GitHub SSH key. Current-main checks and fresh-clone acceptance are recorded in Server #19. The deployment image allows `npm ci` lifecycle scripts because the owned Git package must build its exports.
