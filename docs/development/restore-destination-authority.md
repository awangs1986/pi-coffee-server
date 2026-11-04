# Restore destination qualification

Candidate repair for Server #130/#133/#134/#141, under the accepted trusted Host
root boundary. It does not activate production recovery or grant application
administrator permissions.

Source history completeness and destination ownership are separate. A Host
restart after loss of its last native history cannot produce a new source
checkpoint before restoration. Ordinary Pi/Codex restore planning and publication
therefore use a dedicated `TrustedSourceAuthority` destination capability. Capture,
source export, replacement safety checkpoints and native binding inventory retain
the existing source proof.

The destination method rereads current actor authorization and validates the
configured scope, exact source configuration/graph, root identities, sole Host
producer, current process identity and unchanged authority journal. An earlier
Host must be demonstrably gone. Only exact tagged local operations with proven
dead owners can coexist with this destination attempt; delegated, untagged, live
or negative-coverage records remain unavailable. Those operations are preserved,
not cleared or replayed. Source qualification stays unknown until normal native
history/closure verification seals an actual source checkpoint.

Planning holds a revocable physical EX cut. Publication reacquires the real
physical publication lease and binds a private fsynced destination receipt to the
restore actor, scope, operation ID, revision and digest, original enrollment and
journal, and preserved local owners/death observations. The receipt is not an
approval grant. RestoreCoordinator's current authorization, exact revision/digest
approval, repository pins, target preimages and durable publication gate remain
mandatory. Replacement still requires the independent fresh source safety point.

A truly fresh destination can be allocated before any native launch. Its private
custody allocation marker is bound to the new owned directory inode and group
lock and is committed into fresh enrollment. Native `prepare` consumes it durably
before any launch receipt or subprocess. This permits a real destination EX with
no fake native history or no-op subprocess. A used, missing, changed or corrupted
marker, replaced directory, or unresolved launch never requalifies as pristine.
The private fresh token is issued only inside the actual validated authority and
checked against the same physical fence; shape-compatible objects do not count.

Missing descendant target paths are checked against a canonical, same-device,
owned enrolled ancestor. Existing enrolled roots cannot be replaced implicitly.
A lost root requires explicit new fresh authority/configuration, preserving prior
control evidence; there is no old-journal reset or arbitrary path relocation.
Native restore checks still compare the checkpoint's original workspace/native
mapping before preparing files or databases. Native provider credentials and
historical configuration remain inert/reconfiguration-only.

After fresh restoration, automatic qualification performs an actual owned native
history audit before the first cold source cut, including when a legitimate
Codex version probe already left quiescent custody. No viewer or provider prompt
is required. The owned audit consumes the fresh marker and produces ordinary
current native observation/terminal receipts; it does not stop user sessions.

## Focused evidence

The initial existing-loss authority test failed because no destination method
existed. A fresh-empty test then failed at physical custody. Both pass after the
separate capability. Three initial authority cases plus source/fence/native audit
regressions passed 35 tests in four files with build passing; eight expanded
boundary scenarios pass separately. Three meaningful production mutants (final
authorization, consumed allocation, original root identity) each failed a behavior
assertion and were restored; no compile errors were counted as kills. They cover retained dead-local operations,
current authorization (including withdrawal before commit), scope/config/root
drift, active/opaque work and consumed/lost allocation. Actual HTTP last-task and
entire-source loss, native readback and no-viewer recapture are assigned to the
separate ordinary-main tracer. These local authority results alone do not claim
complete publication acceptance.

All validation uses synthetic temporary sources and isolated resource-capped
units. No provider call, production backup/restore, service restart or real disk
operation was performed. Canonical, independent review and release acceptance
remain the integrating workflow's gates.
