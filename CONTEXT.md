# PI Coffee domain model

Reviewed against Server main `5073c97`, 2026-10-06. The owner confirmed the
[project refocus](docs/reviews/spec-freshness-20261006.md). Start with
[REPOSITORIES.md](REPOSITORIES.md) for source ownership; use the linked feature
contracts for defaults, limits and acceptance. Picode/V5 is historical.

## Participants and ownership

**Browser User**: an authenticated PI Coffee Web identity. Gitea supplies platform
identity; GitHub repository authorizations and native model login are separate.
Web identities partition application records and directories, not Linux privileges.

**Browser Shell**: the interface for selecting conversations, editing drafts,
reading history and issuing supported controls. It owns disposable, bounded
display caches. A cached view does not prove current native history or prompt
delivery. See [conversation switching](docs/spec/conversation-switching.md).

**Web Server**: the browser-facing process that authenticates, selects an
administrator-configured Host route and forwards scoped HTTP/WebSocket requests.
It serves assets but does not own native execution or durable transcript bodies.

**Host**: the long-lived Linux process that owns scoped Conversation registries,
native Agent execution, task files, input queues and the derived display index.
Browser detachment does not stop a run. Host shutdown can interrupt execution;
uncertain commands are not automatically replayed.

**User VM**: the owner-managed Linux execution machine. The current deployment
has one physical owner and one OS login, with separate Web identities and task
directories. This is the operating interpretation in [ADR-0020](docs/adr/0020-unified-github-authority.md),
not an OS sandbox between Agents. Independent Host routing remains supported;
the older dedicated-VM deployments are historical evidence.

**Agent Engine**: Pi, Codex CLI, Claude Code, Cursor or Grok Build, selected from
Host-confirmed availability. Native tools, provider login, session storage and
automatic context management remain engine-owned. Adapter availability does not
prove real-account acceptance or equal capabilities across engines. See the
[native contract](docs/spec/native-agent-engines.md),
[Cursor/Claude limits](docs/spec/cursor-claude.md) and [Grok limits](docs/spec/grok-build.md).

**Agent Adapter**: the Host implementation of the common Agent interface using
the selected CLI's supported native transport. Pi uses RPC, Codex uses app-server,
Claude uses stream-json, and Cursor/Grok use ACP over local stdio. Pi Harness,
LSP and Handoff policy remain Pi-only.

## Task, execution and history

**Task / Conversation**: one user-facing unit with one stable Conversation ID
and one registered local Workspace. Model changes and reconnects preserve that
identity. [Work takeover](docs/spec/agent-takeover.md) may replace the active native
binding while retaining prior history segments. A [Fork](docs/spec/conversation-fork.md)
creates a different Conversation and independent directory.

**Chat**: the default new Conversation, Pi-only, without a repository. Ordinary
Chat has zero system instructions and no automatic project, Host or runner
guidance, including after context reset. Explicit user requests and explicitly
selected MISHU context are separate. See [the zero-system boundary](docs/spec/session-environment.md#chat-zero-system-boundary--2026-10-05).

**Work**: a project Conversation with an independent Git clone. Engine selection
is stable except for the confirmed Pi/Codex takeover operation. Chat cannot
upgrade to Work. Model selection within an engine does not switch engines.

**Workspace / Checkout**: the registered execution cwd. A configured task bundle
keeps the checkout, attachments, artifacts and display export in separate
subdirectories. Host preserves existing registered paths. Platform code uses
ordinary independent clones rather than Git worktrees. See [task storage](docs/spec/task-storage.md).

**Native Session / Binding**: an engine-owned session identity associated with a
Conversation. It need not equal the Conversation ID. Native history is the source
for context recovery; Coffee display/export JSON is not a native restore file.

**Run**: one admitted unit of native execution. Receipt, foreground completion,
background writer state and business acceptance are distinct observations.

**Display Index**: the Host's rebuildable SQLite projection for bounded history
reads and change notifications. Its revision and native-source freshness are
different facts. Unknown freshness cannot replace good history with an empty view.

**Model Context**: the current input actually used by the engine. Context capacity,
usage estimates and cumulative billing counters are distinct. Supported native
measurements determine what Web can display; missing categories remain unavailable.
See [context usage](docs/spec/context-usage.md).

## Extensions and remote assistance

**Skill**: a native SKILL.md package managed through Web and installed/executed
on Host. Project scope means one Work checkout; machine scope is shared native
configuration restricted to the configured VM owner. Installing does not prove
loading or invocation. See [Skill management](docs/spec/skill-management.md).

**Pi Plugin**: an independently versioned package consumed from an immutable
artifact. Harness, LSP and Handoff have canonical directories in `pi-coffee`;
official web/subagent packages remain upstream. Native upstream activation and
readiness rules determine optional-tool availability.

**MISHU**: an explicitly selected Pi Chat secretary with exact, authorized
Conversation contacts. Its independent plugin and Host coordinator currently
provide scoped message/receipt handling. Persistent event-driven tracking and
automatic delayed-result reporting remain [Server #64](https://github.com/awangs1986/pi-coffee-server/issues/64),
not completed by the 0.1.6 authorization repair. See [MISHU](docs/spec/mishu.md).

**Test Runner**: the account-configured Windows SSH computer and its WSL, known
to Work through one pointer to external configuration. **SSHME** is instead
explicit, Conversation-scoped assistance on the Web user's Windows/Linux/macOS
computer. Neither feature activates the other. See [runners](docs/spec/test-runners.md)
and [SSHME](docs/spec/sshme.md).

## Transport and operations

**Frame / Event / Cursor**: the versioned transport message, native observation,
and bounded replay position defined by [the protocol](docs/protocol.md). A cursor
is not the durable display revision or a delivery acknowledgement.

**Bridge**: a scoped Web-to-Host transport connection. Closing it detaches a
viewer rather than cancelling the native task. **File Grant**: authorization for
specific task files; a displayed absolute path is not download authority.

**Relay**: optional forwarding for explicitly configured model API/search traffic.
Native engine login is not migrated into it.

**Watchdog**: the bounded per-machine service health monitor. It recovers actual
service failures with cooldown and a persistent circuit breaker, independently
of MISHU's planned task tracking. A browser disconnect alone is not proof of a
Host/Web crash. See [watchdog](docs/deployment/watchdog.md).
