# MISHU for explicitly enabled secretary conversations

Tracking: [Server #59](https://github.com/awangs1986/pi-coffee-server/issues/59).

Owner decision, 2026-10-05: fork `awangs/MISHU` into the independently maintained
[Gitea pi-coffee-mishu](http://gitea/awangs/pi-coffee-mishu). This is an explicit
exception to the Pi plugin monorepo source rule. The owner selected coordination
of **existing conversations**, with independent settings for **the current Pi Chat**.

## Current source status (2026-10-13)

At published Server main `789a0d1`, the consumed package is
`pi-coffee-mishu@0.3.0-manager.5`. Host source includes task briefs, exact-binding
observation/dispatch, report receipts/recovery, explicit notification opt-in and
the deterministic watch/rules/to-do manager. These are implemented capability
slices, subject to native target support and scoped authorization, not a promise
that every M01–M13 or E01–E05 target has passed acceptance.

Only Pi Chat may be a secretary source. Earlier Codex source/bridge descriptions
below are historical and superseded by #122; native Codex remains a normal Chat/
Work engine and an eligible target. Passive metadata reads cannot create model
turns; bulk awakening needs the separately approved scope in the batch policy.

The dated #69–#76 sections retain their requirement IDs, limits and historical
verification boundaries. “Later slice” and “pending” in an individual slice mean
its original delivery order; they do not negate subsequently implemented slices.
Unmet product acceptance, target-engine limitations, package activation and real
account verification remain separate. The [weekly audit](../reviews/spec-freshness-20261013.md)
records the revision and consumer pins; it does not newly verify live deployment.

Source evidence: `src/host/mishu.ts`, `mishu-watch.ts`, `mishu-tasks.ts`,
`mishu-reports.ts`, `mishu-receipts.ts`, pinned `pi-coffee-mishu/host-policy`, and
public `test/mishu-http.test.ts`, `test/mishu-dispatch.test.ts`,
`test/mishu-manager.test.ts`, `test/mishu-manager-regressions.test.ts`,
`test/mishu-old-contact-menu.test.ts` and `test/mishu-startup.test.ts`.

## Pi-only secretary boundary (2026-10-12)

Owner decision, tracked in [Server #122](https://github.com/awangs1986/pi-coffee-server/issues/122):
only an active Pi Chat can be selected or configured as a MISHU secretary.
Codex and the other supported engines remain eligible existing targets, subject to
their native capabilities and the authenticated user's grants. Ordinary Codex
Chat/Work, native model choices and task bindings are unchanged.

Browser selection and Host admission reject non-Pi sources. Unsupported native
MISHU slash commands are consumed with a clear message instead of becoming model
prompts. Pi continues to own its native setup interface. On Host recovery,
persisted non-Pi source grants and pending observations are retired after a private
byte-preserving backup is written, while
historical contact lists, receipts and task records remain. Legacy Codex sessions
resume with their original native base instructions and the Coffee secretary MCP
server disabled. No replacement thread or prompt replay is required.

The former [Codex secretary design](mishu-codex-secretary.md) is historical and
superseded as a source requirement. This restriction does not establish that
MISHU caused any provider capacity error.

Bulk creation or awakening follows [the high-risk execution policy](batch-agent-execution.md).
Passive directory/status/peek reads must not create threads or start model turns.
Registry-level list coalescing remains; per-conversation native metadata reads
inside a list use at most four concurrent workers, preserving original order and
fallback metadata on an individual native read failure. SQLite/history worker
queues keep their existing bounds. This is read concurrency, not a model-run allowance.

Source acceptance and production activation are separate; this spec does not
claim all external native tools mechanically enforce the new approval policy.

## Secretary experience target (2026-10-11)

The accepted [secretary experience increment](mishu-secretary-experience.md) specifies
transparent memory (M08/M09), nonblocking ordinary clarifications, bounded relevant
coordination, evidence lookup and auxiliary-model usage accounting. E01–E05 and
A36–A45 are pending requirements, not current runtime actions or deployment claims.
Existing tracking/authorization remains; native approvals, per-engine capabilities
and Codex report restrictions are preserved. The independent plugin SPEC owns the
matching product requirements; the linked MISHU specification owns Host/UI acceptance requirements, while this
repository implements the Host/Web/native integration.

## User flow

1. Open a Pi Chat, click the coffee icon, and check **MISHU 秘书（当前对话）**.
   The idle Chat reconnects with the installed plugin; other tasks continue.
   The Chat recognizes its MISHU secretary role even before setup and explains
   that coordination is disabled. Selection does not authorize cross-conversation access.
2. Send `/mishu-setup`. The default directory shows unarchived conversations with
   activity in the last 72 hours, newest first. The window filters presentation only:
   an exact conversation ID can resolve and select an older available target. Select up to 20 exact target conversations, finish the
   selection, choose information-only or authorized-execution capability, and
   explicitly confirm. Cancellation preserves existing settings.
   Reopening setup prechecks still-valid prior selections so contacts can be added
   or removed incrementally. New contacts are not restricted by age;
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
[Repair evidence](../reviews/mishu-autonomy-20261006.md). Background follow-up was outside that 0.1.6 repair. The later #69–#76
slices and [current status](#current-source-status-2026-10-13) describe implemented
bounded tracking/reporting; broader acceptance is not inferred from that repair.

## Ownership and interfaces

- The independent package owns `/mishu-setup`, `/mishu-disable`, `/mishu`, the `mishu`
  tool, interactive setup, and bounded secretary guidance. Its Coffee entry does not
  load Herdr, old memory, terminal screens, or WeChat code. Original source/history
  remain in the fork for explicit legacy use.
- The consumed Harness 0.3.3 retains the `registerChatTools(pi,names)` interface introduced in 0.3.2. Its Chat filters preserve only
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
make an old conversation recent. The time window limits default directory presentation only;
previously approved target bindings do not silently change as the clock advances.
`directory` with an explicit `targetId` resolves at most one eligible exact match without
an age cutoff, without starting native execution or changing contact permissions.
The user can add that result in Pi setup, including when the default list is
empty. Final setup validates the account, lifecycle and exact current binding, not
recency or the first 200 directory rows. Cancellation or late lookup never saves grants.
`directory.configuredTargets` separately returns at most 20 retained entries whose
saved source/target bindings are still current and whose targets remain available.
Retained contacts remain selected; explicitly resolved older IDs may also be added.
Setup validates the entire edited set again at commit.

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
This dated section describes the earlier v1 boundary. Later implemented
observation/report/manager slices supersede its blanket exclusion of tracking;
new helper creation is still outside ordinary passive coordination and subject
to the high-risk batch policy. See [current status](#current-source-status-2026-10-13).

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
result, including the nested observation and report data captured at admission;
later native evidence, report commits and Host restarts do not rewrite that receipt.
Current state remains available through `tasks/get`. Changed payloads or stale
revisions fail. Failed/cancelled UI edits make
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

### Bounded multi-task reporting candidate — Server #74 (2026-10-06)

This source candidate extends #69–#73; it is not an installed package or production
release. Each secretary has its own durable model budget and each Task Brief has
its own event batch. The first useful event opens a 250 ms coalescing window.
While a report remains undelivered, further related versions may join that same
batch. Admission snapshots event versions, state, bounded text and native evidence
references; delivery freezes them. New events during processing form a new batch.
Waiting-user and terminal states remain represented in the event list. Task and
binding generations never merge. Raw tokens/tool logs and unchanged evidence do
not create reports. Reports remain native transcript content, not Task Brief text.

The normal serial input queue now chooses up to three pending foreground inputs,
then one pending notification. After a notification, a pending foreground input
wins again. FIFO is preserved within each class. Running turns are never preempted.
The bound counts runnable queue services, not seconds: a still-running model or a
failed foreground row may require human action for later foreground input; independent
notifications may still proceed. No wall-clock completion is
promised. Among tasks, the oldest ready batch goes first; fresh activity on one
task does not move it ahead of already-waiting tasks.

Published limits (`status.notifications.limits` and task-list limits):

| Resource | Bound and overflow behavior |
| --- | --- |
| Task records, including retained stopped records | 200 per secretary; new registration rejected |
| Idempotent task mutations | 2,000 ordinary mutation receipts plus up to 200 reserved terminal stops; ordinary mutation rejected at capacity, stopping remains available |
| Task page | Default 20, maximum 50 |
| Task purpose / scope / summary / next step | 500 / 2,000 / 4,000 / 1,000 characters |
| Pending event batch | 16 event versions, 64 distinct native ID/revision references; 4,000 summary plus 4,000 latest-reply characters per event |
| Event-batch bytes | 256 KiB pending event batches per secretary; do not advance the affected watermark on saturation |
| Outbox | 20 outstanding report records; 100 retained reports per task |
| Report output validation | At most 16,000 characters, required sections and source label |
| Memory input queue | 100 rows, 512 KiB text and 16 MiB encoded images, shared with normal input |
| Automatic model budget | 12 native report admissions per secretary per persisted one-hour window |
| Safe automatic admission recovery | Once per report failure, one-second delay, persisted across restart; only before native delivery was attempted |

These are resource-specific limits, not a total byte cap on `state.json`. Existing
idempotency receipts retain bounded TaskBrief snapshots and can duplicate retained
facts/report metadata across up to 2,200 receipts; whole-state validation and
migration must account for that storage amplification.

No unsettled responsibility or historical report is deleted to make space. Event
saturation preserves the last confirmed cursor/facts and shows backpressure; after
an existing report commits, the next passive audit can reconcile native evidence.
The budgets limit new automatic admissions, not provider prices or existing native
context size. Monetary cost cannot be guaranteed without provider accounting.
A budget-window timer may resume already-admitted report work; it does not poll or
contact targets. Disabled reminders and uncertain delivery never create a retry
loop. Queue admission failure consumes only the single notification recovery; it
never authorizes retrying target execution. The in-flight admission claim remains
held until the rejection, backoff and recovery budget are durably saved. Concurrent
task reads or event wakes cannot claim the same report in that transition or
consume an additional recovery. The claim is identified by both report ID and
request ID; a superseded pre-queue admission attempt cannot mutate or release
a replacement claim.
If saving the rejection fails, automatic admission stays blocked with a visible
persistence diagnostic; explicit manual report recovery or revocation clears the
claim, while restart recovers only durable state. An ambiguous native admission or model
failure stays uncertain and requires native-history inspection.

`/mishu` shows backlog, uncertain reports, remaining wakes, saturation and recovery
instructions. `/mishu-tasks` retains per-task diagnostics and facts. Once queue
capacity is available, direct `/mishu-report` may deliver a report proven never
attempted; it reuses that report identity. It cannot regenerate uncertain output.
Turn completion, durable report commit, user reading and acceptance remain distinct.

Candidate evidence: HTTP/WS covers two simultaneous task batches with five
foreground inputs, preserved event versions/references, no unchanged-event wakes,
12-admission exhaustion, independent secretary budgets, saturated-queue single recovery
and restart with exhausted budgets. `scripts/probe-mishu-multitask.mjs` exercises
actual Chromium/Web/Host/native Pi with two separate synthetic target runs, two
reports after the foreground turn ends, and one copy each after desktop/mobile
reload. Synthetic model fixtures prove flow and isolation, not model quality.
Installed artifact, all-account startup and the complete integrated lifecycle
matrix remain #76 and final acceptance work. Other unmet A29–A35 and M01–M13
requirements are preserved.

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
For Codex's explicit native `final_answer` phase, the live Agent boundary retains
the final message until that exact turn reports completion, failure, interruption
or connection loss. It then exposes the facts with the proven outcome; a final
message alone does not prove success. Native Browser text still streams immediately.
Explicit commentary and native user questions remain eligible live progress; missing
phase keeps the legacy unknown-phase behavior. Thus one terminal answer is not
automatically reported first as ongoing progress and again as a settled result.
This uses native phase/outcome identity, not a longer coalescing delay, and does not
rewrite a previously admitted or committed progress report.
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

### Upgrade and explicit historical-note recovery (#76 candidate)

The tracking candidate writes coordination envelope `version: 2`. On a validated
version1 read it preserves the exact old bytes as private
`state.v1.<sha256>.json` before the first version2 replacement. Current grants,
Task Briefs, Assignments, Outbox states, budgets and native report references stay
in the scoped Host store; no execution is replayed by migration. In-flight
admission without proof remains uncertain. Version1-only binaries reject the
version2 envelope; rollback keeps the new file in place and disables MISHU until
a compatible Host is restored. **Never restore an old backup as live authority.**
The ordinary release procedure must stop the old Host before a schema upgrade;
pre-tracking binaries do not participate in the newer lifetime writer lock.

Nested records and resource-specific bounds are checked before accepting a store.
Corrupt, future-schema, unsafe-file and capacity failures retain original bytes,
write only a private, static `diagnostic.json`, and reject MISHU operations.
Ordinary Pi Chat can still start without the optional plugin; it retains zero
system context. Diagnostics contain no source text, parser snippets or credentials.
A rejected mutation restores the last successfully committed in-memory checkpoint,
including grant changes; a committed cancellation is not undone by its subsequent
rejection response.

The previous resource limits are not a state-file limit: operation receipts may
copy large task snapshots. Ordinary state growth stops at480 MiB; once revocation uses its reserve, reads and non-growing saves remain possible.32 MiB is reserved for
revocation, and loading stops at512 MiB before reading the file. A larger valid
store is diagnosed and retained, never truncated, silently migrated or purged.
Terminal stop receipts reference the retained, immutable stopped task instead of
copying its report snapshots, so stopping at ordinary receipt capacity remains
possible. These are serialized UTF-8 byte bounds, separate from field-character
and pending-event limits. This protocol tests process-crash recovery and atomic
file replacement; it does not claim power-loss durability for an unsynced directory.

Direct `/mishu-history` opens a bounded human chooser in the current selected
Pi Chat even when a source reset has invalidated setup. Only this secretary's
prior source-bound brief text can be inspected; explicit confirmation copies
purpose, scope, summary, next step, source/time provenance into a new current-source
**note**, capped at200 retained notes. Cancel does not save. Repeated restoration
of the same historical revision is idempotent. Notes do not contain target IDs,
active bindings, Assignment, obligation, notification, report admission or grants.
They can be viewed again through the command; they are not automatically injected
into model context or treated as current progress. Fresh setup and a new explicit
instruction are required for new follow-up. Another secretary/account cannot
restore these references; Fork creates a separate secretary with no inherited
authority. Source-reset status masks old contacts, instruction permission and
reminder consent. The broader M05 transparent-memory roadmap remains open.

### Unattended scoped startup recovery — Server #76 candidate

The real Host entry point discovers already-existing MISHU stores after both Host
transport and the private runtime listener are ready. It uses the configured
default project root and normalized direct user directories under `WORKDIR`,
including their `projects/.coffee/mishu/state.json`. Browser reconnect, a status
request, a user prompt and `mishuRuntime` priming are not prerequisites. Discovery
only supplies candidates: the coordinator still validates the complete saved
format, current source/target bindings, selection, setup and explicit reminder
authority before passive reconciliation or a report admission. It does not start
target CLIs for passive reads, replay target prompts, or grant authority from a
folder name. Disabled, stopped or revoked responsibilities cannot wake a source.

Discovery checks at most 4,096 direct directory entries and initializes at most
256 saved scopes, loading one store at a time. Only canonical usernames and real
(non-symlink) directory/file paths qualify. Oversized state files use the same
512 MiB ceiling as coordinator loading; the same ceiling also bounds total
candidate file bytes admitted during one startup scan. Capacity, unavailable stores and recovery
failures produce static Host-local diagnostics without account names or private
content; unchanged stores beyond the scan budget remain recoverable by explicit
authenticated access. This limit is not a claim of unattended coverage for more
than 256 existing scopes: an operator must resolve the capacity diagnostic before
claiming all-account recovery. One rejected store does not suppress another
scope's recovery. A default root overlapping a named-user layout is diagnosed
and excluded from unattended recovery until the operator resolves the ambiguous
account identity. Shutdown fences discovery before closing its last created slot.

`scripts/probe-mishu-startup.mjs` runs actual `main.js` against isolated synthetic
stores. Public menu/setup/reminder and native model-tool flows first persist two
queued reports. After process restart it makes no HTTP/WS/runtime call until both
source reports arrive, then checks native output references, no target replay,
default/custom-root and user isolation, disabled/corrupt stores, invalid and
symlink paths, oversized state and bounded discovery. Synthetic provider evidence
is source-candidate acceptance; installed-artifact and production evidence remain
separate.

The #76 lifecycle matrix also fixes two integration seams: a completed/failed Fork
preparation record no longer hides the original secretary or target from MISHU;
only an active preparation blocks access. The newly forked Chat is unselected.
Accepted Work takeover durably cancels old observation/queued report responsibility
before starting native conversion, including when that conversion later fails.
Fresh setup does not revive the cancelled obligation. Task headlines preserve
waiting/incomplete/uncertain work state independently of committed report delivery;
a delivered native-question report is not a completed target or user acceptance.


## Review corrections (2026-10-07; source candidate)

The #64 tracking follow-up corrects three review findings; it does not activate a
production release or add Codex as secretary source.

- Task mutations now share the coordinator's complete committed-state checkpoint.
  A rejected stop preserves task, Assignment and receipt states together. Memory
  notification rows are removed only after cancellation is durably committed;
  a failed write retains the queued report and the accepted target responsibility.
- The Pi plugin retains validated `status.tracking` counters and bounded error
  text for both `/mishu` and its model tool. Counts are nonnegative integers bounded
  by the 200-task capacity; the command no longer hides observation failures.
- Live Agent evidence carries an optional `truncated` flag. The Host independently
  records `fact.truncated` and `fact.latestReplyTruncated` for upstream clipping and
  its own 4000-character limits, and preserves both in ReportEvents. Native output
  IDs/hashes remain the evidence references; the bounds and dispatch rules do not grow.
  Task details warn when a reply was clipped. Native report input carries the flags
  and instructs the model to describe the missing tail in its limitations section.

These are optional Boolean additions to private schema2 records. Existing records
remain readable; absent flags mean completeness unverified, never false. Report
inputs encode that unknown as null. Older strict readers may refuse the new fields;
keep their state/diagnostics intact rather than strip metadata or restore old grants.

Regression evidence is through scoped HTTP/WS, installed-native protocol fixtures
and the independent plugin's public command/tool registration boundary: a rejected
queued stop remains queued, tracking counts/errors reach callers, and a long native
Codex result preserves truncation through the automatic report input. Real Chromium
probes separately cover desktop/mobile detail warnings and failed queued-stop retention.
Checks using `MISHU_PLUGIN_ROOT` verify candidate source; they do not validate a new
immutable package or change Server's consumed tracking.2 artifact.

## Manager (P1–P9, 2026-10-09 candidate)

Two tiers. Tier 1 is deterministic Host code with zero model tokens: an
event-driven watch over all of one user's conversations (secretary Chats
excluded), a strict `rules.json` engine, a persisted to-do panel (≤50 items),
Web notices with cooldown/batch/hourly budget/quiet hours, and exact-keyword fast
replies with one-time confirmation codes for stop/cancel. Tier 2 is the secretary
model for non-keyword user messages, which receives a bounded digest
(≤1500 chars, ≤20 lines) and to-do text (≤1200 chars) as untrusted data. The
digest cursor commits only after a successful secretary run. Deterministic manager
watch notices do not themselves wake a model. The separately opted-in automatic
report path described above remains available within its authorization/budget
limits; it is not blanket permission for manager watch events to start turns.

Authorization: overview/events/peek are read-only and limited to currently valid
configured bindings unless the user explicitly enables view-all. Setup has separate
contacts, execution-mode and read-visibility selections followed by one final
confirmation. Cancel/Escape at any step writes nothing. View-all and contacts are
committed together in state.json; failure cannot expand access. Revoked bindings
are also filtered out of model-facing to-do and digest data.

Model execution uses version 2 authorization.quote through Pi. The earlier
Codex secretary MCP bridge is retained only as historical source, disabled by #122. A live direct-user foreground admission is required. The quotation may
come from the current or an earlier same-task user instruction recorded at actual
native delivery (up to 200 request-bound entries, 4000 characters each). Merely
queued/rejected/cancelled instructions and assistant/target output are not evidence;
queue edits contribute only their final delivered text. Uncertain/cancelled delivery
removes its proof. Same-task intent interpretation remains the native model's job:
proof of an exact substring does not establish semantic scope, override a newer
correction or authorize a different task. Explicit retryOf starts a repeated
execution and requires current-turn evidence. Foreground credentials expire at run
end; that is not expiry of the user's same-task instruction. Setup changes,
deselection and source revocation clear recorded proof. The proof budget is explicit:
older text outside this retained window is unavailable to v2 verification; it must
not be fabricated from an assistant summary. Existing unmet task-scoped durable
authorization requirements remain visible in the complete-secretary contract.

Quick stop/cancel confirmations bind the source/target native identities, exact
run request ID or queue row IDs/revisions and the authorization generation.
Reconfiguration, disable or revocation invalidates them, including actions already
awaiting authorization. Stopping one confirmed run preserves unrelated queued input;
cancel affects only the captured unchanged rows. It never silently retargets a new run.

The journal seals torn segments before appending to a new segment, preserving the
original partial bytes. Digest acknowledgment advances only to the last scanned
event (at most 500 per digest), retaining unread backlog. All deadline-generated
alerts obey the same watch scope as incoming events.

Storage: state.json retains schema version 2 with validated optional manager and
request-proof fields; these are one atomic authorization transaction. Older Hosts
that do not understand these fields reject the state instead of silently granting
access. Do not roll back by restoring older authorization snapshots. The unmerged
manager.1 manager.json file is not imported as authorization. Watch data and
receipts remain separate derived/evidence stores. Receipts beyond 500 rotate their
bodies (20000/30-day retention); independent identities.sqlite tombstones retain
execution deduplication without that expiry. Legacy archive read/corruption errors
fail closed; a torn tail is preserved in a recovery file before safe appending.

Historical Codex-source integration preserved its foreground token and thread
and exposed manager reads/v2 quoting. This path is superseded by #122: Codex
cannot be selected/configured as secretary, its secretary bridge is disabled,
and it must not be revived by treating this dated paragraph as current admission
policy. Existing Codex Chat/Work history and native guidance remain; it may still
be an explicitly authorized target of a Pi secretary.

The queue_action protocol gains move (to: front|back); mishu_watch frames are
ignored by older clients. Source, artifact installation, Browser acceptance and
production activation remain separate. See [implementation](../development/mishu-manager.md)
and [repair evidence](../development/mishu-manager-repairs.md).

### Bounded evidence resource (MISHU #9)

Candidate integration adds runtime/browser `evidence` v1. `mode` is `recent` (default),
`search` (1–200 literal keyword chars), or `anchor` (exact native message ID).
Omitted targetId reads only the source secretary. Other targets require a current
configured contact and native binding; view-all grants no transcript access.
Source selection, enablement, lifecycle and both bindings are rechecked after I/O.
The existing passive Adapter readHistory seam is used; Cursor/Grok return unavailable.
No session open, CLI spawn, prompt, native compaction, or new execution grant occurs.
Projection is derived on each query: at most 10,000 entries / 2,000,000 UTF-16 source
chars scanned, 20 returned entries, 2,000 chars per entry and 12,000 total chars.
Entries carry exact conversation/message identity, native time or explicit null,
role, original/model/historical-note label, redaction marker and returned range.
Coverage/freshness, lost anchor and truncation are explicit. No persistent search
index is introduced. UI/native model acceptance is separate from fixture proof.

## Secretary experience candidate: ordinary decisions (#10)

`clarifications` runtime v1 supports list/get/create/cancel. Creation is explicitly
`kind:ordinary`; it saves a bounded question (2000 chars, 12 options) before the
model tool returns. It never adapts native approvals or setup questions. The Pi
plugin is instructed to settle after saving and leave unrelated work available.
`/mishu-questions` and the Browser coffee-menu collaboration panel let the direct
user answer or cancel an exact question/revision. Answers have a Host-created
user event and are available to the next genuine user turn, rather than injecting
a fabricated tool reply or promising unattended resumption. Answers carry no
execution authority. Codex secretary entry remains unavailable under #122.

Host persists at most 100 questions and 1000 operation identities. Exact retries
are idempotent; conflicting answers, expiry, old revisions, source rebinding and
changed setup generations fail. Unrelated questions remain pending. Current
answers are included as untrusted facts in the next foreground manager context.
First journal creation keeps a private state backup; old Hosts reject the new
optional state fields rather than silently ignoring them. Public HTTP and Browser
controller tests cover recovery, exact answers, expiry, revocation and stale UI.
Native capability and real Browser acceptance remain separate final quality gates.

## Secretary private memory (#7 implementation candidate)

Pi Chat is the only secretary source (Server #122); other engines remain targets.
The authenticated Browser `/api/mishu` action `memory` and direct native
`/mishu-memory` operate Host-owned `.coffee/mishu/memory.json` schema 1. Default
off; selection/setup grants neither memory opt-in nor sharing. All requests derive
account from the existing scoped slot and secretary from its exact current binding.
Reads: status/list/get/export/history (old binding notes only). Mutations:
configure/save/delete/restore require operationId, edits/deletes require revision.
Conflicting IDs or revisions reject. Deleted entries retain tombstones and cannot
be edited or restored from the same binding. New bindings start off and empty;
explicit old-note restoration copies a selected live note to a new ID only.

Capacity is 500 entries including tombstones per binding, 2000 chars/entry,
20 historical revisions/entry, 2000 retained idempotency receipts/binding, 4 MiB
whole scoped file, and 50 entries/export page. Capacity fails without committing;
no receipt is silently evicted. Revision operations serialize and atomically rename
only after final scope/binding/selection validation. A mode-0600 previous-save
backup is kept. Schema 1 is initial; unknown versions/corruption remain untouched,
produce a diagnostic and do not block ordinary Chat. Recovery is offline from a
private backup with the service safely quiescent; no automatic rollback resurrects
deleted entries. No claim of erasing copies in native history or backups is made.
Credentials are rejected from memory text. Sources retain manual origin or exact
Host-verified user message excerpts, never caller-supplied account identities.

Candidate validation: public HTTP test covers explicit opt-in, source/account
isolation, revision conflict, tombstone/restart, failed save and old-binding
note-only restore. Browser controller test covers model-free entry and cancel.
Production and real desktop/mobile acceptance remain separate integration gates.

## Secretary experience candidate: unified collaboration (#11)

## Natural memory candidate (#8)

Pi `mishu` tool action `memory` exposes status/list/get/export/save/delete, with
memoryKind, stable operationId, entryId/expectedRevision and memoryQuote. Host derives
requestId and exact quote offsets from the current direct delivered user message;
caller-supplied source/account fields, report origin, expired turns, forged quotes,
model opt-in and model old-note restoration are refused. Nonextractive statements
become separate candidates and cannot replace an existing confirmed fact. A strict
candidate is excluded from transient context until the user explicitly edits it.
Every new Pi context request reads the current ledger, excludes deleted/candidate
entries and unrelated project facts, and clips to 6000 characters. Current user
corrections prevail; no memory operation changes live execution authorization.

Native Pi public WS + synthetic provider verification exercises tool save,
correction, fresh transient context, forged-source refusal and deletion. This is
real native Pi transport/plugin integration with deterministic model output, not
proof of a real model's language understanding or native compaction behavior.

An optional `send.taskId` links an information contact to its exact saved task and
target. Host refuses wrong-target links; linked live task receipts are protected
from rotation. Ordinary bridge messages keep their original idempotency fingerprints
when taskId is omitted. No private memory/history is automatically included.
The Browser collaboration tab and `/mishu-collaboration` show readable responsible
parties, expected results, remaining responsibility, timestamps and reply destination.

## Secretary experience candidate: bounded followups (#12)

`followups` v1 list is model-readable. Create/stop require the direct Browser user
or the one-shot `/mishu-followups` command window. A plan selects 1–20 existing
TaskBriefs (one per responsible target), fixed information-only text (1000 chars),
explicit total cap 1–5 and per-target cap 1–3, `trigger:new-reply` and the supported
`stopCondition:budget-user-or-access`. Unsupported custom triggers/conditions fail.
Host persists exact original source/target bindings, authorization generation,
TaskBrief revision and scope fingerprint, user-event proof and counts.

Only a new complete task-linked reply/fact can reserve a contact. Identical content
with a new message identity stays quiet; existing evidence becomes the initial
baseline and does not replay. Reservation and spent counts are durable before
existing send transport is called. Stable message IDs and uncertain outcomes are
retained across failures/restarts; unknown delivery is never automatically retried.
Counts are contact limits, not token or monetary estimates. Target consumption
remains target usage. The plan adds no model planner or polling timer.

Scope changes, target/source rebind, revocation or stopped tasks invalidate the
plan. Native delivery checks the same reservation again. Stop only prevents future
plan contact; it never stops target work. Reaching either relevant budget preserves
remaining responsibility. The Browser plan form/status/stop controls and native
command show counts, last contact evidence and limits. Reports continue under the
existing separate source capability and opt-in queue; a followup plan does not
automatically enable notifications or unattended secretary model execution.

The integration candidate's scoped public tests use deterministic native fixtures;
actual source-model/desktop/mobile acceptance and final review remain release gates.


### Usage and auxiliary admission resource (MISHU #13)

Runtime/browser `usage` v1 accepts optional purpose (`foreground/report/memory/context`),
exact model, ISO since/until and pagination (50 records/page maximum). Returned known
native input/output/cache fields are separate; absent counters are null/unknown,
Host Watch is known zero model calls, target costs excluded, monetary estimates absent.
Native Pi passive history adds exact message identity and coffee-native-run report
classification; streaming/final/reread/restart merge one identity, including cancelled
or failed responses with returned usage. Other engine/historical auxiliary gaps remain
partial coverage. Current secretary sources remain Pi only (Server #122).

The account-scoped Host stores `usage-v1.json`: 20,000 usage identities and 20,000
auxiliary admission identities, 32 MiB maximum. Dedup/admission identities never expire
or silently prune; reaching capacity blocks budgeted auxiliary work with a diagnostic.
A durable reservation precedes any automatic report or new auxiliary native call;
started/uncertain calls never return quota, only proven not-started cancellation can
release. Shared per-secretary/binding limit is 12 calls/hour, in addition to unchanged
report cooldown, queue fairness and report budget. Corrupt schema/version/file is
preserved and blocks new auxiliary admission; ordinary conversation continues.
Evidence incremental scan mode returns only complete entries and the exact last
consumed nextId. Missing cursor/over-capacity next message never advances the cursor.


## Secretary experience candidate: unified collaboration (#11)

`collaboration` v1 list/get is a scoped projection of TaskBrief, its existing
Assignment, task-linked information receipts and ordinary questions. It adds no
executor. Every item has one current contact and immutable original secretary/task
reply destination. Title refresh does not alter binding. State separates recorded,
queued, running, awaiting-reply, waiting-user, failed, uncertain, reply-available,
reported and stopped. Execution end, report commit, unknown read receipt and pending
user acceptance remain distinct. Missing replies never count as success.

An optional `send.taskId` links an information contact to its exact saved task and
target. Host refuses wrong-target links; linked live task receipts are protected
from rotation. Ordinary bridge messages keep their original idempotency fingerprints
when taskId is omitted. No private memory/history is automatically included.
The Browser collaboration tab and `/mishu-collaboration` show readable responsible
parties, expected results, remaining responsibility, timestamps and reply destination.
