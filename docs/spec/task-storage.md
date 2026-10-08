# Task bundles without native session migration

Accepted 2026-09-27. Tracking: [Server #26](http://gitea:3000/awangs/pi-coffee-server/issues/26).
This specification overrides the new-task directory layout in conversation-workspaces.md when task storage is configured. Existing tasks keep their registered paths.

## Ownership and layout

Host owns durable task files. Web authenticates users and forwards scoped operations. All engines share this platform layout:

```text
/home/awang/coffee/<account>/projects/<conversation-id>/
  task.json
  history/conversation.json
  attachments/
  artifacts/
  research/
  images/
  workspace/
```

Chat uses an empty workspace; Work clones its selected repository into workspace. Each task has an independent directory and clone. The generated Conversation ID is the directory ID. Attachments and exported history stay outside the Git checkout. The existing workspace path shown by the UI points to workspace.

`task.json` is a versioned metadata mirror. `history/conversation.json` is a versioned display/export snapshot of the Agent interface history, refreshed when a session opens and after settled turns, including when the browser is disconnected. These files are best effort: export failures are logged and do not disable native execution. A newly created, unopened task can have no history snapshot yet.

The existing Host registry remains authoritative. Pi, Codex and Claude retain their native storage, credentials, session IDs and resume APIs. Coffee never rewrites native transcripts, changes native home directories, or uses its JSON snapshot as a native restore file. A snapshot may not include every native event or internal context item.

## Configuration and lifecycle

`PI_COFFEE_TASK_ROOT` opts in for new tasks. `PI_COFFEE_TASK_DEFAULT_USER` names the default authenticated route's account directory; `PI_COFFEE_TASK_USER_MAP` is an administrator-controlled JSON object mapping forwarded user scopes to account directory names. Names must be safe single path components; mappings must be unique, must not overlap the default account, and reserve their names from implicit fallback scopes. Unmapped scopes use their validated scope name. Invalid mappings fail closed.

For this installation the default awangs route maps to `awang`, and `gitea-2` maps to `fengge`. Creating these directories does not grant access or configure Web routes. Fengge routing/onboarding remains separate. This layout is application-level separation, not an OS sandbox between agents sharing a system user.

Archive preserves the entire bundle. Permanent cleanup requires the existing archive/ID confirmation plus explicit local-file deletion confirmation, and retains remote repositories and branches. Existing native-engine cleanup restrictions still apply. Neither enabling nor disabling the setting relocates existing tasks; registered paths take precedence. Never copy an old registry over the current one during an application rollback.

File APIs expose only the workspace and explicitly allowed attachments/artifacts/research/images siblings within the authorized task. Metadata, history snapshots, other tasks and escaping symlinks are not exposed through attachment grants.

## Word document delivery — 2026-10-07, Server #94

Generated `.doc` and `.docx` files are included in the bounded artifact index for
Chat and Work. Input attachments, private filenames, escaping paths and symlinks
remain excluded. Existing scoped file grants serve Word bytes as attachments
with native MIME types, encoded filenames, `nosniff` and no-store headers.

The Browser can bind inline code or plain Word filenames in completed, bounded
assistant replies to downloads after the existing artifact API verifies an
available file. Exact relative paths win; a basename resolves only when unique.
User messages, fenced commands, unverified examples, input attachments and
ambiguous names are not rewritten. Existing Markdown links remain intact.
No per-round workspace-artifact card is added, and no system instruction or
file content is inserted into native Chat context.

Discovery is lazy for document-bearing replies, bounded to the existing index,
and shared while in flight. User/Conversation/selection/native-binding changes
invalidate it and discard late replies. Grant renewal rebinds existing downloads;
settlement refreshes availability. Missing discovery or authorization retains
plain filenames. Source publication and activation remain distinct. See
[Server #94](https://github.com/awangs1986/pi-coffee-server/issues/94).

Filename-signature discovery must remain linear in the bounded text inspected;
an unbroken historical token must not cause a retry from every character on each
streaming DOM mutation. The browser regression in
`scripts/probe-streaming-responsiveness.mjs` exercises the actual app over synthetic
HTTP/WS: browser timers keep advancing, drafts remain editable and the latest
streamed text renders alongside dense history. Its second scenario preserves
verified inline/plain Word links. This is a regression gate, not a production
latency guarantee. See [Server #96](https://github.com/awangs1986/pi-coffee-server/issues/96).

## Upgrade and backup contract

Back up the coffee tree **and** the existing Host registry, native Agent stores and necessary configuration/credentials separately with restricted access. The coffee tree alone is not a complete native recovery backup. Stop writes or take a consistent filesystem snapshot across these locations.

Pin and validate Agent upgrades: open an existing native session, resume one turn, create a new task, upload/download an attachment, and check the exported snapshot. Run the Server check suite and Pi package integration checks. Public adapter APIs reduce coupling; future upstream breaking changes can still require adapter updates. Do not promise compatibility with every future version.

Before upgrading, preserve compatible binaries and a consistent data backup. Rollback must account for native data-format changes; downgrading an executable does not automatically downgrade a native store. Platform export schema changes require an explicit version and reader compatibility.

## Acceptance

HTTP/WS coverage must prove new Chat/Work/continuation paths, legacy path retention, per-user separation, real clone and transfer, traversal rejection, archive retention, explicit cleanup, restart persistence, and export after browser disconnect. Deployment additionally creates new Pi and Codex tasks through the live interface and checks their paths and native session bindings without relocating existing histories.

## Attachment send boundary (2026-09-30)

GitHub Server #11: pasted/dropped/selected files remain browser-local draft data
until Send. Pasting alone creates no Conversation, transfer grant, upload or
workspace artifact. Removing a draft attachment causes no upload. After Send,
original bytes are uploaded once before prompting; an inline image contributes
one image representation, without a duplicate uploaded-file chip. Upload failure
restores the draft and must not silently send only the image representation.
Input attachments and legacy inbox files are excluded from generated artifact
cards, while remaining available through authorized file APIs. This does not
change Agent-generated artifact discovery or native session storage.

## Work takeover records (2026-10-01)

Explicit [Pi/Codex takeover](agent-takeover.md) adds private `takeover/` records
and multiple retained native bindings to a task. These are retrieval evidence and
display history, never native restore files or attachment grants. Archive retains
them; complete cleanup remains unavailable. A pre-takeover binary cannot safely resume
a switched Pi binding, so deployment rollback requires compatible code or a
consistent pre-switch registry/native-store backup.

## Inline conversation images (2026-10-04)

[Server #43](https://github.com/awangs1986/pi-coffee-server/issues/43)
tracks image previews and downloads from assistant Markdown. Complete, bounded
assistant messages render inline images and a Download image action in both live
and restored transcripts. Completion belongs to each message: a later running
turn must not turn earlier finished replies into plain text. Incomplete streams
and oversized content retain the existing bounded plain-text rendering.

Host's durable display index retains assistant `inProgress` status while text
arrives; completion changes the entity revision even when the final text is
identical. Historical source entries without status are complete. Interrupted
streams may render their bounded final content after the run settles.

Local images use the current task's existing file grant for preview and download.
Grant arrival or renewal rebinds existing image nodes. Missing or inaccessible
images display an explicit unavailable message. The application does not expose
arbitrary VM paths: generated images intended for delivery must first be placed
in the task workspace or its supported sibling attachment/artifact directory.
Use relative `../attachments/...` references for task attachments; a path outside
the existing file-serving boundary remains denied. No original model session or
model context is rewritten by this display behavior.

## Local file link delivery — 2026-10-08, Server #102

Ordinary local Markdown file links use the current Conversation's authorized
`workspace-download` endpoint. This applies to relative task paths and absolute
paths accepted by the existing Host allow-list; the Browser does not widen that
allow-list or expose arbitrary VM files. Binary attachments such as APK and ZIP
must download regardless of the separate 10 MiB preview limit.

Embedded image elements and their preview anchor retain `preview`; explicit image
download controls retain `workspace-download`. Missing grants disable local links,
and renewed grants rebind them. External HTTP/mail links retain their behavior.
Authentication, account/task scope, traversal/symlink/credential rejection and
preview limits remain unchanged.

Regression acceptance: `test/conversation-images.test.ts` runs the actual
Markdown renderer/binder chain; `scripts/probe-attachment-download.mjs` exercises
actual Chromium download bytes over synthetic HTTP while retaining image preview.
Live diagnosis separately confirmed a real authorized binary download succeeds
and the incorrectly bound preview returns 413; user file contents are not stored
in repository evidence.
