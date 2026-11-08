# Persistent Codex Goal status and controls

Source baseline: Server 0.98 `022b23a`. Tracking: [Server #163](https://github.com/awangs1986/pi-coffee-server/issues/163).
This change implements the requested visible Goal status and Pause/Resume UI;
the separately planned CLI upgrade and native budget editing are not included.

## Upstream evidence

Read Codex tag `rust-v0.167.0` at commit
`086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a`:

- [Goal status](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/tui/src/chatwidget/goal_status.rs) maps native active/paused/blocked/usageLimited/budgetLimited/complete independently of per-turn state.
- [Footer](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/tui/src/bottom_pane/footer.rs) renders the persistent “Pursuing goal” indicator, or paused/stalled/limited/achieved status. Budgeted goals show token usage; unbudgeted goals show elapsed usage.
- [Goal controls](https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/tui/src/chatwidget/goal_menu.rs) expose Pause for active, Resume for paused/blocked/usage-limited, and no Resume for completed/budget-limited goals.
- App Server `ThreadGoalUpdatedNotification` and `ThreadGoalClearedNotification` carry the native state changes. The TUI restores state for the selected thread; native Goal automation remains engine-owned.

Coffee previously mapped commands and showed a result dialog but ignored these
notifications. The new narrow Browser controller owns selection-scoped display,
confirmation and stale-result rejection; Codex translation stays in its adapter.
The existing scoped command route carries actions. Goal reads use the existing
auxiliary lane instead of blocking prompt delivery.

## Executed targeted evidence

- Red: the adapter had no observable Goal state updates after setting a goal.
- Red: the Browser did not query or render a persistent Goal on open.
- Red: a delayed native Goal query blocked a prompt on the same authenticated socket.
- Green: targeted adapter, public HTTP/WS and Browser-controller suite: 188 passed.
- Green: uncertainty/reconnect controller test: a pending pause is not replayed,
  reconnect queries only, and late results do not populate another conversation.
- Green: no-model Chromium probe exercised persistent status between turns,
  Pause/Resume, page reload, delayed command result fencing and unchanged native
  slash/Handoff behavior. At a 390 px viewport the strip measured 366 × 30 px
  without horizontal overflow. No browser errors were observed.

Native event completion is covered using the external fake App Server, separately
from turn completion. No real model turns, new production tasks or native-account
changes were used for this UI implementation. The earlier one-thread Luna
continuation experiment is historical adapter/native evidence, not a new browser
or latest-CLI acceptance claim.

## Complete-check follow-up

The first canonical attempt failed 13 tests: a prohibited legacy-mode word in
new prose, an existing task-details test matching the new Goal Details button
by its former generic label, and 11 ordinary-backup startup failures. The worker
had systemd UMask 0002 and emitted group-writable build artifacts (mode 0664),
which the startup authority correctly rejected. Use UMask 0077 for the isolated
verification worker and rebuild; do not weaken the startup guard or alter live
service permissions. The prose and Goal Details label were corrected. All 18
tests in the three affected files passed after rebuilding with private modes.
The reviewed-source complete gate must then run again.

## Release boundaries

Serial standards/spec/security review found no remaining blocking issue in this scope.
The existing authenticated open-Session command route and scoped native subscriber
remain authoritative. Bounded fields are rendered with textContent; identity changes
clear display/pending work; no dependencies, credentials or account policies changed.
A review follow-up caught stale Goal display when empty-context configuration
rebinds the native thread: the regression failed before the fix and passed afterward.

The source-bound canonical complete check is required before publication.
Source publication, a fresh-clone release check and actual Web/Host activation are
separate stages; record their identities in #163. Current production activation
is not implied by this source document. Keep CLI qualification/budget controls
and any remaining end-to-end acceptance open in #163.
