# Consuming the unified Pi plugin repository

Owner accepted one Pi source repository on 2026-09-29. See [the source map](../../REPOSITORIES.md)
and [Pi consolidation Issue #1](https://github.com/awangs1986/pi-coffee/issues/1).

Harness 0.1.3, LSP 0.4.2 and Context-handoff 0.2.0-experimental.2 preserve their previous
runtime behavior while moving canonical source into `awangs1986/pi-coffee/packages/`.
GitHub and Gitea use identical directory structure and commit history. Each plugin
has an independent package manifest/version, test suite, namespaced tag and built
release tarball with checksums. The Pi root is private orchestration, not an extension.

This Server replaces its independent-repository Harness/Handoff Git dependencies
with immutable built tarballs from the unified Pi repository. npm lock integrity
binds the downloaded bytes. Public package names and exports stay unchanged.
The initial packaging migration did not activate LSP. The subsequent runtime upgrade
below composes its standalone extension, CLI/Skill and daemon lifecycle helpers.

The aggregate `pi-coffee` pin stays at `1ec49a9` for its remaining integration surface.
It is not silently upgraded to the newer native-subagent migration, nor does an old
runtime tree replace Host/Web/native adapters. Its Harness and context-fold entries
are already replaced by the independent plugins in `resolveHostPiExtensions`.

Acceptance: fresh installation, public Web/Host/native Pi package integration,
versioned committed Handoff and existing Server checks. GitHub main leads, Gitea
mirrors the exact commit. Release assets are independently downloadable from both
forges. Production rollout, npm-registry publishing and paid model evaluations are
separate actions, not implied by source consolidation.

## Pi 0.99.1 runtime upgrade (2026-09-29)

[Server #4](https://github.com/awangs1986/pi-coffee-server/issues/4) consumes Pi
0.99.1, host-provided typebox 1.3.27, Harness 0.1.4, LSP 0.4.4 and experimental
Handoff 0.2.0-experimental.3. Each owned plugin uses an immutable release artifact
from the Pi monorepo. The historical aggregate remains pinned at `1ec49a9` for
its remaining subagent bridge/context observation; its upstream web/subagent
package versions are unchanged by this release.

Default composition registers exactly one standalone LSP tool; Harness Work
exposes it through `search_tools` activation. Chat tool policy stays unchanged.
Explicit `PI_COFFEE_EXTENSIONS` replacement lists, including `off`, still win.
`PI_COFFEE_LSP=off` disables default LSP registration. The standalone LSP package
also owns Skill/CLI resolution and Host daemon shutdown. It reports work settlement
to optional Handoff listeners and drains prewarm before native session navigation.

Handoff .3 leaves invocation, retries and continuation to Host. Pi continues to own
automatic compaction. Public Web/Host integration invokes native Work capability
activation, LSP, committed manual Handoff, invalid-Handoff rejection and reconnect
history. This caught a completed-LSP settlement blocker before deployment.

Deploy Web and Host from the same checked Server commit. Replace stale explicit
extension overrides with the default resolver, preserve private environment files,
native authentication, the Pi model allowlist and task roots. Native Codex CLI
0.159.1 is admitted by the verified native readiness gate and installed in a versioned directory and selected through the existing
command interface; native Claude behavior is unchanged. Keep prior service
configuration and release directories for rollback. The Issue records final SHAs,
fresh-clone checks, served-asset identity and live probes.
