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
   Reopening setup prechecks still-valid prior selections so contacts can be added
   or removed incrementally. New contacts remain subject to the 72-hour window;
   previously confirmed contacts can remain selected after aging beyond it.
   Archived/unavailable targets or changed source/target bindings are not prechecked.
   Each edited set still requires explicit message-mode choice and final confirmation.
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

The selected secretary also retains the original warm, attentive, reliable
MISHU personality: Chinese and a natural “老板” address by default, overridden
by the user's latest name/language/tone preference. It responds to the person's
situation before proposing concrete next steps. Greetings do not require repeated
model, permission or protocol explanations; relevant limits remain truthful.
Reports use understandable language and never equate idle with completion. This
fixed, bounded personality shares the transient context, stays present while
coordination is off/unknown, and disappears on deselection. It does not load old
MEMO files, Herdr roles or historical operational policies.

The model tools cannot create conversations, stop tasks, change setup, or answer
native questions. No periodic watcher, automatic reply loop, or background polling
is added. The secretary polls `inbox` when asked or while completing the user's
explicit coordination request. Replies are untrusted data, never new authorization.

## Current-request follow-through (0.1.5)

An explicit inquiry must resolve configured contacts, send an information-only
question, inspect its correlated receipt, then report actual evidence. Directory
idle labels and an empty inbox are not substantive project progress. Reporting a
project issue can be relayed as facts/questions; it does not authorize a repair.
The secretary must not claim contact before actual tool execution.

A completed short action announcement with zero MISHU tool attempts may trigger
one native pre-settlement continuation. Abort/error, disabled/unknown state,
questions and any attempted tool exclude it. A repeated announcement settles with
an unfinished warning. The conservative detector is not a complete intent parser;
metadata calls followed by no send still depend on model adherence to guidance.
Native Pi persists a fixed hidden action-check audit marker to resume the terminal
assistant message; it contains no user content or authority and is filtered out
of provider context. Identity/personality/permission context remains transient.

Inbox can briefly await only message IDs accepted during this user request, with
one shared fixed 12-second polling budget after the initial response. Extra polls
recheck enablement and respect cancellation. Existing HTTP timeouts still apply
to initial requests. At expiry it returns the last observed pending receipt;
older receipts alone never start waiting. No background watcher or replay exists.
The secretary must explain that a later user inquiry can collect delayed replies.

The [SPEC gap audit](../reviews/mishu-spec-gap-20261005.md) preserves unimplemented
legacy requirements rather than treating this first-release bridge as their
completion. [Firstmate research](../research/firstmate-mishu-20261005.md) compares
its durable coordination mechanisms with the Coffee entry; it is not a dependency.

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
`directory.configuredTargets` separately returns at most 20 retained entries whose
saved source/target bindings are still current and whose targets remain available.
Only these entries may bypass the recency window during incremental setup; arbitrary
older IDs remain rejected. Setup validates the entire edited set again at commit.

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
  Its incremental-setup regression uses the published 0.1.3 plugin with native Pi,
  adds a recent target while retaining an aged binding, then excludes an archived one.
- `test/mishu-http.test.ts` additionally verifies installed-package identity in actual
  native provider payloads before setup, after setup/disable, and after context reset.
- Independent package tests: public extension + HTTP interface, cancel/default
  handling, validation and revocation. Actual native Pi/Harness/model HTTP fixture
  proves tool execution in both extension loading orders.

Candidate publication and browser evidence are recorded separately in
[the implementation report](../reviews/mishu-20261005.md). Production activation
requires the normal Server release process and is not implied by published packages.

## Complete-secretary target and implementation status (2026-10-05)

