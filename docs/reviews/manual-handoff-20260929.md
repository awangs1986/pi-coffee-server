# Manual Handoff integration acceptance — 2026-09-29

Tracking: [GitHub Server #2](https://github.com/awangs1986/pi-coffee-server/issues/2),
[plugin #2](https://github.com/awangs1986/pi-context-handoff/issues/2).

## Delivered source

- Context-handoff `0.2.0-experimental.1`, immutable commit `ce7a6d07b215473da3b2703d9c2a6b83dbb5e162`.
- Harness `0.1.2`, immutable commit `d068251dc1b4de59c4178eb04e0d4a0fcc117187`.
- Web confirmation, Host operation ownership/reconnect/abort, Pi RPC result verification,
  and same-native-session custom compaction. Native automatic compression remains Pi's.
- Code remains behind Agent interfaces. No Codex/Claude authentication, model, history
  or tool implementation was replaced. No production deployment is claimed here.

## Evidence

| Surface | Observed result |
| --- | --- |
| Plugin fresh clone | Build and 80 tests in 7 files passed, including native RPC/package installation, default native automatic compaction, explicit manual success/failure and synchronous Git compatibility. |
| Harness fresh clone | Build, 49 tests and 2 packed native-Pi tests passed; installed recovery schemas remain available in Chat without adding system instructions. |
| Server | Build and 301 tests in 39 files passed. A final fresh-clone run is recorded in the Issue. |
| Public Web/Host + actual Pi/plugin | Committed manual Handoff has the expected version and trigger; native session, history and protected workspace file retained; invalid synthesis cannot produce a successful native fallback. Stats reads during synthesis do not mutate its history. |
| RPC timeout | A response delayed beyond 30 seconds settles successfully without replay; unobservable settlement terminates the child and allows reopening the original Conversation. |
| Browser controller | Cancel and task-switch send no compact request; reconnect restores busy state; concurrent mutation is rejected; observer receives failure without the originating socket. Native completion is not prematurely displayed as verified Handoff success. |
| Browser walkthrough | Local built Web with real Pi/plugins and a synthetic provider: Chat reply, experimental modal, cancel, confirm, disabled composer/Stop, then successful completion in the same visible conversation. |
| Reviews | Standards and Spec findings fixed and re-reviewed; plugin and Server security reviews found no security findings. npm audit reported zero vulnerabilities. |

Browser artifacts are temporary synthetic evidence: `/tmp/verify-handoff-confirm.png`,
`/tmp/verify-handoff-complete.png`, `/tmp/verify-handoff-complete.txt`. No credential,
real transcript or generated runtime state is committed. The local probe binds only
loopback and uses isolated task, session and model configuration directories.

Red/green failures retained in the local test logs cover the old automatic Handoff
policy, unavailable synchronous Git settlement, misleading native completion,
compaction ownership, unobservable-child recovery, disconnected failure reporting,
and stats reads changing the history while Handoff is being synthesized. An initial
integration fixture also put sessions inside its workspace and used too-short history;
it was corrected to match the documented native storage boundary and compaction minimum.

## Limits

Deterministic model fixtures establish orchestration and data retention, not semantic
fidelity or improved drift. Unknown third-party asynchronous tool state still blocks
Handoff unless its extension reports settlement; native automatic compaction continues.
A short session can legitimately have nothing to compact. Git releases and source
synchronization do not establish production rollout or npm registry publication.

Before deployment, remove obsolete context/Harness overrides, settle active tasks,
ensure one installed copy of each plugin, and record the deployed commit and served
asset probe using the release runbook. Re-running unrelated live evaluations is not
part of this change.
