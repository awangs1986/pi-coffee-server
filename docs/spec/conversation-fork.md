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
