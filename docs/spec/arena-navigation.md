# Arena navigation and review

Owner correction, 2026-09-23. Server #4 and Agent #60.

## Task creation

New conversation defaults to Pi Chat, retaining its own VM directory. Chat only
allows Pi. Work allows Pi, Codex and Claude Code, with existing readiness gating,
a Gitea Project and starting branch. Returning the new-task selector to Chat
resets Agent to Pi. A created task retains its Agent; no context conversion or
implicit engine switching. Existing native local tasks created before this rule
remain accessible with their original files/history.
Since 2026-09-28 the Agent and Chat/Work selectors live in the composer's Agent menu,
and the first message or attachment creates the task (see Composer).

Server #20 (2026-09-27): while creating a Work task, a compact **New Gitea
project** action sits beside the repository selector. A single name dialog uses
the existing scoped project API to create and initialize a private Gitea
repository. Success refreshes the project list and selects its default branch
without changing the chosen Agent or unsent draft. Cancel/failure preserves the
previous selection; failures are shown explicitly. Disable duplicate creation
while a request is pending. Do not retarget a task or replace a project selection
the user changed while the request was in flight. Hide this shortcut for Chat
and already-bound tasks.

GitHub (2026-09-29, [ADR-0022](../adr/0022-github-work-projects.md)): when the Host has
`PI_COFFEE_GITHUB_TOKEN`, the repository select groups Projects under Gitea and GitHub and ends
the GitHub group with 「＋ 添加 GitHub 仓库…」; 「＋ 新建项目」 becomes a two-item menu (新建 Gitea
项目 / 添加 GitHub 仓库). The picker lists repositories the Host token can reach, filters as
you type, accepts a pasted `owner/repo` or URL, marks 已添加 / 私有 and disables repositories
without push access or archived ones. Adding one registers it through the Host, closes the
picker and selects it with its default branch; failures keep the picker open with the Host's
reason. The strip's repository icon follows the selected Project's forge, and the PR texts
name that forge. Without the token nothing changes.

Pi credential import into Web Server is future consideration only. This change
does not implement it or move credentials, runtime, histories or file ownership.
Native Codex/Claude authentication remains their own user-VM authentication.

## Navigation

The upper-left PI Coffee menu owns Add project, Discover existing projects,
Active conversations and Archived conversations, alongside existing settings.
These global actions must not appear in the task strip. The new-Work creation
shortcut above is the explicit exception; import/discovery remain in the menu. The composer's
task strip retains repository/branch identity; VM, path, Details and compaction live behind the
toolbar's 任务详情 button (see Composer).

The right pane starts closed at every viewport size, on initial task open and on
task switch/new conversation. Background polling and streamed changes cannot open
it. A folder icon in the top-right toolbar toggles the change-list pane; the icon
has an accessible name and expanded state. Preserve the existing pane positions,
responsive sidebar and composer. The review card is about 320 CSS pixels wide, inset below the folder control,
with a subtle border, rounded corners and an internally scrolling file list. It
must not consume a percentage of a wide viewport. On narrow screens the same
bounded card overlays the conversation with viewport margins; its header/footer
remain visible. The folder control stays at the upper-right when the card opens.

## Search destination

The sidebar contains a Search button, not an always-visible input. It opens a
main-area search page with its own heading, search field, type filters and dated
results, following the supplied Arena reference. Filters are All (active), Chat,
Work and Archived, based on actual task metadata. Search matches available titles
and previews only; it does not claim complete-transcript search or invented media
categories. The sidebar task list remains independent of the search query.

The running task, connection, transcript and unsent draft stay mounted while
search is open. Close or Escape returns to that task without aborting it. Selecting
an active result opens the task; archived results expose existing restore actions.
New conversation exits search. Search closes the review card and Diff panel.

## Composer

One rounded card, following the Arena reference: the prompt (placeholder 「想让 PI Coffee
做什么？」), a toolbar, a divider and the task strip. Wording is Chinese-first; Diff, Branch,
Unified and Split stay in English.