The owner requested completion of the missing specifications. The canonical
[complete Coffee secretary SPEC](http://gitea/awangs/pi-coffee-mishu/src/commit/7ef9b4b72242758d4ffb6203543bb314177b2832/docs/coffee-secretary-spec.md) belongs to the independent
plugin repository. Its M01–M13 requirements, S0–S6 stages and A01–A28 acceptance
cases cover the original secretary experience: task briefs, correlated reply
obligations, durable memory, recoverable notifications, instruction ordering,
bounded helpers, stronger authorization and human-readable follow-through.
This is a target contract, not a claim that these capabilities exist in 0.1.5.
The earlier sections describe the implemented v1 contract; their exclusions of
background supervision and new helpers remain the installed default.

The 0.1.5 / `0af6cb924eaad1ae8a0d6ec597631c5c5f6f3e99` rollout completed on
2026-10-05. The deployment record confirms normal Host mode, exact release
identity, served-asset probes, native setup/incremental setup/disable, and an
isolated production Pi-to-Pi information-only inquiry with one send, a correlated
settled reply, same-request reporting and archived synthetic Chats. Prior isolated
Pi-to-Codex evidence remains in the audit. Neither result completes the target
SPEC or verifies every live engine account.

### Planned Host resource contracts

These are vNext obligations, **not additional accepted actions on the v1 runtime
endpoint**. A later implementation must version and validate its wire schemas,
publish actual capabilities and add public HTTP/WS regressions before exposing
any operation. MISHU remains a Pi plugin; native execution stays behind the Host's
existing Agent interfaces, and Web continues to authenticate and forward.

| Resource | Required durable identity and information | Host responsibility |
| --- | --- | --- |
| Managed Task / Task Brief | taskId, secretary owner, purpose/scope, exact responsible bindings, versioned summary, evidence/time, next step, work state, separate acceptance state | Explicit user admission, scoped reads/edits, no same-title merging, no inferred success |
| Assignment / instruction index | assignmentId/instructionId, taskId, target binding, canonical project root, request identity, authorization evidence, priority/order, retryOf | Persist before execution; one live executor per Assignment and serial execution per target; reorder pending work only |
| Reply Obligation | obligationId, task/assignment/message correlation, source/target generations, expected reply, state, observed evidence, optional deadline | Only a matching reply advances responsibility; reconcile after restart; uncertain never triggers replay |
| Notification Outbox | notificationId, event revision, recipient binding, bounded summary, delivery/ACK state | Atomic event/outbox creation; idempotent recipient presentation; ACK is not a user read receipt |
| Memory / daily context | entryId, scope/type, text or artifact reference, source/time, record revision, deletion tombstone | User-inspectable correction/deletion/export, bounded context reads, no restoration of old authorization |
| Follow-up plan / lease | planId, task/targets, event-only or scheduled policy, interval/deadline/count budget, permission revision, generation/lease | New capability defaults off; one valid worker; stop on revocation/expiry; no missed-interval replay storm |
| Temporary delegation | delegationId, coordinationId, exact scope, task fingerprint, parent budget, native handle, state, retryOf | Enforce shared 3-per-coordination/6-per-account budget atomically; no duplicate active work or unapproved fallback |
| Authorization evidence | unguessable Host-issued ID, authenticated user event, exact source/target/task/scope/action, expiry/use/revocation constraints | Model can reference but cannot mint evidence; sender and receiver admission both check current trusted state |
| Handoff / artifact | schema/correlation/target identity, summary/facts/action/mode/evidence, artifact owner/hash/time/range/retention | Structured total-size budget, private neutral storage, per-object authorization, traversal/symlink/range checks |
| Approval summary | target native question ID/generation, action/impact, expiry, one-use user-response identity, native ACK | Display/navigation by default; central response only if the native adapter can bind the exact live question |

All resources derive account/source ownership from authentication and the scoped
capability, never model-supplied `user`, filesystem path or native-session fields.
Cross-record references require per-record authorization. Operations carry a
stable operation ID and expected record revision: an identical retry returns the
same result; changed content or stale revisions conflict rather than overwrite.
Multi-record intent/obligation/outbox writes require transactional or recoverable
journal semantics. Local private atomic files remain an acceptable implementation;
this contract does not require another database or task platform.

New resource capacities, pagination and artifact retention must be explicit in
the versioned implementation schema. Handoff inline size remains at most 4000
characters including structured fields; an oversize request is rejected or replaced
with an authorized bounded artifact reference before delivery, never silently
truncated into a different instruction. Entire transcripts and terminal dumps do not
become default handoffs. Existing result truncation must remain visible until a
bounded continuation-read capability is available.

### Enablement, recovery and compatibility gates

- Current selection/setup, exact source/target binding and original permission
  checks remain authoritative. Upgrade does not enable memory, notifications,
  periodic follow-up, helpers or central native approval responses.
- Event notification permission allows reporting already recorded task changes;
  scheduled contact additionally requires a task-specific finite plan. A report
  is never authorization for another task. Enabling execution capability still
  requires real user authorization for the particular Assignment.
- Disable/deselection cancels future coordination and unsubmitted work. It does
  not terminate an already running target or erase the user's notes. Reset/Fork/
  takeover/replacement never silently adopts old cross-conversation permissions;
  restoring saved secretary notes requires an explicit user choice.
- Host restart restores durable state, validates bindings and reconciles native
  request identity. It resumes observation only when identity is proved; uncertain
  native admission is never automatically resent. Old writers are fenced by lease
  generation, including after an apparently successful but unacknowledged delivery.
- Browser disconnect does not lose accepted tasks. Main secretary input and
  asynchronous results use the normal serial Host queue. Background communication
  must not keep the main Chat permanently busy or concurrently mutate its session.
- A native engine lacking passive history inspection reports unknown without
  launching the CLI for a read. An engine lacking the required receiver attestation
  cannot advertise enhanced execution; unsupported native approval response stays
  a link to the target conversation. Do not fabricate parity across engines.
- M10/M11 enhanced execution remains gated by independent adversarial tests and
  explicit owner enablement. This is a future capability gate, not a claim that
  current free-form authorizationRef already satisfies the old P0-S requirement.

### Requirement coverage and delivery order

| Canonical IDs | Remaining deliverable | Stage | Acceptance |
| --- | --- | --- | --- |
| M01 | Independent capability settings, upgrade defaults and scoped secretary ownership | Each capability | A01–A02, A11, A17, A27 |
| M02, M04 | Task Brief and correlated reply/Assignment responsibility | S1 | A03–A04, A07–A09, A26 |
| M03 | Bounded passive observation and asynchronous communication while main Chat remains usable | S1–S2 | A04–A06 |
| M08, M09 | Transparent memory, provenance, deletion and budgeted context | S2 | A16–A18, A28 |
| M10, M11, M06 | Independent authorization evidence, receiver attestation, structured handoffs and instruction ordering | S3 | A12–A13, A19–A21 |
| M05, M12 | Recoverable Outbox, explicit low-noise notification/follow-up and diagnostics | S4 | A10–A11, A23–A26 |
| M07, M13 | Optional bounded helpers and native approval summaries/navigation | S5 | A14–A15, A22 |
| All | One lifecycle owner, migration/rollback and five-engine compatibility evidence | S6 | A01–A28 |

Each stage must name its actual shipped operations, current configuration defaults,
public-seam tests and real synthetic user-flow evidence. A successful model reply
or legacy test count does not complete a stage. Read-only S1/S2 can ship while new
enhanced execution remains disabled; execution extensions must pass S3 first.
The historical gap audit remains historical evidence, with this target SPEC as
its implementation roadmap; do not erase missing requirements from that audit.
