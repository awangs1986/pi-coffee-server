# Sidebar recent-conversation ordering — 2026-10-06

Scope: [Server #80](https://github.com/awangs1986/pi-coffee-server/issues/80),
based on identical GitHub/Gitea main `b24f76f829224e8a9bafc238021599bd2a1ba39c`.

## Diagnosis and current decision

Sanitized live workspace metadata showed an October 4 creation date and October 6
conversation activity with Show groups disabled. The UI intentionally implemented
an earlier creation-time rule (#54), which placed the task under Recent 7 days.
The owner now explicitly requires recent conversation time for sidebar ordering.
This supersedes that older rule; it is not a server-clock or timezone repair.

Before the change,
`npx vitest run test/shell-logic.test.ts test/local-first-app.test.ts -t 'recent conversation time|older task with'`
failed both regressions. Actual app ordering was `b,a,c` rather than `a,b,c`, and
the pure grouping path used attention categories rather than conversation dates.
Synthetic fixtures reproduced the reported timestamp pattern without transcripts.

## Result

The Browser uses valid durable `lastActivityAt` for date buckets, descending order
and row relative time. Legacy fallback is the stable active timestamp, native
updated time, then creation. Absolute comparisons and stable IDs handle offset
ties, the Unix epoch and missing dates. Project/custom group rows and ungrouped
rows share the same conversation-time order; pins keep their section and manual
order. Status and streaming telemetry do not override durable activity; genuinely
new conversation activity can move a task. No native tools or history are changed.

Two adjacent ownership/freshness boundaries were also reproduced and fixed:

- A new-conversation page now refreshes workspace activity on session-list updates
  without opening an Agent.
- Authenticated cookie-account changes synchronously clear old workspace/session
  sidebar snapshots and DOM, close menus and abandon drag state. Request sequence
  fencing rejects old responses. The regression holds the next workspace response
  while a previous-account menu/pointer interaction is active. Fresh-account
  metadata is required before prior-looking IDs can reappear.

## Acceptance

- Real app controller: grouped/ungrouped old-task/new-conversation date buckets,
  descending order, telemetry stability, new-page activity refresh, and account
  revocation under delayed workspace replies and active sidebar interaction.
- Existing native-agent controller test updated from the superseded creation-time
  requirement to durable activity; pins and metadata-only new task behavior retained.
- Real Chromium, real HTTP/WS, synthetic tasks: grouped and chronological modes,
  Today bucket, old task above newer-created task, reload, telemetry stability,
  genuine new activity promotion, retained pin and zero page errors.
  Probe: `node scripts/probe-sidebar-activity.mjs`.
- Busy Chromium sidebar-scroll probe: row/action/group focus restoration preserves
  scrollTop 420; wheel scrolling remains effective in both modes.
- `npm run check`: 105 files, 856 tests, including production build.
- Independent security review: inherited account-snapshot revocation finding was
  fixed and regression tested; no dependency or credential changes.

## Release boundary

Frontend-only behavior change; the existing production Host already exposes
workspace `lastActivityAt`. Compatible backed-up asset rollout needs no service
restart. Exact source/mirror identity, fresh-clone verification, served hashes
and unchanged service PIDs are recorded in #80 after publication/activation.
The separate completion-persistence Host activation from #79 remains pending.
