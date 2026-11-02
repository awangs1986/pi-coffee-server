# Completion speech recovery after disconnects

Status: accepted design, 2026-11-02; implementation and deployment pending.
Baseline: Server 0.69 / speech plugin 0.1.1 / profile 0.1.0, source
`1fa5bebb331d33b451a0d26c0e7f963b9be90c66`.
Tracking: [Server #159](https://github.com/awangs1986/pi-coffee-server/issues/159).
Parent: [completion speech](https://github.com/awangs1986/pi-coffee-server/issues/152).
Related acceptance: [Server #157](https://github.com/awangs1986/pi-coffee-server/issues/157).

## Problem Statement

An idle Browser can lose its conversation connection and require a refresh before
showing updates. Completion speech must remain useful when that happens. A user
must not have to watch connection indicators, switch Conversations, refresh the
page or generate another Agent reply just to receive an existing spoken result.

The current speech channel already uses independent HTTP polling. However, a
transient reservation/queue request error can pause the entire audio drain even
after HTTP recovers, and requests have no explicit application deadline. The
five-minute expiry also discards results during longer absences. Consuming an
attempt before the Browser has obtained permission to play leaves an ambiguous
network-failure window.

A controlled reproduction on the baseline injected one temporary claim error,
then restored HTTP: three polls produced one claim attempt and zero utterances.
This establishes a speech recovery defect. It does not establish the root cause
of every reported production conversation disconnect.

## Solution

Keep completion speech independent of the conversation WebSocket. Host stores
eligible results while the Browser is disconnected. A designated Browser checks
for them through the existing authenticated HTTP boundary, automatically recovers
from transient network failure, and reconciles immediately when the page returns.
No page refresh or Conversation navigation is required.

Retain eligible pending results for up to 24 hours, subject to explicit bounded
queue and lifecycle rules. Play them serially, retaining only the latest eligible
result per Conversation. Reading a result affects its coffee indicator only.

The guarantee is conditional on a runnable page, valid login, reachable Web/Host
and usable browser/system speech. A conversation WebSocket failure alone does not
prevent delivery. Complete network loss, a frozen or closed page, and unavailable
OS audio prevent immediate sound; recovery reconciles retained work. A playback
whose outcome is uncertain is offered for explicit replay, not blindly repeated.

## User Stories

1. As a Browser User, I want speech to work when only the conversation WebSocket is disconnected, so that a stale transcript does not hide task completion.
2. As a Browser User, I want Host to retain pending results while I am offline, so that a temporary outage does not lose them.
3. As a Browser User, I want returning to the page to immediately check pending speech, so that I do not have to refresh or change Conversations.
4. As a Browser User, I want online, focus, visibility and page-restoration signals to converge on one recovery action, so that simultaneous events do not duplicate requests or sound.
5. As a Browser User, I want hung requests to time out, so that one missing response cannot block future announcements indefinitely.
6. As a Browser User, I want network errors to recover automatically, so that I am not asked to grant audio permission for a connectivity failure.
7. As a Browser User, I want actual audio permission or voice failures to expose an explicit recovery action, so that I can correct a device restriction.
8. As a Browser User, I want results to remain eligible for 24 hours, so that an absence longer than five minutes does not silently discard them.
9. As a Browser User, I want only the latest result from each Conversation, so that reconnecting does not read an obsolete sequence of updates.
10. As a Browser User, I want one playing result and a bounded queue, so that reconnecting does not produce overlapping audio or an unlimited backlog.
11. As a Browser User, I want skipped, expired and uncertain deliveries to have visible reasons, so that silence is distinguishable from success.
12. As a Browser User, I want both foreground and background results to speak, so that actively reading a Conversation does not disable its announcements.
13. As a Browser User, I want listening and reading to remain separate, so that audio does not incorrectly clear the coffee indicator.
14. As a Browser User, I want a request lost before playback permission to be safely retried, so that a recoverable network error does not consume an announcement.
15. As a Browser User, I want a possibly spoken result to require explicit replay, so that uncertainty does not cause duplicate announcements.
16. As a Browser User, I want a lost acknowledgement to be reconciled by identity, so that retries do not create a second delivery.
17. As a Browser User, I want queued results to survive Web or Host restart, so that maintenance does not erase delivery state.
18. As a Browser User, I want a reload to recover playback state without automatic duplicate sound, so that refreshing is safe even though it is no longer required for recovery.
19. As a Browser User, I want one explicitly designated Playback Browser, so that my other tabs and devices do not also announce results.
20. As a Browser User, I want takeover to revoke obsolete playback permissions, so that an old device cannot act on a late response.
21. As a Browser User, I want a suspended page to discard expired permissions before playing, so that waking an old tab does not replay stale work.
22. As a Browser User, I want logout and account switching to cancel local playback and discard obsolete responses, so that another account's data never speaks in my new session.
23. As a Browser User, I want expired login to offer login recovery, so that authentication failure is not presented as an audio-device problem.
24. As a Browser User, I want disabling speech or a Conversation selection to cancel applicable delivery immediately on the active page, so that my explicit preference takes effect.
25. As a Browser User, I want re-enabling speech to avoid resurrecting disabled backlog, so that opting in again starts from intentional new work.
26. As a Browser User, I want archiving, deleting and superseding a result to invalidate its queued delivery, so that obsolete work is not announced later.
27. As a Browser User, I want a new running turn to defer the previous result until its eligibility is resolved, so that an old announcement does not interrupt current work.
28. As a Browser User, I want a missing brief to use a truthful generic notice, so that speech does not fabricate successful completion.
29. As a Browser User, I want manual replay to use retained data without a model request, so that listening again cannot rerun a task or consume extra model usage.
30. As a Browser User, I want questions and approval waits to retain their existing suppression rules, so that a pending decision is not presented as task completion.
31. As a Browser User, I want reconnects to preserve drafts, attachments, model choices and native execution, so that notification recovery cannot alter my work.
32. As a Browser User, I want task titles to be resolved at playback under my account, so that a rename is reflected without changing the brief's content or prompt.
33. As an account owner, I want every queue, reservation and receipt to be authenticated and scoped, so that identical task IDs in different accounts cannot cross boundaries.
34. As a maintainer, I want one bounded recovery scheduler and cancellable requests, so that unreliable connectivity does not leak timers, promises or memory.
35. As a maintainer, I want old delivery attempts migrated conservatively, so that upgrading does not replay previously consumed results.
36. As a maintainer, I want pending payloads protected from presentation-cache eviction, so that cache cleanup does not destroy valid delivery work.
37. As a maintainer, I want the existing versioned speech profile to remain unchanged, so that transport recovery causes no avoidable model-prefix churn.
38. As a maintainer, I want serial synthetic fault tests at the existing public interfaces, so that recovery is proven without burst creation of real Agent sessions.
39. As a maintainer, I want diagnostic states without credentials or transcript logs, so that production failures can be located without exposing user content.
40. As a maintainer, I want source acceptance, installed version and actual device listening separated, so that a passing simulated speaker is not reported as proof of audible delivery everywhere.

41. As a Browser User, I want a temporary failure to load the optional speech component to recover without refreshing, so that startup network loss does not permanently hide speech controls.

## Implementation Decisions

### Ownership and connection independence

The independently versioned speech plugin owns delivery policy, queue state,
playback state and its Browser controller. Host provides authorized completion
facts and durable private storage. Web authenticates and forwards the existing
speech HTTP operations. MISHU and native Agent protocols remain outside this
recovery mechanism.

Speech availability must not depend on conversation selection, an open chat
socket, a conversation subscription, history synchronization, DOM coffee icons
or a successful chat heartbeat. The selected Conversation may be different from
the Conversation whose result is spoken. The same authenticated user and fixed
Host route remain authoritative; the Browser never supplies an arbitrary user
scope or Host destination.

Reuse the current HTTP and Browser lifecycle boundaries. No new daemon, general
plugin framework, WebSocket channel, hosted TTS service or auxiliary model is
needed. Conversation connectivity and speech connectivity may share lifecycle
signals, but must not share a lock whose failure prevents either from recovering.

### Bounded requests and recovery

The optional Browser component bootstrap also participates in recovery. A transient
asset-load failure must not permanently hide controls or require a page refresh.
Retry initialization through one bounded scheduler after connectivity returns,
with no duplicate controllers, listeners or polling timers. A genuinely missing
or incompatible plugin instead exposes an unavailable/update state while ordinary
Conversation operation continues. Do not accumulate unbounded module generations
or fall back to executing unversioned external code.

- Every speech HTTP operation, including response-body reading and presentation
  metadata, has a ten-second application deadline and an AbortSignal. Releasing
  its scheduler guard is mandatory on success, error, abort and disposal.
- Permit one delivery reconciliation at a time. Independent bounded presentation
  reads must not hold the delivery guard. Superseded or disposed requests are
  aborted, and their late responses are fenced by account and controller epoch.
- Healthy polling uses the existing five-second cadence while the page can run.
  Timers are scheduling requests, not a guarantee of background CPU availability.
- Network failure, timeout and temporary server unavailability use a single retry
  schedule: 1, 2, 5, 10, then at most 30 seconds between attempts, with bounded
  jitter. Honor valid server retry-after hints up to five minutes; wake signals
  do not bypass that server-directed delay. Healthy reconciliation resets the
  backoff. Do not create parallel retry loops.
- An online event, focus, transition to visible, pageshow or page resume schedules
  immediate reconciliation. Coalesce overlapping signals. Compare elapsed wall
  time before reusing in-flight work; expire a request that outlived its deadline
  while timers were suspended. Do not wait for an old background timer to fire.
- Connectivity errors do not set the audio-permission pause. A successful network
  reconciliation clears the connectivity error automatically. Actual speech
  API/voice/permission failures require the explicit enable/retry control.
- Authentication failure suspends scoped delivery and invokes existing login
  recovery. Refresh authorization after login before reconciling; no tight 401
  retry loop and no fallback to another account or VM route.
- Authorization denial stops delivery until authorization is corrected; a missing
  plugin disables optional speech. Stale reservation/ownership conflicts trigger
  reconciliation, not an audio-permission prompt. Only temporary availability,
  rate-limit and transport failures enter automatic network backoff.
- A protocol mismatch or invalid response is a bounded compatibility error with
  a visible retry/update action. Do not interpret it as an empty successful queue.

### Durable delivery identities and state

Each automatic result is identified by authenticated account, Conversation,
authoritative completion and automatic-delivery identity. It retains submission
opt-in/profile evidence, settlement time, payload provenance and terminal reason.
Host serializes atomic updates. Concurrent requests cannot grant two automatic
playbacks. The Browser supplies an operation identity for idempotent mutations;
reusing it with different input is rejected.

Reservation and permission to invoke audio are separate. The existing claim path
must no longer permanently consume a result merely because it was reserved.

| State | Meaning and permitted recovery |
| --- | --- |
| Pending | Eligible durable result, with no permission issued to invoke audio. It can be reserved after all current guards pass. |
| Reserved | One designated Browser/page generation holds a 30-second reservation. Audio must not be invoked. A lost reservation response can be reconciled or retried with the same operation identity. Release or expiry returns it to Pending only if it remains eligible. |
| Committed | Host has durably granted the one automatic permission to invoke audio. The Browser may start only after an explicit successful response for its current operation and live generation. This state is conservatively considered possibly spoken, even before an audio-start callback. |
| Played | The Browser reported normal audio completion. The report is idempotent and never creates a read receipt. It is evidence of a browser callback, not proof a human heard the result. |
| Uncertain | Permission may have reached a Browser, or audio may have started, but normal completion cannot be established. It is never automatically returned to Pending. Explicit replay is offered. |
| Audio blocked | The Browser reported a speech permission, voice or synthesis failure. Keep a user-visible recovery action; do not automatically retry the utterance. |
| Skipped | Disabled, deselected, superseded, archived, deleted, expired or overflowed. Record the reason; ordinary polling/re-enablement cannot resurrect it. |

Immediately before committing, revalidate account, master switch, selection,
authoritative completion, settlement, expiry, current Browser ownership epoch
and reservation. Reading is not an eligibility guard. A committed response cannot
be used after its request deadline, controller replacement, page restoration or
ownership change without fresh reconciliation. Repeated commit responses must
never authorize another automatic utterance.

The crash window between permission and actual sound cannot be made atomic across
Host and an OS speech engine. If the commit response is lost and Host reports
Committed, the outcome is Uncertain; do not infer that no audio happened. This
may require manual replay of a result that was never heard. The product promises
safe recovery and an explicit uncertain outcome, not exactly-once audible sound.

A reservation with no commit is recoverable after timeout or restart. Host restart
invalidates outstanding reservation tokens and returns still-eligible results to
Pending; requests carrying an old token must reconcile before reserving again.
Committed work without a normal completion receipt becomes Uncertain, including after Host
restart or the existing 60-second playback deadline. A lost finish response can
be retried idempotently while the same live client still holds its completion
observation; it must not call speech again. A reload without that observation
must not invent a Played acknowledgement.

All automatic and manual playback shares the single account playback slot.
Explicit replay creates a separate user-requested attempt and never revives the
original automatic permission. It uses a retained brief or its truthful stored
status fallback, without asking an Agent to regenerate content. Expired or
unavailable payloads produce a clear unavailable response.

Host crash recovery covers durably captured eligible completions. Do not infer
successful completion or regenerate a brief for an interrupted or unproven run.
A speech result is advertised as available only after its payload and pending
state are durably committed. Existing native-task recovery remains separate.

### Retention, ordering and reclamation

- Replace the five-minute automatic freshness bound with 24 hours from the
  authoritative completion time, measured by Host. Retries, reloads, renames and
  browser takeover do not reset it. Invalid/future timestamps are not eligible.
- Retain only the latest authoritative result per Conversation for automatic
  playback. A newer result permanently supersedes the older pending result.
  While that Conversation has a new running turn, do not play its previous result;
  recheck after settlement. This does not consume results in other Conversations.
- Retain the existing limit of one active delivery and ten pending/reserved
  results per account. After coalescing by Conversation, keep the newest ten;
  mark overflowed older entries Skipped. Play the retained queue by completion
  time, with a stable identity tie-breaker. Capacity loss is visible, not silent.
- Pin each pending/active payload independently of the display-summary cache.
  Presentation cache eviction cannot delete speech still eligible for delivery.
  Payloads remain bounded by the existing brief limit. Generic notices retain the
  truthful outcome rather than fabricating a summary.
- Preserve the existing display cache bound of 100 briefs for 24 hours. Keep a
  durable latest automatic decision per registered Conversation independently of
  expiring text. Keep recent delivery/replay diagnostics bounded to 100 records
  per account for 24 hours. Losing diagnostics must not reset the latest decision.
- Reclaim expired payloads and terminal diagnostic detail during capture,
  reconciliation and startup, without a new background service. No unbounded
  retry, reservation, timer or operation-key history is permitted.
- Expiry or skipping never clears a coffee icon, deletes native history or changes
  the complete written answer. Permanent task deletion removes its scoped speech
  state and invalidates old operation identities.

### Ownership, revocation and Browser lifecycle

Only the explicitly designated Playback Browser receives sound permissions.
Each ownership change increments a Host-authoritative epoch and revokes earlier
reservations. A per-page epoch prevents a duplicated tab from reusing another
page's in-flight response even if browser storage was copied. Multiple tabs in
the designated Browser still contend for one account playback slot.

Account change, logout, close and pagehide abort local requests and cancel local
audio. Restored pages reconcile before playing anything. A pending/reserved result
can remain available to its original account after login recovery, provided its
switches and expiry still permit it. Logout is not disabling the account's speech
preference. A committed result canceled by logout/pagehide remains uncertain.
No data or response from the previous account may be applied in the new one.

Master-off and per-Conversation deselection durably skip affected pending work and
revoke reservations. Re-enable does not replay this backlog. Archive/deletion,
newer completion and explicit browser takeover invalidate applicable permissions.
A currently runnable, connected page cancels affected audio on observation.
A disconnected or frozen page cannot be remotely guaranteed to stop instantly;
use short-lived permissions, the playback deadline and reconciliation on wake.

Recover connection failures automatically while the page can run. Surface actual
audio failure as an action in the existing speech controls. Browser/system rules
can require a fresh gesture after a reload; there is no silent workaround for
that permission requirement. Closed-browser push and lock-screen speech are not
part of this contract.

### User-visible status and diagnostics

Use the existing speech controls for a concise state: ready, reconnecting, login
required, audio action required, uncertain playback, or compatibility error.
Display pending count and relevant expired/overflowed counts. Do not insert these
statuses into the conversation transcript, change its model context or repeatedly
emit a toast for every failed poll. An HTTP failure must not say that the speaker
is broken. A healthy chat socket must not mask an unhealthy speech channel.

Diagnostic metadata is account scoped and bounded: completion/delivery identity,
state/reason, reservation/ownership epoch, last successful reconciliation and
retry timing. Keep credentials, complete transcripts and audio content out of
operational logs. Record server state and browser acknowledgement separately.

### Compatibility and rollout

Version the delivery protocol separately from the pinned speech profile and
advertise compatibility at the existing speech status boundary. Unknown or
incompatible clients must not mutate or consume the new delivery queue; expose
an update/retry state instead. Support staged compatibility explicitly or deploy
matching Browser/Host artifacts together. Do not silently route a legacy claim
through the new reservation contract with different consumption semantics.

Migrate private persisted state atomically with a rollback copy. Preserve account
settings, selected Conversations, profile pins, completion provenance and every
previously consumed attempt. Old consumed/active records become non-replayable
legacy-consumed/uncertain decisions; never infer that they are safely unplayed.
Unconsumed captured results may be admitted if all new guards and the 24-hour
bound pass. Do not scan old native history to manufacture an upgrade backlog.

Rollback must understand the new state or disable optional speech safely; it must
not restore an older attempt ledger over newer deliveries. Ordinary task execution
continues if speech is unavailable. Record the independently incremented plugin
version and the next formal Server release when implementation is published.
Profile 0.1.0 stays unchanged; recovery adds no prompts, tools, model calls or
native sessions. A spec publication is not an implementation/deployment claim.

## Testing Decisions

Reuse the previously agreed public authenticated Host HTTP and complete Browser
controller/application seams. Exercise Browser -> Web -> Host -> durable policy
with synthetic accounts, a controllable clock, fake native completions and a
replaceable speech boundary. Existing completion-speech, completion-read,
connection-recovery and page-wake journeys are the prior art. No new test service
or native model conversation is needed.

Tests assert observable claims, spoken-call counts, scoped receipts and preserved
user state, rather than private booleans or exact DOM structure. The current
reproduction must first fail: one claim-time transport exception followed by
healthy requests must not leave an uncommitted result permanently paused.

Acceptance requires all of the following:

1. Close only the conversation socket while speech HTTP remains healthy; a newly
   captured selected result speaks once without navigation or refresh.
2. Inject network failure and a hung request independently into status, pending,
   reserve, commit, finish and summary presentation. Every operation has a finite
   deadline; unrelated delivery is not held by a presentation request.
3. Restore the network after an uncommitted failure; retries resume automatically
   with one scheduler and no audio-permission click. An audio failure instead
   requires explicit recovery and does not retry sound in a loop.
4. Suppress background timers, advance wall time beyond an in-flight deadline,
   then fire overlapping online/focus/visible/pageshow/resume events. The page
   reconciles immediately and stale responses cannot start an utterance.
5. Complete a task during a 20-minute disconnect and recover without refreshing;
   its latest eligible result plays once. At exactly 24 hours it is eligible;
   after that boundary it is skipped with a reason, without changing read state.
6. Lose reservation, commit and finish replies after the Host has persisted each
   transition. Reservations recover safely; committed uncertainty does not replay;
   a finish retry creates no utterance. Duplicate/conflicting mutation identities
   are handled deterministically.
7. Crash/restart Host at each persisted delivery state; restart Web separately;
   reload/restore the Browser. Pending reservations survive or expire safely,
   and committed deliveries never silently return to pending.
8. Race two tabs and two designated-browser candidates against the same result.
   Only the current owner/epoch can commit; a late old-owner result is fenced.
   Repeat with account switching and identical task IDs in two synthetic accounts.
9. Apply read receipts before reservation and during playback. Neither suppresses
   or cancels speech; listening never writes a read receipt.
10. Exercise master-off, deselection, archive, deletion, a running/newer turn and
    re-enable at pending/reserved/committed boundaries. Skipped automatic work
    does not resurrect, and unrelated Conversations continue to deliver.
11. Produce more than ten eligible results and multiple results from one task;
    verify latest-only coalescing, ordering, one speaker, durable overflow reasons
    and no replay after cache eviction or restart.
12. Verify manual replay for uncertain, blocked and retained generic-fallback
    results, with the same account/ownership guards and zero model requests.
13. Expire authentication and restore it through existing login flow; verify no
    scope fallback, stale payload display, account crossing or tight retry loop.
14. Migrate legacy consumed/active/pending state, exercise old/new client protocol
    mismatch, and test rollback admission. No upgrade or downgrade replays an
    already-consumed result or destroys native history.
15. Verify bounded queue/payload/receipt/timer cleanup, preserved drafts and
    attachments, unchanged native execution/model/profile and no repeated prompt
    injection. Record retry/request counts, not just eventual success.

16. Fail the optional Browser component load once, then restore its compatible
    assets and emit a wake signal. Speech initializes without page reload, with
    one controller and one scheduler. A missing/incompatible version produces a
    visible unavailable/update state without breaking ordinary chat.

Under deterministic foreground fixtures, a wake signal starts one reconciliation
without waiting for the five-second timer; a hung operation releases its guard
within the ten-second deadline; a healthy authorized pending result proceeds to
reservation/commit without a manual page action. These are application scheduling
criteria, not real-world network or OS audio latency guarantees.

Actual target-device listening and suspend/resume behavior are separate manual
gates. Record the browser/OS and observed limitation without claiming an inaudible
headless test proves speaker output. Keep real-model testing explicitly bounded
and sequential if it is later needed for brief quality.

## Out of Scope

- A promise that browsers, networks or conversation WebSockets never disconnect.
- Sound while the Browser is closed, completely frozen, or unable to reach the
  service; system push, a local desktop agent and cloud TTS are separate products.
- Proof that a human heard an utterance, or exactly-once physical audio across
  arbitrary client/server crashes.
- General replacement of the conversation transport, authentication or native
  execution architecture; this does not assert the cause of prior idle failures.
- MISHU integration, extra summary turns, bulk Agent wake-up, automatic replay of
  user prompts, profile changes or edits to native model context/history.
- Replaying expired, explicitly disabled, superseded or previously consumed
  history as a side effect of installing this feature.

## Further Notes

This design supersedes the five-minute speech catch-up rule and immediate durable
consumption at claim time. It preserves the approved foreground/background rule,
original-turn briefs, coffee read semantics, explicit opt-in and account isolation.
The current five-minute behavior remains an implementation gap until the recovery
protocol is delivered and its runtime version verified.

The existing public HTTP and Browser seams were already accepted for this feature;
this follow-up requires no additional testing seam. The independent-plugin
boundary remains governed by the accepted completion-speech architecture decision.
