# Fast conversation switching and temporary resource lifetime

Delivery: [Server #21](https://github.com/awangs1986/pi-coffee-server/issues/21).

## Recent conversation previews

The browser retains up to five recently viewed transcripts in page memory, with a
16 MiB serialized DOM weight budget. Oversized entries are not retained. This is
a disposable preview, not a persistent transcript store; reload and logout clear
it. Keys include the authenticated user and Conversation ID. Identity changes
clear previews. Agent takeover invalidates previews.

Revisiting a retained conversation reattaches its existing DOM immediately and
restores scroll position before network responses. The preview is inert and the
composer cannot send until authoritative history arrives. The user can scroll
and type a draft during synchronization. Current Host history replaces the
preview, including external updates. A failed load remains visibly synchronizing
or failed rather than claiming the preview is authoritative.

Selecting a different task immediately detaches the old socket handlers. Only the
latest authentication attempt may reconnect. On the new connection, the selected
Conversation opens before the sidebar scan so listing unrelated tasks cannot
block its history. An open abandoned during history loading never attaches a
phantom subscriber; it follows the ordinary idle lifecycle. Running tasks survive
browser switches and disconnects.

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
they do not prove whether the native agent executed a request. Reject prompts above
the existing 64 Ki-character or 1 MiB encoded-frame limits before clearing the draft.
The outbox is limited to 20 requests / 8 MiB; stop new submissions rather than evict
unconfirmed requests at capacity. Clear on logout, 401 or account change. It is not
persisted to browser storage and does not survive a page reload or tab closure.

The recovery-card regression covers both Pi and Codex. Production disconnect causes
must be verified separately; successful metadata/history probes alone are not proof
that a user prompt was accepted and executed.
