# Trusted-root sealed export: scoped verification

Scope: Server #130 / [accepted trusted-root boundary](backup-trusted-root-20261029.md),
standalone private source endpoint, repository worker direct transport and CLI exact
selection. Base dependency: `ea275f91fe981c7c8ffab3e3c4ebe51a7d4c1a74`.
This is source verification, not production installation or complete backup acceptance.

## Claims under test

`test/trusted-sealed-source.test.ts` uses synthetic task/native data, actual Unix
peers, an independently launched fixed key listener/worker and pinned real Restic.
No model request, production transcript, other account directory or real disk was used.

1. A requested older sealed point restores its original bytes even after a newer
   seal exists and live files change while a writer remains active.
2. A same-UID caller claiming the administrator cannot impersonate the delegated
   key worker, even when that caller is separately enrolled as a key-service Host.
3. A wrong immediate parent, changed boot/birth/command, stale authority revision,
   removed administrator role, selected scope denial or denial of another member's
   scope prevents export through the actual key worker.
4. A nonexistent named ID, wrong task/member scope or corrupted old point cannot
   silently select the newer seal or create a successful repository point.
5. Revoking the actor after an actual streamed chunk aborts the backup.
6. Killing the fixed producer listener after a streamed chunk aborts the backup;
   the restarted repository service lists no successful point.
7. Closing the source after a streamed chunk aborts the backup without publishing.
8. An explicitly enrolled real CLI process carries `--checkpoint-id` through the
   worker/receiver/Restic chain and restores the selected old bytes. Missing ID is
   rejected by the CLI before submission. CLI enrollment is a controlled synthetic
   operator action, not automatic ancestry or self-registration.
9. Idle connections expire; excess concurrency is refused; close releases readers
   and removes only the endpoint owned by this source instance.
10. A point above the configured byte limit is rejected before content streaming.

The complete-member case uses a synthetic Pi/Codex group with two application
scope names; it reads no real account data. Midstream audit callbacks are private
synchronization hooks and contain metadata only. The product assertion is that
backup fails and no successful repository job is published, not just a log event.

| Requirement | Claims | Remaining boundary |
| --- | --- | --- |
| Explicit immutable checkpoint selection | 1, 4, 8 | Startup/scheduler composition on final candidate |
| Current process and account authorization | 2, 3, 5, 6 | Operator enrollment lifecycle and production policy |
| Complete dependency membership | 3, 4 | Real writer/source graph qualification |
| Fail closed on incomplete transfer | 5–7 | No production failure injection performed |
| Bounded private transport | 9, 10 | Large production throughput is not benchmarked |
| Preserve native permissions | 1–10 use ordinary local processes | Native capture/recovery acceptance is independent |

## Can the tests fail?

Four production mutations were applied individually and restored byte-for-byte.
All four were killed by a **behavioral assertion**: a prohibited backup succeeded
instead of being rejected. No mutation result relies on build/setup failure.

| Mutation | Claim that failed | Result |
| --- | --- | --- |
| Accept an enrolled listener that is not the worker's immediate parent | 3 | Killed |
| Ignore the scopes of other manifest members | 3 | Killed |
| Skip current authorization before each streamed frame | 5 | Killed |
| Ignore the sealed point byte limit | 10 | Killed |

After restoration the source SHA256 was
`1a4a8530af870b5cb10e529e25d04b55346d5c1b17b6c1865652497d9292766e`.
The pre-mutation build and successful entire scoped run used that same source.

## Evidence and retained failures

Private logs under `/home/awang/tmp/backup-implementation-130/`:

- `sealed-export-build2.log`: `npm run build` passed.
- `sealed-export-regression.log`: **5 files / 18 tests passed**, zero skips,
  136.57 seconds. Includes exporter, trusted key service, receiver, exact historical
  checkpoint/scheduler restart and existing broker CLI regression.
- `sealed-export-mutants.log`, `.json`, and four individual mutant logs: all killed.
- `sealed-export-red.log`: initial stub timed out; not a clean behavioral RED.
- `sealed-export-first.log`, `sealed-export-diagnosis.log`: valid export failed
  because Linux denies `/proc/worker/exe` access for the hardened non-dumpable worker.
  The redundant check was removed; live direct-parent identity and exact argv remain.
- `sealed-cli-red.log`: test fixture PID typo, not a product failure.
- `sealed-cli-red2.log`: missing-ID CLI validation reached the broker instead of
  failing locally; an idle-socket fixture also mishandled expected ECONNRESET.
  The CLI and fixture were corrected; later entire scoped run passed with no unhandled errors.

No expensive canonical suite or Browser deployment probe was repeated for this
slice; both remain final integrated-candidate responsibilities. Prior canonical
failures and other slices' limitations are not superseded by these results.

## Security self-check

No blocking finding in this slice. Kernel producer authentication precedes named
checkpoint access; current administrator, scope and complete-member checks run
again before every frame. Inputs cannot supply paths, keys, a trust mode or an
identity override. Filesystem/private policy restrictions and bounded transport
remain enforced. No dependency, browser bundle, public route or credential was
added. Errors/audit entries carry codes and metadata rather than file contents.
This self-check does not replace independent integrated Security review.

The fixed listener's exclusive use of the configured worker is an explicit
operator trust assumption. Same-UID/root tampering is outside the accepted claim.
The endpoint is not a new capture proof: production source qualification, Host
composition, enrollment across restart and scheduled Pi/Codex recovery remain
separate work before feature acceptance.
