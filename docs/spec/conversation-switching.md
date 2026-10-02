# Fast conversation switching and temporary resource lifetime

Delivery: [Server #21](https://github.com/awangs1986/pi-coffee-server/issues/21).

## Recent conversation previews

The browser keeps five user-scoped recent display snapshots in page memory and
IndexedDB. This supersedes the earlier page-only/no-persistence decision in #21.
Host/native history remains authoritative. Cookies are not used for transcripts.

Snapshots contain normalized plain text (user, assistant, tool output and notes),
not DOM/HTML, image bytes, tool argument objects, file-grant URLs, or action handlers.
Unacknowledged optimistic prompts and recovery cards stay in the page-only outbox;
transcript-cache invalidation in another tab does not discard that outbox.
The persistent cache is versioned, expires after 24 hours, and has an 8 MiB
serialized UTF-8 limit per conversation / 40 MiB total / five-conversation LRU.
Projection also limits each snapshot to the latest 10,000 entries and 4 Mi UTF-16
code units. Limits preserve the newest text and set an explicit truncation notice;
complete history remains on the Host. Page memory uses a 48 MiB conservative text and
per-entry weight budget to retain five maximum-sized projected snapshots.

A cached conversation paints its latest 40 entries without waiting for auth/socket
reconnection or Host history during a same-page switch. Older cached entries are
readable in 40-entry pages; individual long entries expand in 8 Ki-character
blocks. Cached text is deliberately plain text: formatting, images and live task
actions are supplied by authoritative history. The view clearly identifies cached
content, remains scrollable/selectable, and permits local paging while sending
stays disabled until current history arrives. No outgoing DOM serialization or
whole-transcript Markdown/diff rendering is on the switching path. Cached entries
are not consumed on display, so rapid A/B/A switches before synchronization do not
lose the preview.

Authoritative history initially renders the latest 40 entries; earlier entries
are available under “更早的 … 条记录” using the same safe paged text view. Very large
historical Markdown/tool outputs use bounded plain-text expansion to avoid an
unbounded formatting/diff pass. New live events retain the normal native renderer.

Reload restores a persisted snapshot only after `/auth/me` verifies the identity.
A cold first-ever conversation still needs Host history. Disk reads, identity,
selection epochs and source fingerprints are checked before restoring a preview;
a late cache result cannot replace newer history or another conversation. Failed
or unsupported IndexedDB, blocked opens, quota failures and corrupt data degrade
to cache misses. Logout revokes old socket callbacks before awaiting cache deletion;
other tabs receive a cache-clear signal. Account changes, archive/deletion and
Agent takeover invalidate affected snapshots. Delayed workspace metadata can
invalidate an already displayed preview after a binding or lifecycle change.

A selected task opens before the sidebar scan. Native capabilities are resolved
before taking the opening snapshot, and opened/history/replay are sent as a
contiguous sequence before transfer setup can await. Running tasks survive browser
switches and disconnects.

### Performance acceptance (owner runtime verification)

No production sub-second timing is claimed by this patch. Use five genuinely long
conversations, revisit A/B/C/D/E for at least five rounds, and measure click to the
first readable, scrollable conversation body (not title/spinner). Target every warm
switch under 1,000 ms. Repeat with slow or unavailable Host history, rapid A/B/A
switches, and browser reload after caching. Reload timing should separately report
authentication and IndexedDB-to-readable time. Check older-message paging, long
message expansion, external updates, logout/login as another user, archive/delete,
and Agent takeover. Send must stay disabled until authoritative synchronization.

A repeatable local synthetic fixture is provided by
`node scripts/probe-conversation-switching.mjs` after `npm run build`; open its
printed local URL. It prepares five 1,500-message transcripts (~3 million text
characters each), measures 25 switches through paint and actual scroll movement without new
history responses, checks rapid A/B/A and delayed background history, then reloads
and checks all five IndexedDB restores. A 300 ms synthetic authentication delay is
reported separately. Results include per-switch times, browser/viewport, long tasks
and composer gating, and are saved to `/tmp/pi-coffee-browser-probe.json`. Its results
are synthetic/browser-specific and cannot substitute for the owner's runtime test.

## Codex process lifetime

Concurrent requests through the same native factory share one in-progress
app-server initialization. Failed initialization stops its child and can be
retried. Listing-only factories participate in idle shutdown after outstanding
list reads complete. A live session prevents idle shutdown. Closing a factory
waits for initialization before stopping it. Each app-server uses its own process
group; shutdown terminates both the CLI wrapper and its native descendants.

Unbound conversation discovery uses native Codex's metadata index (`thread/list` with
`useStateDbOnly: true`), retaining cwd filters and pagination. A sidebar refresh
must not trigger rollout scan/repair across the native history store. Native
index repair, when needed, is separate from normal sidebar reads.
Overlapping sidebar reads share one in-flight stored listing per authenticated
user's Host registry. Success and failure both release the shared promise; the
next refresh reads again. Running, queue and attention state are decorated from
live sessions after the read, never cached with the stored metadata.

