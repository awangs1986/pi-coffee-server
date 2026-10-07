# Native Agent activation and recovery

This release adds opt-in Host Adapters for Codex CLI **0.154.0 / 0.156.1** and Claude Code
CLI **2.1.280**. Other versions remain unavailable until their native interface
is verified. Pi remains the default. M5 production activation and two-user acceptance are
recorded in [the deployment evidence](../reviews/native-agents-m5-20260923.md).

The local workbench recovery on 2026-09-27 additionally verifies Codex 0.156.1:
native account readiness, the Luna model catalogue, reading an existing synthetic
thread, and opening a new empty Work task through the real Browser/Server/Host.
The authenticated Host regression test covers discovery, task creation and empty
history; unknown CLI versions remain disabled. No additional model turn was sent
during UI recovery. This is compatibility evidence for those operations, not a
new paid-model acceptance run. The complete browser belongs to the separate
`awangs/pi-coffee-server` repository; the older GitHub monolith is not its release.

## Installation and activation

Install the official CLIs under the existing User VM owner. Use native login or
native provider configuration for that owner. Web/Gitea login does not replace
native authentication. Neither repository stores provider keys or imports native
accounts. Do not place credentials in Issues, task prompts or service command
arguments. Environment-based credentials belong only in the VM's protected
service environment or its existing native configuration.

Set either or both executable paths in the Host service environment:

```sh
PI_COFFEE_CODEX_COMMAND=/absolute/path/to/codex
PI_COFFEE_CLAUDE_COMMAND=/absolute/path/to/claude
```

These values are executable paths, not shell command strings. The Host starts
one native process per active Task in its existing Chat folder or independent
Gitea clone. Native configuration, model defaults, tools and permissions remain
owned by the CLI. For example, an existing read-only Codex configuration still
rejects writes; the Adapter does not change it to a writable or bypass mode.
Pi Harness variables, Skills and extension arguments are not injected.

Deploy the compatible Host before the Server. `GET /api/engines` reports exactly
Pi, Codex and Claude Code, their installation/version and local authentication readiness, and an explicit
reason for disabled engines. This uses local version and native authentication status checks, not an
API billing call or a guarantee that a provider will accept the next request.
Codex first uses native `login status` for local configured-login readiness. If
the native command reports no login (exit 1), `account/read` with refresh disabled
retains compatibility with custom providers that require no OpenAI login. Command
faults/timeouts remain unknown; account metadata hydration is not required when
the local login is configured. Claude uses `auth status --json`. Only
configured/required/unknown is exposed, never command output or account details.
Native authentication is evaluated by the native engine. Expired credentials
must be repaired using that engine on the VM; preserve the Task binding.

## Verified transports

Codex uses `codex app-server` over private stdio: initialize, thread start/resume,
thread read, turn start/interrupt, model list and native request responses.
The thread returned by start/resume supplies the initial history. Reading turns
from a new empty thread can return `list_turns is not supported yet` in the
pinned CLI; no replacement thread is created to hide that condition.

Claude uses the unmodified CLI with these transport arguments:

```sh
claude --print --input-format stream-json --output-format stream-json \
  --verbose --include-partial-messages --permission-prompts host \
  --permission-prompt-tool stdio --session-id <prepared-uuid>
```

A bound Task uses `--resume <native-id>` instead of `--session-id`. The `stdio`
permission handler is the CLI's control channel; it does not start an MCP server
or substitute the Agent SDK. Omitting it was observed to deny Write without
sending the client a permission request. The Adapter sends native `initialize`,
`interrupt` and `set_model` controls and responds to `can_use_tool`. Required
questions are answered through the same native request, never as an unrelated
new chat message.

Claude's native JSONL history is read only for the bound Task's cwd/session
under `CLAUDE_CONFIG_DIR` (or the native default). It remains a local display
projection; the Web Server does not ingest or convert transcripts. A missing or
damaged history file fails visibly. Native settings and compaction still belong
to Claude.

## Capability limits

