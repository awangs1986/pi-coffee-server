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