## Temporary directories

Host startup allocates a private directory under
`~/.cache/pi-coffee/runtime-tmp/` (override with `PI_COFFEE_TMP_ROOT`). `TMPDIR`,
`TMP`, and `TEMP` point there for native children. Use a disk-backed path; this
avoids consuming tmpfs RAM for ordinary native temporary-file APIs. Graceful Host
shutdown closes native factories before removing that Host's temporary directory.
A crash may leave its directory for inspection; do not remove another live Host's
or task's files. Programs that explicitly hardcode `/tmp` do not obey TMPDIR and
are outside this routing guarantee.

`npm run check` allocates one private disk-backed run directory under
`~/.cache/pi-coffee/checks/` (override with `PI_COFFEE_CHECK_TMP_ROOT`), passes it to
build/tests and removes it after success or failure, including fixtures without
individual cleanup. Child process groups are stopped before cleanup. Abrupt VM
shutdown or SIGKILL can leave disk artifacts; no automatic broad prefix deletion
is permitted. Durable conversations, attachments, repositories, Skills and native
account directories never belong under these disposable directories.

## Incident evidence boundary

At investigation time `/tmp` was an empty 22 GiB tmpfs. The reported historical
`pi-coffee-*`, `verify-*`, `gsphone-*`, and `pulse-*` trees were absent; their
contents and attribution could not be verified. Multiple live Codex app-servers
were observed under the workbench Host. A deterministic 12-way sidebar discovery
reproduced 12 process starts before the fix and one after it. This confirms the
startup race, not a complete retrospective attribution of the earlier OOM.

## Sidebar timeout regression (2026-10-01)

A production `list_sessions` probe exceeded 30 seconds while the services stayed
alive. A same-cwd native comparison measured 2,238 ms with rollout scan/repair
versus 28 ms with index-only listing. This confirms a discovery bottleneck, not a
claim that every reported browser freeze has the same cause.

Regression coverage exercises paginated discovery with the rollout scan
unavailable, and six authenticated WebSocket clients sharing a delayed read.
Both a successful read and a failed read are released so the next request sees
fresh stored metadata. The pre-merge complete check passed 426 tests. An isolated Host using
real native metadata listed six registered Codex tasks for six clients in 155 ms
with one stored read; five had matching native listing metadata and the remaining
older task retained the existing durable fallback. No prompts were submitted.
Production activation requires the existing running task to settle first.

## Sidebar request isolation (2026-10-01)