| Operation | Codex | Claude Code |
|---|---|---|
| Stream text and tool results | Enabled | Enabled |
| Native model catalogue and selection | Enabled | Enabled |
| Task-scoped stop | Native turn interrupt | Native interrupt control |
| Native approvals and questions | Correlated native RPC responses | Native permission control responses |
| Restore native context/history | Same thread ID | Same session ID and native history |
| Files and Gitea Checkpoint/PR | Existing scoped services | Existing scoped services |
| Inline image input | Not advertised in this release | Not advertised in this release |
| Pi steering, queues, extensions, commands, statistics, compaction | Disabled | Disabled |
| Reasoning selector and native rename | Disabled | Disabled |
| Permanent native history cleanup | Unavailable; archive retains data | Unavailable; archive retains data |

Original uploaded files are retained even when inline input is unavailable.
Models can use their native file tools where those tools support the format.
A selected model is not a promise that the owner's provider grants access to it.

## Failure and writer recovery

Task engine identity is durable before the first prompt. A native binding cannot
be switched to another ID. A failed resume, missing CLI or uncertain first start
never falls back to Pi or a new native Session. Browser reconnect does not kill
the native process. The last 256 accepted native request IDs are retained to
reject accidental replay; clients must not retry uncertain delivery automatically.

Checkpoint, push, PR and cleanup reject active or unknown writers. Native idle
sessions remain connected during Git operations; Host lifecycle locks reject a
racing prompt. Codex inspects native turn/command/child states conservatively.
Claude tracks native background-task snapshots independently of answer completion
and journals uncertainty before a turn. A restart cannot turn an unfinished
background job into an idle claim.

If Claude's binding records `writers: unknown` after a lost process, the VM owner
must inspect the original process group and background work. Stop the Host,
verify no writer for that Task survives and inspect the checkout. Only after
that inspection may the owner reconcile that Task's `nativeBinding.writers` to
`idle` in the workspace metadata, preserving all IDs and files, then restart.
Do not clear uncertainty merely to make a Checkpoint succeed. Unknown initial
native identity similarly requires inspection or an explicitly new Task.

Archive/restore preserves bindings, history and files. Native permanent cleanup
is rejected before deleting any directory. The UI offers archive and restore;
it does not claim that deleting a folder would erase all native history.

To disable activation, remove the two command variables and restart the Host.
Existing native Tasks remain visible but unavailable; retain their data. Roll
back only to a build that understands engine metadata. Do not run an older
Pi-only Host against native Task records.

## Reproducible checks

From fresh clones of both repositories, with Node 22.19 or later and Git:

```sh
npm ci
npm run check
```

Agent tests run executable protocol fixtures through authenticated Host HTTP/WS
and real temporary Git repositories. Server tests drive the actual browser
controller and authenticated forwarding seam. They require no provider keys.
For a live probe, create a disposable Gitea project, choose each native engine,
read a marker, write one file, inspect Diff, Checkpoint and compare local/remote
SHA. Refresh, restore native context and stop one active Task. Upload/download
matching bytes to Chat folders and archive/restore them. Keep provider usage
short and record native permission decisions and any unsupported operations.
See the [dated evidence](../reviews/native-agents-m0-m4-20260923.md).

## LAN deployment accepted on 2026-09-23

Open `http://webserver:3000/` using the existing Gitea account. Web remains on
`192.168.100.101`; `awangs` routes to linux001 and `pi-coffee-t4-user2` to
linux002. Both User VMs have all three engines enabled. The owner-supplied native
provider defaults are Codex `gpt-5.6-terra` and Claude `claude-sonnet-4-6`.
The Codex credential is restricted to Terra even if the native catalogue lists
other models. Native model catalogues describe CLI support, not provider access.

The [M5 evidence](../reviews/native-agents-m5-20260923.md) pins deployed commits,
checks, exact code Checkpoints and the recovery probe. Native provider secrets
are loaded from `/etc/pi-coffee/native-agents.env` on each VM (root:awang, 0640).
User settings are `~/.codex/config.toml` and `~/.claude/settings.json` (0600).
The environment file is a deployment secret, never a project file. Interactive
CLI use outside systemd needs the same protected environment; do not paste its
contents into a Task. Service environment and user settings must use the same
VM owner/home as the native process.

### Repeatable release procedure

