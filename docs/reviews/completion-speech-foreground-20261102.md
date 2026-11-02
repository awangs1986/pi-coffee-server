# Foreground completion speech correction

Base: `ccab3b372b19402f1551b4e6823e12e275843556` (Server 0.68).
Candidate: Server 0.69, completion-speech package 0.1.1, unchanged profile 0.1.0.
Tracking: [Server #152](https://github.com/awangs1986/pi-coffee-server/issues/152),
[delivery/device acceptance #157](https://github.com/awangs1986/pi-coffee-server/issues/157).

## Cause and confirmed behavior

The original unread-only policy consumed a completion when its viewed receipt
arrived and revoked active audio if it later became read. Foreground rendering
normally acknowledges the latest result, so automatic playback raced with normal
reading. The owner confirmed a new rule: play new opted-in settled results once
in foreground or background. Read receipts control only the coffee indicator.

Remove read gating from delivery consumption, claim eligibility and active audio
validation. Preserve opt-in, authorized task admission, browser designation,
settlement/current-completion checks, expiry, queue bounds and durable attempts.
No user state migration or attempt reset is required. Previously consumed results
are deliberately not replayed. No change to model, native permissions, tools or
the pinned instruction profile is included.

## Review

Serial standards/spec/security inspection found no blocking finding in this diff.
The change stays in the independent policy package; Host/Web public interfaces
and account isolation remain unchanged. Tests exercise the public Host HTTP seam,
not private fields. The new fixture captures once before the Host loads its own
policy and creates a fresh Host instance for restart verification; it never
submits a model prompt or shares mutable policy instances during delivery.

The new two-case HTTP test failed before the fix: read-before-claim returned no
pending item, and read-during-playback removed the active item. Both pass after
removing the three read gates. Existing delivery tests now assert the approved
foreground rule while retaining supersession, concurrent claim, designation,
expiry, disablement, archive and restart assertions.

## Executed focused evidence

- 53 tests in 15 suites passed, including native instruction-slot integration.
- Chromium complete-app journeys passed for raw and indexed sync, each with 15
  observable criteria and zero page errors. Each journey uses five explicit
  synthetic user submissions, not hosted Agent sessions.
- The foreground journey observes the actual read receipt, then verifies that
  speech remains active and has been invoked once for that completion.
- Browser audio is synthetic; preview/audible quality on the target device and
  hosted-model brief compliance remain manual gates.
- Versioned plugin artifact 0.1.1 packages successfully; the profile is unchanged.

Local private evidence is retained under
`~/.local/state/pi-coffee/speech-diagnosis-20261102/foreground-browser` and
`foreground-browser-raw`. No credentials, transcripts or real account state are
included in this report.

## Separate missing-brief observation

The authorized reported completion had no validated brief. That observation does
not distinguish a native optional-instruction failure from model noncompliance
or an exact-output constraint. The installed Codex 0.163.0 settings protocol was
verified with one ephemeral thread and zero model turns: settings/update emits
resolved native instructions through settings/updated, matching the adapter's
schema. No unsupported claim of a device synthesis fault or a lost injection is
made. Missing briefs retain the truthful generic completion notice. No extra
summary model, automatic task replay or retry loop is added.

Canonical fresh-clone release verification, remote publication and runtime
activation are separate release gates and are recorded in the Issue receipt.

## Fresh-clone verification follow-up

The first canonical run passed all speech checks but hit the unchanged MISHU
budget fixture's 30-second deadline. Its isolated execution passed in 20.52
seconds. Repeating the complete main suite with memory-backed bounded scratch
passed all 1,344 tests. The separate runtime-temp negative test then failed: it
assumed `tmpdir()` was ordinary disk, while the selected scratch was a valid
16-GiB private tmpfs. Consequently it advanced beyond the intended configuration
rejection and reached a listener conflict instead.

The negative fixture now uses the checkout's ignored `.scratch` directory on
disk. It still requires nonzero exit and the original memory-cap rejection.
No runtime code, deadline or assertion is weakened. The other temp lifetime and
recovery fixtures continue to use the check-owned scratch directory and cleanup.
The source change is test-only and requires a new exact-SHA fresh-clone check;
no failed receipt is promoted or combined into a successful release verdict.
