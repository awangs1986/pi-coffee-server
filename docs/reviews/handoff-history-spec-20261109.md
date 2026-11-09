# Complete-history Handoff: specification review

Date: 2026-11-09. Baseline Server 1.00 / `97ae45b`.
Tracking: [Server #164](https://github.com/awangs1986/pi-coffee-server/issues/164).
Specification: [complete-history Codex Handoff Fork](../spec/handoff-history-reconstruction.md).

This is a documentation-only change using the owner's `to-spec` workflow.
The accepted conversation supplies the scope; existing HTTP/WS, native Adapter
and Browser-controller test seams remain the agreed interfaces. No runtime
implementation, model call, live Fork or service activation is included.

## Decisions captured

- Reconstruct complete available native history in bounded operation-owned RAM,
  with durable original evidence and explicit memory reclamation.
- Use fresh read-only preparation context rather than a source extraction Fork.
  Preserve chronological evidence, later corrections and the stopping point.
- Cap preparation at 1M tokens where the installed native CLI/transport qualifies;
  reserve instructions/output and keep ordinary Conversation settings unchanged.
- Cover larger histories serially within declared call/deadline budgets and the
  existing batch-approval policy; no parallel Agent creation.
- Permit exactly one deterministic local compression of derived evidence and
  one bounded retry after a definitive input-size failure. Persist allowance
  consumption across reconnect/resume/restart; never alter the original source.
- Preserve the 256 MiB evidence and 32 MiB native-page budgets. Non-size failures
  retain current recovery behavior. Unknown native delivery is not retried.

## Serial standards and spec review

Source authority remains Server-owned Host/native policy, with Pi plugins in
their existing repository. The new spec uses the domain model and the requested
Problem/Solution/User Stories/Implementation/Testing/Out of Scope/Notes structure.
Implementation decisions name responsibilities and contracts without executable
snippets or source paths. Thirty-four user stories cover behavior, scope,
resource accounting, failure, recovery and acceptance.

Existing Fork and durable-preparation specs explicitly link this as an accepted
future amendment, preserving their implemented behavior and dated acceptance.
The documentation map and backlog distinguish design from implementation.
The one-retry exception is narrow and cannot become a general replay policy.
The original evidence, account boundaries, ordinary task execution and native
automatic compaction remain protected. No credential or private transcript is
included in this change or the published Issue.

No blocking documentation finding remains. Token capability, memory-pool sizing,
finite execution profiles and real-account qualification are explicit future
implementation/release gates. The source-bound low-risk documentation plan is
the applicable publication check; final receipts are recorded on the Issue.
