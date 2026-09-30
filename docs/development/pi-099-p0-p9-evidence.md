# Pi 0.99 P0–P9 candidate evidence

Date: 2026-09-30. Delivery: dependent Gitea PRs; owner merges main, then mirrors
GitHub. No production service was restarted and no main branch was merged.
This record describes a pre-merge candidate, not completed P10 deployment.

## Baseline and candidate composition

| Surface | Observed baseline | Candidate |
| --- | --- | --- |
| Server source and owner Host release | 8ee54e3b273dcda26f61c4c2a7c08c6650bda740, root Pi 0.99.1 | Same native adapters, public RPC completion repaired |
| Plugin source | b9063e4f003fcf13f1b0cc934a3500655dfb55a3 | Maintained monorepo Harness 0.2.0-rc.1 |
| Selected child runtime | Legacy aggregate resolved Pi 0.87.1 | Upstream child actually reports 0.99.1 |
| Default local terminal | Pi 0.86.1 | Separate candidate executable 0.99.1, no global replacement |
| Web / delegation plugins | 0.27.0 / 0.63.0 | Original upstream 0.34.0 / 0.73.1 |
| LSP / Handoff | 0.4.4 / 0.2.0-experimental.3 | Unchanged artifacts, compatibility checked |
| Historical aggregate | pi-coffee at 1ec49a9 | Removed from dependencies and active imports |

Read-only SSH inventory attempts to linux001 (192.168.100.217) and linux002
(192.168.100.218) both returned No route to host on this date. Their installed
versions and health remain unverified; no remote deployment was attempted.
Keep the prior immutable releases and private configuration for P10 rollback.

## Acceptance by task

| Task | Implemented contract and evidence |
| --- | --- |
| P0 | Both clean branches started from equal GitHub/Gitea main SHAs above. Installed/selected/probed identities are distinguished here. Remote deployment inventory remains a P10 gate. |
| P1 | Public prompt/steer/followUp return dispositions replace the private RPC cast. Native handled commands settle Host input only when no model run is active. Red test failed on missing settled events; public Web/Host/native package test sends two commands then a model request. |
| P2 | Root Pi family stays exactly 0.99.1. prepare-terminal-pi creates a separate official-npm candidate, preserving credentials and global executable selection. Children select the parent's package root. |
| P3 | Host passes package roots, not extension internals. --no-extensions prevents discovered/configured duplicate executors; explicit roots still load extensions/Skills/prompts natively. Explicit package off switches and replacement lists remain available. User/project Skills and context stay native. |
| P4 | Original subagents 0.73.1 starts an actual child, whose Bash output identifies Pi 0.99.1. Complete, active, stop and idle states are observed through upstream public RPC. No private schema rewriting or Coffee scheduler. |
| P5 | Original web 0.34.0 executes Serper against a synthetic HTTP fixture, returns bounded text and retrieves source text by responseId. A real model request receives the bounded result. Empty/error results create no additional Coffee evidence. Permanent session deletion removes its own artifact directory. |
| P6 | Harness native-package tests cover install, mode restore/switch, missing optional plugins, tool schemas, result pointers and public fleet state. Work uses upstream loaders; search_tools remains for readiness/trust and LSP. |
| P7 | Existing LSP public CLI/native tests cover semantic query, diagnostic success/error, daemon cleanup and package installation. TS/JS, Python, C#, C/C++, Rust and Go profiles remain. This is not an all-language deployment certification. |
| P8 | Existing Handoff tests cover native automatic compaction, same-session manual commit, recovery and visible failure. Public Web/Host test completes LSP then Handoff and reconnects. Completed native web reaches Handoff synthesis; the intentionally invalid fixture synthesis cannot commit. Numerical attribution moved to Harness. |
| P9 | Aggregate dependency and runtime imports removed. Old child executable env overrides cleared. Maintained public exports supply context types and observer. Clean installation and reviewed-root loading protect the selected composition. |

## Intentional boundaries

- Native Pi tool_search only searches deferred/codemode exposure. It cannot replace
  Coffee readiness/trust discovery without changing policy; codemode stays off.
- Original upstream concurrency replaces the former Coffee 3/5 limits. Consult
  upstream subagents configuration for scheduling; no claim of identical limits.
- Web policy is dynamic activation, maxInlineContentChars=6000, workflow=none.
  includeContent=true and generated-summary workflows are rejected because their
  background settlement is not observable through a verified public API.
- Long web/delegation text is an excerpt capped at 8000 characters including an
  original-evidence pointer. It is not a generated semantic summary. Native web
  responseId retrieval remains preferred. Failed/empty upstream diagnostic session
  records may remain; Coffee does not create additional research artifacts for them.
- Chat retains its existing search-only boundary; extended web retrieval requires
  Work. LSP and Handoff versions are unchanged because compatibility tests pass.
- Core native Codex/Claude adapters, auth, routing, workspace and UI layout are
  preserved. Paid-provider quality, browser rollout and remote VM health are P10.

## Installation and rollback

The Server PR contains an immutable candidate Harness tarball plus SHA-256 and
source provenance under vendor/. Merge the Pi source PR first, then the Server PR.
Use npm ci; do not point production at a mutable source checkout or latest.
For a terminal candidate, run scripts/prepare-terminal-pi.mjs with a new absolute
runtime directory. It selects the official npm distribution at 0.99.1 and registers
package roots with native pi install. scripts/configure-native-pi.mjs preserves
provider credentials and package resource filters, and keeps private backups.

Host explicit roots are the execution authority. The configuration helper retires explicit extension paths owned by replaced
packages; unrelated user entries are preserved and not executed implicitly by Host; operators
can opt them into PI_COFFEE_EXTENSIONS after review. This migration does not rewrite
project settings. Remove obsolete live service overrides during P10; candidate
child launch already ignores them. Rollback selects the prior immutable runtime
and configuration; do not delete Conversation/session/workspace data.

## Security review

A separate read-only review found no new blocking authentication, scope, credential,
or data-access issue. Exact overrides resolve newly introduced undici advisories
with 8.11.2 and fast-uri with 3.1.8. npm audit still reports one high entry for
brace-expansion 5.0.9 bundled inside upstream Pi 0.99.1. It predates this change;
a root override cannot repair the embedded bundle. Track the upstream patch and
do not describe this dependency audit as clean.

## Verification results

Working-checkout checks: Server 44 files / 320 tests passed. Pi plugins: Harness
49 unit + 4 installed-package tests, LSP 81 unit/integration + 1 package test,
Handoff 89 tests, plus 2 monorepo artifact tests passed (226 total).
The terminal candidate at /home/awang/share/pi-runtime-candidates/pi-099-p0-p9
reports Pi 0.99.1 and registers exactly five reviewed package roots.
Harness source commit: 3b1680a3e002a08f461ce8b09aa7d33309873d7b. Its candidate
archive SHA-256 is bfc45e82b3bbe7b4475b64b40cb00c53bda3ab1ee9d10ba5a366014168d7ebe8.
Final fresh-clone verdicts are recorded in the Gitea PRs. Synthetic providers replace paid model/API access;
no real search credential or user transcript is included in test fixtures.
