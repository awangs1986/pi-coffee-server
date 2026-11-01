# Completion speech MVP: integration and acceptance

Candidate: Server 0.67.0 and `@pi-coffee/completion-speech` 0.1.0, profile
0.1.0. Source is in this Server repository because this plugin crosses native
engines. It is independent of MISHU and the Pi-only plugin repository.
Tracking: [spec #152](https://github.com/awangs1986/pi-coffee-server/issues/152),
execution tickets #153–#157. Source completion does not mean production activation.

## Delivery boundary

The package owns the fixed Skill, brief validation, speech eligibility and queue,
bounded brief projection, presentation and browser speech controller. Coffee
owns account authorization, task persistence, current completion/read identities,
native instruction slots and UI mounting. No daemon, general plugin framework,
auxiliary summary conversation or MISHU role was added.

Projection requires both an immutable native message key and the digest of the
entire answer, preserved across raw history, bounded index pages and disposable
browser caches. Legacy answers without that binding retain their complete view.

Only **Pi and Codex** advertise this feature. Claude, Cursor and Grok task switches
are disabled; they are not accepted as supporting the brief protocol. The host
accepts one terminal `coffee-speech` JSON fence from the current opted-in
assistant turn with the exact pinned profile version. Ordinary complete answers stay
in native history. Missing, ambiguous or invalid brief metadata leaves the normal
complete-answer view; speech can use a truthful completion/error status fallback.

The profile uses the native request instruction mechanism, not repeated user
messages. Pi's request-bound provider instruction slot preserves native history;
Codex combines its native mode instructions with a stable developer instruction
slot on the same thread. The fixed profile excludes dynamic titles/time/turn IDs.
The account/task setting is sampled when admitting a new user turn. No additional
turn is started to summarize a completed task.

An existing Conversation retains profile 0.1.0 when the plugin is upgraded.
Future packages must retain supported old profile definitions; unsupported pins
must not be silently replaced. Speech disable stops active injection and playback
without erasing historical messages. Prefix stability is not provider cache-hit
proof: expiry, routing, native compaction and model changes remain external.

## Installation, immutable identity and rollback

Build the selected Server commit and package its independent plugin:

```
npm ci
npm run build
node scripts/pack-completion-speech.mjs /tmp/coffee-speech-package
sha256sum /tmp/coffee-speech-package/pi-coffee-completion-speech-0.1.0.tgz
```

Record the Server commit and artifact SHA256 together. The build ships compiled
policy, declarations, browser modules, fixed Skill and MIT attribution; the tarball
can be installed in an isolated consumer with no Coffee/MISHU/native CLI imports.
The Server bundle consumes the source at the same commit. Packaging alone does
not install it on a running server or imply a published registry release.

Account and task switches default off. Open **PI Coffee → 完成播报** to enable
the account and designate this browser. Use a Conversation's actions menu to
select **完成播报** for future turns. **播报设置** chooses/previews a system voice;
**在此浏览器播报** explicitly takes playback over from another browser. Only one
browser plays automatically per account. The page must remain open; system voices
may require network access and actual browser permission/user activation.

To stop automatic playback, disable the account master switch; task selections
are retained. To disable Host integration during an authorized release/restart,
set `PI_COFFEE_COMPLETION_SPEECH=off`. Ordinary sends, model controls, native
history and complete answers remain available. If removing the optional package,
remove its public modules as part of the same release; do not delete task/native
history or account state. Restore the previous immutable Server release to roll
back implementation. Do not mix plugin browser assets from one commit with Host
policy from another. Production restarts require the normal deployment process.

## Reproducible verification

The repository has no `docs/agents/feedback-loops.md`; package commands and existing
complete-app probe conventions are used instead. Run build/check sequentially: build
replaces `dist`, so a second concurrent build can invalidate an active browser
fixture even when the application is correct.

```
PI_COFFEE_TEST_TIMEOUT_MS=20000 npm run check
EVIDENCE_DIR=/tmp/verify-completion-speech-v2 node scripts/probe-completion-speech.mjs
SPEECH_SYNC_PROTOCOL=1 EVIDENCE_DIR=/tmp/verify-completion-speech-v1 node scripts/probe-completion-speech.mjs
```

The speech probe is registered in `check:browser`. It boots real Host, Web,
TransferServer and fake Gitea OAuth on loopback ephemeral ports, separate
synthetic account scopes, isolated Playwright contexts, an in-process native
factory and fake system speech. It never references production endpoints,
credentials, transcripts or model services. Actual clipboard copying and browser
download bytes are verified. Evidence contains screenshots, HTTP contracts,
criterion results, native input counts, page errors and request cancellations.
Every created service/browser is closed and temporary fixture files are reclaimed.

Observed candidate evidence (behavior commit `f5a061b`, 2026-11-01):

- `/tmp/verify-completion-speech-cache-v1/result.json`: protocol 1, fourteen
  observed criteria passed, four explicit user/native prompts, no extra summary
  prompt and no page errors. Screenshots and HTTP contracts share that directory.
- `/tmp/verify-completion-speech-cache-v2/result.json`: the same fourteen criteria
  passed through indexed protocol 2, with four explicit native prompts and zero
  page errors. Request cancellations were navigation-related `ERR_ABORTED` only.
- `/tmp/verify-completion-speech-package-mvp/standalone.json`: final tarball
  installed in a separate consumer and accepted a brief with a fake authorized
  adapter, without Coffee/MISHU/native CLIs or model calls. Artifact SHA256:
  `e7b96c73cb056631a798c06441b49a1659462215a66301aa46a9a16fd0fac93b`.
- `/tmp/coffee-speech-native-slot-evidence.json`: separate installed Codex CLI
  0.159.1 no-model instruction-slot smoke preserved model/thinking, zero messages
  and model calls. This is protocol compatibility, not model-summary-quality proof.

The local fresh-clone check uses the identical source commit and a read-only
symlink to the existing lock-matched dependency installation. This verifies clean
source/build/check behavior, not a second network dependency installation. Its
retained output is `/tmp/verify-completion-speech-final-fresh-check.log`.

The final fresh-clone command `PI_COFFEE_TEST_TIMEOUT_MS=20000 npm run check`
exited **0**: ESLint and the TypeScript/build pipeline passed; Vitest passed
1,342 tests in 183 files plus three isolated runtime-reclamation tests in one
file (**1,345 tests / 184 files total**); all **17 registered Chromium probes**
passed, including the new completion-speech journey. The fresh-clone source was
`f5a061b`; subsequent T5 changes document that evidence without changing behavior.
Separately, the final asset-boundary/documentation checks passed three tests in
two files. No production restart or deployment was performed.

The configured check timeout avoids the baseline five-second Git fixture limit
on a shared busy VM; it does not permit live parallel model sessions. A fresh
local clone of the candidate must run the same documented check before release.
The actual final commit, command result and retained logs are recorded in the
implementation PR/tickets, rather than claiming that this living document names
the final release hash forever.

## User-story coverage

The references below identify the public behavior exercised. Browser evidence is
synthetic speech output, not proof that a person heard an OS voice. Deterministic
policy/controller tests remain necessary for controlled-time and crash cases.

| Spec story | Observable behavior and evidence |
| --- | --- |
| 1 | Authenticated account/task opt-in in complete browser journey and scoped HTTP tests |
| 2 | Default-off selections in HTTP tests; existing new/fork task IDs do not inherit a selection |
| 3 | Original-turn fixed brief displayed/spoken in browser; duration/quality by hand |
| 4 | Four explicit browser sends yield exactly four native prompts; no summary turn |
| 5 | Submission captures sample current settings; running turn is not steered |
| 6 | Error/fallback policy tests retain failure/unverified wording |
| 7 | Cancelled/tool-only results rejected by plugin; approval/question waits never settle eligible result |
| 8 | Two isolated browser contexts and explicit ownership takeover |
| 9 | Controlled policy/controller tests serialize and bound the queue |
| 10 | Controlled policy tests reject read/stale/superseded completion IDs |
| 11 | Five-minute boundary and enablement/backlog policy tests |
| 12 | Hidden complete-app playback leaves `readCompletionId` unset |
| 13 | Expand actual Markdown/code, clipboard Copy and scoped binary download |
| 14 | Latest visible summary clears actual sidebar coffee/read state |
| 15 | Tool-only/absent brief produces truthful fallback without another prompt |
| 16 | Browser settings persist voice URI and preview matching synthetic voice |
| 17 | Controller blocked/error/timeout tests pause until explicit recovery |
| 18 | Master off retains selections and sends next native prompt without profile |
| 19 | Manual replay in real browser leaves native prompt count unchanged |
| 20 | Fake-OAuth alice/bob with identical task ID keep settings, summaries and playback separate |
| 21 | Archive/deletion policy and account-change cancellation/controller tests |
| 22 | Independently packaged fake-adapter consumer; no MISHU/native imports |
| 23 | Missing-package Host execution regression; asset negative paths; complete-answer fallback |
| 24 | Pi provider-request capture, Codex request-mode capture and multi-turn browser equality |
| 25 | Scoped persisted profile, restart/resume capture and unsupported-pin safety tests |
| 26 | Stable-prefix evidence explicitly separated from unavailable provider cache metrics |

## Ticket acceptance matrix

Numbers correspond to checkbox order in each ticket, including the cache-stability
additions. “Automated” refers to the named public-boundary tests plus complete-app
probe where specified. Actual command completion is recorded in the PR checks;
this matrix must not be used to substitute planned tests for executed evidence.

| Criterion | Evidence / acceptance boundary |
| --- | --- |
| T1.1 | Scoped HTTP settings persist across Host restart; browser account/task switches and designation; no inherited selection |
| T1.2 | Submission/native captures, including Pi provider HTTP request and Codex fake app-server; model/effort/tools/history unchanged |
| T1.3 | Current assistant capture + versioned envelope validation; browser displays brief separately; spoken duration by hand |
| T1.4 | Pi/Codex native adapter tests + both task types in real browser; invalid/missing brief policy fallback, no extra invocation |
| T1.5 | Independent policy and delayed-capture race tests; no speech for interrupted/tool-only stale result; browser completion/read identities |
| T1.6 | Authenticated claim races/Host restart and hidden-browser read receipt assertion |
| T1.7 | Pinned profile, README and upstream license; diagnosis/permanent activation not imported |
| T1.8 | Independent fake adapter; absent-package execution test; real Web/Host/browser/transfer complete journey |
| T1.9 | Multi-turn Pi provider/Codex captures and browser profile equality without historical append |
| T1.10 | Fixed profile excludes dynamic title/time/ID; completion association in Host; renamed-title policy test |
| T1.11 | Persisted task profile and adapter restart/resume tests; unsupported-profile safety, no silent repin |
| T1.12 | Deterministic successive request captures, resume/disable; provider cache metrics unavailable without live provider |
| T2.1 | Exact authenticated answer digest projection; invalid/unselected answer ordinary complete view |
| T2.2 | Actual browser expansion, clipboard and transfer download; raw native answer retained |
| T2.3 | Hidden/audio-only unread then latest visible summary clears; stale digest/revision and viewport proof tests |
| T2.4 | Browser reload expansion and switch tests; existing latest-history/busy-switch probes; read-before-play claim rejection |
| T2.5 | Projection retained on disable, future normal view; absent-plugin execution/complete reply |
| T2.6 | Browser complete journey + scoped HTTP and presentation controller tests with synthetic accounts |
| T2.7 | Public UI presentation/replay/voice actions leave native invocation count and subsequent profile unchanged |
| T3.1 | Controlled policy overflow test drops oldest of 11 and retains its unread state |
| T3.2 | Controlled late-read/supersession/freshness/current identity tests and latest rename at claim |
| T3.3 | Public HTTP concurrent claims + two actual browser contexts, explicit takeover/reload |
| T3.4 | Exact five-minute boundary/backlog policy test; initial empty selection has no historical completion |
| T3.5 | HTTP Host restart preserves consumed attempt; policy restart does not replay uncertain delivery |
| T3.6 | Controlled TTL/presentation pruning and count-bound policy; durable attempts survive text expiry; deletion pruning |
| T3.7 | Same-ID synthetic account isolation + completion identity and current-title tests; no DOM trigger |
| T3.8 | Real scoped HTTP/WS/browser plus controlled clock policy tests; no live parallel native/model sessions |
| T3.9 | Native request counter remains unchanged for replay/takeover/reconnect; cache policy never invokes native factory |
| T4.1 | Real Logo/task menus, stored synthetic voice choice and preview |
| T4.2 | Real browser replay after read + explicit owner policy; native/read state unchanged |
| T4.3 | Controller no-voice/error/timeout/cancel tests, explicit recovery and bounded timer cleanup; actual OS permission by hand |
| T4.4 | Synchronous browser cancellation and durable master-off queue policy; retained selection and no next-turn injection |
| T4.5 | Scoped archive/delete policy and active-task revocation; account switch/controller cancellation |
| T4.6 | Throwing speech boundary does not touch native task; existing navigation/download probes; actual suspension by hand |
| T4.7 | Controller/settings disposal and API tests, plus real browser replay/disable path |
| T4.8 | Native counters/profile equality plus stored voice without profile change |
| T5.1 | complete documented check, local fresh-clone check, tarball pack/install identity and rollback procedure |
| T5.2 | complete actual Chromium journey and screenshots/HTTP JSON; audible Chinese listening remains by hand |
| T5.3 | Fake ownership/reconnect/blocked speech/clock tests; actual OS suspension explicitly unverifiable here |
| T5.4 | Only synthetic alice/bob; no other user's files or credentials read |
| T5.5 | Pi actual local provider-boundary test; Codex fake app-server plus installed CLI no-model slot smoke; other engines not advertised |
| T5.6 | No live models called by browser/check fixtures; no MISHU activity/auxiliary summary |
| T5.7 | Plugin absence exception, normal post-disable answer, existing model/navigation/download probes |
| T5.8 | Spec/ADR status reconciled with candidate; production activation not claimed |
| T5.9 | Pi/Codex deterministic stable instruction captures; dynamic titles stay out of fixed profile; restart pin tests |
| T5.10 | Prefix evidence only; provider cached-input metrics unavailable; no cache-hit claim |
| T5.11 | Version pin/upgrade guidance above; no new framework or summary conversation |

## Remaining device acceptance

The following are **UNVERIFIABLE in this headless synthetic run**, not silently
marked complete: real Chinese voice availability/intelligibility and 15–30-second
delivery quality; browser user-activation behavior on the user's device; actual
OS/browser background suspension/resume; provider cached-input reuse/expiry.
Use a supported target browser with system Chinese voice and walk enable → task
completion → listen → background → resume → takeover → replay. Do not promise
closed-browser or locked-device delivery. Provider metrics, if later measured,
must use an explicitly bounded sequential observation and no private transcripts.

During T5 the real Web server initially rejected both nested speech browser module
URLs despite those files existing. A public HTTP red regression reproduced 404;
the repair allowlists exactly the two public plugin modules, leaving arbitrary
nested/package paths at 404. Real Chromium then mounted the plugin and traversed
the end-to-end journey. This illustrates why passing controller tests alone was
not sufficient release evidence.
