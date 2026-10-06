# Immediate Conversation model display

Tracking: [Server #68](https://github.com/awangs1986/pi-coffee-server/issues/68).
Source baseline: GitHub/Gitea main `22be30bcd41bbad58a3fcfd8316744a773d1c859`.

## Diagnosis

The actual app-controller regression visited A with `gpt-6.1-sol`, then B with
`gpt-6-luna`, then selected A while authentication was held. Before correction,
the label stayed `gpt-6-luna`. The minimised loop ran in about one second:
`vitest run test/local-first-app.test.ts -t 'immediately restores'`.

Selection retained the shared `models` object until `opened` cleared it. There
was no per-Conversation model metadata cache, so navigation first showed the
wrong task's model and then a loading label. Existing socket-identity guards
already rejected detached-socket replies; those guards are retained.

## Result and evidence

The [contract](../spec/conversation-switching.md#last-confirmed-model-display-2026-10-06-server-68)
uses a scoped, bounded last-confirmed metadata cache separate from native settings
and catalogs. Unknown destinations clear previous labels and options; native open
keeps the preview until an authoritative response arrives. Account revocation also
clears menu fields, not only the compact trigger.

- Actual app-controller and public cache regressions: 45 tests passed, including
  all five engine labels, blocked auth, blocked workspace reads after reload,
  stale sockets, authoritative correction, unconfirmed choices and binding changes.
- `npm run check`: 105 files / 847 tests passed. No dependency change.
- Real Chromium 151.0.7922.34 with synthetic HTTP/WS passed immediate A/B/A label,
  correction to a new native value and reload while workspace reads were blocked.
  No setting mutations or page errors occurred. This does not claim real-model
  acceptance. The first probe fixture omitted the existing changes/files response
  shape; correcting that fixture removed its unrelated errors.
- Independent security review found no new secrets, unsafe interpolation, account
  crossover, selectable cached catalogs or native-setting side effects.

Run `npm run build` then `node scripts/probe-conversation-models.mjs`; optionally
set `BROWSER_EXECUTABLE` and `EVIDENCE_DIR`. Probe artifacts contain synthetic data
only. Source publication, fresh-clone verification and actual served-asset rollout
are recorded in Server #68. Asset-only activation must preserve Host/Web PIDs and
record the frontend source SHA separately from their unchanged backend release.
