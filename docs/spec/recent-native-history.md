# Recent-first native history

Accepted 2026-10-20. This supersedes complete-history fallback on Browser open
for the production Codex App Server adapter. The production adapter uses the native `excludeTurns` resume option; lightweight
legacy adapters without the display-page interface retain their existing path.
Complete native history remains authoritative for export, Fork,
Handoff, context operations and other consumers explicitly requiring completeness.

## Display contract

- Opening or revisiting Codex uses an already verified bounded index window, or
  reads one native `thread/turns/list` page, descending,
  at most five turns, then projects that window in chronological order. Existing
  thread resume requests exclude turns from their response. Neither operation
  starts a model turn. A failed passive file audit must not trigger an ascending
  traversal of all native history for display.
- Browser receives at most 40 entries and a bounded 64 KiB display page. Entries
  within a native page are paginated too: a turn containing many items must not
  silently lose its earlier entries. Compact/detailed selection is applied before
  display pagination. Empty projected native pages retain the older-page control.
- Earlier history is explicitly loaded through an inline older-records panel.
  It retains one bounded page, supports backward navigation through visited pages
  and does not replace the live latest-message area. Live execution and prompt
  handling continue while the user reads older records. Switching conversations,
  accounts or display modes fences late responses.
- Oversized entry content is visibly abbreviated with an authenticated download
  of the original entry, never silently discarded or rendered as untrusted HTML.
- Display pages prove only their own native window, not a successful audit of the
  entire conversation. They must not replace durable history exports or claim a
  complete native history watermark. Existing verified indexed delivery remains
  available; unverified Codex history uses the bounded display interface.

New Browsers advertise `recentHistory=true` on open. Older clients retain their
compatible history presentation; they are not sent inaccessible partial pages.
The latest native response is bounded separately from complete-history consumers.

Once a recent-native window is admitted, stop Browser index polling for that
conversation and suspend its passive complete-file audits. Keep indexed freshness
unknown instead of claiming a successful complete audit. A client returning to
the non-window path re-enables audits; active execution events remain retained.
An already running audit may finish, but cannot mark the suspended index current.

## Ownership and resource bounds

The Agent interface exposes an optional display-page read, separate from
getHistory. Host owns filtering, bounded entry slicing, pagination tokens and
content downloads. Native cursor semantics remain in the adapter. Every read is
scoped to the authenticated user and existing task; archived/removed/rebound tasks
cannot reuse old page tokens. Random opaque tokens are kept in memory and bound
to the originating HostSession, mode and native binding generation. A Host restart
or expired token asks the user to reopen/reload; it never starts a replacement task
or replays a prompt.

Retain at most 64 MiB of projected display data per process with an LRU/TTL bound
of ten minutes for tokens; expired storage is reclaimed on access or within the
next sixty-second collector tick. Retained page/token count is bounded as well. Eviction must release
original text and tokens together. Never start background conversations to prewarm
this cache. Identical concurrent reads share one in-flight operation. Errors and
expired cursors are surfaced; no fallback to a complete native scan is permitted.
Native RPC decoding still materializes one native page; its cost is distinct from
the bounded retained cache and Browser payload. A large single turn can therefore
still be costly. Prior Handoff prefixes are loaded only when requested; their
existing local JSON decoder can materialize the prefix for that explicit read,
but display reads do not memoize the entire prefix. Oversized results fail explicitly rather than weakening budgets.

## Acceptance

Public HTTP/WS tests must show an unverified Codex open requesting only the recent
native page (no ascending scan or complete export), older-page traversal without
loss/duplication, compact/detailed separation, cross-task token rejection,
expiration/rebinding behavior and oversized-entry recovery. Existing complete
history consumers must retain their complete read semantics. Browser tests cover
bounded older-page display, live latest messages, delayed response fencing and
no prompt/abort caused by browsing.

The investigated task reproduced ~104 MB / 21 seconds for four complete-history
pages versus ~950 KB / 435 ms for the most recent five turns. These are diagnostic
measurements, not a universal latency guarantee. No user transcript belongs in
fixtures, commits or Issues; use synthetic large histories and new native item
formats. Source, published version and production activation remain separate.
