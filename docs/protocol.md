# PI Coffee MVP protocol

> 当前协议记录已实现的接口。工作区合同由 [GW-01～12](./spec/gitea-workspaces.md) 定义；Host 和 Server 已切换到独立 Checkout、同步/PR/迁移动作，并退出平台本地 merge 接口。

> **2026-09-22 目标 Workspace 合同，尚待实现**：每个 Chat/Work Conversation 的 cwd、inbox、research、artifact 和 images 归属见 [`conversation-workspaces.md`](./spec/conversation-workspaces.md)。下文 `.pi-coffee/inbox/<sessionId>` 是当前已实现帧，不能覆盖新合同；协议升级时必须返回 Host 解析的 Workspace 相对路径，浏览器不得提交 cwd。

> **2026-09-19 目标拓扑变更，尚待实现**：见 [ADR-0010](./adr/0010-unified-web-gateway-private-user-vms.md)。默认只对外提供统一 HTTPS 入口，聊天和文件流由网关转到私网 VM；VM 不再要求浏览器直达。本文中的直连 Transfer 地址、双浏览器侧 TLS 和逐 VM 端口开放说明描述旧实现，不应据此配置新公网部署。当前代码／模板尚未完成文件网关，不能只关闭 VM 文件端口就声称迁移成功。网关与 Host 保持独立生命周期；文件流不在入口落盘。

The Browser and Host use the same versioned JSON frame vocabulary. The Web Server validates the Browser frame and forwards it; it does not reinterpret Pi events and keeps no conversation state.

## Workspace HTTP capability

When `PI_COFFEE_PROJECT_ROOT` is configured, authenticated clients use
`GET /api/workspace` for the v2 Project/Conversation registry and
`POST /api/workspace` for actions. The Web gateway forwards these requests and
does not execute Git.

| Action | Required fields | Result |
|---|---|---|
| `project` | `name`, optional external `url` | Gitea-backed Project registration |
| `import` | `name`, uploaded ZIP `scope`/`file` | Gitea-backed Project after bounded import |
| `discover` | — | locally discovered repositories imported to Gitea |
| `github_repos` | — | repositories the Host's GitHub token can reach (`fullName`, `private`, `archived`, `defaultBranch`, `canPush`, `projectId` when already added); requires `PI_COFFEE_GITHUB_TOKEN` ([ADR-0022](adr/0022-github-work-projects.md)) |
| `github_project` | `repository` (`owner/repo` or URL) | idempotent GitHub-backed Project (`forge: "github"`, ID `github-<repository id>`) after push-permission and VM Git checks |
| `conversation` | `projectId`, optional `branch` | independent Checkout and reserved Conversation branch |
| `status` | `id`, optional `refresh` | dirty and remote sync state/SHA/time |
| `changes` | `id` | bounded diff/checks against fetched target branch |
| `change_file` | `id`, `path`, `scope`, `base` (Branch: the merge-base `changes` returned), optional `contents` | one file's whole patch (≤4 MB, else `truncated`) and, with `contents`, both sides' text (≤1 MB each) for the Diff panel; read-only ([ADR-0023](adr/0023-pierre-diff-renderer.md)) |
| `checkpoint` | `id`, selected `paths`, `message` | commit, normal push and exact remote SHA confirmation |
| `sync` | `id` | retry normal push of the existing local checkpoint |
| `pull_request` | `id`, `title` | idempotent real PR record on the Project's forge (Gitea, or GitHub for `forge: "github"`) |
| `continue` | `projectId`, `sourceBranch`, `sourceSha`, optional new `id` | new Checkout/branch at the verified source SHA |
| `bind_project` | `projectId`, credential-free `repoUrl` | bind a legacy Project before migration |
| `migration_plan` / `migrate` | `id` | inspect or execute a legacy-to-Checkout migration while retaining the old directory |
| `archive` / `restore` / `delete` | `id`; delete also needs exact `confirmation` | visibility or guarded local cleanup; remote branch/PR are retained |

`merge_preview` and `merge` are no longer protocol actions. A client that
needs integration opens the returned Gitea or GitHub PR. `GET /api/workspace`
reports `capabilities.forges` (`{gitea, github}`) so the browser offers only the
configured code forges; Projects without `forge` are Gitea. Health reports
`capabilities.giteaCheckouts`, `ownerEnvironment` and `passwordlessRoot`; the
last two describe observed process capability rather than configuration intent.

