# Streaming browser responsiveness — 2026-10-07

Tracking: [Server #96](https://github.com/awangs1986/pi-coffee-server/issues/96).
Baseline: `6115217168bf50a695e5d673204a857e3174fb1f`.

## Reproduction and diagnosis

The owner reports the whole page freezing during Agent replies after the latest
release. A real Chromium fixture serves the actual app with synthetic authenticated
HTTP/WS, eight bounded completed replies containing 8,000-character dense tokens,
and forty subsequent streaming deltas. It also edits the composer draft and checks
that browser timers and the final streamed text continue progressing.

On the baseline, `node scripts/probe-streaming-responsiveness.mjs` fails: over
2,811 ms the 20 ms browser timer advances only fourteen times. Interaction round
trips reach 323 ms, and repeated main-thread tasks take about 222–230 ms. There
are no page errors. Ordinary small Word replies and local-image fixtures do not
reproduce this dense-history failure.

Disabling only the Word-download controller restores responsive streaming.
Replacing only its signature expression also restores responsiveness while
retaining document decoration. The original unanchored greedy pattern retries a
long nonmatching token from each starting character. Measurements for token
lengths 4K / 8K / 16K / 32K take approximately 7 / 27 / 109 / 461 ms. The transcript
MutationObserver repeatedly invokes that signature on streaming DOM mutations,
so unchanged historical tokens consume the main thread throughout later replies.
This is repeated expensive scanning, not an observer self-mutation loop.

The synthetic reproduction establishes this regression class. No timestamped
trace or private transcript establishes the owner's exact individual trigger.

## Correction and acceptance

Signature discovery splits the already bounded text into whitespace/backtick
separated tokens and attempts the existing greedy filename match once, anchored,
per token. This retains the case-insensitive filename signature while removing
restart-at-each-character behavior. The downloader interface, verified-file
selection, task grants, exclusions, scope/epoch fencing and URL renewal are
unchanged. No Host, native context or dependency upgrade is introduced.

The same browser regression passes after correction: its timer advances 57 times
in 1,134 ms, interaction round trips take 1–3 ms, the final delta is rendered and
the draft remains editable. A second actual-app scenario retains both inline and
plain verified Word downloads during streaming. Three targeted controller/HTTP
files pass eight tests, preserving file bytes/MIME, authorization, path exclusions,
late-scope handling and existing delivery behavior.

The probe is added to the canonical check alongside the four existing browser
probes. It uses bounded synthetic data, no provider request, and a permissive
liveness budget rather than claiming production latency guarantees. Source
review/canonical-check evidence and exact release identity belong to Issue #96.

Activation is a compatible Browser-only update with backups and served-byte
verification. Backend identity must remain `6115217`; running Agent sessions
must be preserved. Publication alone does not prove activation.
