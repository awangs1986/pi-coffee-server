# Task preparation candidate review

Date: 2026-11-06. Scope: Server #161, base
`eb34dde7fb08420ac9501811482893f0c3215ddd`, candidate formal version 0.94.
This record describes local source verification, not deployment or live provider acceptance.

## Behavior and evidence

The Host now accepts durable creation/Fork operations and owns their progression,
publication and recovery. The Browser polls the accepted identity, retaining that
identity after transport uncertainty. Native Fork orchestration has moved out of
the factory into an adapter module. Manual compression and takeover are unchanged.

Public HTTP/native protocol regressions cover:

- Same-key acceptance, conflicting payload rejection and synthetic cross-scope reads.
- Cancellation and revision checks, native-start deadlines and uncertain restart recovery.
- Cold Codex source inspection, current-operation summary receipts and distinct target binding.
- Terminal seed failure followed by explicit resume with the same summary and target binding.
- Failed clone followed by explicit resume on the selected branch.
- Refusal to adopt an existing task directory or overwrite its metadata.
- Incremental task exports and refusal of oversized saved summary artifacts.
- Actual fixture Host process death during clone and between cleanup/publication;
  restart never launches native work automatically.

Browser-controller regressions cover lost acceptance replies, explicit recovery,
dialog reopening, starting another Fork only after an explicit click following a
known failure, and bounded transport with reconciliation of the original identity.
The timeout regression executes the real application controller and synthetic
fetch; it caught a wrapper that discarded AbortSignal and passed after correction.

## Corrections found during review

Terminal failure publication previously preceded lifecycle lock release. Resume
now joins the old execution tail before acquiring custody. Cleanup also tracks the
outer Handoff workflow, not only its nested stages. Saved artifact reads now have
fixed byte limits before consumption. Task preparation is shared only across
explicitly configured aliases of the same Workspaces authority; this preserves
administrative restore routing without merging independent account stores.

Existing regression repairs preserve legacy HTTP timeout handling, partial adapter
fixtures, recovery publication semantics, persistent kernel lease files, and failed
takeover visibility without exposing an uncommitted binding.

## Security review

The changed HTTP path retains Host bearer authentication and normalized account
routing before selecting its coordinator. Each coordinator reads its scoped
workspace registry and journal. Request fields are allowlisted; operation/task IDs
and branch/project input are validated. The added artifact reader rejects symlink
paths, non-regular files, foreign ownership and multiple links, and bounds reads.
Browser messages use textContent. No credentials, user transcripts or new package
dependencies are introduced. This targeted review does not claim an OS security
boundary between agents sharing a system user.

## Acceptance boundary

The canonical lint/build/test/Chromium check and focused red-to-green regressions
are source verification. Synthetic providers cannot establish real provider
availability. The specification's exhaustive crash-boundary/descendant-resource
matrix is not fully demonstrated by the two process-death fixtures. Fresh-clone
release verification and the owner-authorized deployed Handoff Fork remain release
acceptance steps. No production restart, real model turn, account migration or
bulk conversation creation was performed for this candidate.

## Final local check

`npm run check` exited 0 on the final runtime source: lint and production build
passed; 1,718 tests passed (136 intentionally skipped), followed by 3 isolated
runtime-temporary-storage tests and all 17 Chromium probes. `git diff --check`
passed. Focused failures were observed before the resume-tail, artifact-budget
and Browser AbortSignal corrections; their corresponding regressions now pass.
GitHub and Gitea main were re-fetched and remained at the recorded baseline.