- Toolbar left: ⊞+ uploads attachments. Before creation, the Agent trigger shows the Agent
  icon and name (Pi / Codex / Claude Code). Existing conversations show only the current
  model ID, limited to its first 12 Unicode characters, without icons or an added ellipsis.
  The complete model remains in the tooltip and accessible label. While metadata loads, show
  「模型加载中」 rather than the previous conversation’s model. The trigger still opens
  one menu with Agent, 类型 (Chat/Work), 来源, 模型 and
  思考深度. For a new task, Agent and 类型 are chosen there (the hidden `#task-engine` and
  `#task-kind` selects stay the source of truth, so Codex/Claude remain Work-only). They lock
  once the task exists; model rows follow the model catalog and are disabled without one.
- Toolbar right: the running-mode select and Stop while a turn runs; the scroll icon opens
  任务详情 (VM, branch, readiness, Details, complete path, Copy path, 交接压缩); the send
  button is a bordered rounded square with →, grey while disabled. The key hint appears only
  while a turn runs.
- Strip, Work task: Gitea or GitHub repository link | branch, then `+A −D ›` (task branch vs base; a
  zero side is omitted, hidden without changes) and 创建 PR, which becomes `PR #N ↗`.
- Strip, Chat task: only 「Chat · 本地目录」; no Diff or PR. New task: the repository select
  (+ 新建项目) and starting branch for Work, or the Chat label (a shortcut to the 类型 pane).
- The first message (or attachment) creates the task; there is no separate 创建任务 button.
  A pre-directory legacy task keeps 「为旧任务创建目录」. A failed creation returns the draft.
- 创建 PR is one click: if files are pending it runs Checkpoint (commit + push the Host's
  `checkpointPaths`, message = PR title); if only unpushed it syncs; then `pull_request`. One
  dialog asks for the title. Behind/diverged/branch-mismatch states stop before pushing. While a
  turn runs, creation is disabled; an existing PR opens on the Project's forge (Gitea or GitHub).

## Diff

The right pane is the file-change summary with Diff/Checks tabs, counts, patch
download and View all changes, matching the supplied Arena list reference. A file,
View all changes or the strip's `+A −D ›` opens the Diff panel.

The Diff panel is a docked right column (`clamp(460px, 44vw, 920px)`) beside the chat, which
stays usable; below 1100px it covers the viewport. It is non-modal and never reserves a grid
column below the dock width. It temporarily replaces the Checkout card and restores it (and the
focus) when closed with × or Escape. Header: Diff, collapse-all (⊟/⊞ with a dark tooltip
「收起/展开全部文件」), the scope menu, Unified | Split (active segment blue) and a bordered ×.

Scope is a radio menu: **Branch** — all changes vs the base branch (the Host's branch
comparison, with branch/base/target/refresh metadata); **最近一轮** — only what the latest turn
changed. 最近一轮 is disabled with a reason for Chat, for Claude Code (not yet supported) and
before the first recorded turn. A panel left open refreshes in place after each turn, keeping
folded files and scroll position. While a Codex run is editing, each `turn_diff` event also
refreshes an open 最近一轮 in the same way, still from the Host snapshot (the event's own diff is
not rendered): at most once every 1.5 s, never two reads at once, and not while a comment box has
focus; the settled turn's refresh replaces a pending one. Branch, and Pi's 最近一轮, refresh when
the turn ends.

File rows: chevron, monospace path, right-aligned `+N −M` (zero side omitted; binary and
untracked-without-count are labelled). Bodies are rendered by @pierre/diffs
([ADR-0023](../adr/0023-pierre-diff-renderer.md)), loaded on the first Diff open: Shiki
highlighting, word-level changes, one line-number column in Unified — the old number on removed
rows, the new number elsewhere — no sign column, no wrapping (horizontal scroll), a dotted red
bar for removals and a solid green bar for additions. Split pairs removed and added lines and
hatches the side with no counterpart. Separators read 「N 行未改动」 and expand unchanged lines
in place; the first expansion fetches both sides' text (each ≤1 MB, otherwise the reason is
shown). Files mount as they near the viewport and lines are virtualized; a file the capped
combined patch lacks is fetched whole (`change_file`, ≤4 MB), so there is no 150 KB cut-off.
Empty/binary/oversize files and stale remote state are explicit. Switching layout, theme or
folding updates the mounted files in place without Git or a model; task changes invalidate
pending loads. Browsers without `IntersectionObserver`/`ResizeObserver`, or a failed bundle
load, fall back to the built-in `review.js` renderer (same patches, no virtualization).

