# Shared viewed-completion receipts — 2026-10-12

[Server #121](https://github.com/awangs1986/pi-coffee-server/issues/121) clarifies
#100: changing browser profiles must not restore account-owned viewed cups.
The previous implementation deliberately stored acknowledgements in localStorage;
its refresh test did not establish independent-browser sharing.

The public HTTP regression failed with 409 for `completion_read` before the change.
Host now validates bounded batches against the authenticated workspace and exact
current settled completion. One latest viewed identity is persisted per owned
Conversation and projected in scoped HTTP/WS summaries. No Agent starts, native
turn changes, transcript reads or blanket acknowledgement occur. Existing browser
markers are an offline cache; the original browser must open the updated client
once to publish valid historic receipts. Native-only summaries without an owned
completion identity retain local compatibility acknowledgement.

Targeted tests verify exact-run rejection, unknown/other-account records, extra
scope fields, Host restart, WS projection, migration, rejected-receipt retry loops,
network failure and account changes. A delayed-publication regression failed
before the queued drain and passes after it: reading B while A is publishing must
also publish B, without depending on another future sidebar frame.

Real Chromium uses two independent contexts with separate localStorage. It covers
both grouped and ungrouped lists, latest-tail proof, hidden tabs, stale history,
new completions, running/interrupted state and no icons for untouched tasks.
Transport is synthetic; the Host HTTP/WS integration separately exercises actual
production routing and durable metadata. These are not paid-model validations.

Standards and security reviews found no blockers. The Spec review's concurrent
publication finding was fixed and re-reviewed. Formal release v0.19; final
canonical/fresh receipts and served asset evidence belong to the release gate.
Source publication and staging do not mean production activation. No task or
service was interrupted while implementing this correction.
