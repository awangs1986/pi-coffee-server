# Personal backup integration on current main — 2026-11-04

Release candidate: Server 0.80. Base: `ac5a4185ac5d52232a9b36dc4f6fa6b21ae8fde8`.
Normal merge includes PR #151 (`257ee0d24ee4af8d3df6ddfe294c46805228a75f`),
retaining completion-speech 0.1.2/protocol 2 and current Pi 1.4 native adapters.
The backup branch's 0.58 version does not replace the current release number.

## Review

Standards: no blocking documented violation. Web authenticates and forwards;
Host owns backup/restore, writer lifecycle and scoped task data. Both backup and
speech imports, API handlers, build assets, browser probes and registry options
were retained. Potential later refactoring: name the long backup configuration
interfaces and extract the action dispatcher; this is not a release gate.

Spec: no blocking mismatch for installing optional backup code with production
backup unconfigured. Historical backup review and acceptance evidence remain in
[the PB-2.1 report](personal-backup-pb21.md). They do not verify this merged tree.

Security: independently reviewed authenticated actor forwarding, data scopes,
restore operation authorization, path/material validation, browser text rendering
and unchanged dependency pins. No blocking finding. npm audit reports inherited
moderate advisories (9 including dev dependencies, 6 production), no high/critical.
The existing scoped Restic advisory review remains applicable.

## MISHU identity

Do not downgrade to the plugin's older main package metadata. Source `259e12b`
(MISHU #17) is an ancestor of the already pinned immutable `08fbd13` candidate,
version `0.4.0-experience.2`; the latter adds Pi 1.4 compatibility. All 44 `src/`
files from `259e12b` match the installed artifact byte-for-byte. This integration
retains that package and verifies the same source during activation.

## Verification and activation boundaries

The initial combined build and lint pass; seven public-seam files / 20 tests pass,
including actual personal Host startup/Restic recovery, scoped backup HTTP,
completion-speech HTTP recovery and Pi package integration. The final canonical
review-bound check and independent exact-source clone must pass before staging;
their actual receipts and results belong to Server #150 / PR #151.

Production activation requires the owner-approved service window, idle admission
across routed scopes, independent bounded worker, exact service/asset identities,
normal Host mode, unchanged speech settings, and a rollback receipt. It may expose
personal backup setup with a private same-filesystem runtime and reviewed Restic.
No encrypted backup exists until its destination is configured and the offline
recovery copy is verified; daily scheduling is also an explicit setup step.
No production restore, Gitea pause or provider turn is authorized by a source check.

The Codex backup adapter qualifies **0.159.1 only**. Production CLI **0.163.0**
remains usable for normal tasks but its backup capture is explicitly unavailable;
no version guard is weakened and no native CLI is downgraded. Gitea capture needs
its actual backend/paths qualified and an explicit service profile. Deployment
must not claim complete Pi/Codex/Gitea protection while these gates remain open.

## Integration verification repairs

The first broad check used `/run` and correctly hit managed-source grant refusal.
A disk retry under a long cache prefix hit the Unix socket pathname limit
(`provider.sock` chmod ENOENT after truncated binding). A short private disk root
is required; both failed logs are retained in the release evidence. No production
service changed. The round-trip takeover test also observed persisted completion
before lifecycle adoption/unlock and immediately issued another mutation; it now
uses the existing public `list_sessions` idle helper between takeovers, retaining
the original history/model-call assertions. No product behavior was relaxed.
