# Local-first conversation display and durable synchronization

Implementation started from GitHub main `6cb1d3244fdf6305d2b798f48082c5d27e03a831`
and was integrated with OAuth main `b39e85160c871194430f78d21abb2d46fe560a41` before publication.
This changes the Browser/Host display path, not native model ownership. Native tasks
continue when their Browser view switches or disconnects. Stopping a task remains
an explicit command. The October 3 integration incorporates PR #32's continuity/model-selection work
and PR #40's Conversation Fork while preserving current OAuth and watchdog behavior.
Pi PR #8 remains a separately versioned plugin source change; this does not update Server pins.

## Three lifetimes

- View: current authenticated scope, selected conversation, view generation,
  visible entities, scroll anchor and page-memory text draft.
- Synchronization: independent per-conversation serialized actors, read-only
  requests, epoch/revision validation, bounded memory and IndexedDB cache.
- Execution: existing Host Session/native adapter, command acceptance and model
  lifecycle. Cache success never proves native prompt delivery.

Switching saves a lightweight anchor/draft, invalidates old layout jobs and
immediately displays available local content. It does not project the complete old
transcript, await a network response, or send an abort. Socket controls remain
separate from the read-only synchronization pool. Recent conversations continue
background synchronization with bounded concurrency and retry backoff.

## Negotiation and rollback

New clients request `syncProtocol: 2` on `open`. A v2 Host starts the explicitly
opened execution session but does not call the legacy complete-history preparation
path. It sends a bounded `history` snapshot with durable identity. Body content
then comes only from the repository; legacy text/tool events do not independently
append a second transcript. `sync_changed` is a small notification emitted after
index commit. Control/run/approval events retain their execution role.

Old clients and older servers keep the existing protocol. The Browser accepts
legacy `history` and uses the bounded legacy live renderers. The Browser URL
`?syncProtocol=1` requests that fallback. Host `PI_COFFEE_SYNC_V2=off` (or
`syncProtocolV2: false`) declines v2 opening without removing index files.
Neither switch erases native history. A renderer change is not a production
rollout, and no deployment is performed by this branch.

## Read-only API

All routes use the existing authenticated Web-to-Host user selection and check
conversation access inside that scope. They never create/resume a native session
or submit a prompt merely to prefetch a transcript.

- `GET /api/conversations/:id/meta`
- `GET /api/conversations/:id/page?cursor=...&limitBytes=65536`
- `GET /api/conversations/:id/changes?bindingEpoch=...&afterRevision=...&limitBytes=65536`
- `GET /api/conversations/:id/content?bindingEpoch=...&entityId=...&entityRevision=...&offset=...&limitBytes=8192`

Epochs survive normal restarts. Rebinding or incompatible history replacement
changes the epoch. Revisions are unsigned decimal strings, not JavaScript numeric
cursors. Stable entities have their own entity revision. Snapshot page cursors are
bound to their snapshot/epoch and rejected when invalid; they are not mutable
array offsets. Text offsets and lengths use UTF-16 code units, while transport
and display budgets use UTF-8 bytes.

The latest page has at most 40 entries and a byte bound; giant individual content
is separately pageable. Long live content carries a bounded tail plus
`contentOffset`/`contentLength`, so streaming does not appear frozen at the first
8 KiB. Previous/next/latest controls read bounded authoritative content. A copied
truncated message is explicitly labeled as copying only the displayed segment.

Changes contain contiguous operations, durable watermarks and entity versions.
Wrong epochs, future cursors, pruned logs, unknown operations and invalid text
patch bases cause controlled errors/resnapshot, never blind append. Edits and
deletes invalidate affected pages; deletion removes visible older entities too.
A stale snapshot or old-user response cannot replace a newer local state.

## Durability and source freshness

The Host maintains a per-user/per-conversation SQLite display index through a
bounded shared worker pool. Entity changes, operation log and head revision are
committed atomically before notification. Native history remains authoritative;
the display index can be rebuilt. External native changes are audited without
runtime activation. Unsupported, inconsistent, unavailable or still-reconciling
sources are labeled `unknown`/`reconciling`, not declared current or replaced with
a misleading empty history. A source audit has an epoch/revision guard against
concurrent streamed output.

IndexedDB applies page/entity changes and its durable watermark together with
transactional compare-and-set. Failed persistence leaves the memory view usable
without advancing the on-disk watermark. This cache stores inert display data;
file authorization URLs, image bytes, credentials, tool argument objects and
executable approval controls are excluded. A 401 revokes visible cached identity,
page-memory drafts and old synchronization work immediately.

## Display and resource budgets

Initial budgets are implementation guardrails, not measured hardware SLOs:

- Latest page: 40 records / 64 KiB; individual displayed text block: 8 KiB UTF-8
- Older-page view: small bounded buffer, demand loaded near the top, stable anchor
  restored while older records are inserted; late size changes use ResizeObserver
- Render scheduler: 4 ms frame target, coalesced dirty entity jobs, explicit
  identity/generation/revision guards; a long single job is reported as an overrun
- Browser synchronization: at most two shared JSON workers, bounded request pool,
  timeouts, single-flight and bounded queues; timed-out underlying work is still
  counted until it actually settles
- Recent cache: five in-memory conversations; IndexedDB quota/eviction and
  transaction failure fall back to memory without stopping native execution
- Text drafts: 30 page-memory drafts / 4 Mi UTF-16 code units; cleared on logout