Line comments: select line numbers (click, Shift-click) and press the gutter 「+」 to open a
comment box under the range (⌘/Ctrl + Enter saves, Escape cancels without closing the panel).
Saved comments stay under their lines with 编辑 and 删除. A tray at the bottom shows
「评论 (N)」, 清空 (confirmed) and 汇总到输入框, which appends one message to the composer —
per comment the path, `L<start>–L<end>` (「改动前」 for removed lines), up to 8 quoted lines and
the comment — and does not send it. Comments belong to the task and survive Diff refreshes,
layout switches and closing the panel; sending or clearing removes them; a page reload loses
them.

### Host contract for 最近一轮

When a Work task's run starts (Pi and Codex; Claude Code is not handled yet), the Host snapshots
the checkout's working tree into a Git tree object before the prompt is acknowledged, using a
temporary index (the task's own index, HEAD and refs are untouched; ignored files are excluded).
The snapshot is stored as `conversation.turnSnapshot` (`tree`, `head`, `startedAt`,
`requestId`); a failed snapshot is recorded as an error and never leaves an older tree behind.
Steering or queueing into a running turn does not start a new snapshot.

`POST /api/workspace {action:'changes', id, scope:'turn'}` diffs that tree against the current
working tree, including untracked files, and returns `{scope:'turn', startedAt, running, files,
patch (≤150 KB), truncated, …}`. Without a snapshot, for Chat or for an unsupported Agent it
answers 409 with an explicit reason. Without `scope` the response is unchanged apart from
`scope:'branch'`; untracked files now carry line counts (first 100).

`POST /api/workspace {action:'change_file', id, path, scope, base, contents?}` returns one file
of either scope: `{patch, truncated}` (patch ≤4 MB) and, with `contents:true`,
`{oldContents, newContents, contentsUnavailable?}`. Branch requires the `base` that `changes`
reported, still an ancestor of HEAD; 最近一轮 uses the turn snapshot through a throwaway index.
It is read-only, skips the task lifecycle lock and refuses private or escaping paths.

## Acceptance

Public browser-controller tests cover Pi Chat defaults, native Work readiness,
brand menu commands, opt-in review, task transitions, line numbers, actual paired
Split rows, file folding and close; the composer strip for Work/Chat, the merged Agent
menu, the docked Diff (scope menu, 最近一轮 and its throttled `turn_diff` refresh, Escape/focus
return) and one-click 创建 PR
(`test/composer-diff.test.ts`), plus renderer/word-diff units (`test/review-diff.test.ts`).
The @pierre/diffs body (lazy mounting and per-file loading, in-place layout/theme, context
expansion, comments → composer, fallback) is covered by `test/diff-view.test.ts`; `change_file`
by `test/diff-file-http.test.ts`; the vendor route's caching and gzip by `test/web-server.test.ts`.
Host tests cover the turn snapshot (`test/turn-changes.test.ts`) and the HTTP/WS seam: an
Agent edit made during the turn is the only file reported for `scope:'turn'`. Host HTTP tests reject new native Chat without
persisting a task; native lifecycle regressions use independent project clones.
Run npm run check from fresh clones. Browser visual acceptance uses synthetic
content on desktop, narrow and short viewports; live acceptance is read-only.

## Repository groups in the sidebar

[Server #24](http://gitea:3000/awangs/pi-coffee-server/issues/24): conversations
are automatically grouped by their registered Gitea project, across branches and
native engines. Project headings show counts, pending/running indicators and an
accessible expand/collapse button. Empty project groups remain available as drop
targets. Active and archived views stay separate; choosing a project for a new
task does not hide other sidebar conversations.

Drag a conversation into a project group, or into **Ungrouped** to remove it from
a group. The conversation menu also offers a **Move to sidebar group** select
for keyboard/touch use. Explicit placement overrides automatic grouping;
Ungrouped is an explicit null override rather than a reset to automatic placement.
Group assignment and collapsed state are user-scoped Host metadata, retained
across browser refresh and Host restart. Failed saves preserve the prior UI and
show an error. No optimistic success, cross-user moves or external drag payloads.

These are navigation groups only. A move must never change the actual project,
repository, branch, VM directory, engine, transcript or running turn. Chat and
terminal conversations can be organized without becoming Git-backed Work tasks.
Within projects, preserve attention-first ordering and conversation indicators;
ungrouped conversations retain the existing attention/time/terminal sections.
The existing compact sidebar and its browser-height scrolling remain unchanged.

The authenticated workspace endpoint accepts `sidebar_move` with a known owned
conversation `id` and a known project `projectId` (or null), and `sidebar_collapse`
with a known `projectId` and boolean `collapsed`. GET returns `sidebar.assignments`
and `sidebar.collapsed`; absent metadata preserves automatic grouping. These
operations do not acquire execution lifecycle locks or start/stop any Agent.

## Brand mark and optional grouping

[Server #25](http://gitea:3000/awangs/pi-coffee-server/issues/25): the sidebar
brand mark is a monochrome black/white pixel-art coffee cup, rendered as an
inline crisp-edged SVG. Preserve the existing brand menu and compact layout.

The PI Coffee menu contains a **Show groups** (`显示分组`) checkbox, checked by
default when no preference exists. Unchecking restores the original
attention/time/terminal list, with no project or Ungrouped headings. Rechecking
restores project groups, existing manual placements and collapsed states.
Switching never opens a conversation, changes its execution identity, clears
placement data or interrupts a turn. Active/archived filtering still applies.

`sidebar_display` accepts only boolean `showGroups`; the authenticated user's
Host persists `sidebar.showGroups` alongside assignments and collapsed groups.
The preference survives refresh and Host restart, without affecting other users.
Failed saves keep the previous choice and list with an explicit error.

Manual Pi compaction follows [experimental Handoff](manual-handoff.md); automatic
compaction remains native Pi. This supersedes historical local-fold UI wording.

## Task source and new-task shortcuts (2026-09-30)

[Server #6](https://github.com/awangs1986/pi-coffee-server/issues/6) clarifies task
creation without changing the overall workbench layout. The settings menu starts
with **Source** (Chat / Gitea / GitHub), followed by **Agent type** (Pi / Codex /
Claude Code). Chat maps to the existing `chat` workspace kind and remains Pi-only;
Gitea and GitHub both map to `project`. The registered Project determines the
forge. Native / Relay remains a separate **Model source** setting for Pi, with
its existing protocol and credentials unchanged. The task source and directory remain fixed. Explicit [Work Pi/Codex takeover](agent-takeover.md) is available from Agent type; Chat cannot upgrade or switch.

The empty new-task hero shows exactly three actions: **New chat (Chat)**,
**Start task (Gitea)** and **Start task (GitHub)**. These configure the draft,
opening the existing repository picker for Work. They do not send a prompt or
create a Conversation; typed text is preserved. Changing forge clears a selected
repository from the previous forge. Choosing Chat selects Pi. GitHub remains
visible but disabled with an explanation when Host has no GitHub configuration,
rather than disappearing. Registered-project selection still reflects the
selected repository's forge; delayed requests cannot replace a changed draft.

GitHub functionality from ADR-0022 remains authoritative. Host's configured
GitHub token lists repositories; the VM owner's native Git credentials perform
Git operations. Web never receives the token. Deployment must validate both
capability configuration and actual repository selection, not just source code.

## Compact transcript file summaries (2026-09-30)

The conversation does not automatically append a workspace artifact gallery on
load, polling or turn completion. Explicit Agent file links, previews and downloads
remain available. This display policy does not delete or relocate task files.

Each edited-files summary is collapsed by default and occupies one row with the
file count and additions/deletions. Its accessible disclosure opens the entire
file list and review action; clicking again collapses it. Selecting a listed file
opens that file in Diff. Workspace polling must not reopen a collapsed summary.

The summary is labelled **本轮已编辑 N 个文件** and uses only
`changes {scope: "turn"}` against the Host's pre-turn snapshot. The right-hand
Diff entry still defaults to cumulative branch changes. Summary file links and
its review action explicitly open the latest-turn Diff. An empty, unavailable,
failed or unsupported turn snapshot produces no summary; branch changes must
never substitute for missing turn evidence. A new run removes the previous
summary, and completion replaces it with the latest completed turn's collapsed
summary. Unchanged workspace polling preserves disclosure state and does not
repeat turn reads. Late results from another selection or run are ignored.


### First-user title fallback (2026-10-01)

A conversation without an explicit name uses a readable excerpt of its first user
message. For native Pi Skill expansions, unwrap the Skill before whitespace
normalization and truncation: use the user's supplied request, or the original
`/skill:<name>` invocation if no request was supplied. Never use the expanded Skill
body, its XML wrapper or its local path as the title. Explicit user renames remain
unchanged. Existing native transcripts are read through the same projection;
correcting a title must not rewrite messages or invoke a model.

## Confirmed conversation rename (2026-10-01)

[Server #22](https://github.com/awangs1986/pi-coffee-server/issues/22) makes the
rename action await the matching Host acknowledgement. Until then the current
name remains visible with a saving notice. Success updates sidebar, header and
search immediately and requests a fresh authoritative list. Failure or a closed
connection never claims success; disconnect leaves the outcome unconfirmed.
Changing accounts while the dialog is open cancels submission.

Host renames through the authenticated user's native binding without projecting
or exporting the transcript. This applies to active and stored conversations;
a metadata-only resume follows ordinary idle retirement. Native rename failures
retain the old title and do not change the running turn's UI state.

## Transcript readability (2026-10-01)

[Server #24](https://github.com/awangs1986/pi-coffee-server/issues/24): copyable
reply code blocks use white text on `#7C9CC3` in both themes, including their
language header, copy control and syntax spans. Copying preserves the original
command text. User message text is italic in the shared live/history rendering;
assistant prose retains its existing style. This is presentation only and does
not rewrite native transcripts or modify the Diff panel's syntax palette.

## Task and input continuity (2026-10-03)

Draft text remains local to the selected account and task while switching in one
page. The page keeps at most 30 text drafts / 4 Mi characters in recency order;
refresh/sign-out clears them. Attachments are not persisted as drafts. A late task
creation, status, changes or file-grant result cannot take over another selection,
including A → B → A. Disconnect leaves sync state unconfirmed.

The first pending send cannot be replaced by a second submit. Creation failure or
attachment cancellation returns its text without discarding newer edits. Image
decoding reserves an attachment before Send becomes possible; originals upload
only after explicit Send. Removed uploads cannot restart after asynchronous work.
Transfer preparation, upload and saved-file confirmation have bounded waits;
failed files require explicit retry or removal, never silent message delivery.

IME composition does not trigger slash completion, dialog confirmation or global
shortcuts. The topmost shell modal owns keyboard focus and blocks background task
navigation; closing it returns focus to its trigger. Nested sidebar controls do
not activate their row, and metadata polling preserves equivalent action focus.
This does not alter the confirmed-message outbox or authoritative native history.

## Task interaction and compact welcome (2026-10-03)

[Server #42](https://github.com/awangs1986/pi-coffee-server/issues/42): sidebar
refreshes defer while an action-button gesture is in progress or its menu is open.
The latest queued render applies after dismissal. Agent questions remain pending
without making the entire workbench inert; navigating away never manufactures an
answer. Destructive confirmations and application settings retain their modal
behavior. Conversation menus remain usable during loading/errors, while native
operation eligibility is still checked by Host. Menu placement stays in view.

A compact chibi version of the original black-haired cat maid greets a successful login briefly, once per login identity. It retains the cat ears, black-and-white maid outfit and coffee-offering pose, with simplified detail.
It does not cover the workbench, take focus, or consume Enter. A close control and
Escape dismiss it; reduced-motion mode avoids animation. The previous oversized
character artwork is no longer displayed. The workbench layout is unchanged.

A running conversation uses a small light-blue (`#7CBAE8`) pixel cat in the sidebar instead of a
pulsing blue dot. Finished, unread conversations show a static pixel coffee cup;
opening the conversation clears it under the existing attention rules. Waiting
retains its question mark. An idle row
has no running cat. Reduced-motion mode shows the cat without animation, and the
dark theme adds a subtle outline to retain contrast.

The owner clarified that compact welcome means simplifying the original cat-maid character, not replacing her with a coffee-cup icon. The character asset remains transparent and the greeting stays small and nonblocking.

### Busy conversation selection (2026-10-04, Server #44)

A running task's sidebar refresh must not replace the row under an active pointer
or keyboard activation gesture. Defer the coalesced list refresh through the
complete gesture for conversation rows, group controls and action buttons.
Pointer cancellation, drag completion and window blur release the deferral.
Selecting another task preserves the old task's execution and immediately shows
available cached content independently of a new network/history response.

In grouped mode, concurrent active conversations keep their relative order while their attention
category is unchanged. The view captures an ordering timestamp on entry into each
active category; streaming output, tool events and polling can update visible
metadata without changing that ordering key. A new conversation or an actual
attention-category change may change placement; idle conversations retain the
usual recent-activity ordering. Equal timestamps use the conversation ID as a
stable tie-breaker. This is disposable view state, reset on identity changes and
pruned when tasks leave the displayed list; it does not change task timestamps,
project membership, execution or persisted group preferences.

### Sidebar group lifecycle (2026-10-04, Server #50)

The logo menu offers New group. A custom group has an independent opaque ID and
trimmed NFC name (1–64 characters, no control characters). Names must be unique
among visible groups, ignoring case. Creating a group enables grouped display
without creating a Project, cloning a repository or changing the selected task.
At most 100 custom groups are retained per authenticated workspace.

Existing project groups and custom groups share collapse, drag/drop and the
conversation move selector. Each group has an actions button offering Delete
group. Only an empty group can be removed; archived conversations and retained
explicit legacy assignments count as members even when absent from the current
view. Unregistered external deletion is not assumed to prove a reference absent.
Known permanently deleted IDs no longer block group removal.

Deletion of an automatic project group records a sidebar-only hidden-project
preference. The Project remains available for new Work tasks; repository, files,
branches, task identity and execution remain unchanged. New tasks for a hidden
project appear ungrouped unless explicitly moved. The ungrouped container cannot
be deleted. Empty custom groups and hidden-project preferences survive restart.

Host validates the authenticated workspace, name, group identity and emptiness.
Moves and deletion use the same registry serialization, so a race cannot remove a
group while accepting a new member. Browser disabling is feedback, not the guard.
A failed save retains existing placement and displays the error. Group metadata
operations do not require interrupting an Agent.

### Dialogue-first history (2026-10-04, Server #53)

Cached previews, older-history pages and the durable indexed transcript group
contiguous tool records into one closed “工作过程 · N 步” row. User messages and
Agent replies remain directly visible in chronological order. Readers can expand
the process to inspect individual tools and outputs; a failed tool marks its group
“含错误”. Explicit group expansion survives updates within the same visible run.
When live tool activity gives way to dialogue, its group closes. This changes only
display: native records, model context, retrieval, pagination and error data remain
intact. Long outputs remain bounded and load additional content on demand.


### Fixed ungrouped order (2026-10-04, Server #54)

When “显示分组” is disabled, conversations are ordered by creation time, newest
first. Today/Yesterday/older date buckets also use creation time. Running,
waiting, finished and new-message activity update icons and metadata in place;
they never promote a conversation or move it into an attention section. A new
conversation enters at its creation position. Workspace creation time takes
precedence over native-session creation time, so resume/takeover cannot reorder
a task. Equal timestamps use the stable ID; missing/invalid creation dates sort
last in the older bucket by ID, without falling back to last activity. The
separate native terminal section and grouped-mode ordering remain unchanged.

### Pins and Chat context reset (2026-10-04, Server #55)

Conversation actions offer Pin/Unpin. Active pinned conversations appear once,
in a separate top section outside project/custom/date groups in either display
mode. New pins lead; repeated pin requests do not reorder them. Pin preferences
are user scoped and durable. Pinning preserves the original group assignment;
unpin restores that placement (or creation-time order in flat mode). Archiving
hides the pin until restore. Pinned membership still prevents group deletion.

The Context Usage popup offers “一键清空上下文” only for an active Pi Chat.
One click executes directly without confirmation. Running/queued instructions,
blocking questions, lifecycle transitions and active/unknown background work
prevent reset. Work tasks and other Agents cannot use this operation.

Host prepares and verifies an empty native Pi branch in a new native session,
using public native session-tree APIs. The Conversation ID, creation time,
title, model, thinking/context settings and task directory/attachments remain.
Old native records are retained and excluded from future model requests; no
handoff summary or prior dialogue is injected. Commit changes the durable native
binding only after preparation succeeds. Repeated operation IDs are idempotent;
stale bindings are rejected. Failures before commit retain/reopen the original.
Native reset settings also survive restart before the first new user message.
Display history and caches follow the new binding; this is real context reset,
not a visual hide. Permanent cleanup of a task with retained reset history is
not offered; archive preserves those records.

### LAN HTTP compatibility — 2026-10-04

Clear-context operation IDs, Fork IDs and draft SSHME task IDs must work on the
supported LAN HTTP Web origin. Generate UUID v4 identifiers with cryptographic
`getRandomValues`; do not require the secure-context-only `randomUUID` API. The
clear button still sends exactly one request without a confirmation dialog.