[Server #23](https://github.com/awangs1986/pi-coffee-server/issues/23) additionally
fixes an observed native metadata stall. A socket's sidebar list request runs
independently of its ordered task-control messages; a blocked listing cannot
hold up ping, answers or prompts. Concurrent listings in one authenticated user
registry share a single discovery operation. Bound Codex tasks read metadata
by native ID and verify its cwd, instead of scanning the native store once per
project directory. Discovery RPCs have a ten-second bound. A timed-out directory
scan cools down for sixty seconds, and its metadata process can be recycled only
when it has no live sessions or in-progress session creation. No task execution
process is killed as a discovery recovery action.

## Workspace reads and shutdown (2026-10-01)

Overlapping HTTP status/diff requests share one outstanding read inside the
selected user slot, keyed by task, action and effective refresh/diff scope.
Completed and failed reads are discarded. Periodic browser refreshes must not
accumulate equivalent remote Git queries while an earlier read is still pending.

A disconnected HTTP client does not cancel the workspace operation it started.
Graceful Host shutdown stops accepting requests/upgrades, closes browser sockets,
and waits for accepted API handlers to finish their cleanup before closing native
factories and returning to the process exit path. Concurrent shutdown callers
share that completion. Hard termination may still leave a durable operation lock;
an administrator must inspect Git work before moving a stale marker aside.

Regression evidence: an aborted authenticated project-registration request held
an actual workspace lock. Before the fix, Host close returned while the lock was
still held. After the fix, close waited for operation settlement, the marker was
removed, and a restarted workspace owner could mutate normally. Six overlapping
HTTP status/diff requests likewise reproduced six underlying reads before the
fix and one after it, including retry after a failed shared read.

## Auxiliary reads cannot block delivery (2026-10-01)

The socket's ordered command lane is reserved for task operations. Model, Skill
command, extension, usage and draft-catalog reads run outside it. Each socket
coalesces equivalent outstanding reads, limits outstanding keys and applies a
ten-second deadline. A timed-out underlying read remains shared until it settles,
so polling cannot create more hung native requests. Results are dropped after the
socket disconnects, opens a session or changes model/context/thinking settings.
Metadata failures use `metadata_unavailable` with their originating operation;
they leave the running turn and editable input queue intact.

Codex initialize, model/config discovery, native Skill discovery and account-meter
reads also have a ten-second native RPC deadline, removing pending request entries
without stopping a live task. The deadline does not apply to model turns.

Sync status reads serialize under a separate status key. Waiting for remote Git
must not hold the conversation lock needed to reserve a run and record its turn
snapshot. Existing lifecycle exclusion and stale-marker inspection remain in
force for archive, takeover, checkpoint and permanent cleanup.

Regression feedback loops: a suspended auxiliary read followed by a prompt; a
real repository whose upload-pack waits on a gate during a status refresh; a
silent native Codex model/list; and a complete Web-to-Host prompt followed by
reconnection and native history inspection. Before correction, the first two
blocked prompt acceptance and produced no native user entry. After correction,
the prompt is acknowledged and reaches native history while the read is pending.

### Unacknowledged prompt recovery

A socket write is not delivery confirmation. Until a matching prompt/steer/follow-up
ACK arrives, retain the text, inline images and uploaded-file paths in a bounded,
page-memory outbox keyed by authenticated user, conversation and request ID.
Disconnects, conversation switches and history replacement must not erase those
requests. Show an explicit uncertain-delivery card with manual restore and dismiss
actions; never automatically resend or infer acceptance from matching transcript
text. Restoring must not overwrite a newer composer draft. Multiple outstanding
requests must remain independent. Late matching ACKs remove their recovery cards.

After 20 seconds without an ACK, surface the retained request and timeout reason.
A disconnect card includes its WebSocket close code. These signals diagnose delivery;
they do not prove whether the native agent executed a request. Reject encoded
frames above 1 MiB before clearing the draft; text has no separate 64 Ki-character
ceiling. UTF-8, JSON escaping, request fields and images all consume that budget.
The outbox is limited to 20 requests / 8 MiB; stop new submissions rather than evict
unconfirmed requests at capacity. Clear on logout, 401 or account change. It is not
persisted to browser storage and does not survive a page reload or tab closure.

The recovery-card regression covers both Pi and Codex. Production disconnect causes
must be verified separately; successful metadata/history probes alone are not proof
that a user prompt was accepted and executed.
