# Conversation Fork

Owner decision, 2026-10-03. [Server #39](https://github.com/awangs1986/pi-coffee-server/issues/39). A Conversation Fork is a new task, not a code-forge repository fork.

## Interaction

Place Fork beside Rename and Archive in each Conversation menu. A dialog offers:

- **Traditional Fork**: preserve the active Agent's native context through its native fork API. No model preparation turn.
- **Handoff Fork**: prepare a new branch using handoff context. Experimental: may drift or omit information and incurs model usage. Explicit dialog confirmation is required.

Both create a new Conversation and independent local folder, retain the source Agent and its model/thinking/context selection, and preserve project/GitHub binding. Chat retains its selected Pi or Codex engine under the accepted repository-free Chat contract. Fork does not switch Agents; takeover remains a separate feature. Show unavailable native modes as disabled with a reason, never silently substitute a different method.

The owner explicitly chose copying the current local state: tracked/staged/unstaged changes, untracked project files and task attachments are retained in an independent clone/data folder. Git metadata and known dependency/cache directories are excluded from filesystem copying. Preserve staged versus unstaged changes. Unresolved Git merge conflicts and nested Git repositories/submodules require separate handling before creating the snapshot; they are rejected instead of producing a partly shared checkout. Internal links are retargeted within the new copy; external links are rejected rather than sharing writable files. A clone uses its own task branch; no implicit push, checkpoint, remote repository creation or commit.

## Lifecycle

The accepted [durable task preparation refactor](task-preparation.md) replaces the
scattered orchestration with one Host-owned operation lifecycle, implemented
since Server 0.94. Preserve the product/source protections below; the preparation
contract governs durable acceptance, budgets, cancellation and recovery.

Source must be an owned, active, ready task with settled foreground/background work, no unanswered questions and no queued input. Lock source and destination against conflicting Web operations while preparing. Fork does not rewrite source conversation messages, compact its context, change its binding/branch or edit its files. Routine native inspection may append internal bookkeeping entries. The new task records source, mode, phase, model settings and progress. Same operation ID is idempotent; never regenerate after delivery uncertainty. Source remains usable after a failed fork; retain destination diagnostics/files for inspection and archival. Host restart marks unfinished preparation interrupted instead of continuing model work automatically.

## Native integration

Pi uses native SessionManager.forkFrom with a new ID and cwd. Handoff invokes the pinned context-handoff plugin only inside that copy. The source session is never compacted. Codex uses native thread/fork with source ownership checked and cwd changed to the new task. Codex Handoff uses an isolated native fork to generate a handoff, then starts a fresh target with the summary and original-evidence pointer. Handoff instructions adapt the installed Skill: preserve goal, accepted/rejected decisions, pending questions, changed files, verification and next actions; redact credentials, reference existing artifacts, suggest relevant Skills. Preparation must not resume project work. Codex summary and seed runtimes disable shell/execution, external tool providers, plugins and hooks, and enforce native read-only/no-network policy; unexpected tool events fail preparation. They are closed before normal task reopening, which restores ordinary execution policy.

Claude native complete-context fork is not claimed without a verified native interface; Handoff embeds the readable exported history in a fresh native session with built-in tools, MCP, slash commands and hooks disabled. Exports over 1 MiB are rejected without truncating evidence; the source and failed snapshot are retained. Normal reopening restores ordinary tools. Raw provider transcript formats are never fabricated or translated into another provider's tool-call protocol.

## Acceptance

Verify HTTP/WS user scope, idle/question/queue gates, current code/attachment isolation, unchanged source history/branch, duplicate suppression, native-history continuity and settings, Handoff failure/restart retention and the two-choice browser dialog. Run npm run check and independent reviews before publication. Source publication and production activation are reported separately.

## Bounded workspace copy under ordinary writer custody (2026-11-05)

Server 0.83 aligns the ordinary Git executor with Fork's existing 32 MiB staged binary patch budget. The caller and executor share one maximum; ordinary commands keep their smaller per-call limits. A genuinely oversized staged patch fails with an actionable error, releases the source lifecycle lock, preserves source data and retains the failed destination record; it never invokes native handoff preparation. No unlimited buffers or model retries are introduced.

The browser reconciles completion/failure through the existing workspace refresh path. Reopening the Fork dialog shows the persisted source preparation/failure status, including after a page reload, instead of erasing the failure. Closing the dialog does not cancel or repeat Fork. Existing uncertain-delivery retries retain the same operation ID. This fixes a preparation rejection, not arbitrary network disconnections or model-provider failures.

Regression acceptance composes the real HTTP Fork endpoint with PersonalBackup's ordinary writer custody and physical fence for both modes, verifies staged/unstaged separation, verifies a binary patch between 16 and 32 MiB, and verifies bounded rejection above 32 MiB before native work. Browser-controller coverage checks durable error visibility without a new request. Synthetic adapters only; no live provider usage is required.

### Evidence and deployment status (2026-11-05)

Reviewed baseline: Server 0.83, `13e4636ea2b5874a1a65a01077ef3d20f5510955`, identical on GitHub and Gitea main. The documentation refresh itself is a local change after that baseline; it does not introduce runtime changes.

| Claim | Implementation and regression evidence |
| --- | --- |
| Shared bounded staged-patch allowance | [workspace-git-limits.ts](../../src/host/workspace-git-limits.ts), [ordinary-workspace-git.ts](../../src/host/ordinary-workspace-git.ts), `Workspaces.copyForkWorkspace` in [workspaces.ts](../../src/host/workspaces.ts) |
| Both modes operate with ordinary writer custody; oversized patches fail before native preparation | [conversation-fork.test.ts](../../test/conversation-fork.test.ts) |
| Reopened dialog displays persisted failure without replay | [fork.js](../../public/fork.js), [fork-ui.test.ts](../../test/fork-ui.test.ts) |
| Native context/settings continuity | [fork-native-http.test.ts](../../test/fork-native-http.test.ts) |

Executed release acceptance: both the reviewed checkout and an independent public GitHub clone passed 1,701 tests, with 136 optional tests skipped, plus 17 Chromium probes. This refresh inspected those recorded outcomes; it does not claim a new execution of the entire suite.

Actual activation is confirmed by the private operator receipt `fork-v083-20261105/result.json`: Web and primary Host started from the exact commit, Host reported normal mode, and served assets (including fork.js) matched the immutable release. No rollback occurred. [Server #39](https://github.com/awangs1986/pi-coffee-server/issues/39) records source and activation evidence. No real provider Fork was automatically replayed; live provider acceptance of a new user-initiated Fork remains separate from these synthetic regression and deployment checks. This change does not establish a universal Fork deadline or repair unrelated provider/network failures.

Documentation reconciliation, 2026-11-06: the Pi-only Chat restriction above has been corrected to match the already accepted [repository-free Pi/Codex Chat contract](native-agent-engines.md#repository-free-codex-chat--2026-10-08-server-98). This does not extend native Fork capability to an unsupported engine.

## Codex Handoff Fork preparation model (0.84, 2026-11-06)

The owner previously requested Codex handoff preparation to default to `gpt-6.1-sol` with `medium` reasoning. At deployed 0.83, that default was applied to Agent takeover but not Handoff Fork: both summary and seed turns inherited the source Conversation's model and effort. Server 0.84 applies sol/medium to these two temporary Codex preparation turns, then restores the source model/thinking/context selection on the new Conversation before normal use. Traditional native Fork, Pi/Claude preparation and manual in-place Codex compression are unchanged by this scoped fix. A protected provider that does not enroll the preparation model fails explicitly; it must not bypass its allowlist.

Each `forkTurn` still has a 180-second preparation deadline. It fails without automatic retries, stops its temporary runtime and retains the source and failed copy. Error text now identifies summary versus seed and the preparation model/effort. This is not a promise that sol will respond within three minutes or that the entire operation has one three-minute wall-clock bound; setup and two turns are separate phases.

Evidence: `NativeAgentFactory.forkConversationAdmitted` in [factory.ts](../../src/host/native/factory.ts), [fork.ts](../../src/host/fork.ts), and the public HTTP/native subprocess regression in [fork-native-http.test.ts](../../test/fork-native-http.test.ts). The regression was observed failing when preparation inherited the source model/high effort; it verifies the sol/medium wire requests, final source-setting restoration, and phase-specific failure retention without provider calls.

Observed production failure at 0.83: workspace copy completed; the retained temporary Codex rollout recorded astra/medium, task start and interruption approximately 180 seconds apart, without a completed summary. This supports a real preparation deadline expiry; it does not establish whether upstream latency, provider processing or another native issue prevented completion. At the time of that diagnosis, activation and a real provider retry had not occurred. Later activation and acceptance are recorded below; the failed Fork was not automatically replayed.

### Activation and acceptance update (2026-11-06)

Server 0.84 / `eb34dde7fb08420ac9501811482893f0c3215ddd` was published to
GitHub and Gitea main and activated for Web/Host. Normal-mode health, release
identity and served assets passed. One owner-authorized Handoff Fork subsequently
passed: independent workspace, saved summary, distinct native binding, WebSocket
open/history and retained final model/thinking/context. [Server #39](https://github.com/awangs1986/pi-coffee-server/issues/39#issuecomment-6681979218)
records the result without user transcripts.

Exact-source verification passed 1,703 tests, with 136 optional skipped, and 17
Chromium probes. Earlier concurrent runs encountered MISHU polling timeouts; the
isolated six-case recheck and subsequent sole canonical run passed. These are
recorded historical executions, not tests rerun by this documentation change.
At that historical 0.84 baseline, the [preparation refactor](task-preparation.md)
was unimplemented; it was implemented since 0.94. That one success does not
establish bounded end-to-end cleanup/recovery for every failure.

## Large conversation evidence (1.00, 2026-11-09)

Both Fork modes retain complete projected source evidence up to 256 MiB. This
replaces the 32 MiB conversation-history ceiling, which rejected long Codex
tasks dominated by completed tool output. It does not alter the separate
32 MiB staged Git patch budget, model context setting, preparation model or
summary limit. History is not silently truncated or reduced to recent messages.

Codex reads 20 turns at a time, checks active tools/background work on every
page, and discards raw pages after projection. Each native page and metadata
response has a 32 MiB ceiling; cumulative native data and saved history each
have a 256 MiB ceiling. Entry-sized hashing/writing and actual-file-sized read
buffers avoid allocating the maximum for small histories. Original ownership,
source consistency, digest, operation/stage deadlines and recovery gates remain.

The [preparation contract](task-preparation.md#large-fork-evidence-100) defines
persistence and failure semantics. [Review evidence](../reviews/fork-large-evidence-20261109.md)
distinguishes synthetic complete Fork tests and the original read-only source
inspection from production activation and real model acceptance. Old failed
operations remain diagnostic evidence and are never replayed automatically.
