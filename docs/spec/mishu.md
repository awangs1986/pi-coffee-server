# MISHU for an explicitly enabled Pi Chat

Tracking: [Server #59](https://github.com/awangs1986/pi-coffee-server/issues/59).

Owner decision, 2026-10-05: fork `awangs/MISHU` into the independently maintained
[Gitea pi-coffee-mishu](http://gitea/awangs/pi-coffee-mishu). This is an explicit
exception to the Pi plugin monorepo source rule. The owner selected coordination
of **existing conversations**, with independent settings for **the current Pi Chat**.

## User flow

1. Open a Pi Chat, click the coffee icon, and check **MISHU 秘书（当前 Chat）**.
   The idle Chat reconnects with the installed plugin; other tasks continue.
   The Chat recognizes its MISHU secretary role even before setup and explains
   that coordination is disabled. Selection does not authorize cross-conversation access.
2. Send `/mishu-setup`. The directory offers only unarchived conversations with
   activity in the last 72 hours, newest first. Select up to 20 exact target conversations, finish the
   selection, choose information-only or authorized-execution capability, and
   explicitly confirm. Cancellation preserves existing settings.
3. Ask this Chat to discover status, relay bounded messages, or inspect its inbox.
   Targets can be Pi, Codex, Claude Code, Cursor, or Grok. Non-Pi targets must have
   an established native binding (open them and send an initial message first).
4. `/mishu-disable` disables coordination. Unchecking the menu unloads the plugin
   on the next idle reconnect and clears targets. Neither operation stops a target
   task that already received its message. Pending delivery checks revocation again.

Information-only delivery can wake an existing target and receive its reply; its
message says it does not authorize new work, delegation, or permission approval.
Execution instructions additionally require setup permission and a reference to the
user's explicit instruction. Model-generated claims are not independent proof of
user intent. Native permission questions stay with the user in the target Chat/Work.

The plugin refreshes a bounded, transient native Pi custom context message before
every model call. It identifies the selected MISHU application role, independently
of the underlying model name, and states the latest enabled/disabled permission
mode. This latest state replaces historical claims. It contains no capabilities,
credentials or target-provided text and is never appended to durable history.
Host-status failure reports uncertainty and removes the tool. Deselection removes
the identity; ordinary unselected Chat retains zero system instructions. Context
reset preserves selection but does not restore coordination authorization; the new
binding requires explicit setup.

The model tools cannot create conversations, stop tasks, change setup, or answer
native questions. No periodic watcher, automatic reply loop, or background polling
is added. The secretary polls `inbox` when asked or while completing the user's
explicit coordination request. Replies are untrusted data, never new authorization.

## Ownership and interfaces

- The independent package owns `/mishu-setup`, `/mishu-disable`, `/mishu`, the `mishu`
  tool, interactive setup, and bounded secretary guidance. Its Coffee entry does not
  load Herdr, old memory, terminal screens, or WeChat code. Original source/history
  remain in the fork for explicit legacy use.
- Harness 0.3.2 provides `registerChatTools(pi,names)`. Its Chat filters preserve only
  registered **and active** optional tools. The plugin owns enablement. Native Pi
  keeps its own provider wire formats and model authentication.
- Server owns authenticated user scope, conversation/native identity, durable
  settings/receipts, and normal Host prompt/follow-up execution. Agent implementations
  and native login remain unchanged.
- Web forwards `/api/mishu` through existing authentication and POST origin checks.
  It accepts only `status` and `select` for the user's current Pi Chat.
- A per-Chat capability is passed only in the selected Pi process environment.
  `/api/mishu/runtime` derives source/user from that capability, never request fields.
  A separate capability-only loopback listener works even when the main Host binds a LAN address. It exposes status, directory, setup,
  disable, send, and inbox. Setup is allowed only while processing a direct user
  WebSocket `/mishu-setup` command; merely obtaining the Chat capability cannot enable it.

## Delivery and persistence

Setup saves exact Conversation IDs with hashes of native identity, engine, original
creation identity and workspace. Source/target binding changes, archive, cleanup,
Fork preparation, takeover, and lifecycle locks fail closed. Sending checks again
immediately before native delivery, including messages waiting in the existing Host
follow-up queue. Selection changes wait for an idle source with no unknown/active
background work; they do not restart a service.

Messages require stable IDs, a kind, and 1–4000 characters. Execution references are
limited to 500 characters. Reusing an ID for different content fails. Retries of an
identical accepted message return the existing receipt without another send.
Replies are bounded to 4000 characters and flag truncation. The inbox returns the
latest 50 receipts; a Chat retains up to 1000 receipts and at most 20 unsettled ones.
The selection directory is bounded to 200 eligible existing conversations, **after**
the 72-hour and lifecycle filters and newest-first ordering. Host records durable
`lastActivityAt` when a conversation turn starts; existing records fall back to
their last turn snapshot, native summary update time, then creation time if no
activity metadata exists. Renaming a record with tracked turn activity does not
make an old conversation recent. The time window limits new setup selection;
previously approved target bindings do not silently change as the clock advances.

Directory and status resolve current native names, including confirmed renames
and Host restart, with first-user-message preview as the unnamed-title fallback.
Titles are bounded display labels; exact Conversation IDs and binding hashes remain
the authorization and delivery identity. A rename does not retarget a saved binding,
and matching titles never merge permissions or make an ambiguous target unique.

Native extension selection and confirmation dialogs fit inside the viewport with
16-pixel margins. Options and long confirmation text scroll independently of the
visible action footer. Users can reach Finish selection, cancel, or confirm on
short and narrow displays. Answers still wait for native acknowledgement; no
default, focus, scrolling or timeout automatically submits a selection.

Settings and receipts live below the owning workspace root in `.coffee/mishu` and
are written atomically with private file permissions. Host restart retains them;
in-flight/queued receipts become `uncertain` and are never replayed automatically.
A settled native turn is not proof that the requested business outcome was verified.

## Acceptance evidence

- `test/mishu-http.test.ts`: real Pi slash-command UI, two-stage activation,
  unauthorized user/token rejection, source-derived scope, exact native bindings,
  bounded messages, execution opt-in, idempotent receipts and restart persistence;
  all five Agent adapters, and cancellation of queued delivery after disable.
- `test/mishu-menu.test.ts`: real menu DOM selection, explicit setup hint,
  non-Pi/Work exclusion and stale response rejection after switching conversations.
- `test/mishu-directory-http.test.ts`: recent-only selection after historical
  entries exceed the cap, archive exclusion, actual activity and rename-only recency.
- `scripts/probe-extension-dialog.mjs`: real Chromium, 200 options, long native
  confirmation, explicit completion/cancel/Escape and desktop/short/mobile viewports.
  Current-title rename/restart regression is in `test/mishu-http.test.ts`.
- `test/mishu-http.test.ts` additionally verifies installed-package identity in actual
  native provider payloads before setup, after setup/disable, and after context reset.
- Independent package tests: public extension + HTTP interface, cancel/default
  handling, validation and revocation. Actual native Pi/Harness/model HTTP fixture
  proves tool execution in both extension loading orders.

Candidate publication and browser evidence are recorded separately in
[the implementation report](../reviews/mishu-20261005.md). Production activation
requires the normal Server release process and is not implied by published packages.
