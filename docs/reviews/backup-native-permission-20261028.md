# Backup permission reconciliation — 2026-10-28

Status: **implementation draft; permission-boundary redesign required**.
Parent: [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130).
Candidate reviewed: `3bbf0e6a79dec4f08594c4d69f67f65078ae8297`.
GitHub and Gitea main were fetched as
`21f856b60c99b1c06bb312743ba69a4a9f69868c`. This is source evidence,
not a deployed release or a production backup receipt.

## Owner decision and retained requirements

On 2026-10-28 the owner selected **保留现有原生权限**: preserve existing
native permissions and redesign backup trust and consistency boundaries. The
alternative of adding a restricted execution mode was not selected. Mandatory
namespace confinement is not an accepted prerequisite for this feature.

This confirms existing requirements rather than relaxing them:

- [NE-04](../spec/native-agent-engines.md): “No new PI Coffee command sandbox or
  approval tier is introduced.” NE-03 preserves Pi configuration, plugins and
  tools without injecting Pi customizations into Codex; NE-16 permits ordinary native Git.
- [GW-01](../spec/gitea-workspaces.md) retains owner sudo and forbids using
  `NoNewPrivileges` to block required elevation. Destructive operations still
  follow the user's approval requirements.
- [Two-user separation](../spec/multi-user-workbench.md) retains unrestricted
  native permissions and describes trusted-user application separation, not an
  OS sandbox between processes sharing a Linux UID.
- Parent #130 decision 38 forbids disabling native functionality to manufacture
  writer-coverage evidence. Decisions 36–37 require a valid consistent cut;
  unknown writers cannot be called protected. Decision 41 requires “普通用户、模型、浏览器常规状态及 Issue 不接触密钥”;
  only the administrator may use the explicit protected offline-recovery export.
  This restriction is not reduced to an interface-only promise.

The current [single-VM topology](../architecture/topology.md) does not supersede
these permission requirements. Preserving the old mode only when backup is
disabled does not establish parity for tasks enrolled in backup.

## What the candidate actually does

`src/main.ts` constructs mandatory `ManagedNativeCustody` for the managed profile.
`managed-native-profile.py` isolates network, mounts and process visibility,
removes capabilities and enables no-new-privileges. `ManagedLaunchPolicy` retires
future unrestricted execution. These are real implementation choices, not merely
test fixtures; they conflict with the retained permission contract.

The Host Git repair executes workspace Git inside custody and uses a scoped
smart-HTTP transport. Actual clone, diff, checkpoint push, empty-repository
initialization and continuation tests pass at its tested candidate. Native
Pi/Codex Git/gh do not inherit that transport. Provider/read-resume tests do not
establish native tool parity.

Additional static gaps include network dependency installation and Pi web access,
runner/SSHME configuration moved outside native grants, and Host/native Skill
discovery using different homes. The shared machine Skill library contract must
remain intact. SSHME targets the user's computer; it does not itself require
remote processes to write the source Host. No blanket requirement for arbitrary
browser debug ports or every possible network protocol was inferred.

## Revised design constraints

The independent backup service, authenticated PI Coffee entry points, Pi/Codex
adapter boundaries, Restic storage, daily schedule, retention, administrator
approval and resumable recovery remain in scope. Existing tested components are
retained for review; this decision does not erase their history or deploy them.

The replacement source design must meet all of the following before #131/#132
and final acceptance can close:

1. Preserve actual native tool and permission workflows. Do not replace them
   with a restrictive profile and label that equivalent behavior.
2. Define backup/key authority outside any privilege domain controlled by native
   execution if the design claims mechanical separation from that execution.
   Another process or UID on the same root-controlled Host is not that boundary.
   A VM also needs an explicit ownership/control boundary; the word VM alone is
   insufficient. No new placement or security installation has been selected or
   qualified by this source review.
3. Establish an observable Pi/Codex consistency protocol independently of the
   rejected execution restriction. A filesystem snapshot, identical hashes,
   successful copy or operator-provided Boolean does not prove the complete
   native/registry cut. Keep current writer coverage and version-specific graph
   validation requirements; missing evidence remains unavailable/stale.
4. Produce and restore the first complete checkpoint for both engines, then
   demonstrate later cuts with normal native activity and unchanged privileges.
   Retaining an old point is correct during activity, but is not an implementation
   substitute for ever producing a qualified initial point.
5. Keep administrator authority current, secret export explicit and protected,
   account boundaries intact, and recovery/retention approvals bound to exact
   plans. Do not silently weaken key or authorization requirements to compensate
   for the permission conflict.

These constrain the next design; they are not an implemented replacement capture
protocol. Trust placement and its consistency proof remain open. Real disk
provisioning remains the owner's responsibility, not a software development
blocker. No production restart, migration, principal creation, security change,
provider round or deployment is authorized by this document.

## Executed checks and remaining failures

At exact `3bbf0e6`, canonical `npm run check` passed lint/build, then its main
Vitest phase reported **245 files passed / 10 failed; 1472 tests passed / 12
failed; zero skipped**. Duration was 2888.61 seconds. The separately gated
runtime-temp and browser phases were not reached.

- Nine socket failures used paths of 112–124 UTF-8 bytes, exceeding the AF_UNIX
  pathname limit. With the same source and tests and only a short private temp
  root, the affected eight files / 25 tests passed. Preserve the original failure;
  this comparison is not a passed canonical run.
- Three Codex refusal cases expected a persistent pending-publication marker,
  while the implementation returned none. The original failures are retained;
  the subsequent assertion correction and stronger checks are recorded below.
- Separate Git long-path followup `0e7e47f1ba739af6a60ab5179e5eab888e0c3b71`
  has two files / ten tests passing under the long-path reproduction and a passing
  typecheck. It was not part of the canonical commit above.
- Earlier component and targeted integration passes remain scoped to their exact
  commits. They do not establish a passing final candidate, fresh clone, native
  capability parity, distinct-identity installation or qualified cold enrollment.

The 45-story / 40-ticket-criterion inventory must retain the permission conflict
and these final gates. PR #142 remains a draft; no tickets are closed or
acceptance boxes checked by this reconciliation.

## Retained-component followup

Independent normal integration at
`f513d87125b2b5fc0c4f8970174768d1e75f2ab7` includes the Git long-path repair,
permission-document correction and Codex assertion followup
`fd8b5aa2cf6f58ff2250ba450a1e603d9ee353d8`. Build passed, followed by six complete
test files / 19 tests passing with zero skips and explicit Restic/Codex runtimes.
The scope was Git boundary/transport, Codex replacement/rejections, the durable
publication gate and documentation. This was not another canonical or fresh-clone
run, and it did not execute the browser phase.

The three obsolete Codex assertions now check that preflight refusal preserves
registry bytes, workspace/native trees and SQL rows, and admits a later healthy
writer. The existing post-intent restart test still requires writer exclusion.
An intentional early durable-intent mutation was rejected by the new test and
restored. No production recovery code was weakened to obtain these passes.
The permission-preserving source/key architecture remains absent; these results
do not close that requirement.
