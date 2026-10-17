# Web/Host stability close-out — 2026-10-17

Owner approved completing the six gaps identified in the October 17 refocus.
Scope stays in Server/Host; no Pi plugin redesign or automatic model task fan-out.

1. GitHub renewal: correct the moved Web endpoint and ensure both supported Web
   entrypoints load OAuth configuration. Probe authenticated service admission
   with an invalid empty body, never a real credential rotation merely for testing.
2. Publish and activate pending idle-connection recovery and migration tooling.
   Keep source publication, fresh-clone verification and active release distinct.
3. Skills: bounded command discovery and explicit retry in the current composer;
   installed files and native catalog already contain refocus. No claim that the
   intermittent production trigger has been identified solely from code review.
4. Recover accepted queued text/images after Host replacement as paused rows;
   never automatically replay. Private atomic per-account files; corruption fails
   closed. Internal callback notifications retain their existing owner/journal.
   Add consistent backup/verification/restore-to-new-directory tooling and a drill.
5. Establish version-pinned native CLI qualification and rollback. Candidate Codex
   0.163.0 is staged separately; metadata/schema and adapter checks create no turns.
   Automatic compaction's reported failure remains unproven without failing-task
   evidence; context attribution remains a separate unimplemented proposal.
6. Reconcile current specs, source/deployment identity and same-VM runbook. Preserve
   old evidence as dated history rather than represent it as current acceptance.

Public verification seams: actual Browser controller, Host HTTP/WS with synthetic
native adapters, built Web entrypoints, filesystem-backed queue replacement,
operator CLI subprocesses and native Codex metadata only. Existing repository
policy establishes these seams. No other user's transcripts are used.

Service impact: Web restart disconnects browser transport without stopping Host
runs. Host activation waits for other active/queued tasks; the deploying conversation
is reported separately. Consistent backups require writers stopped. Source fixes
and staged configuration are not claimed active before service/asset verification.

## Observed Codex compaction notice regression

A completed native contextCompaction item was translated to compaction_end without
a result, while the Browser treated a missing result as failure. The adapter now
includes an explicit native completion result without inventing summary text. The
adapter-to-presentation regression test fails before the fix and passes after it;
error, cancelled and genuinely absent-result events retain their failure behavior.
This establishes a false failure notice, not that every reported provider
compaction failure has the same cause. No context limits were reduced.
