# MISHU for an explicitly enabled Pi Chat

Tracking: [Server #59](https://github.com/awangs1986/pi-coffee-server/issues/59).

Owner decision, 2026-10-05: fork `awangs/MISHU` into the independently maintained
[Gitea pi-coffee-mishu](http://gitea/awangs/pi-coffee-mishu). This is an explicit
exception to the Pi plugin monorepo source rule. The owner selected coordination
of **existing conversations**, with independent settings for **the current Pi Chat**.

## User flow

1. Open a Pi Chat, click the coffee icon, and check **MISHU 秘书（当前 Chat）**.
   The idle Chat reconnects with the installed plugin; other tasks continue.
2. Send `/mishu-setup`. Select up to 20 exact target conversations, finish the
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
The selection directory is bounded to 200 eligible existing conversations.

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
- Independent package tests: public extension + HTTP interface, cancel/default
  handling, validation and revocation. Actual native Pi/Harness/model HTTP fixture
  proves tool execution in both extension loading orders.

Candidate publication and browser evidence are recorded separately in
[the implementation report](../reviews/mishu-20261005.md). Production activation
requires the normal Server release process and is not implied by published packages.
