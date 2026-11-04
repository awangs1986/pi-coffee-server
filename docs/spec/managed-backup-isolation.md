# Managed backup execution profile (candidate)

**Current decision (2026-10-29):** [trust Host root and preserve native permissions](../reviews/backup-trusted-root-20261029.md).
This managed profile remains experimental history; its namespace, identity and
provider-transport installation are not prerequisites for ordinary backup.
Source consistency and current account authorization still require evidence.

The protected profile is an experimental implementation in draft #130. On
2026-10-28 the owner selected preservation of existing native permissions; this
mandatory confinement is not an accepted prerequisite for backup. See the
[permission reconciliation and replacement-design constraints](../reviews/backup-native-permission-20261028.md).
The sections below describe the existing candidate, not approval to change NE-04,
GW-01 or the two-user permission contract. Installing source does not activate
the profile. No real service identities or production migration were performed.

`ManagedNativeCustody` mechanically launches native execution through mandatory Bubblewrap user/mount/PID/network/IPC/UTS/cgroup namespaces, no-new-privileges, zero capabilities, and disabled nested user namespaces. The trusted supervisor opens identity-checked source directory FDs; only those grants and explicit immutable runtime roots are mounted. Host root/home/run/procfs, user/system buses, SSH agents, Host controls and backup keys are absent. There is no unrestricted fallback.

A private PID1 reaper waits for all descendants, including setsid/double-fork writers, even after the original native process exits. The trusted outside supervisor holds the source group's real shared kernel lock for that whole lifetime. Loss of custody retains an unknown record; it does not prove a cold source. Backup never signals a native task to create a cold window.

`ManagedWriterFence` combines the existing synchronous Host admission epoch with actual shared/exclusive kernel leases. New platform work synchronously invalidates and releases a capture's exclusive lease before mutation. Final source validation and atomic publication remain in the same synchronous Host segment while the kernel lease is held. A native descendant independently retains its shared lock after a Host session wrapper releases, so capture cannot outrun its writes. Unsupported writer classes are refused.

`ManagedLaunchPolicy` switches service-wide future admission from legacy to draining before enrollment. Existing legacy lifetimes continue; future unrestricted launches are denied immediately. It reaches protected-only only after all concrete lifetimes naturally exit. Lost/unknown custody blocks the transition; a service restart is not evidence that unknown writers stopped. Startup must create and use this policy before any native factories, including deferred engines.

The experimental implementation requires a dedicated no-login/no-sudo service principal with a private 0700 source parent. Backup key custody uses a different service principal. A model child shares only its approved group directory FDs inside the namespace, never the parent's path hierarchy or control sockets. Ordinary same-UID host helpers remain outside the trusted principal policy. Existing root-capable model/native executors must naturally drain before activation; trusted human root remains outside this threat model.

Protected execution removes arbitrary host IPC, SSH/service handoff, sudo and unrestricted network. Provider connectivity requires a qualified narrow model broker, with explicit endpoint/operation constraints and no Host-control or arbitrary CONNECT route. Offline state/read/resume tests establish native runtime compatibility, not provider transport or model-output quality. Until deployment, global admission wiring and provider broker qualification are complete, this primitive layer alone does not authorize production source coverage.

Actual tests use private synthetic roots: kernel source-FD writes, secret/proc/bus denial, no-new-privileges/capability/nested-namespace checks, detached writers and cut invalidation. The real pinned Pi reads/resumes native JSONL; explicit `PI_COFFEE_TEST_CODEX_ROOT` enables the real pinned Codex app-server ordinary-thread read/resume test. Neither test submits a model turn. Dedicated real service-UID deployment remains unverified here; no account creation or security-setting changes are part of software verification.

## Concrete source and provider integration

The experimental implementation and its configuration are documented in [managed-source-authority](../deployment/managed-source-authority.md). Source qualification uses actual independent process identities, a live natural-drain handoff and namespace probes. The source Host automatically refreshes cold checkpoints; capture remains subordinate to source writer admission. Recovery publication uses a distinct physical group lease and optional trusted-importer FD inheritance.

`provider-broker-worker` is an independent hardened service entry point with pinned Pi ModelRuntime and Codex0.159.1 native auth RPC loaders, model/endpoint allowlists, current credential reload and native OAuth rotation. The exact pinned provider socket is authenticated outside the user namespace and mounted by FD. Pi receives a safe catalog projection and nonsecret placeholder auth; Codex receives a same-provider HTTP overlay. Synthetic local upstream/refresh fixtures and actual native SDK/RPC are distinct from production provider acceptance. Trusted cold-enrollment maintenance software includes mechanically checked read-only block export, typed Pi/Codex root relocation, exact staged checkpoint export to the scoped key broker, and durable approved account/native recovery; see [cold legacy enrollment](../deployment/cold-legacy-enrollment.md). Real service-principal installation, the legacy cold snapshot/export view, and complete production enrollment acceptance remain explicit deployment/integration gates.

Shared-group materialization enforces the trusted byte budget while accumulating actual in-memory source buffers and stops before exporting the next child when exhausted. The coordinator still counts path-tree bytes/files during copy. These are material/output bounds; temporary per-adapter JSON parsing and the rest of the JavaScript heap require the documented process/cgroup memory limit.
