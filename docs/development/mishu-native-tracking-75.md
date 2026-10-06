# MISHU native observation — #75 candidate evidence

2026-10-06. Source candidate only, paired Server `impl/mishu-75` and independent
plugin `impl/coffee-75`. No new package artifact, production deployment, service
restart or real-user task reuse. Installed-artifact and integrated #74/#76 evidence
remain separate obligations of parent #64 / PR #78.

## Checks and public seams

- Initial public red: all four non-Pi targets returned unsupported before the
  online adapter path. `red75.log` retains the four failures.
- Server `npm run check`: **106 files / 909 tests** passed (`check75.log`).
- Independent plugin `npm run check`: **141 tests** passed (`plugin75-final.log`).
- The new public Host HTTP/WS matrix covers four native engines × completed,
  interrupted, failed, connection loss and binding replacement: 20 cases. Codex
  uses the same production `CodexSessionFactory` wired by main. Existing Pi native
  public observation/dispatch/report cases remain in the complete check.
- Cases start work directly at the target, register its exact run, reject wrong
  run IDs, preserve native questions at the target, do not count partial replies
  as success, ingest result once, ignore unrelated later runs, and preserve old
  facts with uncertainty after restart. ACP references are labelled Host receipts.
  Failure/interruption remain incomplete; connection loss and unknown ACP stop
  reason remain uncertain. Native questions are answered only on the target WS.
- Existing passive ACP history checks additionally verify run evidence is unknown
  without invoking a CLI. The task browser only offers observation for proven
  current evidence; reports and dispatch do not confer broader native support.

The matrix exercises behavior, not actual provider readiness. The root's final
immutable-package check must run without source overrides.

## Actual Browser: Pi secretary to production Codex

**PASS**, evidence root:
`/home/awang/tmp/mishu-implementation-d12/verify75-codex-HZWPOT/`.
Harness: sibling `verify75-codex-probe.mjs`; log `verify75-codex-probe3.log`.
Runner configuration was read; everything ran locally on isolated loopback ports,
synthetic workspaces and native sessions. Existing native authentication was
referenced in place. Production credentials/default models were not modified.

The explicit isolated source model was `eidolon/gpt-5.6-sol`; the production Pi
model `openrouter/meta/muse-spark-1.3-contributor` had previously returned repeated
404 and was not silently substituted. Target used the actual configured Codex CLI
and production app-server Adapter, not a fake CLI or fallback adapter.

1. User directly starts a bounded local Python gate in the synthetic Codex Work.
2. Actual Chromium selects MISHU and completes native `/mishu-setup` for that target.
3. Natural source request asks to follow the current existing test and report when
   finished. Real Pi model calls directory/register/observe. With reminders **off**,
   it finishes the foreground turn and truthfully explains the enable command.
4. Browser explicitly enables `/mishu-notifications` through selection/confirmation.
5. Target gate is released after the secretary has settled. No further source prompt
   causes notification admission. Codex's exact native turn/item evidence becomes
   a Task Brief fact, then one real native Pi report is committed.
6. Report correctly describes the latest final fact: synthetic test completed,
   exit code zero; it keeps user acceptance pending. Its output ID/hash matches the
   native source evidence. Manual repeat does not generate another report.
7. Desktop 1360 and mobile 390 refresh each display exactly one report. Mobile
   `report-390.png` was visually inspected: readable result and usable composer.

This is online, same-connection observation. It does not prove Codex passive
terminal recovery, cross-engine durable dispatch, or detached writer completeness.

### Failures retained and resulting repairs

- First attempt `verify75-codex-HtRSAn`: source registered successfully but repeatedly
  read tasks while reminders were off; it never settled, so the later native enable
  command remained queued. This was a real foreground-flow failure, not permission
  to bypass Browser consent. Plugin guidance and successful-observation tool receipts
  now explicitly hand future events to Host and end foreground waiting. Public-entry
  red→green covers both reminders off/on and no continuation after actual admission.
- Second attempt `verify75-codex-b6IRZh`: source settlement was fixed, and one report
  durably committed, but it summarized older commentary while ignoring the opaque
  final marker. The native report input did contain the complete latest fact; this
  was not a missing event or admission/ACK bug. Task facts now expose bounded
  `latestReply`, and reporting guidance distinguishes newer explicit result from
  older plan. Final probe uses a meaningful completed/exit-code result, verifies
  that fact semantically and verifies exact native references independently.
- These failed attempts are not counted as PASS. The final test does not establish
  semantic correctness of arbitrary model summaries; output authority and user
  acceptance remain separate from report format/native commit proof.

## Other actual accounts

Independent verifier report:
`/home/awang/tmp/mishu-implementation-d12/verify-75-other-engines.md`.

| Engine | Verdict | Evidence / limit |
| --- | --- | --- |
| Pi | PASS as real source in this Browser walk | Explicit isolated `eidolon/gpt-5.6-sol`; production Meta model availability is separate |
| Codex | PASS for current existing online run and automatic Browser report | Actual production adapter, exact turn/item refs, late result and unique native summary |
| Grok Build 1.0.46 | PASS for one native request and scoped online observation | Public directory/register/observe, wrong-run409, explicit Host live receipt; no automatic Browser or passive recovery claim |
| Cursor | UNAVAILABLE | Native authentication required; fixture success is not real-model success |
| Claude Code 2.1.280 | UNAVAILABLE | One actual synthetic native call returned upstream403 quota; tracking remained incomplete/failed, no retry |

Grok evidence `verify75-other-Ry1ZnT`; direct Claude evidence
`verify75-claude-hXViaJ`. An earlier Claude source setup helper timed out before
sending any Claude model prompt; this is retained as an unlocalized public-path
probe failure. The separate direct adapter request establishes only the account
condition and honest failed-run evidence, not a passing public Claude journey.

No snapshots, native transcripts, tokens or auth files are checked in. Evidence
paths above refer only to synthetic local probe outputs. All probe-owned processes
were closed; engine-owned synthetic native records may remain for diagnosis.
