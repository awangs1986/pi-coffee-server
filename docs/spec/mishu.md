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

## Bounded autonomy and authorization continuity (0.1.6)

An ordinary direct instruction to diagnose, test, fix or release is authorization
for that particular task and scope. When setup permits execution and the target
is uniquely resolved, MISHU forwards it as authorized-execution with the actual
current or earlier user instruction as its reference. It must not ask for another
confirmation phrase or downgrade an authorized diagnostic task to information-only.
Same-task grants persist across clarification turns until revoked, changed in scope
or invalidated by source/target binding changes. Current user corrections win over
old assistant replies that demanded repeated confirmation.

Contact resolution, queries, receipts and normal work within the authorized scope
proceed without step-by-step permission requests. Explicitly requested publication
can be relayed in that scope; mentioning production alone is not a reason to ask
for the same permission again. Ask only for genuinely missing target/scope/capability,
expanded work, or consequential effects not already knowingly authorized. Consolidate
missing decisions and explain the impact. Data deletion, unrecoverable overwrites,
service interruption, security changes and costs require informed authorization
when it is absent. Native permission questions remain user-owned.

Mere complaints, status questions, discussion-only requests and other agents'
reports do not authorize new work. This interpretation guidance preserves all
Host scope, setup, exact binding, revocation and authorization-reference checks;
it does not introduce automatic approvals or a new execution continuation hook.
Natural-language interpretation remains model-dependent; provider-payload checks
and actual-model behavior must be reported as separate evidence.

