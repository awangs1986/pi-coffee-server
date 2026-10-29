# Backup trusted-root decision — 2026-10-29

Status: accepted product trust boundary; implementation and integrated acceptance remain open.
Parent: [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130).
Reviewed baseline: `3bbbfa4b0a4b830a12600908b7f3815909d21621`.
GitHub and Gitea main fetched on 2026-10-29 both resolve to
`21f856b60c99b1c06bb312743ba69a4a9f69868c`.
This is source/design evidence, not an installed backup or deployment receipt.

## Accepted boundary

The owner explicitly chose to trust the existing Host root. Version one protects
against accidental deletion, data corruption and source-disk loss; it does not
promise secrecy or integrity against an executor with Host root privileges.
Existing native permissions, environment, HOME/configuration, tools, Git/gh,
network, Skills and runner workflows remain available. Backup does not require
mandatory namespaces, no-sudo, no-network or a new command sandbox. A separate
VM or external root-proof key authority is no longer a prerequisite.

The independent repository service remains responsible for keys and Restic jobs.
Normal model/application APIs, status, errors, logs, transcripts and Issues must
not deliver repository secrets. Keys remain in private runtime storage outside
source/task trees and backup targets. Explicit current-administrator offline
recovery export is the narrow exception, with a verified offline copy required
before enabling daily protection. Private service files and kernel peer identity
are defense in depth, not protection against trusted root.

Application administrator and account authority still come from current private
service configuration and authenticated actor/scope grants. Linux UID, sudo/root,
a supplied actor string or a previously restored role do not grant application
administration. Cross-account data and credentials remain isolated at the
application boundary. A same-UID socket caller is not by itself the Host.

This decision supersedes the root-adversary interpretation and unresolved
external-authority placement in the [2026-10-28 review](backup-native-permission-20261028.md).
That review and its actual failures remain historical evidence. It does not
supersede #130 decisions 36–40 or the requirement for complete consistent cuts.

## Separate repository readiness from source capture

Repository configuration, protected export, offline-copy verification, extraction
of existing points and retention pins must not depend on current source idleness,
managed namespaces, protected-only admission or the newest source revision.
Creating a new source point still needs a qualified cut. Consuming an already
sealed point must select its exact checkpoint ID, verify complete manifest/member
coverage, object hashes, scope and current authorization, and preserve its
original capture time. A newer point must never silently replace a selected one.
Restore extraction is not permission to publish; destination writers, current
approval, exact plans, durable intent and conflict checks remain independent.

## Source consistency is still a required implementation gate

Ordinary descendant custody can hold a real shared lock from before native spawn
until all adopted descendants naturally exit. Capture takes the corresponding
exclusive lease; new writer admission revokes capture before side effects.
This must preserve the process environment and permissions and must not stop a
native process, shorten its idle timer or disconnect viewers to manufacture a cut.

Advisory locks and descendant custody do not cover unrelated daemons, shared
native clients or service/remote delegation automatically. Qualification requires
an explicitly enumerated trusted writer-authority contract, actual admission and
durable outstanding-operation evidence for each source producer. Operator-owned
topology assumptions must be recorded separately from verified facts. Unknown
producers, pending/untracked delegation, source/root/graph drift, lost custody and
unreadable evidence keep the affected group unknown. Operations may continue;
backup must not disable them to claim coverage. A clean process/FD scan, source
ownership marker, matching hashes or caller-provided Boolean is insufficient.

First and later Pi/Codex cuts, source export, exact-point scheduler consumption,
Restic round-trip and native recovery must be demonstrated with ordinary
permissions. Permanently reporting unavailable is not Pi/Codex delivery. Shared
stores and historical engine bindings retain their full dependency closure.
Actual deployment topology qualification remains distinct from synthetic fixtures.

## Baseline and remaining work

At the reviewed baseline, `src/main.ts` still returns
`writer-enforcement-unqualified` for ordinary capture, and repository readiness
in `src/host/backup-key-service.ts` still depends on the managed source handshake.
`src/host/native-custody.ts` has ordinary descendant custody but physical source
leases are tied to the experimental managed path. These are implementation gaps,
not accepted permission restrictions. New implementation slices are under review;
this document does not claim their tests or integration have passed.

Retain the exact canonical failure and targeted followups in the 2026-10-28
review. Do not rerun the expensive complete suite merely to validate this product
decision: run affected checks for implementation slices, then canonical checks,
Browser acceptance, independent Standards/Spec/Security review and fresh clone
on the final compatible candidate. PR #142 stays draft; all active tickets remain
open. No production backup/recovery, service restart, security/principal change,
real-disk action, provider model turn or deployment is authorized here.
