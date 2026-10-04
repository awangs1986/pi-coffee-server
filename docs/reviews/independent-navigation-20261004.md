# Independent conversation navigation

Scope: [Server #47](https://github.com/awangs1986/pi-coffee-server/issues/47).
Baseline: `0a378ce7d90d4a627c2592934534c254661baa33`.

## Design and changes

Selection, display synchronization and native execution attachment have distinct
lifetimes. ConversationNavigation owns route transitions and deferred attachment;
ConversationDisplay owns source arbitration and scoped observation. The existing
bounded repository, index, native adapters and render schedulers are reused.
Compatibility-native opening remains automatic and may start a runtime; it cannot
block local selection or independent indexed history reads. This is not a claim
that all native history formats support read-only recovery.

The repository serializes local commits, without holding an actor queue during
network I/O. Already-queued synchronization can be promoted into foreground read
capacity without duplicate fetches. Current cache reads and new socket snapshots
remain available while an older network read is pending. Late metadata cannot
replace newer snapshot state. Subscriptions survive disposable cache clearing and
end on account changes.

Canonical conversation URLs support direct entry, refresh, Back/Forward and
separate drafts. Both authentication backends bind a validated conversation return
path to OAuth state. Missing conversations display an unavailable state and cannot
accidentally create a runtime. Links carry identity only, never authorization.

## Evidence

- Two original public-repository/read-pool regressions failed on the baseline:
  pending synchronization prevented a cached read and newer socket snapshot from
  completing; a promoted background read left available foreground capacity idle.
  Both pass after the fix. Repository-level priority promotion is also exercised.
- HTTP tests first failed for authenticated deep-link serving and OAuth return
  preservation, then passed. Untrusted external/alternate redirect targets resolve
  to the root. Both authentication backends are covered.
- Actual app-controller tests retain delayed A/B/A fencing, scoped drafts,
  legacy/indexed rendering and task continuity. Added account-replacement coverage
  uses no logout broadcast and keeps read transport pending, requiring attachment
  to verify identity before accepting the new connection.
- `node scripts/probe-independent-navigation.mjs` runs actual Browser/Web/Host
  with synthetic native RPC. A stays busy; B's native startup is deliberately
  blocked. B's readable indexed content appeared in 127 ms and 137 ms in two
  local samples, and its newer native-history marker appeared before native open
  completed. Drafts, Back/Forward, late-response fencing, direct entry and missing
  conversation behavior passed. These are fixture samples, not production SLOs.
- `scripts/probe-latest-history-switch.mjs` continues to verify newest reply
  visibility while another task runs; it does not use cached paint as freshness.
- Image/download compatibility is verified with the existing V2 browser probe.

Browser executables are supplied by CHROMIUM_PATH (navigation/history) or
PI_COFFEE_BROWSER_EXECUTABLE (images). Synthetic screenshots and detailed local
logs stay outside Git. Source tests and scripts contain no private transcripts.

## Review corrections and validation limits

Security review identified that skipping attachment identity verification could
mix account scope after another tab replaced a login cookie. That optimization
was removed. Local selection remains independent while attachment retains the
identity check. Follow-up security review found no remaining actionable issue.

Initial controller-suite failures exposed fixture URL state persisting between
independent tests. Fixtures now reset history alongside storage. A native-engine
error-message regression retained the established Unknown Task wording. An image
probe launched during a rebuild initially had no dist entrypoint; it is rerun
only after build completion. These failures are recorded rather than counted as
successful acceptance.

Complete-check counts, fresh-clone results and actual activation/served-asset
identity are recorded in Issue #47. Staging is not activation. A rollout must
preserve all active tasks and queued messages, including the deploying conversation.
