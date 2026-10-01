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

Sidebar discovery uses native Codex's metadata index (`thread/list` with
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
fresh stored metadata. The complete check passes 426 tests. An isolated Host using
real native metadata listed six registered Codex tasks for six clients in 155 ms
with one stored read; five had matching native listing metadata and the remaining
older task retained the existing durable fallback. No prompts were submitted.
Production activation requires the existing running task to settle first.