Small completed messages can use the existing sanitized Markdown chain. Long or
live text is safely rendered as bounded plain text; completion cannot trigger an
unbounded complete-message Markdown/diff pass. Tool bodies are lazy and collapsed
updates only touch short status/length text. Reading older history does not force
scroll-to-bottom; a new-message control returns to the latest page.

## Synchronization and login animations

The selected conversation shows a small code-native pixel black running cat only
while synchronization is in progress. Error, offline and timeout states stop it
and expose retry. Other conversations' synchronization cannot animate the current
view. Reduced-motion preference removes motion, and status text remains available
to assistive technology. The indicator never disables the composer or blocks the
transcript.

After a successful identified page login, a distinctly anime PC-98/256-color-era
cat maid offers coffee as a clean transparent character cutout. The locally
bundled 768×1152 RGBA WebP is 203,868 bytes (199 KiB). It was revised from the
owner's supplied reference: larger stylized eyes, flat cel shading and restrained
pixel/dither colors. There is no cafe scenery, illustration frame or visible
dialogue box. The greeting remains available to assistive technology.

There are no third-party image requests, video, audio, canvas or JavaScript
animation loops. A subtle CSS transform and opacity sequence removes itself after
2.2 seconds. Skip/Escape/Enter or a click dismiss immediately without activating
an unseen composer or approval control. Input focus is not stolen and loading/
authentication proceed independently. Reduced-motion uses a short static
illustration. Socket reconnects and conversation switches do not replay it;
genuine logout/new login can. A failed image removes the overlay.

## Evidence boundaries

Run `npm run check` and the focused protocol/repository/app tests. The actual
Browser controller is tested through public DOM, HTTP fixtures and WebSocket
frames for live Pi/Codex/Claude text/tools, long messages, paging, edits/deletes,
identity changes, stale results, drafts and failed/hung synchronization.

`scripts/probe-local-first-sync.mjs` is the real-browser live-frame probe. It
includes fresh events/history while switching, rather than only warm cached views
with zero incoming frames. Browser timings, paint, input responsiveness, anchor
pixel error and long-run memory must be measured on the intended device/browser;
JSDOM correctness does not prove those performance results. See the accompanying
verification report for exact commands, failures, mutation results and unavailable
stages. No production performance claim or deployment approval is implied.

## Delivery receipts and urgent controls

`GET /api/conversations/:id/commands?requestId=...` returns bounded delivery
receipts without prompt bodies. States are `accepted`, `delivering`, `running`,
`settled`, `uncertain` and `cancelled`. Acceptance is committed before ACK; native
execution is a separate step. A restart converts unfinished receipts to uncertain.
Duplicate IDs are never replayed. The per-conversation receipt cap is 4,096 IDs
or about 1 MiB; new acceptance is refused at capacity rather than evicting replay
protection. Start another conversation when that explicit limit is reached.

V2 task controls carry conversationId and bindingEpoch; requestId remains the
command identity. The Host checks its attached-session epoch fence without waiting
for a display-index read. Stop and question answers use an urgent socket lane.
Stop invalidates delivery generations, aborts native execution before waiting on
receipt bookkeeping, and prevents an older queued acceptance/delivery from
starting a prompt after its blocked write later finishes. These guarantees do not
claim exactly-once native execution or authorize automatic resend.

A synchronization HTTP response also carries userScope derived by Web from its
current authenticated identity. A tab rejects a missing/mismatched scope even if
another tab changed the cookie without broadcasting an invalidation event.

For history-window restoration, `page?anchorEntityId=...` returns a current bounded
page containing the stable anchor. A missing/deleted anchor falls back with an
explicit adjustment marker. This validates restored cached older windows without
requiring their old snapshot cursor to remain valid indefinitely.

## Compatibility boundary

Some earlier Codex rollout formats do not expose the canonical stable item
records supported by the read-only file audit. Their source remains unknown.
A cold/unverified index declines v2 enrollment and uses the existing explicit
opening path, so established conversations remain readable. This fallback still
uses bounded Browser rendering and cache-first display, but does not claim the
new durable delta/paging guarantees for that unsupported source format. No
production-native session compatibility or target-device performance has been
certified in this environment.

## Review corrections (2026-10-04, Server #44)

The internal per-conversation serialization tail must settle to `undefined` on
both success and failure. Only the result returned to its caller may carry a
transcript window; clearing an evicted actor's state must release that body.
Older-page buffers are part of the displayed history projection: replacement,
append and deletion operations update buffered entries before they are revealed,
as well as currently visible entries.

Both legacy and V2 user-message renderers parse the same bounded upload marker
into attachment chips. Cached state contains only inert text/paths; fresh task
transfer grants bind download URLs when the view renders or a grant arrives.
No grant is persisted in IndexedDB. Native message text remains unchanged.

## Latest-history correctness after selection (2026-10-04, Server #45)

Layout, message mounting and scroll-anchor restoration produce scroll events.
Those events alone must never request older history or mark the view as reading
an older window. Automatic older-page loading requires explicit reader input
(wheel/touch, upward keyboard navigation or scrollbar interaction); the Load older
button remains explicit navigation. Selection clears pending scroll intent.
Returning to latest remains separate from preserving an intentionally older
reading position. Test latest native reply visibility, not just cached body paint.

An explicit v2 open requires a currently verified native source. A non-null old
lastSourceCheckAt is insufficient when sourceFreshness is unknown or reconciling.
In that case, open through the native-history fallback and retain cached preview
only while that read is pending. Read-only index HTTP requests remain independent
of execution and never start a native runtime. A later currently verified open
may negotiate v2 again; source uncertainty must not silently hide newer native
history behind an old display index.