## Connection sequence

The browser reaches `/ws` only with a valid Gitea session cookie when the Web
Server has Gitea login configured (otherwise the upgrade is refused with 401).
The Web Server opens the private Host connection with `Authorization: Bearer
<host token>` and, for a logged-in user, `x-pi-coffee-user: <gitea login>`;
the Host resolves every frame on that connection inside that user's registry
(ADR-0010). Frames themselves carry no user field.

```text
Browser -> Web Server -> Host: {"v":1,"type":"list_sessions"}            (allowed before open)
Host -> Web Server -> Browser: sessions
Browser -> Web Server -> Host: {"v":1,"type":"open", "sessionId?", "after?"}
Host -> Web Server -> Browser: opened
Host -> Web Server -> Browser: history                                   (always, right after opened)
Host -> Web Server -> Browser: event…                                    (only the in-flight tail, if any)
Browser -> Web Server -> Host: prompt | abort | ping | list_sessions
Host -> Web Server -> Browser: ack | event | error | sessions
```

`open` without a `sessionId` creates a Session. `open` with an ID attaches to the live Host Session if there is one, otherwise the Host resumes the conversation from Pi's session store in the User VM (`pi --session <file>`). Either way the Browser receives the same two things: `opened`, then `history`.

## Where conversation state lives

- **Completed messages** live in Pi's own session file in the User VM (ADR-0008). The Host projects them into `history` on every `open`. The Browser renders `history` from scratch and keeps nothing across page loads except which conversation it last looked at.
- **In-flight events** (a message that is still streaming, a tool that is still running) live in the Host's bounded per-Session buffer. After `history`, the Host replays only buffered Events newer than `max(after, cursor of the last completed message)`. So a Browser that has never seen the Session and a Browser that reconnects mid-stream both end up with: history + the current tail, no duplicates.
- If the in-flight tail itself has fallen out of the bounded buffer (a single message with more Events than the buffer), the Host emits `resync_required` instead of a partial tail; completed messages are unaffected because they come from `history`.
- The Host may stop an idle Pi process (no Browser attached, nothing running) after `PI_COFFEE_IDLE_TIMEOUT_MS`. The conversation is unaffected: the next `open` resumes it from the store.

## Client frames

```json
{"v":1,"type":"list_sessions"}
{"v":1,"type":"open","sessionId":"optional","after":42}
{"v":1,"type":"prompt","requestId":"r-1","text":"hello","images":[{"type":"image","mimeType":"image/jpeg","data":"<base64>"}],"mode":"follow_up"}
{"v":1,"type":"abort","requestId":"r-1"}
{"v":1,"type":"rename_session","requestId":"n-1","sessionId":"optional (default: the open one)","name":"Coffee plan"}
{"v":1,"type":"delete_session","requestId":"d-1","sessionId":"…"}
{"v":1,"type":"get_models"}
{"v":1,"type":"set_model","requestId":"m-1","provider":"cpa","id":"gpt-5.5"}
{"v":1,"type":"set_thinking","requestId":"t-1","level":"high"}
{"v":1,"type":"get_command_catalog","engine":"pi","requestId":"commands-1"}
{"v":1,"type":"get_commands"}
{"v":1,"type":"get_extensions"}
{"v":1,"type":"get_stats"}
{"v":1,"type":"compact","requestId":"c-1"}
{"v":1,"type":"ui_response","requestId":"u-1","id":"<extension_ui_request id>","value":"Allow"}
{"v":1,"type":"ui_response","id":"…","confirmed":true}
{"v":1,"type":"ui_response","id":"…","cancelled":true}
{"v":1,"type":"ping","nonce":"n-1"}
{"v":1,"type":"close"}
```

### Extension UI

Pi extensions talk to the user through `ctx.ui.*`. In RPC mode Pi emits them as
`extension_ui_request` events, which the Host forwards unchanged inside `event`
frames. Fire-and-forget methods (`notify`, `setStatus`, `setWidget`,
`setTitle`, `set_editor_text`) need no answer; the browser renders them (note,
status chip, widget strip, composer prefill). Dialog methods (`select`,
`confirm`, `input`, `editor`) block the extension until the browser sends
`ui_response` with the same `id` and exactly one of `value` / `confirmed` /
`cancelled` — the same shape as Pi's `extension_ui_response`. The Host keeps
the dialogs Pi is still waiting on and re-sends them after `history` to any
browser that opens the Session, so a reload or a second device can answer. An
answer to an id nobody is waiting on (already answered, timed out, or the run
settled) gets `error{code:"unknown_ui_request"}`. `custom()` is TUI-only and is
not supported.

