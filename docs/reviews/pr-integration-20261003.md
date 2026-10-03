# October 3 pending PR integration

Reviewed the three open PRs against current GitHub main, preserving normal merge
ancestry and the latest Fork, OAuth, watchdog and native adapters. Production
activation, plugin artifact publication and Server plugin-pin upgrades are separate.

| PR | Scope | Source result |
| --- | --- | --- |
| Server #32 | Browser continuity and thinking selection before first send | Merged as `2bcb7b3`; GitHub/Gitea verified identical |
| Pi #8 | Harness read-only Git inspection, candidate 0.3.0 | Merged as `8959af5`; GitHub/Gitea verified identical |
| Server #38 | Local-first display/sync and welcome artwork | Integrated with #32 and #40; final implementation candidate `af7f1b3` |

## Standards review

One required finding: background display audits refreshed their own actor-access
clock, preventing idle eviction and eventually rejecting the 257th conversation's
command receipt. Audits now preserve the real access timestamp. A real SQLite
regression fills capacity, audits at nine minutes and accepts a new command after
idle expiry; it failed before the fix. Focused re-review found no remaining issue.

## Spec review

The same idle-retention defect was independently confirmed. Browser acceptance
also found a cropped welcome image and transient 183 px reading-position drift.
The welcome grid item now permits shrinking. Late disk-cache results and same-user
reconnect authentication no longer reinitialize an already displayed cached view.
The latter has a failing-before/passing-after public DOM/auth-response regression.
Independent Chromium verification under 4× CPU throttling confirmed the same
message at y=-176 before/after navigation: 0 px drift. No remaining source blocker.

## Security review

No required finding in the PR deltas or integrated tree. Review confirmed scoped
HTTP/WS operations, per-user index/cache keys, parameterized SQLite, receipt
ownership, auth-change clearing, scoped GitHub execution and retained Fork
preparation restrictions. The draft maps were unified without relaxing identity
checks. No new dependency was introduced.

## Checks and browser evidence

- Server independent clone, unchanged dependency lock: `npm ci && npm run check`
  passed **87 test files / 727 tests** at `af7f1b3`.
- Pi independent clone: `npm ci && npm run bootstrap && npm run check` passed
  Harness 50 tests + 4 installed/RPC checks; LSP 81 + 1 package check; Handoff 89;
  three monorepo installation checks, including native Pi 0.99.1 and 1.0.0.
- Chromium continuity probe passed medium default, explicit high before first
  prompt, task-local drafts, IME, modal focus and five collapsed-sidebar geometries.
  The actual isolated Web/Host Fork browser probe also passed both modes afterward.
- Final v2 60-second Chromium probe, 4× CPU slowdown: 300 switches with live frames,
  switch p95 39.7 ms / p99 47.9 ms, input p95 33.8 ms, two workers, zero page errors,
  and 0 px stable-message drift. The 10,000-message fixture was actually injected
  and awaited before reading-position checks.
- Legacy 60-second probe: 300 switches, p95 25.8 ms / p99 29.2 ms, two workers,
  zero page errors and restored scrollTop. Legacy plain-text previews add cache
  banners and differ in geometry from native rendering; stable-entity pixel
  equivalence is claimed for the v2 path, not legacy preview typography.
- Welcome component browser checks passed desktop/mobile bounds, reduced motion,
  preserved focus/draft, Escape/Skip, timed dismissal and no same-login replay.
  Screenshots were visually inspected; the coffee cup is no longer cropped.
- Earlier integrated candidate `93bfc0c` completed a 30-minute switching stress run:
  9,008 switches / 18,168 live frames, p95 32.5 ms / p99 33.3 ms, two workers,
  637–655 sampled DOM nodes and no page errors. Sampled JS heap ranged 4.8–57.2 MiB;
  end-of-probe heap was about 65.8 MiB and includes retained fixture telemetry.
  This is resource observation, not a leak-free or target-device SLO certification.
  It predates the final anchor guards. Its old large-history injection check was
  insufficient; the corrected final short probe above supplies that acceptance.

Original failures are retained in local evidence: the staged documentation wording
check; resource-contention timeouts under 32-way test scheduling; actor expiry;
welcome geometry; duplicate anchor restoration; and probe TDZ, worker protocol and
fixture-body-limit mistakes. Test workers are now capped at four; no failing
assertion was removed. Browser probes use separate fixture servers for each
protocol because they deliberately suspend HTTP reads at the end.

Reproduce after `npm run build`:

```sh
CHROMIUM_PATH=/path/to/chromium EVIDENCE_DIR=/path/on/disk/evidence node scripts/verify-local-first-browser.mjs
CHROMIUM_PATH=/path/to/chromium EVIDENCE_DIR=/path/on/disk/welcome node scripts/verify-login-coffee.mjs
# PROBE_SECONDS=1800 selects a longer run; CPU_RATE=4 enables CPU throttling.
# PROBE_ANCHOR_ONLY=1 gives the short reading-position regression.
```

Local synthetic evidence resides under
`/home/awang/tmp/coffee-pr-integration-20261003/`: `browser-accepted`, `browser-final`,
`browser-soak`, `welcome-fixed`, `fork-browser`, and `fresh-server-accepted-check.log`.
No credentials, production history or screenshots were committed. No production
service was restarted and no real-provider model turn was performed. Native
provider quality, actual user-device timing and the broader crash/disk-failure
matrix remain deployment-specific checks.
