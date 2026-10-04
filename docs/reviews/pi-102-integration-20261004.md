# Pi 1.0.2 consumer integration

Reviewed sources: Pi PR #10 (`25d6a258`) against `8959af5`, and Server PR #48
(`d884bdf2`) against `0a378ce`. Server integration starts from newer main
`fce594a`, retaining independent conversation navigation, routes, synchronization
and native attachment. Normal merge ancestry preserves both feature lines.

## Standards

No documented-rule violations or material code-smell findings. Plugin ownership,
independent versions, changelogs and immutable consumer lock integrity are preserved.

## Spec

One partial requirement was reproduced: clicking Refresh while legacy GitHub
project binding remained pending replaced its progress with generic guidance.
The public DOM test failed before the correction. External refresh now waits for
pending mutations, the Refresh button is disabled during the action, and an epoch
invalidates earlier list responses. Internal post-action loading still updates the
list and confirms the selected project/account. All three binding UI tests pass;
independent follow-up review confirms the finding is resolved.

## Security

No findings in the dependency upgrade or scoped binding path. Server and all
three plugin lockfile audits returned zero advisories. New status text uses
textContent. Existing origin checks, authenticated routing, project/account
ownership and credential handling are unchanged. No dependency lifecycle scripts
were added by an unexpected package identity.

## Source and artifact acceptance

Pi main is `eb3933838d7a1b6ec6c1918c22fa0b13df071c15` on both forges; its tree
equals the independently tested PR head. Fresh clone bootstrap/check passed 229
checks, including installed tarballs on Pi 0.99.1, 1.0.0 and 1.0.2. Published and
mirrored tags are `harness/v0.3.1`, `lsp/v0.4.6` and
`context-handoff/v0.2.0-experimental.5`. Repacked artifacts and downloaded GitHub
assets match the Server lock SHA-512 integrities; Gitea tarballs and checksum/source
manifests also match. No published asset or tag was overwritten.

Server installation used an empty npm cache and public release URLs, followed by
`npm run check`: 99 files / 776 checks passed. This closes the original PR's
unpublished-artifact gate. Browser/Web/Host navigation, latest-history visibility
and image/download compatibility probes are rerun on the combined candidate.
Native package and actual official child compatibility are covered by the Server
check; live model autonomy and semantic Handoff drift are separate evaluations.

GitHub owns merge ancestry. Gitea does not allow the manually-merged PR status
operation, so mirrored PRs are closed with the actual integration SHA in their
body after their main branch is synchronized; no independent merge is created.
Issue #46 records final Server source identity, fresh-clone release checks and
actual activation. A staged release does not imply Web/Host activation. Preserve
all active work, queued messages, credential stores and previous releases.