`prompt.mode` decides how a message joins a Session that is already running: omitted/`prompt` requires an idle Session (`busy` error otherwise); `follow_up` queues it for after the run; `steer` interrupts after the current tool calls. On an idle Session both fall back to a plain prompt so nothing is silently parked. Pi reports the queue via the `queue_update` event.

`list_sessions`, `rename_session` and `delete_session` are sidebar commands and are accepted before `open`. `delete_session` stops a live Pi process for that conversation and removes its file from the User VM's session store. Every other command needs an open Session (`not_open` error).

Images are sent inline as base64 (at most 8 per prompt, within `MAX_FRAME_BYTES`); the browser downscales before sending. Bulk uploads into the Conversation inbox are `FILE-001`.

## Server frames

```json
{"v":1,"type":"sessions","sessions":[{"id":"…","name":"optional","createdAt":"…","updatedAt":"…","messageCount":6,"preview":"first user message","running":false,"attention":"waiting | finished (optional)","source":"appServer | cli | … (optional)"}]}
{"v":1,"type":"opened","sessionId":"…","cursor":0,"state":{"isStreaming":false,"messageCount":0}}
{"v":1,"type":"history","sessionId":"…","leafId":"…","truncated":false,"entries":[
  {"kind":"user","id":"…","at":"…","text":"list files","imageCount":1},
  {"kind":"assistant","id":"…","at":"…","text":"Sure."},
  {"kind":"tool","id":"call-1","at":"…","name":"bash","args":{"command":"ls"},"result":"a.txt","isError":false},
  {"kind":"note","id":"…","text":"会话上下文已压缩…"}
]}
{"v":1,"type":"ack","operation":"prompt | steer | follow_up | abort | rename_session | delete_session | set_model | set_thinking | compact | ui_response","requestId":"r-1"}
{"v":1,"type":"models","models":[{"provider":"cpa","id":"gpt-5.4-mini","contextWindow":200000,"reasoning":true}],"current":{"provider":"cpa","id":"gpt-5.4-mini"},"thinkingLevel":"medium","thinkingLevels":["off","low","medium","high"]}
{"v":1,"type":"commands","commands":[{"name":"harness","description":"…","source":"extension"}]}
{"v":1,"type":"extensions","sessionId":"…","extensions":[{"name":"harness/extension.js","kind":"extension","path":"…","origin":"configured","scope":"temporary","commands":[{"name":"harness","description":"…"}]}]}
{"v":1,"type":"stats","sessionId":"…","stats":{"userMessages":3,"assistantMessages":3,"toolCalls":2,"tokens":{"input":1200,"output":340,"cacheRead":0,"cacheWrite":0,"total":1540},"cost":0.0042,"contextUsage":{"tokens":1540,"contextWindow":200000,"percent":0.77},"rateLimits":{"fiveHour":{"usedPercent":42,"windowMinutes":300,"resetsAt":"…"},"weekly":{"usedPercent":61,"windowMinutes":10080,"resetsAt":"…"},"plan":"plus"}}}
{"v":1,"type":"event","sessionId":"…","cursor":1,"event":{"type":"message_update"}}
{"v":1,"type":"error","code":"busy","message":"…","requestId":"r-2"}
```

`extensions` describes what the Session's Pi process actually loaded, grouped by the file that registered each slash command (kind `extension` / `skill` / `prompt`, origin `configured` for paths PI Coffee passed with `--extension`, otherwise Pi's own source: `cli`, `auto`, `inline`, `package`). Extensions PI Coffee configured appear even when they register no command.

`sessions` is also **pushed** by the Host to every connected browser whenever the list may have changed (a conversation was created, finished a run, was renamed, deleted, or its idle Pi process was stopped), so sidebars stay in sync without polling. `history.entries[kind=tool]` may carry `diff`: the patch Pi itself recorded for an `edit`, so a reloaded browser renders the same change view as the live one.

`history.entries` follows the active branch of Pi's entry tree (leaf → root); abandoned branches are omitted, compactions and branch switches appear as notes so the user sees the whole past conversation rather than the model's current context. The frame is bounded by `MAX_FRAME_BYTES`: when a conversation does not fit, the newest entries are kept and `truncated` is `true` — the rest stays in the User VM's session file. Tool results are capped at 4000 characters. Session-file paths never appear in any frame.

