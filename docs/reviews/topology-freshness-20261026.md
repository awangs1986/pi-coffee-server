# Topology freshness review — 2026-10-26

## Baseline and scope

Source: GitHub and Gitea Server main both at `1db8ab3e53b53754902b743700df340984967de8`
(v0.56), clean before this documentation change. Scope: current Web/Host deployment,
participant identity, storage/credential ownership, deployment entry documents and
historical architecture pointers. This is a documentation reconciliation, not a
new architecture decision, runtime configuration change or Pi-plugin audit.

Accepted decisions: [shared execution and source authority](../adr/0020-unified-github-authority.md),
[Pi package boundary](../adr/0021-pi-only-source-authority.md),
[completed same-VM cutover](../deployment/same-vm-migration.md), and
[complete two-user workbench](../spec/multi-user-workbench.md).
The maintained description is now [Current topology](../architecture/topology.md).

## Findings and disposition

| Finding | Disposition and source evidence |
| --- | --- |
| Main topology diagram implied separate machines and used login-name scoping, worktree storage and one engine per Host. | Rewritten around one primary VM, separate services, numeric/legacy scopes, task bundles, independent clones and native adapters. `src/main.ts`, `src/web/identity.ts`, `src/host/native/factory.ts`, `src/host/workspaces.ts`. |
| README and deploy entry documents treated same-machine and split-machine placement as equal defaults; current installation was not clear. | Chinese and English README sections, deploy/README and the repository map now identify same-VM deployment as current, with split/per-user machines optional. Fresh scoped examples remain valid and are explicitly distinguished from legacy-owner upgrades. |
| REQUIRE_USER instructions could exclude the existing default owner. | Current topology, README and release procedure point to the existing `legacyDefault` onboarding exception. No route or user directory was changed. |
| Domain-model and index introductions foregrounded October 17's v0.27 receipt. | Marked that baseline historical; recorded the current v0.56 observation and pointed readers to live release identity for future checks. |
| Historical MVP and ADR descriptions looked like current deployment requirements. | Added explicit current-topology/supersession notices; retained original decisions and acceptance evidence. Two differently named ADR-0010 files remain addressable by their existing links. |
| Web/Host content ownership could be interpreted as requiring different physical disks/machines. | Clarified the process responsibility: Host persists content; Web forwards without becoming a duplicate transcript/archive owner. Task storage remains governed by its existing specification. |
| Topology failure table promised valid cookies through Gitea outages and described native restart as a 0.1 gap. | Corrected to route-file session revalidation, explicit interrupted-work semantics and native durable-history boundaries. `Identity.authorize`, Host session/registry lifecycle and current native-engine contracts. |
| Release acceptance still said three Work engines and Pi-only Chat. | Replaced with configured available Work engines and supported Pi/Codex Chat; no claim that every engine/provider has undergone new live acceptance. |

## Read-only runtime observations

- Web and the primary workbench Host run on the same local Linux VM under the
  same OS account, using separate user services. Their observed release directory
  is the immutable v0.56 / `1db8ab3` release. The activation receipt records normal
  Host mode, successful health checks and matching served assets.
- Both primary units are enabled; user lingering is enabled. This is configuration
  observation, not a new reboot or power-loss test.
- Web shared routing is enabled. The existing owner uses an explicit legacy default
  scope; the second participant uses a numeric scope. Host retains default-scope
  admission. Task root/account mapping and local Host-to-Web renewal configuration
  agree with the maintained task-storage and onboarding contracts.
- Gitea remains an external service; this review did not relocate or reconfigure it.
  Native provider credentials remain native. No credential values, user transcripts
  or private route tokens are included in this document.

## Remaining operational boundaries

A historical test route and an additional legacy Host service remain configured;
the legacy service was observed active. They are not evidence that ordinary users
still require separate VMs. Whether they can be retired needs a separate inventory
of their consumers and data. This review does not remove them or claim they are unused.

The retired Web source's fencing is documented in the dated migration receipt.
This review did not contact that machine or repeat remote fencing/rollback tests.
An IP or hostname alone does not prove that a machine is still the original one.

Shared-UID execution remains trusted-user application separation. This review does
not upgrade directory or prompt rules into an OS isolation guarantee, cancel optional
remote Host support, or mark old multi-VM acceptance tasks newly completed.

## Verification

Reviewed source/configuration and live user-service metadata; checked documentation
links and the changed diff. No application code, credentials or deployment parameters
changed. No model calls, service restarts or application test suite were run for this
documentation-only refresh. The earlier v0.56 release verification is historical
supporting evidence, not a new test result produced by this audit.
