# MISHU explicit older contact correction — 2026-10-11

The owner clarified that 72 hours only filters the default selection list; it is
not a maximum age for adding a contact. Previously final setup reused the recent
200-row directory as an admission allowlist. A valid exact binding was therefore
rejected with “Target binding changed” solely because its last activity was old.

The public HTTP reproduction changes only a synthetic target's activity to 96
hours ago, verifies it disappears from the default list, then confirms the same
binding through the authenticated setup flow. It failed with HTTP 409 instead of
200 before this correction. No real user conversation is changed by the tests.

Host now resolves explicit IDs against account-owned, available, non-archived
conversations and checks the current binding at final admission. Default directory
ordering and its 72-hour/200-row display bounds remain. Exact lookup returns at
most one row and grants no permission. Codex setup lookup uses the existing
source-bound, expiring ticket; Pi's native setup has the same explicit-ID option.
Both work even when the recent list is empty, preserve the 20-contact limit, and
save only after the existing permission choice and confirmation.

A related review found setup tickets could survive deselection/reselection or
disable. Those transitions now invalidate pending tickets and setup windows.
Async lookup rechecks the same permit after reading; setup creation checks the
authorization epoch and binding after awaits; confirmation checks the live permit
before one-time consumption. A paused lookup followed by revocation returns 409.

Evidence: public HTTP/WS and browser-controller regressions; plugin public command
checks; isolated real Chromium at desktop/mobile/short viewport resolves the old
contact, cancels without saving and later confirms it. The probe uses synthetic
native model transport, not a user task or a real-model acceptance claim.

Product behavior and native Pi interaction belong to the independent MISHU package
`0.3.0-manager.5`; Host validation and Codex Browser integration remain here.
Source publication and production activation are separate outcomes. Nothing in
this change silently edits a real user's contact list or restarts a running service.