1. From fresh clones at the intended Gitea commits, run `npm ci` and
   `npm run check` on the target hosts. Stage builds under
   `/opt/pi-coffee-releases/<commit>` and
   `/opt/pi-coffee-server-releases/<commit>`. Install only verified native CLI
   versions; retain existing native user configuration and credentials.
2. Confirm no Task is running before restarting a Host. Retain the existing
   Workspace/session directories and protected service configuration. Capture
   registered Task IDs/bindings privately for before/after comparison.
3. In `/etc/systemd/system/pi-coffee-host.service.d/30-native-agents-release.conf`,
   set only the immutable release `WorkingDirectory`. Keep the existing native
   `EnvironmentFile` and absolute executable `Environment` entries in a separate
   `40-native-agent-environment.conf` drop-in. Do not rewrite environment settings
   when switching release directories. Retain the original root-only configuration
   and environment files for rollback; never copy their credential contents into
   the repository or an Issue. Confirm `/api/engines` still reports the configured
   engines after **every** Host release, even a frontend-only companion change.

4. Run `sudo systemctl daemon-reload` and
   `sudo systemctl restart pi-coffee-host` on linux002 first, then linux001.
   Verify `/healthz`, authenticated `/api/engines`, retained Task identities and
   native readiness before continuing. Readiness alone does not prove upstream
   model access.
5. Point the analogous `pi-coffee-web.service.d/30-native-agents-release.conf`
   `WorkingDirectory` to the tested Server release, preserving identity/routing
   configuration. Reload systemd and restart `pi-coffee-web` on Web. Verify
   `/healthz`, Gitea login, each fixed VM route and one bounded native flow.
6. Record sanitized evidence and exact revisions in Agent #53 and both parents.
   Retained old source directories are recovery artifacts, not the active release.

### Tested activation rollback

Keep the native-aware Agent build and all existing data. On an idle VM, add
`/etc/systemd/system/pi-coffee-host.service.d/90-native-agents-disabled.conf`:

```ini
[Service]
Environment=PI_COFFEE_CODEX_COMMAND=
Environment=PI_COFFEE_CLAUDE_COMMAND=
```

Reload systemd and restart `pi-coffee-host`. Check that Pi is available and native
Tasks are retained but unavailable. Remove only this temporary override, reload
and restart to restore activation. This sequence passed on linux002 with native
bindings/history intact. Do not restore old Workspace metadata or run a Pi-only
binary against these records. Switching code revisions is safe only to a tested
native-aware build, with settled Tasks and the same durable directories.

### Shared project registration

New-project import is repository migration; it is not a shared-repository picker.
For an existing shared Gitea repository, an operator can stop an idle Host and
use the deployed `Workspaces.registerProject(name, repoUrl, branch, repoId,
webUrl)` interface as the VM owner, with the configured project/chat roots and
VM Git credentials, then restart the Host. Do not modify the state JSON directly
or keep a second Workspaces process running beside the Host. Gitea must already
grant the user access. The registered repository ID determines the canonical PR
owner/name, including repositories owned by another user. Browser users can then
choose that Project and a verified remote starting branch normally.

### Owner's short manual checklist

1. Sign in at the LAN URL and verify the displayed VM is your assigned VM.
2. Start a new Task. Choose Pi, Codex or Claude Code and Chat or Work. For Work,
   choose a registered Gitea Project and starting branch. Confirm the Agent is
   fixed immediately after creation and the complete local path is shown.
3. Keep Codex on `gpt-5.6-terra` and Claude on `claude-sonnet-4-6` with the current
   credentials. A model selector never changes the Task's Agent.
4. Ask for a small read/edit/check in a disposable project. Review any native
   permission request, watch tool results, and refresh once. The same Task and
   history should return; do not resend a possibly accepted prompt automatically.
5. Review Diff, create a Checkpoint, check synchronization, and open the Gitea PR.
   Another engine needs a new Task from the published code branch; it receives
   code, not the previous engine's conversation context.
6. Try a Chat attachment and reopen the Task. Archive/restore should retain its
   files and history. Permanent native-history cleanup is unavailable in this
   release; archive is the supported lifecycle action.

A known caption defect can leave the new-task action saying
“为旧任务创建目录” after visiting a legacy Task; the selected new Task still receives
its own directory and immutable Agent. This is a separate Browser follow-up.