Agent event payloads are opaque JSON values at this seam. The browser renders `message_update` → `text_delta`, tool execution start/update/end, `message_end` errors, `extension_ui_request` notifications and visible custom messages. Two events extend Pi's vocabulary and are emitted by the Codex adapter (ADR-0011); the browser ignores them when absent:

- `tool_execution_update {toolCallId, toolName, partialResult}` — output of a still-running tool, accumulated so far (the card refreshes live).
- `turn_diff {diff}` — the run's cumulative unified diff. The browser does not render this diff: it only refreshes a Diff panel left open on 最近一轮 (at most once every 1.5 s), which still reads the Host's turn-snapshot comparison (`changes` with `scope:'turn'`, see 「Host contract for 最近一轮」 in [Arena navigation](spec/arena-navigation.md)).

### Sidebar attention and native threads

- `sessions[].attention` is the Host's answer to "does this conversation need me": `waiting` while an agent dialog is unanswered, `finished` when a run settled with no browser attached to that Session. It clears when a browser opens the Session. The shell sorts these first (需要你), then running conversations, then time buckets.
- `sessions[].source` is where the conversation was started as the agent's own store records it (Codex: `appServer` for conversations from this page, `cli` / `exec` for the VM admin's terminal in the same working directory). The shell lists foreign sources under 本机终端会话. Opening one *takes it over*: the Host resumes the native thread. While another process is still driving a turn there, `opened.state.isStreaming` is `true`, prompts answer `busy`, and the Host polls the agent (default 3 s) until the turn ends, then publishes `agent_settled`.
- `stats.rateLimits` are the model account's rolling usage windows (Codex ChatGPT login: `account/rateLimits/read`, refreshed by `account/rateLimits/updated`), classified by window length rather than slot name. Absent for API-key logins and for Pi. The account is shared by every user of the VM, so the numbers are the same for everyone.

### File transfer (ADR-0009)

Files never cross this protocol or the Web Server. After `opened`/`history`
the Host sends

```json
{"v":1,"type":"transfer","sessionId":"…","url":"http://<user-vm-lan-ip>:53317","scope":"<opaque-owner-and-session-scope>","token":"…","inbox":".pi-coffee/inbox/<sessionId>","maxFileBytes":268435456,"maxBatchBytes":1073741824}
```

and the browser talks LocalSend v2 directly to that URL: `POST
/api/localsend/v2/prepare-upload?scope&token` with the file list (optionally
`sha256`), then one `POST /api/localsend/v2/upload?sessionId&fileId&token` per
file with the raw bytes; `POST /cancel?sessionId` aborts. Files land in the
inbox under Pi's working directory, so the prompt only needs to mention their
paths. The Host reports progress on the ordinary event stream:

```json
{"type":"transfer_progress","sessionId":"<upload session>","fileId":"…","fileName":"…","received":123,"size":456}
{"type":"transfer_complete","sessionId":"…","fileId":"…","fileName":"…","path":".pi-coffee/inbox/<sessionId>/name.pdf","size":456,"sha256":"…","fileType":"application/pdf"}
{"type":"transfer_failed","sessionId":"…","fileId":"…","fileName":"…","message":"Checksum mismatch (sha256)"}
```

Downloads use the LocalSend download API against the same URL: `POST
/prepare-download?scope&token` lists the inbox; `GET
/download?scope&token&fileId=<workdir-relative path>` streams any file under
the owning user's working directory (agent output included). Upload preparation,
inbox listing and downloads require a Host-issued scope and token; missing grants
return 401, including for plain LocalSend clients. Scopes bind the authenticated
user and session, so identical session ids cannot share grants or events. These are Host-originated
events; unlike Pi events they are not part of the durable history.

## Lifetime rule

Closing a Browser WebSocket detaches that Browser from the Session. It is not a stop command and must not interrupt Pi. The Host stops a Pi process only during Host shutdown or after the idle timeout above, and in both cases the conversation remains in Pi's session store.


## Conversation Workspace additions (CW-01–10, 2026-09-22)

The authenticated `/api/workspace` registry returns `vmId`, `capabilities.chatWorkspaces`,
Projects and Conversations. A Conversation includes `workspaceKind: chat | project`,
`cwd` (absolute display/copy path), `creationState: creating | ready | failed`, and optional
`creationError`. Project workspaces also carry `startBranch`, `startSha`, assigned `branch`
and last remote confirmation. Paths are resolved by Host; clients cannot supply a cwd.

