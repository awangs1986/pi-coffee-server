# Fast conversation switching and temporary resource lifetime

Delivery: [Server #21](https://github.com/awangs1986/pi-coffee-server/issues/21).

## Recent conversation previews

### Last-confirmed model display (2026-10-06, Server #68)

The composer immediately shows the selected Conversation's last confirmed model
ID, provider/source, reasoning level and supported context preset during navigation.
It never displays the previous Conversation's model while waiting for authentication,
native attachment or history. A Conversation without remembered metadata shows
the existing loading/unknown state. The model label keeps its 12-character limit.

`public/conversation-models.js` owns a separate display-only cache keyed by verified
Web identity and Conversation ID. Memory supplies warm switches synchronously;
localStorage restores small metadata after identity verification on page reload.
The versioned cache retains at most 1,000 entries / 256 KiB per identity for 30 days.
Only whitelisted model metadata and the existing engine/native-binding fingerprint
are stored. Catalogs, task bodies, credentials and setting request IDs are excluded.
Malformed, unavailable or quota-limited storage degrades to a miss or memory-only
cache. This does not change the transcript cache's separate lifetime and limits.

Only authoritative selected-socket model responses populate the cache; pending
model/reasoning/context changes are not remembered as confirmed. Cached metadata
does not populate selectable catalogs, enable model controls or issue native
setting commands. Opening a native session retains the labelled preview until
the actual model response replaces it. New responses may correct old metadata;
the preview is not a claim of current native state or restored model context.

Old socket replies cannot update the selected view or its cache. Account changes,
logout/401, archive/removal and engine/native-binding changes invalidate the
affected metadata. New-task model selection remains its existing native catalog
workflow. No Agent process is started merely to read remembered display metadata.

Acceptance: actual app-controller regressions cover all five engine labels,
A/B/A under blocked auth, missing metadata, post-open correction, delayed replies,
unconfirmed settings, account and binding changes, and reload with workspace reads
blocked. `test/conversation-models.test.ts` covers persistence, bounds and failure
fallback. `scripts/probe-conversation-models.mjs` uses real Chromium and synthetic
HTTP/WS without a native CLI/model call; it is browser evidence, not production
model acceptance. Source and activation status belong to [Server #68](https://github.com/awangs1986/pi-coffee-server/issues/68).

### Transcript snapshots

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
If native opening temporarily fails, keep the labelled readable snapshot and
show the error while sending remains disabled. Identity, binding and lifecycle
invalidation still removes snapshots as described below.

Authoritative history initially renders the latest 40 entries; earlier entries
are available under “更早的 … 条记录” using the same safe paged text view. Very large
historical Markdown/tool outputs use bounded plain-text expansion to avoid an
unbounded formatting/diff pass. New live events retain the normal native renderer.
Authoritative tool arguments and patches remain readable through that expansion,
including earlier-history pages and tool error state. These display-only fields
are excluded from disposable snapshots.

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

## Pi process lifetime and native model recovery — 2026-10-07, Server #92

An idle native Pi child may be retired while the Host remains running. Reopening
after browser detachment, reload, idle disposal or Host restart must use the
existing native conversation's model selection. Host-wide provider/model defaults
seed genuinely new native sessions only; they must not be passed as explicit CLI
overrides when an existing native file is resumed.

Pi's own session restoration remains authoritative for ordinary populated
conversations. Existing empty reset/fork bindings retain the established native
branch model/thinking restoration. No browser display cache is allowed to change
execution settings, and no additional synchronous transcript scan is added to
ordinary conversation opening. Chat's zero-system boundary, supported-model policy,
task/native identities and no-prompt-replay behavior remain intact.

Acceptance uses the real pinned Pi CLI behind authenticated Host WS operations:
conflicting Host defaults versus a saved model in ordinary, populated reset and
empty reset conversations; recovery across Host recreation; no provider request
during opening; the next explicit prompt reaching the selected model in a local
provider fixture; independent new Chat tasks retaining the Host default. A
no-turn Gemini/Meta reproduction separately checks the actual installed CLI.
See [Server #92](https://github.com/awangs1986/pi-coffee-server/issues/92).

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

## Independent navigation (2026-10-04, Server #47)

A selection is a local transaction, independent of native attachment and remote
history reads. `ConversationNavigation` owns canonical `/conversations/<id>`
routes and selection occurrences. Sidebar links, search, Back/Forward and new-task
navigation share that transition. URLs contain only an opaque conversation ID;
every HTTP/WS operation still uses authenticated user scope. An explicit route
wins over remembered selection. Creation replaces the draft route. Login carries
only a validated canonical conversation path in OAuth state, never an arbitrary
redirect target. Invalid paths stay 404; unavailable conversations do not silently
select another task or create a native runtime.

`ConversationDisplay` owns the visible history source. It subscribes to the scoped
repository, shows bounded memory/disk data, and admits indexed or native-history
results for its selected conversation. Compatibility-native history cancels
pending indexed render work before taking display ownership. Indexed synchronization
and legacy event rendering do not compete to update the same body. Scroll intent,
saved anchors and the explicit return-to-latest action retain their existing rules.

Native attachment runs separately after local selection. It still verifies the
current login before opening the execution socket: another browser tab may have
replaced the login cookie without broadcasting logout. A pending identity/native
read cannot prevent switching, reading cached/indexed content or editing the
selected draft. Sending remains gated on execution/history readiness and existing
model/effort confirmations. Detaching a socket never stops its native task. The
compatibility fallback still automatically opens native history in the background
for unsupported source formats; this release does not promise zero runtime starts
on browsing. No unverified index is presented as verified native history.

Repository actor queues serialize local load/merge/commit, not network waits.
Incoming socket snapshots and local reads can complete while a network request is
pending. Late responses are checked against scope, binding and revisions at commit;
old metadata cannot downgrade a newer snapshot. Promoting an existing background
sync raises its queued reads into reserved foreground capacity without duplicating
requests or increasing concurrency. Display subscriptions survive cache clearing,
but never survive an account-scope change.

Acceptance crosses the actual DOM, repository, HTTP/WS and Browser/Web/Host seams:
blocked native startup with readable, updating history; A/B/A and Back/Forward with
separate drafts; delayed replies unable to repaint another view; login/deep-link
recovery; unavailable-ID errors; active native task continuity; and queue promotion
under occupied background capacity. Report local paint, latest reply visibility
and native readiness separately. A cache paint alone is not a freshness verdict.

## Connection recovery (2026-10-08)

[Server #103](https://github.com/awangs1986/pi-coffee-server/issues/103)
adds a Browser-to-Host application ping every 15 seconds while visible. A matching
pong must arrive within 10 seconds. Pings are authenticated connection operations,
carry no task binding, and do not wait behind native opening, Fork, takeover or
context reset. Hidden pages pause heartbeat timers; returning or coming online
probes the current connection and requests fresh session/history metadata.
Repeated wake events do not extend an outstanding pong deadline.

A silent transport follows the ordinary disconnect cleanup, retains editable
and unacknowledged drafts, and reconnects with exponential backoff and jitter
(about 1 second initially, capped near 30 seconds). Only an end-to-end matching
pong resets the backoff. Opening the Browser-to-Web socket alone is insufficient.
The Web-to-Host hop also uses protocol ping every 20 seconds and terminates only
that socket after 10 seconds without pong. Native task processes continue running.

Cached models remain display-only; selectable model/source/thinking controls wait
for the authoritative catalog. Initial model requests carry a selection epoch;
a late response cannot overwrite another selected task. A slow catalog shows a
synchronization notice after eight seconds without making the cached catalog
editable or changing native settings.

The compact spacing update retains the existing desktop/mobile layout and all
operation controls. Codex defaults remain unrestricted with native approval set
to never, and the existing Work environment instruction asks for user consent
before dangerous operations. Repository-free Chat retains its zero-custom-prompt
contract. File transfer retains its reachable LAN bind and scoped grants.

## Composer attachment ownership (2026-10-09)

Selection saves unsent original Files beside the account/Conversation's text draft
and renders the selected draft synchronously, before authentication/history arrive.
The new-task draft stays separate. Pending decode/upload results cannot repopulate
a different selection or a removed attachment. Returning never automatically sends
or resumes an abandoned prompt. Identity changes clear both active and saved drafts.
See the [attachment contract](task-storage.md#conversation-scoped-attachment-drafts-2026-10-09)
and [Server #104](https://github.com/awangs1986/pi-coffee-server/issues/104).
