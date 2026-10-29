# Ordinary Host restore and daily-worker acceptance — 2026-10-29

Scope: synthetic Pi/Codex data in the ordinary `main.ts host` composition,
independent private key broker, pinned Restic, and actual Host HTTP/WebSocket
interfaces. No provider turn, production restart, account credential reuse,
physical disk failure or deployment was performed. The integration workflow owns
canonical/fresh-checkout checks, independent review and release acceptance.

## Cases and assertions

`test/ordinary-backup-composition.test.ts` now contains the previous 13 cases plus
seven cases:

- Pi and Codex each recover a missing task while a neighbor survives, and each
  recover the last task after stopped-Host task/native-history loss and restart.
- Pi and Codex each recover after the entire synthetic source root is removed.
  The operator explicitly selects a new fresh authority and genuinely absent
  roots at their original paths; old authority evidence and the independent
  repository remain. This does not reset an old journal or relocate data.
- A real fixed-role `ordinary-backup-start.py` scheduler saves a due daily point
  through authenticated Host inventory and the independent broker. The persisted
  attempt ID matches the successful Restic job with `repository-read`
  verification, and extracted repository bytes contain the selected history.
  The test configures the current UTC minute; it does not change a clock or call
  an in-process scheduler tick.

All six restore cases use actual capture/save, source loss, HTTP request/plan,
approval, publication and idempotent repeated publication. Publication before
approval is refused. Before opening any viewer, they obtain another complete
source checkpoint through the ordinary cold path. WebSocket acceptance then
asserts the actual `history.entries`, the original durable native identity, and
no error frame. Surviving Pi history bytes and Codex rollout bytes plus stable
thread business columns are compared before loss and after publication/recapture.

Fresh Codex configuration is intentionally absent after publication. The test
first verifies native authentication refusal, then the operator supplies a new
synthetic offline provider configuration while the test Host is stopped. This
uses a loopback port with no service and no credential, rather than copying old
configuration out of the archive. After changing initial fresh enrollment to
existing-source startup, the test obtains a cold checkpoint and reopens the
original native history. This is not authenticated provider continuation.

## Defects found and repaired

The last-task cases originally failed at planning because source qualification
required the very native history being restored. Fresh Pi could plan/approve but
publication failed because pristine native custody had never run a process.
Separate [destination qualification](../development/restore-destination-authority.md)
repairs these paths while retaining current administrator/scope authority,
physical exclusion, exact approved targets and independent source qualification.
Its final implementation is included from `d493cf2`.

After publication and cold recapture succeeded, stronger viewer acceptance found
that original Pi tasks ignored `nativeBinding.id` unless takeover/context reset
was present. They could open a new empty session under the public Task ID.
`NativeAgentFactory` now uses the durable binding for passive reads, native
reopen, list coalescing and native deletion. Workspace lookup keeps the public
Task ID. A recovered task requires existing native history, while ordinary
first-use tasks retain their prior creation behavior. Existing takeover,
context-reset and non-Pi deletion restrictions are unchanged; the separate
MISHU cleanup lifecycle is not repaired by this change.

`test/native-history-read.test.ts` adds real synthetic-storage cases for reading
and listing a differing native ID, refusing missing recovered native history,
and deleting only the selected bound native file even when another native ID
matches the public Task ID. The first two failed before the identity repair;
the deletion case failed before its corresponding mapping repair.

## Retained failures and evidence

Logs are private under `/home/awang/tmp/backup-implementation-130/`; no raw
credential, snapshot or transcript output is committed here.

| Run | Result and meaning |
| --- | --- |
| `ordinary-restore-pi-first.log`, `ordinary-restore-pi-diagnostic.log` | Initial HTTP-delete setup encountered existing MISHU gating. The restore tests use controlled stopped synthetic-source loss instead. |
| `ordinary-restore-pi-loss-1.log`, `ordinary-restore-last-task-red.log` | Real last-task Pi/Codex planning refused unavailable source custody. |
| `ordinary-restore-pi-fresh-1.log` | Connection refused during initial setup before capture; not evidence of a restore verdict or a proven environment root cause. |
| `ordinary-restore-pi-fresh-2.log` | Fresh Pi approved plan could not publish: `native-custody-incomplete`. |
| `ordinary-restore-pi-neighbor-1.log`, `ordinary-restore-codex-neighbor-1.log` | Early neighbor checks passed, but matched all WebSocket frames and sent an invalid public `get_messages` frame. They are **not** accepted as proof of reopened native history. |
| `ordinary-daily-scheduler-1.log` | Fixture listener used a noncanonical Python argv and failed the strict startup identity check; fixture corrected, no product guard relaxed. |
| `ordinary-daily-scheduler-2.log` | Daily scheduler case passed in 19.50 s; the same run retained fresh Codex's initial unavailable-custody RED. |
| `ordinary-restore-full-1.log` | 20 cases: 15 passed, 5 failed, no skips, 386.69 s. All six restore publications and cold recaptures succeeded. Three Pi viewer cases failed on wrong identity; fresh Codex hit the expected authentication/configuration gate; one old negative case still refused active native work with a new exact authority error message. |
| `ordinary-fresh-codex-open-red.log` | Confirms exact `Native authentication required; configure this CLI on the User VM` response after successful recovery/recapture. |
| `restored-pi-binding-red.log`, `restored-pi-delete-red.log` | Two identity cases and the targeted deletion case respectively failed before their source fixes. |
| `restored-pi-binding-final.log` | All 14 native-history cases passed, no skips, 3.09 s. |
| `ordinary-reopen-green-1.log` | All five selected previous failures passed, 15 unrelated cases excluded by filter, 157.18 s. Actual `history.entries` assertions and explicit fresh Codex configuration replace the weaker checks. |

Final frozen-source ordinary composition run: **pending**. The integrating agent
must record the result of `ordinary-restore-full-final.log` (20 cases, both pinned
native tools enabled) before claiming that the entire composition suite passes.