- `conversation`: pass a stable `id` and `workspaceKind`. `chat` needs no project; `project`
  requires `projectId` and optional starting `branch`. Retry the same payload/ID after
  uncertain transport or failed creation. Partial files stay at the reported path;
  ready/missing directories are never silently recreated. Existing callers omitting
  workspaceKind keep the Project behavior.
- `branches`: `{projectId}` returns remote branch names for the creation picker.
- `files`: `{id}` returns the scoped grant and cwd-relative inbox (`inbox` for Chat,
  `.pi-coffee/inbox` for Project). Upload completion also returns `{path,sha256,fileName}`
  in HTTP JSON, so a lost WebSocket event does not strand a completed upload.
- `status`: Chat returns `state: local`; Project returns the **actual** `branch` and
  `branch_mismatch` on drift/detached HEAD. Such state blocks checkpoint/push. Failed
  remote checks return `unknown` plus the last confirmation time, never cached `synced`.
- `archive`/`restore` change visibility only. Running Pi and children continue.
- `delete`: archived ID and exact `confirmation` are mandatory. `includeLocalFiles:true`
  explicitly covers the directory, attachments/research/artifacts/images and ignored
  files. Dirty/unpushed Project code still blocks deletion. Host checks idle children,
  stops idle Pi, closes its LSP and revokes upload grants before removing local data.
  Failed creation can also be explicitly cleaned; tombstoned IDs cannot be reused.
  Native history is deleted; remote branches/PRs/repositories and external legacy data remain.

New Pi processes receive the registry cwd, `PI_COFFEE_DATA_ROOT`, initial Chat/Work mode
and `PI_SUBAGENTS_TEMP_ROOT` under their data root. Restored mode overrides the initial
default. Native sessions remain in their existing VM store. Proven old
`.pi-coffee/inbox/<id>/...` references retain scoped **read-only** download/preview access;
new uploads go to the task directory. Unattributed global evidence is not reassigned.

## Native engine extension (nativeProtocol 1)

The envelope remains `v: 1`; the additive native contract is negotiated by
`open.nativeProtocol: 1`. Pi clients remain compatible. Opening a native Task
without that opt-in fails before creating a process. Unknown Task IDs do not
select Pi implicitly.

Authenticated `GET /api/engines` returns exactly three installation/version
entries: `pi`, `codex`, `claude`, each with `name`, `available` and optional
`reason`/`version` and native `authentication` (configured/required/unknown). Native authentication remains in the CLI; availability is not
provider authorization. The Web gateway forwards this endpoint as read-only to
the user's fixed Host.

Workspace `conversation` and `continue` accept `engine` (legacy default `pi`).
Engine identity is preserved through ordinary retry/archive/restore. The scoped HTTP Work takeover operation is the only Pi/Codex switching exception; see [the takeover contract](spec/agent-takeover.md).
Native IDs are Host-owned binding metadata, never an `open` or `prompt` input.
`opened` adds `engine` and boolean `capabilities`: models, images, stop, questions,
tools, thinking, steer, followUp, stats, commands, extensions, compact, rename,
cleanup. Missing capabilities on legacy Pi Hosts retain the established Pi UI.
Missing native capabilities do not imply support.

Native `event` payloads use the existing ordered cursor and Task scope:

- `run_started {runId}` and `run_completed {status, message?}`. Stop acknowledgement
  accepts the request; only native terminal evidence completes the run.
- `message_delta {id, delta}` and `message_completed {id, text}`. Completion
  replaces the accumulated text for that ID.
- `tool_update {id, name?, args?, status, result?, isError?}`. Updates share one
  stable item ID; history/replay must not append duplicates.
- `native_request {id, method, title, message?, options?, secret?}` uses the
  existing `ui_response` envelope. Requests remain pending across disconnects;
  invalid or stale answers cannot grant a different request. Question groups
  are presented sequentially and answered as one native response.
- `background_state {known, active}` is independent of foreground completion.
  Unknown writer state is not permission for a Git or cleanup operation.

A failed or uncertain native delivery is visible and is not replayed. Completed
history comes from the native engine and its binding. Secrets, raw native stderr
and native login material are not exposed by discovery or lifecycle errors.
See [activation and recovery](deployment/native-agents.md) for the version-pinned
capability matrix and retained-data cleanup policy.

