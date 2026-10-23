# Codex speed and post-send queue controls

Owner request, 2026-10-13. Tracking: [Server #123](https://github.com/awangs1986/pi-coffee-server/issues/123).
Implemented in published main (`5119256`, verified by `cf7a2f7`). The owner
clarified that the restriction concerns bulk Agent creation. The specifically
authorized single real-model probe has completed; that approval is consumed, not
a standing allowance for future calls. See the [weekly status](../reviews/spec-freshness-20261013.md)
for source versus recorded deployment.

## Speed

Reviewed UI source: `1bc2b27968addeeb7d30ee2c0ed71b93147c314d`, branch
`feat/user-running-cat`, candidate v0.53; clean before this documentation refresh.
This is local source, not a deployed-version claim. Scope, source pointers,
executed evidence and unresolved gaps are recorded in the
[2026-10-23 freshness audit](../reviews/spec-freshness-20261023-ui.md).

Append a Codex-only Speed row below Context in the existing Agent menu. Offer
`1x` (Standard, default) and `1.5x` (Fast). Pi and other engines do not show this
row. Existing tasks display their last confirmed per-conversation choice while
metadata synchronizes; cached display values never configure the native runtime.

Selecting a speed edits the open menu draft. Only the menu's Confirm action
starts saving; outside click/Escape/navigation discards that draft. Before enabling
Fast, Confirm must show the existing explicit cost confirm/cancel dialog. Purchased credits
and pay-as-you-go usage cost 2x Standard; included subscription limits are consumed
at 2.5x Standard. `1.5x` is the requested product label, not a guarantee that all
models run at exactly that speed. The dialog states this distinction. Cancelling
or switching conversations while the dialog is open leaves settings unchanged.

Sources: [official Codex speed documentation](https://learn.chatgpt.com/docs/agent-configuration/speed)
(read 2026-10-13) and the installed Codex 0.159.1 locally generated protocol types
`TurnStartParams`, `ThreadStartParams`, `ThreadResumeParams` and `ModelServiceTier`.
Protocol generation used an empty isolated Codex home, with no model request.

Host exposes the optional speed setting only through the native Codex adapter.
Use native `serviceTier: "default"` for Standard and `serviceTier: "fast"` for Fast.
This changes service tier, not concurrency, reasoning effort, permissions or the
model. No process fan-out, automatic account switch or retry is involved.

Persist the choice beside existing per-native-thread model/effort/context settings.
Explicit Standard overrides an inherited/global Fast default. Resume and context
changes retain the selected speed. New conversations default to Standard and require
their own Fast confirmation. Draft Fast selection is applied and confirmed before
the first prompt; pending model/thinking/context choices resolve first.

Availability comes from native model catalog `serviceTiers`, with legacy
`additionalSpeedTiers` fallback. Missing support does not imply availability.
Reject Fast for unsupported/custom models. If Fast is selected, switching to an
unsupported model requires selecting Standard first. Validation and preference
writes are serialized, preventing concurrent settings from accepting an
unsupported model/tier combination.

Speed cannot change during an active run or lifecycle operation. An ACK alone
does not update the selected value: the browser waits for correlated authoritative
model metadata. On disconnect, error or confirmation timeout, preserve unsent input
and do not replay the write. A timeout may read current settings without starting
a model turn. Provider errors remain visible; Fast is not a rate-limit workaround.

## Sending while busy

Remove the composer dropdown that chose steering versus queueing before sending.
Idle messages start normally. When busy, an engine with follow-up support receives
`follow_up`; an engine without it keeps the message in the composer until idle.

After Host publishes the accepted queue entry, show its existing Edit, Cancel and
Immediate Insert controls. Immediate Insert promotes that exact entry/revision
through `queue_action`; it never submits a second prompt containing the same text.
Native steering capability and existing tracked-assignment restrictions still
apply. Images stay attached to the queued entry. Sending, stale, failed or uncertain
entries retain the existing guards; uncertainty never triggers automatic retries.
If the run finishes before admission, Host may execute the message as a normal
prompt. An already delivered message cannot be retroactively promoted.

## Acceptance status

Regression coverage includes protocol validation, authenticated WS speed
settings without a model turn, native preference restoration and tier reset,
unsupported-model rejection, browser cost confirmation/cancellation, stale-dialog
fencing, metadata correlation, timeout without retries, and Pi/Codex queue-then-
promote behavior without duplicate prompts. Existing queue edit/cancel tests remain.

The owner clarified that ordinary testing is allowed; sudden bulk creation or
awakening of conversations remains high risk. The single real Codex Fast turn authorized for this release
completed as recorded below, before source publication.
Use serial isolated regression checks without additional provider calls or review
subagents. Evidence and failures are recorded in Server #123; version advancement,
publication and production activation remain distinct. The Pi-only MISHU source
boundary and high-risk batch policy are integrated through normal merge ancestry.

## Source verification (2026-10-13)

Targeted verification passed: 9 files / 205 tests, executed serially with synthetic
providers. An isolated local Web/Host task completed exactly one real Codex
`gpt-6.1-sol` / medium model request with native `serviceTier=fast`, returned
`SPEED_OK`, and displayed the confirmed Fast menu and cost dialog in Chromium.
The observed turn took about 6.7 seconds; this is functional acceptance, not a
Standard/Fast performance comparison or a guarantee of the advertised multiplier.
The native CLI required recovery of discarded empty threads before the one turn;
these scaffolding attempts made no model requests. The single Web diagnostic task
was retained outside production account workspaces, and its processes were closed.

The test's initial unpublished-thread UI attachment failures and recovery are
retained in private evidence and the Issue. Canonical verification, publication,
fresh-clone verification and production activation remain separately recorded gates.


## Confirmed-menu limitation (2026-10-23, source inspection)

Only Codex receives `set_speed`; selecting a Pi model must not synthesize a speed
write. This is covered by the v0.53 review regression in
`test/local-first-app.test.ts`.

The existing **select and save Standard first** requirement remains binding when
leaving a Fast-enabled model for one without Fast support. The candidate menu
locally normalizes the staged speed to Standard, but `confirmAgentSettings` writes
model before speed. `CodexSession.updatePreferences` in
`src/host/codex-adapter.ts` rejects the new unsupported model while the stored tier
is still Fast. One Confirm cannot currently perform that compound transition;
the user must first save 1x, then reopen and change model. The displayed draft
normalization must not be described as successful automatic native downgrade.
This integration/UX gap was identified by source tracing, not a new model call or
runtime reproduction. No implementation or acceptance criterion changes here.
