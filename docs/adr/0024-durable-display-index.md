# ADR-0024: Durable, rebuildable display index with separate execution ownership

Status: accepted for implementation, 2026-10-03 (owner-approved local-first synchronization design).
Deployment remains a separate approval.

## Context

ADR-0008 keeps Native Transcript authoritative and originally rereads complete history
on every open. The 2026-10-02 amendment allows disposable Browser previews. Those
previews improve warm switching but do not provide a durable cursor, old-message
edit/delete propagation, consistent paged snapshots or bounded live rendering.
An in-memory socket cursor cannot serve as a content version across Host restarts.

## Decision

Add a user-scoped Host display index, physically stored inside the User VM,
containing derived entities, snapshots, a retained change log and durable
binding-epoch/revision watermarks. SQLite transactions are the atomic boundary;
bounded background workers perform display-index work. Native Transcript and
Model Context remain authoritative, and no display copy is used to resume or
reconstruct a native model run. Web/Control Plane authenticates and forwards and
does not persist transcript content.

A negotiated v2 open receives a bounded indexed snapshot and commit notifications.
Readonly synchronization never opens/resumes a native conversation or becomes its
execution owner. Explicit execution opening remains separate. Unsupported or
unverified native source formats must retain a truthful freshness state and a
readable legacy-open fallback, rather than assert that an empty index is complete.

Browser views are bounded projections of a disposable, scope-fenced repository.
Native execution, synchronization and view selection have independent lifetimes.
Caches may be removed without deleting native history or stopping a task. Turning
off v2 does not delete index data.

The command acceptance/delivery record is a separate durable safety record. It
stores request identity and state, not prompt text, and is never interpreted as
proof of exactly-once native execution. Unfinished delivery after a restart is
uncertain and is not automatically replayed.

## Trade-offs

The Host now has durable derived content, unlike the literal original INV-S2.
This adds disk/quota management, schema compatibility, transactional testing and
source-audit obligations. It avoids complete-history transfer on each warm open and
provides an honest continuity boundary. A pure memory cache was simpler but could
not provide these guarantees. One worker/process per conversation was rejected
because idle history should not consume unbounded physical resources.

This supersedes ADR-0008 only for the display-index/open transport restriction.
It preserves native authority, User VM placement, shared-user isolation and
browser-disconnect execution lifetime. See the
[local-first contract](../spec/local-first-conversation-sync.md) and its
verification evidence for supported formats and remaining acceptance limits.