## Categorized context usage

`stats.contextBreakdown` is additive and defined in [CU-01–03](spec/context-usage.md).
It carries `version: 1`, `method: o200k_base_estimate`, `basis: last_request | session_preview`,
`model`, `capturedAt`, `contextWindow`, `totalTokens`, `mediaOmitted`, and seven
`{id,tokens}` categories. The Browser must use this total for the segmented chart,
not cumulative `stats.tokens`. Missing breakdown is unavailable. Raw content
never crosses this metadata interface.

## Skill management HTTP

Authenticated `POST /api/skills` is the additive native Skill management seam.
The [canonical contract](spec/skill-management.md) defines `list`, `detail`,
`install`, `update`, `enable`, `disable` and idle `reload`, scoped by `engine`,
`scope` and an optional registered `conversationId`. It does not add Agent tools
or alter WebSocket model/session protocols. Old Hosts return 404; Web must show
management as unavailable. File/source ownership and all mutations remain on VM.

### Draft Codex model discovery

When `/api/engines` advertises Codex `modelCatalog: true`, an authenticated browser
may send `{v:1,type:"get_model_catalog",engine:"codex",requestId:"..."}` before
opening a session. The scoped Host replies with `type:"model_catalog"`, the same
engine and request ID, and the normal model-list fields. Only `codex` is accepted.
Discovery does not create a task or native thread. The browser ignores replies
for abandoned drafts and applies selections through `set_model` after `opened`,
waiting for confirmation before the first prompt.

Pi also advertises `modelCatalog: true` when its factory supports ephemeral
registry discovery. `get_model_catalog.engine` and `model_catalog.engine` accept
`pi` or `codex`; other values remain invalid. The response contains the selected
engine's choices only, including its configured model policy. No session must be
opened to query this catalog.


### Native draft command catalog

`get_command_catalog` is allowed before opening a session, requires `engine: "pi"` or `"codex"`,
and returns `command_catalog` with the same optional `requestId`, `engine` and a
`commands` array using existing CommandInfo fields. It remains scoped to the
WebSocket's authenticated Host factory. The native adapter performs ephemeral
read-only discovery without a model turn or durable conversation. Unsupported
Hosts/engines return an error; the browser displays it rather than inventing
commands. Open sessions continue using `get_commands` for their loaded state.

Codex catalog entries use `source: "skill"`, the native Skill `name` and optional
`invocation: "$name"`. Pi entries omit `invocation` and retain `/name` completion.
Host never accepts Skill filesystem paths from a browser. Codex `get_commands`
reads fresh `skills/list` for the open task cwd; a leading `$name` in a prompt or
steering input is resolved again against that native catalog and accompanied by
a native `skill` input item. Other text and images retain their native format.

## Confirmed dialog answers (2026-10-01)

[Server #23](https://github.com/awangs1986/pi-coffee-server/issues/23): an
`ui_response` acknowledgement means the native adapter accepted the answer.
Native continuation events may precede this acknowledgement. An adapter failure
returns an error without success acknowledgement; the pending question remains
available for explicit retry. Duplicate or expired answers cannot claim success.

The browser keeps a dialog open until acknowledgement and never reports an
answer sent when its socket cannot send. Ordinary text drafts survive replay of
the same question within the page, keyed by user, conversation and question, with
at most ten retained drafts. Secret answers are not retained in that draft cache
or copied into the normal composer. No answer is automatically retried or chosen.
An expired question reports failure and returns a non-secret typed answer to the
composer so the user can explicitly send it as a message. Error/disconnect feedback
does not mark the ongoing model turn as completed.

Conversation history is assembled in a detached document fragment and attached
once; layout measurements must not grow per historical message. This prevents
repeated synchronous layout while loading long conversations.

`list_sessions` is independent of the socket's task-command queue. Its response
may arrive after later task frames. A failed listing sends `list_unavailable`,
which does not mark the active run as stopped. Per-user discovery is coalesced.


## Auxiliary metadata failures (2026-10-01)

A model, command, extension, statistics or draft-catalog read can return an error
with `code: "metadata_unavailable"` and `operation` naming its originating client
frame. Its optional `requestId` remains correlated to that read. The browser must
report the read failure without ending an active turn, clearing prompt delivery
state or dropping queued instructions. These reads run independently of ordered
prompt, answer, model-setting and lifecycle commands, with bounded native reads.