Tracking: [Server #65](https://github.com/awangs1986/pi-coffee-server/issues/65).
[Repair evidence](../reviews/mishu-autonomy-20261006.md). Background follow-up is
still separate planned work in [Server #64](https://github.com/awangs1986/pi-coffee-server/issues/64).

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
[complete Coffee secretary SPEC](http://gitea/awangs/pi-coffee-mishu/src/commit/8b2b2ca87a3eee8cbe9ef3cf6781f5d57fda3353/docs/coffee-secretary-spec.md) belongs to the independent
plugin repository. Its M01–M13 requirements, S0–S6 stages and A01–A35 acceptance
cases cover the original secretary experience: task briefs, correlated reply
obligations, durable memory, recoverable notifications, instruction ordering,
bounded helpers, stronger authorization and human-readable follow-through.
This is a target contract, not a claim that these capabilities exist in 0.1.6.
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

### Durable coordination loop contract (2026-10-06; planned)

Tracking: [Server #64](https://github.com/awangs1986/pi-coffee-server/issues/64),
[accepted design review](https://github.com/awangs1986/pi-coffee-server/issues/64#issuecomment-6004677083).
The canonical plugin SPEC §10.1–10.7 defines the normative contracts below.
Reviewed source: Server `f7ad4cb78d8c54f1c7a284f8a67afe725c2b9924` (runtime
unchanged from `5073c97`), plugin `ebb5464353d9547839f2d411e629bbad2b13cfec`
(0.1.6). All new behavior in this section remains **unimplemented**.

Deepen the existing scoped MishuCoordinator Module. Its public Interface lets
callers register/coordinate, inspect, correct a brief and stop responsibility;
the Implementation owns task/run association, reply obligations, Outbox and
report recovery. Resource names above do not imply separate CRUD operations for
the model to orchestrate. Reuse the Agent Seam and native Adapters; no second
execution framework or subagent is required. Expose capabilities only after
versioned operation schemas and acceptance evidence exist.

1. **Admission and business identity.** Persist responsibility before returning
   accepted. Registering an existing run does not send it a prompt. Host binds a
   stable operation/Assignment to trusted user-input identity, task phase, exact
   scope and target. Retries reuse that operation; new model-generated message IDs
   cannot duplicate an accepted dispatch. Distinct later user instructions remain
   valid even when their text matches. Conflicting content/revisions are rejected;
   an explicitly authorized re-execution records retryOf.
2. **Durable event ingestion.** Correlate scope, task, binding generation,
   run/request and native event/message identity plus revision. Include work
   started directly by the user; do not require a MISHU request prefix or claim
   all future turns. Establish a buffered subscription plus watermarked snapshot
   (or equivalent gap-free protocol), reconcile overlap, and persist the recovery
   starting point before acknowledging registration. Evidence, responsibility
   changes and Outbox commit atomically before advancing the durable watermark.
   A best-effort event callback or in-memory socket cursor cannot prove this.
   Reconcile pre-commit loss from supported native history; otherwise show an
   observation gap/uncertain without starting a CLI or replaying execution.
3. **Persistent Outbox, existing queue.** InputQueue is a memory delivery Adapter,
   not the owner of durable notifications. Distinguish pending, admitted,
   processing, report-committed, cancelled, failed and uncertain. Queue/native
   admission cannot close responsibility. Coalesce bounded progress within one
   task/generation while preserving evidence and covered revisions; never mutate
   an in-flight notification. Keep one native writer and explicit bounded fairness
   with foreground input. Publish capacities, retention, coalescing/wakeup budgets
   and visible backpressure before enablement; preserve unfinished responsibility.
   Automatic recovery is at most once per failed event, durable across restart,
   and only with proved non-admission or idempotent receipt. It never retries target
   execution or blindly retries uncertain notification delivery.
4. **Trusted run origin.** Host establishes user-intent or task-notification origin
   bound to input/notification identity, task, bindings, permission revision and
   worker generation. Enforce it at every reachable tool/execution admission,
   not only in prompt text. Notification runs may read scoped task facts, update
   factual summaries and report; they cannot setup, expand contacts, investigate
   files, modify code, dispatch work, retry target execution or answer native
   questions. Chat-wide allowInstructions does not grant background execution.
   Foreground grants persist within scope without repeated confirmation; subsequent
   user runs are independently admitted and cannot share a mixed authority context.
5. **Native report commit.** Persist a ReportRecord with stable report/notification
   IDs, covered event revisions, secretary generation, native processing identity
   and durable output reference. Save processing intent before wakeup. Only verified
   persisted native summary output can atomically commit ReportRecord and Outbox
   completion; tool activity, admission and promises are insufficient. Reconcile
   “native output written, ACK lost” using the same native identity, without another
   model wake. If unprovable, retain uncertain rather than gamble on repetition.
   User-visible output already published before acknowledgment is included in this
   reconciliation. Prove the Pi Adapter's persisted output mapping and once-only
   presentation before exposing the capability. ReportRecord is a delivery ledger,
   not another authoritative transcript; [ADR-0024](../adr/0024-durable-display-index.md)
   still applies. Browser text deduplication or the disposable display index alone
   is insufficient. Report commit, user reading and user acceptance remain distinct.
6. **Revocation and ownership order.** CAS current permission/record revisions and
   fence worker generation at ingestion, queue admission, delivery and report
   commit/ACK. Persist a definite order between stop/revocation and report commit.
   Revocation first prevents later delivery/commit; report first retains the
   historical fact and stops future notifications. Already delivered native work
   cannot be represented as never sent; late output cannot revive responsibility
   or complete an invalid generation. Stopping tracking does not abort target work.

Current gaps are evidenced by `src/host/mishu.ts` (MISHU-prefixed requests and
in-memory active receipts), `src/host/session.ts` (best-effort event callback),
`src/host/input-queue.ts` (memory delivery), and `src/host/native/factory.ts`
(Cursor/Grok passive history unknown). Plugin `src/coffee.ts` waits within the
current request; it has no persistent notification worker. This revision changes
specifications only and does not satisfy any of the following future acceptance.

| Additional acceptance | Existing requirement refined | Observable proof |
| --- | --- | --- |
| A29 | M02/M03/M04; Issue stories 4, 19 | Directly started target work and registration-race results correlate; unrelated later turns do not |
| A30 | M03/M05/M12; stories 13, 20–23 | After the secretary turn ends, a delayed result produces one real webpage summary without another user prompt; normal chat remains usable |
| A31 | M04/M05; stories 24–27 | Crash after native report persistence/lost ACK and browser reconnect do not duplicate; unknown remains uncertain; display-cache deletion loses no responsibility |
| A32 | M01/M05; story 40 | Malicious notifications cannot execute through any available tool, even with Chat execution enabled; the next user run retains its own authority |
| A33 | M04/M06; stories 24, 26 | Changing messageId after acceptance cannot replay an operation; legitimate later repeated instructions work |
| A34 | M01/M04/M05/M12; stories 32–35, 42 | Stop/revocation races and stale workers cannot publish or acknowledge improperly; target work continues |
| A35 | M03/M05/M12; stories 28–29, 39, 41 | Bounded fair queueing, overflow/retry diagnostics and native recovery limits without lost obligations or unbounded wakeups |

These refine A06–A11 and A23–A27. Verify through the same HTTP/WS Interface used
by callers plus actual browser flows. At least Pi secretary → real Pi and Codex
targets need delayed-result evidence; other engines receive explicit PASS/FAIL/
UNAVAILABLE results. This scope does not introduce timers, new helper creation,
central native permission answers or the complete M10 enhanced-execution protocol.

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
| M02–M05, M12 | Durable admission/events/Outbox/report commit and trusted notification origin for #64 | S1 + event-only S4 | A29–A35 plus existing related cases |
| All | One lifecycle owner, migration/rollback and five-engine compatibility evidence | S6 | A01–A35 |

Each stage must name its actual shipped operations, current configuration defaults,
public-seam tests and real synthetic user-flow evidence. A successful model reply
or legacy test count does not complete a stage. Read-only S1/S2 can ship while new
enhanced execution remains disabled; execution extensions must pass S3 first.
The historical gap audit remains historical evidence, with this target SPEC as
its implementation roadmap; do not erase missing requirements from that audit.

## Candidate task briefs (#69, not a production activation)

The candidate adds `tasks` to the capability-authenticated runtime Interface.
`version: 1` and `operation` are mandatory. `register` takes a stable `operationId`,
exact configured `targetId`/`binding`, and `purpose`, `scope`, `summary`, `nextStep`.
`list` accepts `offset`/`limit`; `get` takes `taskId`; `update` takes `taskId`,
`operationId`, `expectedRevision` and changed text fields; `stop` takes the same
identity/revision fields. Unknown fields, including claimed source/user ownership
or acceptance, are rejected. Host derives secretary/account ownership.

Host creates independent task IDs even for identical titles. Every read/mutation
rechecks current source and contact bindings; lists exclude revoked contacts.
A new source native context cannot read or inherit old briefs, even after setup.
Mutations serialize within the scoped coordinator, stage a journal copy, and flush
an atomic private state-file replacement before acknowledging. Disk failure leaves
the prior journal in memory. Identical operation retries return their original
result; changed payloads or stale revisions fail. Failed/cancelled UI edits make
no mutation. Existing message receipt identity and execution remain unchanged.

Limits per secretary: 200 briefs (including stopped/history), 2,000 accepted write
operations, default page 20 and maximum 50; purpose 500, scope 2,000, summary 4,000,
next step 1,000 characters. Capacity exhaustion is explicit, with no history or
idempotency-key eviction. Brief data are Host task data, not native transcript.

Users can ask the selected enabled secretary to record/view/correct a brief, or
open `/mishu-tasks` to browse, correct a field and stop a record through native UI
on desktop/mobile. Cancel/Escape does not save. Long native dialog titles scroll within a bounded
viewport area so detail text cannot hide correction/cancel buttons. The browser displays **已记录，尚未
开始观察** until explicitly opting into the #70 observation capability below. Work state is recorded/stopped and
acceptance remains separately pending; models cannot claim user acceptance.
Stopping a record preserves history and never terminates the target task.

The #69 slice alone did not implement observation. #70 below adds existing Pi run
observation and reply obligations; #71–#76 reporting/dispatch/multi-engine requirements remain pending.
Evidence: public HTTP/WS tests in `mishu-http`, plugin public extension/HTTP tests,
and `scripts/probe-mishu-tasks.mjs` (real Browser/Web/Host/native Pi, deterministic
model). An editable plugin root is source evidence only; the integrated candidate
must repeat the probe with its immutable installed artifact.


## Candidate existing Pi run observation (#70, not a production activation)

An explicitly enabled secretary can observe one existing configured Pi native run
through `tasks`, version 1, operation `observe`: taskId, stable operationId,
expectedRevision and exact runId are required. The configured directory exposes
bounded observation capability/run metadata, without other conversation content.
No target prompt is sent. A missing/uninstrumented run or unsupported engine
rejects admission; future work in the same conversation is never adopted.

The engine-neutral Agent Interface supplies passive `readRunEvidence` audits.
Pi's final Host extension appends hidden custom native run UUID/baseline markers
before the run's first user message and a settled audit after native output append.
The marker baseline is the previous native leaf, **not** the current user entry.
The selected run owns its first subsequent native user entry and following output,
ending before a second user boundary or next run marker. Exact native binding,
entry IDs/content revisions and a stable range watermark determine evidence.
Hidden markers never enter model context; ordinary Chat retains zero-system.
`message_end` triggers a passive audit but is never a persistence acknowledgment.
Missing terminal audit, invalid/changed history, absent live process, model errors,
length-limited output and tool-only output remain incomplete/uncertain with last
facts. A normal native text reply is reply-available, not business/user acceptance.

Admission and event work share one scoped serial writer. The Host subscription
exists before registration; an event arriving during native snapshot/save is
retained by a coalesced dirty flag and trailing audit. Responsibility, watermark,
latest bounded facts and pending notification revision are flushed atomically
before success. Native delta streams are not copied as a second execution ledger.
Host restart first reconciles recorded exact ranges passively, never spawning a
CLI or replaying an instruction. Failed event writes retain the prior journal and
expose diagnostic status; an explicit detail read retries only the native audit.

`/mishu-tasks` supports explicit observation and later viewing of waiting replies,
latest facts, incomplete or uncertain evidence and the exact responsible target.
Waiting native questions show a user-action notice; only the target handles them.
`status.tracking` reports committed waiting/reply/uncertain counts without a fresh
native audit. The secretary stays usable while target work runs. No automatic
model wake, report commit, recurring prompt or new-agent creation exists here.

Stopping, deselection, disable, contact removal, archive or source context reset
fences observation generations through the same writer. Restoring/re-enabling
does not revive cancelled observations. These actions do not abort target work.
Exact scope/binding authorization is checked before and after native reads.
Current source-candidate tests: direct native Pi HTTP/WS, registration/settlement
race, browser disconnect, event commit failure plus restart, duplicate audits,
unrelated later user input, partial native evidence and revocation. Real browser
probe `scripts/probe-mishu-observation.mjs` exercises desktop/mobile inspection,
late native reply and ordinary secretary chat while the target waits; its model
is deterministic and its workspace synthetic. Immutable installed-candidate and
production evidence remain separate release requirements. A29 and the observation
part of A34 are covered for Pi; preserve all other unmet A29–A35 requirements.

## Candidate durable dispatch (#71, not a production activation)

`tasks/dispatch` version 1 accepts a saved Task Brief, its admission-phase
`expectedRevision`, bounded `text`, `authorizationRef` and a transport `messageId`.
The Host derives the source native user-run identity; callers cannot provide it.
A new dispatch requires a live foreground Pi user run and enabled instruction
capability. The direct task instruction remains authorization; no additional
confirmation phrase is required. Interpreting whether a natural-language request
is an instruction remains the plugin/model responsibility, not a claimed complete
M10 proof of user intent. Queries, discussion and target results grant no new work.

Host persists the Assignment and exact-run Reply Obligation before target admission.
The business key is source binding/native user run + Task Brief + accepted phase;
changing messageId returns the same Assignment even after the current brief's
revision advances. Conflicting content/scope is rejected. Distinct explicit work
uses distinct briefs. Later legitimate repeated work needs a new user input,
current brief revision, `retryOf`, and proof that the original native result ended
(or was cancelled before execution). An uncertain original is never replayed.

The existing serial input queue remains a delivery adapter. Assigned queue rows
cannot be edited or promoted into unrelated running work; cancellation is allowed.
Stop, contact removal, disable and binding changes fence undelivered assignments.
Native acceptance/transport ACK loss becomes uncertain; neither a model retry nor
Host restart replays delivery. The Pi adapter privately seeds the exact hidden run
marker before prompt delivery. Matching persisted native evidence resolves the
obligation; new dispatch rejects engines without an explicit verified correlation capability;
legacy sends and existing observations retain their documented boundaries. Delivered/settled is not user acceptance or proof of business
success. `/mishu-tasks` shows accepted, queued, executing/waiting, cancelled or
uncertain dispatch and the existing observed native facts.

The legacy `send` message bridge and manual `inbox` remain compatible, including
information-only notifications. Legacy messageId deduplication is **not** A33
business intent deduplication. The candidate plugin directs durable task work to
`tasks/dispatch`; it does not claim legacy sends gained a persistent task mandate.
Evidence: public HTTP/WS disk failure, changed-ID, lost-native-ACK, restart and
queued-stop tests; native Pi Browser probe `probe-mishu-dispatch` using synthetic
content. Source candidates and immutable installation/production remain distinct.

## Candidate on-demand native reports (#72; not a production activation)

A directly entered `/mishu-report` opens a task-title chooser; an exact task ID is
accepted for integration callers. It summarizes already persisted bounded facts
in the same native Pi Chat using a hidden custom input, never a synthetic user
message. Ordinary conversational summaries do not claim durable report delivery.
No automatic wakeup, retry timer or new target execution is introduced.

Before native input, the scoped Host saves a ReportRecord with stable report and
notification/revision identities, source binding, obligation generation and native
processing UUID. The final platform extension records a native marker with that
UUID, then starts native summary processing. The report asks for progress, limits,
next step and a human source title. Internal task IDs are not required in visible
summary text. The ledger stores native output IDs/hashes, not another transcript.

All report tool calls, including built-ins, extension tools and callers of nested
tools, are denied by Pi's actual `tool_call` gate. Host runtime action admission
also denies setup, dispatch, send, disable and task mutations during that run.
Declaration filtering alone is not the boundary. User steering and queue promotion
cannot mix into a report; follow-up user input waits separately. A subsequent real
user turn restores ordinary capabilities. Plugin report identity carries no
foreground execution invitation or empty-action continuation.

Neither `message_end` nor queue acceptance commits a report. After local settle,
or during passive recovery after the native process has stopped, the Adapter
verifies the exact marker, hidden custom input and native assistant range. Only
successful, nonempty bounded output containing the required report sections and
source title commits the ReportRecord and notification atomically. This validates
correlation and the report envelope, not model truthfulness. Tool-only output,
plain promises, errors and unprovable ranges stay uncertain without regeneration.
A persisted assistant with a lost final audit/Host ACK is reconciled from that same
native output; no second provider request is made.

The state owner holds a kernel-backed SQLite exclusive transaction for its
lifetime. Another Host fails closed before reading or mutating that coordination
state; process death releases ownership. All state changes remain under the
scoped serialized writer and atomic flushed JSON replacement. This is process
crash recovery, not a claim of native-file fsync or power-loss atomicity.

Stop/removal/archive/reset cancels unfinished reports and prevents stale ACK.
Already admitted native text may have streamed before revocation or ACK; it remains
scoped native historical output, never evidence of completed notification, user
read or acceptance. Existing output cannot be retracted. Automatic worker leases,
notification delivery and multi-engine task observation remain later slices.

Acceptance uses synthetic native Pi over Host HTTP/WS and real Browser/Web/Host:
report marker/output mapping; assistant write without final audit or Host ACK;
no replay after restart; promise/tool-only uncertain; malicious built-in and nested
caller denial; restored foreground tools; revoked target; competing owner process;
chooser, desktop/mobile reload and repeated command without duplicate generation.
Immutable package/fresh-clone/integrated release evidence remains the parent PR's
responsibility. Existing pending A29–A35 and all broader target criteria remain.

## Candidate automatic event reports (#73; not a production activation)

After explicit `/mishu-notifications` selection and confirmation, newly observed
results from already registered exact Pi runs can wake the same secretary after
its current turn ends. The default is off. Cancellation changes nothing; enabling
does not replay old facts. Disabling reminders cancels unfinished automatic
reports while retaining task records and target execution. `/mishu-tasks` still
reads late facts when reminders are off. Selection/setup and event consent are
separate, per-source-binding capabilities.

Host owns the durable Outbox as automatic ReportRecords: pending → admitted →
processing → committed, or cancelled/uncertain. One notification per secretary
is placed on the existing FIFO input queue at a time; foreground input retains
its position. A private callback owns the exact report admission and command;
Browser sees only a human title with a stop-following action, never editable native command text,
a processing nonce or capability. Notifications cannot be edited, promoted or steered. Cancelling the queued row is an authenticated user stop-following action; it does not stop target execution.
The native report retains #72's hidden custom input, all-tools denial, exact
native output evidence and atomic notification/report commit. It grants no new
execution authority and cannot mix with foreground instruction origin.

A persisted delivery-attempt fence precedes the native call. Queue acceptance is
not completion. A restart may requeue only a pending/admitted report proven never
to have attempted native delivery; that receives a new transport command receipt
while keeping the same report and processing identities. Ambiguous admission
stays uncertain, without another model request. Lost report ACK reconciles the
same native output. No target execution is replayed. Source/contact binding,
source permission generation, obligation generation and notification revision
are checked at admission, delivery, processing and commit. Stop, contact removal,
archive and clear cancel pending delivery and later ACK; already streamed native
text remains scoped historical output, not a successful notification.

Baseline bounds: 20 outstanding reports per secretary, 100 report records per
Task Brief, one automatic native delivery attempt per report, one queued
notification per secretary, and existing input queue limits (100 rows/512 KiB
text/16 MiB attachments). Capacity/persistence failures are visible in status and
retain the obligation. There is no polling wake, infinite retry or retry with a
new processing identity. FIFO prevents a series of reports from overtaking user
input. Multi-task coalescing, richer fair scheduling and per-engine observation
are later slices, not claimed by this candidate.

Candidate verification crosses public HTTP/WS and actual Browser/Web/Host/native
Pi: default off and model-side grant denial; late result with no second prompt;
foreground-busy queue; queued revocation; never-delivered restart; ambiguous
admission without replay; native output written before lost Host ACK; mobile
explicit enable/stop and desktop/mobile reconnect with one visible report.
Fixtures are synthetic. Production activation, immutable package pin, real-model
quality and complete integrated lifecycle acceptance remain separate evidence.

### Native observation capability slice — Server #75 candidate

This source candidate adds online observation of user-started existing work through
Agent interfaces. It does not grant cross-engine durable dispatch or imply equal
recovery across engines. Browser `/mishu-tasks` offers **观察当前工作** only when the
configured exact target exposes current run evidence, and shows the capability
limits beside the task. Model directory observations carry `capabilities`,
`identity`, `referenceKind`, and `dispatchSupported` independently.

| Engine | Online identity / evidence | Host restart run recovery | Passive display history | Detached writers | Durable `tasks/dispatch` |
| --- | --- | --- | --- | --- | --- |
| Pi | Persisted native run marker and native message IDs | Supported for exact retained native run | Supported | Unknown | Supported |
| Codex production app-server | Native thread / turn / item IDs observed on the existing connection | Unknown; no unverified rollout terminal parser | Supported where canonical native display IDs are available | Unknown | Unavailable |
| Claude Code | Explicit Host invocation ID in one connection generation; native message ID or UUID | Unknown | Supported for selected native branch | Unknown | Unavailable |
| Cursor / Grok ACP | Explicit Host invocation ID and Host live receipt UUID for the captured message | Unknown | Unknown; no passive CLI launch | Unknown | Unavailable |

Codex support is wired in the production `codex-adapter.ts`, not merely the fallback
adapter. The fallback Codex adapter does not advertise this observation capability.
ACP positional display IDs are never treated as durable native message identities.
The Host durably commits captured facts/receipt references as part of the existing
Task Brief journal. That provides a retained fact, not proof that omitted events
can be recovered after a lost connection. A fresh Host retains prior facts and
marks unprovable run outcomes uncertain; it never resends target work.

Connection evidence retains at most 32 runs and 100 completed messages per run,
with 4000 characters per message. Evicted/missing runs and exceeded evidence
capacity return uncertainty. Native completion, failure, interruption, process
loss, blocking question and partial message are distinct. Only exact registered
run identity can advance a brief. Codex's asynchronous unanswered-question pause
remains pending; a subsequent different native turn is not adopted implicitly.
Binding replacement fences an old live adapter even when the new binding was
separately selected. Native questions remain in the target conversation.

Native facts retain an optional bounded `latestReply`, independently of older
progress text, so a report can distinguish a new explicit result from an earlier
plan. It is the latest complete observed message, not a user acceptance claim.
After `tasks/observe` succeeds, the plugin returns current reminder status and
explicit guidance to end the foreground turn: Host owns subsequent events, and
repeated model polling is not the notification mechanism. With reminders off,
the secretary explains `/mishu-notifications` or later user queries instead of
promising automatic delivery. This does not force arbitrary model compliance;
the actual natural-request probe and public-entry regression cover the observed
loop and its correction.

Legacy `send/inbox` remains available under its existing authorization. Its
cross-engine messaging support must not be described as durable correlated
`tasks/dispatch`; that latter capability still requires Pi's persisted correlation.
See [candidate evidence](../development/mishu-native-tracking-75.md) for separate
fixture, actual account, browser and source/package status.
