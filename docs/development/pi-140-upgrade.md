# Pi 1.4.0 consumer candidate

This candidate updates only the native Pi integration and consumed packages.
Native Codex, Claude, Cursor and Grok adapters retain their current implementations.
The Browser is not required to change to install these Pi packages.

| Package | Selection |
| --- | --- |
| Pi coding-agent / ai / agent-core / tui | 1.4.0 |
| Official subagents / web / Antigravity | 0.81.0 / 0.44.0 / 0.11.0 |
| Upstream BlockedPath pi-xai-oauth | 1.7.3 |
| Coffee Harness / LSP / Handoff | 0.3.4 / 0.4.8 / 0.2.0-experimental.7 |
| MISHU | 0.4.0-experience.2 |

Candidate Gitea release URLs and lockfile integrity make package installation
reproducible before final plugin releases. Final namespaced plugin tags remain a
separate publication step. Pi source PR #80 and MISHU PR #18 are not merged by this
upgrade. The earlier candidate could not publish to GitHub while its task authorization was unbound; current publication must be verified independently.

Pi >=1.2 sends custom-message runs through before_agent_start. Preserve Host
report-only tool restrictions and their correlation IDs for those events; only real
user input resets them. The native regression first reproduced a forbidden Bash
execution, then confirmed the repaired block without creating its marker file.

Subagents 0.81 uses a bundled public entry. Find its package manifest using Node's
findPackageJSON, rather than treating the entry's directory as the package root.
Keep native RPC, child version matching, cancellation and background settlement.

Host selects package roots explicitly. Include exactly one pi-xai-oauth root by
default, with PI_COFFEE_XAI_OAUTH=off available for rollback. Do not run the upstream
setup wizard that changes the default model; retain native user model/provider and
credentials. /login xai-auth is the package's OAuth path. Package registration and
an offline fallback model catalog do not establish account entitlement or a live
xAI reply. Optional xAI network/media tools retain upstream opt-in behavior.

The owner chose activation after existing tasks settle. The deployment worker
requires repeated passive observations of no running/queued/waiting tasks and no
native background child, retains configuration and the previous deployment, and
checks Host health after restart. Activation failures restore the previous
configuration/release; no native input is replayed. Installation, source publication,
validation and activation receipts are separate.

Initial complete checks retained failure evidence: stale fixture versions/package counts,
old subagent entry assumptions, local test timeouts under parallel load, and a
transient MISHU observation snapshot race. A single 20 ms retry of an unknown native run read avoids transient append windows without accepting stale evidence; persistent failure remains uncertain. Relevant repaired cases are rerun with
bounded concurrency. Native live probes reached eidolon but returned HTTP 503
twice; online model success is not claimed. Private logs and generated runtime
receipts remain outside the repository.

## Rebased maintenance candidate (2026-10-29)

Integrated by normal merge into current GitHub main, retaining v0.56 workspace
and scoped GitHub account fixes and the current single-VM topology docs. The
previous automatic activation recorded a rollback and did not retain its exception;
its root cause is not established. Do not reuse its activation worker or overwrite
current PATH with its historical Codex pin. Validate the combined release and
prepare an explicit next-restart switch.

Pi native catalog coverage verifies Muse and both DeepSeek V4.1 Flash providers
without generating model turns. See the current native-engine model contract.
DOMPurify 3.4.17 and Vitest 4.1.12 address advisories found during this refresh.
Production credentials, backups and deployment receipts remain outside source.

## Pi 1.6.0 and Server 1.09

The Host pins the four native Pi packages to 1.6.0, Harness to 0.3.5,
LSP to 0.4.8, Handoff to 0.2.0-experimental.8, and MISHU to
0.4.0-experience.3. The explicit package roots also load subagents 0.89.2,
Web Access 0.48.0, Antigravity 0.15.0 when its models are enabled,
XAI OAuth 1.7.3-coffee.1, and GoalPlus 0.1.1. `PI_COFFEE_GOALPLUS=off`
disables GoalPlus at the Host package boundary. The lockfile records the digest
for each candidate artifact.

The Pi native backup audit, Host adapter and stored custody receipt accept the
qualified 1.6.0 SDK alongside 1.1.0 and 1.4.0. The SDK must read a format-3
session under the authorized root without rewriting its stored bytes. Host
acceptance covers capture and restore, resume and reconnect history, direct
Handoff, and a subagent using the same native version as its parent.
