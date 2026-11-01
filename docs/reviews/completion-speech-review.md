# Completion speech MVP review

Scope: [Server #152](https://github.com/awangs1986/pi-coffee-server/issues/152),
T1–T5 (#153–#157), fixed source base
`d58ac4e814e34167157c57ae76f3b7461042f025`.
Integration runtime reviewed: `b0d704a536f19cb2477ae0b72ba2c5df6cee3e82`.
T5 `f5a061b96d8cf4507fa4a8668094e5d8a769e767` has identical application code;
`95be954` adds evidence documentation and probe failure capture.

## Final review verdict

| Axis | Unresolved findings | Evidence and boundary |
| --- | --- | --- |
| Standards | 0 | Repository instructions, source authority, domain model and existing interfaces checked; no actionable documented violation or design smell remains |
| Spec | 0 | Current-turn provenance, pinned profiles, waiting-user disposition and browser cache path rechecked; latest reviewer ran 50 targeted tests in 3 suites |
| Security | 0 block, 0 fix-before-ship, 0 note | Scoped HTTP/WS operations, private atomic state, strict static-resource allowlist, native controls and safe metadata rendering checked |

The three reviews were independent source inspections. They do not substitute for
the acceptance journeys or imply hosted-model/speaker-quality verification.
Retained local reviewer reports: `/tmp/coffee-speech-review-standards-final.md`,
`/tmp/coffee-speech-review-spec-final.md` and
`/tmp/coffee-speech-review-security-final.md`.

## Findings repaired before acceptance

- Removed repeated native title enumeration from submission/capture; one fresh
  title snapshot is reused within a playback operation.
- Consolidated duplicate brief parsing and projection-retention policy.
- Added an explicit waiting-user disposition instead of speaking a question as
  an ordinary missing-brief completion.
- Retained immutable profile versions and report unsupported pins without
  replacing the persisted selection or blocking ordinary execution.
- Bound display projections to both native assistant-message identity and the
  complete-answer digest, including after old projection eviction.
- Preserved validated provenance through indexed browser storage and recent
  history; appending text invalidates the previous digest.
- Allowed exactly the two required nested public plugin assets; arbitrary
  package paths remain inaccessible.
- Suppressed redundant private Pi controls for never-enabled and unchanged
  settings, preserving ordinary task events and MISHU behavior.
- Matched Pi multi-text-block capture with native-history newline joining.
- Protected the final asynchronous eligibility check against a superseding turn.

## Verification record

See the [acceptance guide](../development/completion-speech.md) for all 26 user
stories and 47 ticket criteria, package identity, execution results and evidence
paths. The [test audit](completion-speech-test-audit.md) preserves 40 plain-language
business claims and the initial gaps, repaired red tests and final 11-mutation
probe with zero survivors. Source was restored after every mutation.

Actual browser journeys cover both raw and indexed sync: fourteen observable
criteria per protocol, zero page errors, real clipboard/download operations and
four explicit synthetic native submissions per journey. They start no hosted
model sessions. Browser speech is a controlled effect; the following remain
manual or unobservable here: actual audible system voice quality, hosted-model
brief quality and upstream cache-hit metrics. No live services were restarted
and no production user state was modified.
