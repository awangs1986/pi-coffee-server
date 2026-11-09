# Large Fork evidence: diagnosis and source review

Date: 2026-11-09. Server 1.00 candidate, based on GitHub/Gitea main
`056b5edee9313b250cdac441e5b991276a1d0649` (0.99).
Tracking: [Server #161](https://github.com/awangs1986/pi-coffee-server/issues/161).
Contract: [task preparation](../spec/task-preparation.md#large-fork-evidence-100)
and [Conversation Fork](../spec/conversation-fork.md#large-conversation-evidence-100-2026-11-09).

## Diagnosis

Two owner-scoped Handoff Fork operations failed at source snapshot, before
workspace copying or model preparation, with `Fork source exceeds its 32 MiB
evidence budget`. A read-only native inspection reproduced that exact error.
The source contained 358 turns / 14,044 projected entries: 104,218,643 raw page
bytes and 98,718,261 projected bytes. Completed command/tool output dominated
the history; user/assistant message text was about 1.3 MiB. Metadata was small,
pagination advanced and the source identity/update marker stayed unchanged.
This supports an evidence ceiling failure, not an attachment, staged Git patch
or CLI-version diagnosis. Private task/native IDs and transcripts are omitted.

## Change

- One 256 MiB limit covers capture, canonical evidence writing and saved reading.
  Codex independently bounds cumulative native data at the same value.
- Codex uses 20-turn pages, each at most 32 MiB, validates each page and retains
  projected entries without accumulating a second raw-turn history.
- Entry-sized hashing/writing avoids a whole-history serialization copy.
  Private temporary files are synced, atomically renamed and directory-synced.
- Saved reads allocate by checked actual size, reject concurrent file changes,
  and preserve canonical-path, owner, no-symlink and single-link checks.
- Strict history shape and digest verification reject unrecorded top-level
  fields; legacy pretty-printed evidence remains compatible.
- Source preservation, idle/background checks, scoped admission, deadlines,
  runtime cleanup, summary reuse and no automatic model replay remain unchanged.
  Git patches stay at 32 MiB; summaries at 256 KiB; embedded Claude history at
  1 MiB. This change does not increase model context or remove resource limits.

## Executed regression evidence

The public HTTP preparation tests first failed with the original 32 MiB error
for both Traditional and Handoff Fork of synthetic tool-heavy history. They now
complete and retain every tail entry, while the source stays unchanged. Added
negative tests cover total evidence over 256 MiB, a single oversized native
page, active tool work on a later page, oversized saved files and altered
evidence shape. Failed-seed resume reuses the verified saved summary.

The altered-shape regression was observed red before strict shape validation
was added, then green. No provider requests are involved in these tests.

- `test/task-preparation-http.test.ts` and `test/codex-adapter.test.ts`: 68 passed.
- `test/conversation-fork.test.ts`, `test/fork-native-http.test.ts`,
  `test/native-fork.test.ts`, `test/claude-fork-handoff.test.ts`: 16 passed with
  the documented neutral PATH and short private disk TMPDIR.
- Original owned-source read-only inspection after the fix: 14,044 entries /
  98,718,261 projected bytes accepted. No new Coffee task, native fork or model
  preparation was performed by this probe.

An earlier direct test run hit two five-second writer-custody test deadlines;
both the isolated file and four-file run passed in the documented environment,
without changing those tests' deadlines. Another attempted test run overlapped a
build that removed compiled kernel helpers and failed fixture scope admission;
the sequential post-build rerun passed. Builds and tests must not overlap.

## Serial review

Standards: native pagination stays behind the Codex adapter; the coordinator and
workspace writer share one evidence policy. The existing lifecycle and account
boundaries remain. Version metadata and current specifications agree. No new
dependency or Browser behavior is introduced.

Spec: complete projected evidence is retained within explicit budgets; both
modes, failure retention and saved-summary recovery have public regressions.
The bounded Git copy and model preparation policy remain separate. Historical
claims that durable preparation was unimplemented are corrected with dates.

Security: followed scoped preparation admission through source lookup, native
inspection, destination selection and artifact read/write. No new route or
caller-controlled filesystem destination is introduced; no scope or ownership
check is relaxed. Byte limits, canonical paths, private files, digest validation
and stage limits remain enforced. No credentials or transcripts enter source,
client assets or this report. No dependency changes. No blocking finding remains.

## Remaining release gates

The canonical check and independent exact-commit fresh-clone check must pass
before activation; their final receipts and publication SHAs are recorded on
the Issue, rather than asserted here before execution. Production was observed
at 0.98 during diagnosis. This source repair does not activate 1.00, complete
the pending CLI upgrade, automatically replay failed Forks or prove a real
provider summary/seed succeeds. The deployed owner-initiated Fork acceptance
and broader crash/resource matrix remain open.
