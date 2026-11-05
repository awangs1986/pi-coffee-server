# Fork writer-custody regression review — 2026-11-05

Base: GitHub/Gitea main `3ed88fa6b080209364519633779aa22a1159c12d` (Server 0.82). Candidate: Server 0.83. Issue: Server #39.

## Diagnosis and evidence

Production rejected Work Fork before native preparation: the caller requested its existing 32 MiB binary-patch allowance, but ordinary Git custody rejected any request above 16 MiB, regardless of actual output. The HTTP regression composing PersonalBackup custody/fence reproduced `Workspace Git request exceeds its resource budget` in both native and handoff modes. A browser-controller regression reproduced the missing durable error when reopening the dialog.

The shared maximum restores the existing Fork allowance. A specific output-overflow error tells the user to reduce staged changes; source data and the failed destination record remain intact. Ordinary calls retain their smaller limits. The existing workspace polling/reconnect path is retained; no parallel polling, automatic provider retry or additional sessions are introduced.

Targeted acceptance: 15 tests passed across conversation-fork, fork-native-http and fork-ui. Includes real local Git/custody with synthetic native adapters, staged/unstaged isolation, binary patch between 16 and 32 MiB, over-limit rejection before native calls, same-ID retries and reopen failure visibility. No live provider calls or other-account data access. The ordinary Git custody suite additionally passed its authentication/timeout/output-limit cases.

## Standards (serial review)

No blocking findings. Changes follow existing Host/browser boundaries and public HTTP/controller test seams. One shared output-budget constant prevents the caller/guard divergence. The error path does not bypass existing lifecycle finalization. Version metadata remains consistent. Large binary assertions use Buffer.equals rather than per-byte assertion traversal.

## Spec (serial review)

No blocking findings against conversation-fork.md and #39. Existing independent copies, scoped ownership, staged/unstaged state, no implicit commit/push, source retention, same-ID idempotence and no restart model replay are preserved. The topical spec and documentation indexes record the correction. No claim that this fixes unrelated transport/model failures.

## Security (serial review)

No blocking findings. Followed authenticated Host Fork dispatch through owned workspace lookup, lifecycle checks, copy and finish. No route or ownership changes, secrets, new dependencies, raw HTML or automatic retry. Browser errors use textContent. Output remains bounded per stream; request size/input budget, secure result-file validation, custody and physical writer fence remain enforced. The increased maximum applies only when an internal caller explicitly requests it.

## Release gates

Complete review-bound canonical check, independent published-source clone check, immutable staging and deployed health/asset identity evidence are recorded separately on #39. This source report does not assert production activation. Previous 0.82 deployment rolled back because an operator script incorrectly treated private release metadata as a public asset; the activation probe must use authenticated /api/release and actual public assets.

Initial canonical run: 1697 tests passed, 136 optional tests skipped, one documentation-vocabulary failure in this report. Replaced the retired-mode word with “Complete”; final exact-source verification is recorded separately.
