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
LSP's standalone release is available independently; this packaging migration does
not activate or replace an LSP tool in current native sessions.

The aggregate `pi-coffee` pin stays at `1ec49a9` for its remaining integration surface.
It is not silently upgraded to the newer native-subagent migration, nor does an old
runtime tree replace Host/Web/native adapters. Its Harness and context-fold entries
are already replaced by the independent plugins in `resolveHostPiExtensions`.

Acceptance: fresh installation, public Web/Host/native Pi package integration,
versioned committed Handoff and existing Server checks. GitHub main leads, Gitea
mirrors the exact commit. Release assets are independently downloadable from both
forges. Production rollout, npm-registry publishing and paid model evaluations are
separate actions, not implied by source consolidation.
