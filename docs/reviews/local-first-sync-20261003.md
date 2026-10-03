> Integration update: the original cloud-environment results below are historical.
> Current merged-candidate validation and corrections are recorded in
> [the integration report](pr-integration-20261003.md). Production activation remains separate.

# Local-first synchronization verification — 2026-10-03

Implementation code reviewed and tested at `ff88e27373a76ccd8b6a2cda8a9edcc0058016b9`,
based on current main `b39e85160c871194430f78d21abb2d46fe560a41`.
The original baseline was `6cb1d32`; newly merged OAuth PR #37 was preserved during
integration. PR #32 and pi-coffee PR #8 remain separate. Watchdog code/configuration
has no changes in this branch relative to current main. No deployment or production
model prompt was performed.

## Checks run

An independent clone installed 599 dependencies from the unchanged lockfile with
`npm ci --ignore-scripts`, then ran:

```
env -u CODEX_HOME PI_COFFEE_CHECK_TMP_ROOT=<private-check-directory> npm run check
```

- Build and TypeScript: passed.
- Tests: **677 passed / 2 failed, 80 files** (78 files passed).
- Both failures were reproduced before implementation on the original main:
  `test/host-server.test.ts` archive/delete and
  `test/task-storage-http.test.ts` task-bundle deletion. Both return HTTP 409
  because the restricted environment denies the existing LSP Unix-socket
  connection with `EPERM`. A temporary runtime directory did not remove that
  restriction. No permission workaround or disabled assertion was used.
- CODEX_HOME was unset only for isolated test processes. The inherited executor
  home otherwise prevents newly merged OAuth native fixtures from starting.
  No user configuration, credentials or OAuth grants were changed.
- Actual-app and final welcome checks: 30/30 passed. Web/Host asset and protocol
  seams also pass their focused suites, including actual worker-script and image delivery.
- Whitespace and JavaScript syntax checks passed.

A repeated aggregate run exposed an intermittent takeover-directory cleanup race.
Two public regressions reproduced early return from Host shutdown: an owned native
history audit was still pending, and a disconnected socket could still prepare its
post-history inbox. The fix fences new index admission and drains owned audits,
accepted index operations, socket work and workspace bookkeeping before releasing
resources. The original takeover plus the two regressions passed 20 consecutive
runs (60 test executions), without cleanup retries or killing shared workers.
The final independent-clone result above includes these corrections.

This is not an entirely green aggregate result. The two environmental failures
remain release gates to rerun in a suitable environment.

## Behavior established at public seams

- Actual app.js receives live Pi/Codex/Claude text and tool events at 45k/225k,
  including authoritative completion; output stays bounded and its ending remains
  accessible through text-page controls.
- Continuous hints refresh the durable tail without waiting for the stream to
  pause. Durable and legacy replay paths do not append duplicate content.
- Rapid A/B/A navigation rejects old-socket and old-page results, preserves
  independent drafts, restores the older visible window and never sends an abort
  merely because the view changes.
- A 10,000-message fixture remains readable through a bounded latest window.
  Hung reads leave cache navigation and draft editing available.
- Edits/deletes affect an older page being read. Tool arguments and diffs are
  demand-loaded while identity, running state and collapse controls remain intact.
- New conversations mount their initial v2 view. Unacknowledged requests keep
  manual recovery controls across reconnect and root replacement; no automatic
  replay is introduced.
- Authenticated scope, epoch, entity revision and snapshot guards prevent stale
  writes. HTTP 401 or mismatched authenticated scope revokes cached display and
  drafts, including a cookie identity change without an earlier tab notification.
- SQLite transactions preserve entities/log/watermarks together; retained-log
  reset, stale audit, external edits/deletes, restart epochs, source replacement
  and IndexedDB transaction failure have focused coverage.
- Bounded workers/queues retain occupied capacity until actual work settles.
  Urgent Stop and question answers bypass delayed ordinary commands. Stop does
  not wait for receipt writes, and late accepted/delivering work cannot start a
  cancelled prompt or steer afterward.
- Read-only history APIs do not start/resume native sessions. Native adapter
  fixtures cover Pi, Claude and canonical Codex records; unknown earlier Codex
  formats retain readable legacy opening.
- The selected-view sync cat stops on timeout/error/offline. The login welcome
  runs once after a successful identified login, supports reduced motion and
  dismissal, removes itself after 2.2 seconds and handles an image-load error.
- HTTP asset tests serve the exact module-worker path, its dependency and WebP
  artwork while retaining denial of other nested paths.

## Review and test sensitivity

Independent Standards/integration and scoped Security/Spec reviews reported no
remaining concrete source blockers after corrections and the OAuth rebase.
Review reproduced and corrected transaction races, missing Pi live projection,
401 revocation, tool/older-window regressions and Stop admission/delivery races.

Eight targeted actual-app changes made only in a disposable copy were all caught
by tests: oversized rendering, destructive tool truncation, dropped completion,
lost drafts, stale socket acceptance, duplicate replay, ignored older deletion,
and false idle status. A separate protocol sensitivity pass found missing cases;
explicit epoch, append-base, unknown-operation and content-revision counterexamples
were added. These are targeted checks, not an exhaustive correctness proof.

## Visual/resource evidence and remaining gates

The owner iterated the visual direction to a more distinctly anime PC-98/256-color-era
character, without scenery. The final reference-based transparent artwork was
visually inspected as a static asset: 768×1152 RGBA WebP, **203,868 bytes (199 KiB)**.
Its alpha channel was decoded and checked: 338,580 pixels are completely transparent.
This is a limited-color-era visual style, not a claim of an exact 256-color palette.
The application has no cafe/frame/visible dialogue backdrop and uses a short
transform and opacity sequence, no video, audio, canvas loop or third-party image
request. Static artwork inspection does not verify browser composition or animation.

The permitted cloud-browser navigation was blocked before page load with
`net::ERR_BLOCKED_BY_CLIENT`. The restriction was not bypassed. Consequently:

- Browser paint/input p95/p99 and target-device switching SLOs are **unverified**.
- Module-worker execution in a real browser, animation appearance, pixel anchor
  tolerance, CPU throttling, the 60-second switching run and 30-minute memory soak
  are **unverified**.
- Production native sessions, live model behavior and the entire crash/disk-failure
  matrix are **unverified**.

`scripts/probe-local-first-sync.mjs` supplies legacy/v2 browser fixtures with live
frames, fresh history, worker-backed HTTP data, hung reads, switching and measured
sample output. It is ready for an allowed browser; it is not marked passed here.

Earlier Codex rollout formats lacking supported stable item records remain on
legacy explicit opening. Bounded display/cache improvements apply there, but the
new durable delta/paging guarantees are not claimed for those formats. The command
receipt limit is 4,096 identities/about 1 MiB per conversation; at capacity new
acceptance fails explicitly instead of evicting replay protection.

Keep this PR in draft until the outstanding environment/browser acceptance is
reviewed. Deployment and merging require separate authorization.
