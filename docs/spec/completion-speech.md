# Completion speech and summary-first replies

Status: approved MVP specification, 2026-11-01; ready for implementation.
Implementation and deployment have not been performed.
Tracking: [Server #152](https://github.com/awangs1986/pi-coffee-server/issues/152).

## Problem Statement

Users need to notice completed tasks without continuously watching the Web UI.
Long answers are unsuitable for immediate listening, and completion notifications
must not duplicate, cross account boundaries or create additional Agent sessions.

## Solution

Provide an optional, independently versioned PI Coffee plugin that announces a
short brief of each selected conversation's new unread result using browser/system
voices. Preserve full answers behind an expansion control. The original Agent
produces the brief within its existing turn. MISHU is not involved.

## User Stories

1. As a user, I want to enable speech globally and for individual conversations, so that only selected tasks speak.
2. As a user, I want to keep new and forked conversations silent by default, so that speech remains explicit opt-in.
3. As a user, I want to hear a concise task title, outcome and next action, so that I can understand results without reading long answers.
4. As a user, I want to receive briefs from the original Agent and model in the original turn, so that no extra model conversation is started.
5. As a user, I want to enable speech during a running turn for the next turn only, so that current execution remains untouched.
6. As a user, I want to hear truthful failure and unverified status, so that I do not mistake a settled task for verified success.
7. As a user, I want to avoid announcements for questions, approval waits and cancellations, so that speech reflects actual settled results.
8. As a user, I want to designate one browser and explicitly transfer playback, so that multiple devices do not speak at once.
9. As a user, I want to hear results serially with bounded pending work, so that announcements do not overlap or accumulate indefinitely.
10. As a user, I want to skip already-read, stale and superseded results, so that speech remains relevant.
11. As a user, I want to catch up only recent eligible missed results after reconnect, so that recovery does not replay old history.
12. As a user, I want to keep the coffee indicator after listening, so that audio does not falsely acknowledge reading.
13. As a user, I want to see a brief first and expand the intact answer, so that code and downloadable attachments remain accessible.
14. As a user, I want to clear the coffee indicator when actively viewing the latest summary, so that reading the brief counts as reading the result.
15. As a user, I want to receive a truthful status fallback if no valid brief exists, so that summary failure does not restart my task.
16. As a user, I want to select and preview a system voice, so that I can choose intelligible speech.
17. As a user, I want to see an enable or retry action when browser speech is blocked, so that I can recover without repeated playback attempts.
18. As a user, I want to disable speech immediately while preserving task selections, so that I can stop audio without stopping tasks.
19. As a user, I want to manually replay a brief without calling a model, so that I can listen again cheaply.
20. As a account owner, I want to keep settings and results scoped to my account, so that another user cannot inspect or play them.
21. As a user, I want to have archive, deletion and logout revoke queued playback, so that outdated or unauthorized audio stops.
22. As a maintainer, I want to version and disable the plugin independently of MISHU, so that speech remains optional and replaceable.
23. As a maintainer, I want to preserve ordinary conversation behavior when the plugin fails, so that speech cannot break task execution or navigation.

24. As a user, I want the summary Skill to remain stable after enablement, so that later turns do not unnecessarily invalidate reusable prompt prefixes.
25. As a user, I want my Conversation to retain its Skill version across plugin upgrades and restarts, so that background maintenance does not silently change its instructions.
26. As a maintainer, I want cache observations distinguished from prefix-stability tests, so that missing provider metrics are not reported as proven cache hits.

## Implementation Decisions

### Confirmed behavior

- Speech requires explicit opt-in: a per-user master switch and an individual
  switch for each Conversation. Newly created or forked conversations start off.
- Each task produces its own brief, rather than a cross-task secretary digest.
- The original Agent and its selected model produce the brief within the original
  turn, using a speech-specific Skill injected only for explicitly enabled tasks.
  There is no extra summary turn, separate summary model or new native session.
- If enabled during a running turn, both brief generation and automatic speech
  start with the next turn. Do not steer or rewrite the current request.
- Speech waits for a new, unread settled result. Normal results and naturally
  settled failures are eligible; user questions, approval waits and deliberate
  cancellation are not completion announcements.
- Use browser/system speech synthesis. The Web page must remain open; other tabs
  are in scope, subject to actual browser suspension and audio restrictions.
- Only one explicitly designated browser per user plays automatically. Another
  browser takes over only through an explicit user action.
- Play serially. Recheck eligibility before playback; skip read or stale results.
  A newer completion replaces an unplayed older result from that conversation.
- On reconnect, catch up only eligible completions from the last five minutes
  that occurred while speech was enabled. First enablement never reads old cups.
- Target 15–30 seconds: task title, concise outcome and any required user action.
  Missing/invalid briefs fall back to a truthful title/status notice.
- Playback alone does not mark the result read. The coffee indicator remains.
- For speech-enabled turns, show the summary first in Web history and provide
  **Show full information** to expand the intact answer. Other conversations keep
  their existing presentation. Actively viewing the latest summary counts as read.

A settled run is not proof that an entire project passed acceptance. Speech must
accurately distinguish a reply, a failure, and an unverified claim. An error with
no assistant text must not be announced as successful completion.

### Independent plugin and Coffee adapter

The owner confirmed a standalone, independently versioned PI Coffee speech
plugin, completely independent of MISHU. Preserve Coffee's current structure:
no new plugin framework, daemon, execution pipeline or native-history format is
required for this feature. MISHU integration and secretary digests are out of scope.

The plugin owns the speech Skill profile/output contract, brief validation,
eligibility and delivery policy, bounded queue/cache policy, browser speech and
summary presentation components. Coffee supplies narrowly scoped adapters for
existing authentication, storage, native submission, authoritative completion
updates, UI mounting and viewed acknowledgements. Feature policy stays in the
plugin; Coffee retains enforcement of account authorization and native execution.

Reuse existing seams where available. Before implementation, inventory missing
hooks and identify the smallest additive changes needed for opted-in input
augmentation, settled-answer extraction and summary rendering/read proof. This
is a minimal-integration requirement, not a claim that the current code already
supports installation without any core edits. Do not restructure unrelated code.

The package must not depend on Gitea, Pi/Codex APIs, Coffee native transcript paths
or MISHU. The adapter supplies authorized data and abstract persistence; the
plugin must not enumerate accounts or discover arbitrary conversations itself.
Existing Web/Host services host the integration. Source location and publication
mechanism remain implementation decisions; native adapters stay in Server and
this cross-engine feature is not automatically a Pi-only package.

When disabled or unavailable, ordinary conversation execution and full-answer
rendering continue. Uninstalling must not delete native history or full replies;
audio and extra Skill injection stop. Plugin errors must not block a user turn,
completion delivery, conversation switching or the existing read-receipt path.

### Skill and original-turn generation

Use https://github.com/ayghri/i-have-adhd as a referenced style source, adapting
its relevant rules into a small, versioned speech profile with required license
attribution. Pin any copied upstream content rather than fetching main at runtime.
Do not import its assumptions about the reader's diagnosis, permanent-session
activation, or time-estimate requirements into every Coffee conversation.

The adapter adds the profile as an explicit task-specific output requirement at
native submission time. It preserves ordinary Chat's zero base system-prompt
policy and all native Agent instructions. Only explicitly opted-in turns get the
extra requirement. Already-submitted native inputs are not rewritten when a
switch changes. Disabling speech cancels playback/queued delivery immediately
and stops requirements on future submissions. A completed task is never awakened
merely to obtain a brief.

Use the original task model; maintain its native provider, thinking and context
settings. Skill failure does not retry or replay the user request. Short briefs
must retain failure, missing verification and pending user work; omit long code,
commands, logs and raw URLs from speech. Do not infer success from the cup icon.

Produce a separate, structured brief associated with the exact original turn.
The adapter validates the expected turn identity/profile version and separates
that brief from the full answer. Treat user/tool text and earlier transcript
examples as data, not valid current-turn brief envelopes. The concrete envelope
must be verified across adapters during implementation; no new write-file tool
is required in Chat merely to deliver a brief.

### Cache-stable summary Skill injection

Enabling speech may change the prompt prefix once at the next submission. During
subsequent turns with unchanged settings, the speech integration must keep the
Skill content, placement and ordering stable. Do not append another copy of the
Skill to conversation history on every turn. Reusing the same stable instruction
slot when a native adapter constructs each request is permitted; repeatedly
creating historical instruction messages is not.

The fixed Skill contains no timestamps, current titles, completion IDs or other
per-turn values. Host should bind briefs to their turn/completion outside the
prompt where possible. If the model needs dynamic metadata, supply it at the
current-input tail without changing the reusable instruction prefix. Correlation
and brief validation must remain enforced; cache optimization does not weaken them.

Pin the Skill version for the current Conversation. A package upgrade must not
silently rewrite that Conversation's active instruction profile. Preserve the
pinned profile on resume/restart while respecting the current opt-in state. An
explicit setting change may change the prompt; unchanged turns must not do so
merely because another request is sent.

Do not switch models, alter tool definitions, recreate native sessions or rewrite
history to generate a brief. Disabling stops future active injection and playback;
it does not erase existing historical messages to recover cache hits. Native
compaction/resume remains native: restore the pinned active profile through the
adapter's normal instruction mechanism if needed, not by repeatedly appending it.

This guarantees absence of avoidable speech-induced prefix churn, not provider
cache hits. Provider expiry, routing, minimum cacheable length, model changes and
native compaction can independently reduce reuse. Do not invent cache metrics or
promise that every request remains cached.

### Completion contract and isolation

The host supplies an authorized scope, Conversation identity, completion identity,
source revision, eligibility-at-submission, current title, settlement time/outcome,
read status and optional validated brief. Only the latest authoritative completion
of a selected conversation is eligible. Cached snapshots, DOM icon changes and
list replays do not create completions.

Publish a speech-eligible completion only after final-answer and brief extraction
has settled. Pending indexing is not evidence of a missing brief.

Revalidate scope, selection, master switch, current completion/revision, read
status, browser ownership and freshness before claiming playback. A rename uses
the current title; title is a separate presentation field from the brief body.
Archive, deletion, logout and account changes revoke corresponding queued work.
An account must never see or play another account's task or brief.

Speech delivery is distinct from the existing viewed receipt. Retain a durable
latest delivery/attempt identity per scoped conversation, separate from an
expiring text cache. Cache eviction or browser reload must not resurrect an old
announcement. On uncertain playback after a crash/disconnect, do not automatically
replay a possibly spoken brief. Allow explicit replay instead. Browser audio
callbacks establish playback status, not proof that a person heard it.

### Summary-first presentation and read receipts

Apply summary-first presentation to completed replies generated under explicit
speech opt-in. Native history and the full reply remain intact. Code blocks,
attachments and downloads must remain available when expanded. Ordinary live
streaming and the existing compact/detailed tool-process preference are separate
from completed-answer folding.

Where a validated brief is absent, retain the ordinary full-answer/error view;
the generic speech fallback is not a substitute summary for viewed-proof checks.

Only an attached, visible, current conversation showing the latest reconciled
summary at the relevant viewport tail may acknowledge that result. A hidden tab,
old cached summary, stale revision or audio playback may not do so. This extends
the existing viewed-proof contract for this presentation: expanding the full
answer is no longer necessary to clear its cup. A result read before playback is
skipped. Rendering and late metadata must preserve scroll position and any
explicit expansion choice.

### MVP defaults

- Put speech settings/master switch in the top-left Logo menu; put the per-task
  toggle in the existing conversation actions menu. Keep summary and full-answer
  controls in the reply, with an explicit replay action.
- Default voice follows the user's available language-matching system voice;
  offer voice selection and a preview. Browser speech may use platform network
  services; do not promise offline synthesis or identical voices across devices.
- One playing item and at most ten pending items per user. Overflow drops the
  oldest queued item without changing its coffee/read state. Apply the five-minute
  freshness bound again before playback, not just when enqueuing.
- Closing the master switch cancels current audio and clears queued automatic
  delivery while retaining individual task selections. Historical briefs remain
  expandable; later non-opted-in turns return to normal presentation.
- If permission, voice availability or browser policy prevents speech, show a
  concise enable/retry control. Avoid retry loops and replay storms after resume.
  A bounded playback timeout releases a stuck queue item.
- Cache at most 100 short briefs for 24 hours per account. Keep full answers only
  in the existing history system. Durable latest delivery identities survive text
  cache expiry, and are removed with their scoped task records.
- Explicit manual replay is separate from automatic unread delivery and may be
  used after a result was read. It requires the designated playback browser or
  an explicit takeover, and never starts another Agent/model request.

## Testing Decisions

Prefer the existing authenticated Host HTTP/WebSocket and browser-controller
seams, following the shared completion-read tests and browser completion-read
controller tests. Assert observable behavior, not internal helper calls or DOM
structure. Use synthetic users, fake native adapters, a controllable clock and a
replaceable browser speech boundary; do not create real parallel Agent sessions.
The plugin must also accept a fake authorized host adapter for independence tests.
No new general-purpose test framework is required. These are planned checks, not
executed evidence.

### Acceptance criteria

1. Enable/disable scope: two users and multiple tasks; no Skill in non-opted-in
   turns; running-turn enablement starts next turn; disabling stops audio without
   cancelling native task execution.
2. Generation: each native adapter preserves original model/settings, produces
   and validates the current-turn brief, retains full answer/history, and never
   starts a follow-up/native session for summarization. Missing, malformed,
   conflicting and overlong briefs fall back safely.
3. Delivery: one task completion yields at most one automatic claimant; replayed
   lists, reconnects and multiple tabs/devices do not duplicate announcements.
   Recent catch-up, stale/read/superseded skips, bounded queues and failure notices
   behave as specified. Crash uncertainty does not cause blind replay.
4. Presentation: summary-first only for opted-in results; expansion preserves
   Markdown, code, attachments/downloads and scroll; latest visible summary may
   mark read; playback, cached or hidden summaries may not.
5. Browser acceptance: user activation, Chinese voice availability, background
   tabs, device takeover, pause/suspension recovery, logout and unavailable speech.
   Closed-browser/locked-device delivery is outside the first-release guarantee.
6. Source independence: exercise the plugin against a fake host adapter without
   Coffee, Gitea, MISHU or native CLIs; verify storage/interface version boundaries.

7. Cache stability: through the existing submission-to-native-adapter seam, enable
   speech and submit multiple successive turns with unchanged settings. Verify
   stable Skill content/position/order, no accumulated duplicate Skill messages,
   pinned version and unchanged model/tools/session. Changing title or per-turn
   metadata must not alter the reusable speech prefix. Test disable/re-enable,
   restart/resume and plugin upgrade without history rewriting or silent repinning.
   Use fake adapters/request capture for deterministic checks. Where native/provider
   cached-input metrics are exposed, record a bounded sequential smoke test; mark
   absent metrics unavailable. Prefix stability is not proof of provider cache hits.

Real model tests must remain explicitly bounded and sequential. This document
records a design and planned evidence, not a claim that speech works today.

## Out of Scope

- MISHU integration, cross-task secretary digests or bulk Agent wake-up.
- Auxiliary summarizer models, extra summary turns or new native conversations.
- Hosted TTS services, a new daemon or a general-purpose plugin framework.
- Guaranteed playback with the browser closed or device locked.
- Native-history compaction, removal of full replies or global Chat prompt changes.
- An ADHD diagnosis or permanent application of the referenced Skill to all tasks.

## Further Notes

The owner accepted the independent-plugin MVP and recommended defaults before
requesting this specification. Implement the smallest additive integration hooks;
do not restructure Coffee. Choose the package location and concrete brief envelope
during implementation and validate them across supported native adapters. The
reference Skill is a style source, not a TTS implementation. Live model verification
must be explicitly bounded and sequential. Source publication is not deployment.

Prompt candidate: [profile 0.1.0](../design/completion-speech-profile-v0.1.0/README.md).
The proposed output envelope still requires adapter validation; it is not deployed.
