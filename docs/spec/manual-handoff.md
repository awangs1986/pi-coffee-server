> Packaging migration: canonical Handoff source now lives in pi-coffee/packages/context-handoff; see [current package consumption](../development/plugin-monorepo.md). Version/commit records below describe the initial integration baseline. Behavior is unchanged.

# Experimental manual Handoff

Accepted 2026-09-29. Tracking: [Server #2](https://github.com/awangs1986/pi-coffee-server/issues/2)
and [Context-handoff #2](https://github.com/awangs1986/pi-context-handoff/issues/2).
This decision supersedes older Web manual local-fold and automatic Handoff cadence descriptions.

## User contract

The Pi Context Usage action is **交接压缩**. Confirm **交接压缩（实验性功能）**:
“交接压缩不保证避免上下文漂移，适合在多次系统自动压缩后重新聚焦当前项目。
自动压缩仍使用 Pi 原生自动压缩。同一对话、历史和项目文件保留。”
Cancel changes nothing. Switching tasks while the dialog is open invalidates confirmation.
Codex/Claude keep their native adapter capabilities and are never labelled Pi Handoff.

Manual confirmation runs the independently maintained `context-handoff` plugin,
not legacy local folding. Its existing attributed Task State and original-evidence
index become a native custom compaction in the **same native session**. The visible
Conversation, workspace, attachments and original history remain. It does not create
a new task or replay completed actions. Automatic threshold/overflow compaction stays
native Pi; the plugin's historical explicit `cadence` mode is not a Web policy.

Host owns the operation across browser disconnection. Conflicting prompts, queued
input, another compaction, model/thinking changes and idle retirement are blocked.
The browser shows ongoing compaction after reconnect and allows Stop. Host emits
`context_operation` start/end events and `opened.state.isCompacting`. Compaction
must not block the socket's abort command. Failure is visible, without substituting
native compaction under the Handoff label.

## Package and integration contract

Current source and consumed versions come from [REPOSITORIES.md](../../REPOSITORIES.md)
and Server `package.json`/`package-lock.json`. At the reviewed Server baseline
`5073c97`, Host consumes independent Harness 0.3.2, LSP 0.4.6 and
context-handoff 0.2.0-experimental.5 artifacts via public package interfaces.
The following initial version records remain historical integration evidence;
they are not instructions to restore the old aggregate or downgrade plugins.

- Handoff **0.2.0-experimental.1**, commit `ce7a6d07b215473da3b2703d9c2a6b83dbb5e162`.
  `/handoff version` reads the installed manifest; committed Handoff details record
  `pluginVersion` and `trigger`. Immutable tag `v0.2.0-experimental.1`.
- Harness **0.1.2**, commit `d068251dc1b4de59c4178eb04e0d4a0fcc117187`, keeps installed
  recovery tools available in both Chat and Work. Neither Harness nor LSP implements Handoff.
- Server loads independent package roots through `src/host/pi-extensions.ts`.
  Native Pi owns extension discovery; the historical aggregate/context-fold hook
  is no longer the current runtime composition. Official web/subagent packages
  remain upstream dependencies. Acceptance includes `test/pi-package-integration.test.ts`.
- `PI_COFFEE_EXTENSIONS=off` and explicit extension lists remain authoritative.
  `PI_COFFEE_HANDOFF=off` omits Handoff. Legacy `PI_COFFEE_CONTEXT_FOLD=off` also
  omits the replaced default hook. Missing Handoff fails visibly; no fallback.
- Host uses public `context-handoff/protocol` and Pi `compact(customInstructions)`.
  It verifies a new manual Handoff compaction carrying the pinned plugin version
  and original session identity. A successful RPC response alone is insufficient.
- Pi RPC normally times out after 30 seconds. Host continues observing the same
  operation through public state, never retries it, and retains ownership until
  completion. Unobservable settlement or a 360-second deadline stops that child
  before releasing the operation. Original durable history is retained.

Native session storage must be outside the execution workspace. Unknown/delegated
third-party tools must report settlement to the plugin (`pi-handoff:work`); otherwise
Handoff defers/fails visibly. The official web plugin's background work has no blanket
settlement exemption. Native automatic compaction remains available in that case.
Very short sessions may correctly report “Nothing to compact”.

## Acceptance and rollout

Use public browser-controller, HTTP/WS and native Pi RPC/package seams. Cover dialog
cancel/task-switch; busy/reconnect/Stop; real committed plugin output and version;
failed generation without native fallback; original history and workspace retention;
longer-than-30-second operation; default automatic native compaction. Synthetic
provider fixtures test orchestration, not drift quality. No live-model score is claimed.

GitHub main and immutable tags lead; Gitea mirrors exactly. Fresh-clone checks are
required. Package publication is separate from deployment. Deploy only when affected
sessions/background work are idle, remove legacy context/Harness overrides and ensure
one copy of each plugin. Keep the previous Server/plugin release and task data for
rollback. Reverting to Handoff 0.1.0 would restore its old cadence policy; disabling
Handoff and keeping native Pi is the safer recovery option.
