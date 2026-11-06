# Conversation Fork

Owner decision, 2026-10-03. [Server #39](https://github.com/awangs1986/pi-coffee-server/issues/39). A Conversation Fork is a new task, not a code-forge repository fork.

## Interaction

Place Fork beside Rename and Archive in each Conversation menu. A dialog offers:

- **Traditional Fork**: preserve the active Agent's native context through its native fork API. No model preparation turn.
- **Handoff Fork**: prepare a new branch using handoff context. Experimental: may drift or omit information and incurs model usage. Explicit dialog confirmation is required.

Both create a new Conversation and independent local folder, retain the source Agent and its model/thinking/context selection, and preserve project/GitHub binding. Chat stays Pi Chat. Fork does not switch Agents; takeover remains a separate feature. Show unavailable native modes as disabled with a reason, never silently substitute a different method.

The owner explicitly chose copying the current local state: tracked/staged/unstaged changes, untracked project files and task attachments are retained in an independent clone/data folder. Git metadata and known dependency/cache directories are excluded from filesystem copying. Preserve staged versus unstaged changes. Unresolved Git merge conflicts and nested Git repositories/submodules require separate handling before creating the snapshot; they are rejected instead of producing a partly shared checkout. Internal links are retargeted within the new copy; external links are rejected rather than sharing writable files. A clone uses its own task branch; no implicit push, checkpoint, remote repository creation or commit.

## Lifecycle

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

Documentation gap retained for reconciliation: the older “Chat stays Pi Chat” sentence predates the later repository-free Codex Chat design. This scoped budget/deployment refresh does not treat that sentence as evidence that all current Chat tasks are Pi-only, or certify a new Chat/Agent compatibility matrix.

## Codex Handoff Fork preparation model (0.84 candidate, 2026-11-06)

The owner previously requested Codex handoff preparation to default to `gpt-6.1-sol` with `medium` reasoning. At deployed 0.83, that default was applied to Agent takeover but not Handoff Fork: both summary and seed turns inherited the source Conversation's model and effort. The 0.84 candidate applies sol/medium to these two temporary Codex preparation turns, then restores the source model/thinking/context selection on the new Conversation before normal use. Traditional native Fork, Pi/Claude preparation and manual in-place Codex compression are unchanged by this scoped fix. A protected provider that does not enroll the preparation model fails explicitly; it must not bypass its allowlist.

Each `forkTurn` still has a 180-second preparation deadline. It fails without automatic retries, stops its temporary runtime and retains the source and failed copy. Error text now identifies summary versus seed and the preparation model/effort. This is not a promise that sol will respond within three minutes or that the entire operation has one three-minute wall-clock bound; setup and two turns are separate phases.

Evidence: `NativeAgentFactory.forkConversationAdmitted` in [factory.ts](../../src/host/native/factory.ts), [fork.ts](../../src/host/fork.ts), and the public HTTP/native subprocess regression in [fork-native-http.test.ts](../../test/fork-native-http.test.ts). The regression was observed failing when preparation inherited the source model/high effort; it verifies the sol/medium wire requests, final source-setting restoration, and phase-specific failure retention without provider calls.

Observed production failure at 0.83: workspace copy completed; the retained temporary Codex rollout recorded astra/medium, task start and interruption approximately 180 seconds apart, without a completed summary. This supports a real preparation deadline expiry; it does not establish whether upstream latency, provider processing or another native issue prevented completion. A real provider retry and activation of 0.84 have not been performed by this diagnosis. Source and failed Fork are not automatically replayed.
