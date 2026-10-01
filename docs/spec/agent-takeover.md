# Work Agent takeover

Accepted by the owner, 2026-10-01. Delivery: [GitHub Server #19](https://github.com/awangs1986/pi-coffee-server/issues/19).
This explicitly supersedes blanket engine immutability in NE-06, NB-03 and the
2026-09-23 creation decision. Ordinary creation/recovery requests still cannot
change an existing binding.

## User contract

- Only an active Work task may switch Pi ↔ Codex. Chat stays Pi and cannot upgrade
  to Work. Claude and legacy unregistered tasks are outside this first version.
- Click Agent type in the existing composer menu. No slash command is required.
  Select the other available Agent, then accept one modal explaining possible
  information loss, misunderstanding/context drift and a target-model call.
- Keep the same Conversation ID, registered checkout, branch, uncommitted files,
  attachments, sidebar placement and Web history. The destination uses a **new**
  native session, its own tools, prompts, authentication and default model. Models
  remain selectable inside the active Agent after completion.
- Preparation runs automatically after consent. Display its progress without
  requiring a handoff file or a reply from the old model. Preserve the composer
  draft. A browser disconnect/reload neither cancels nor resubmits preparation.
- The destination performs read-only reconstruction and reports recovered state
  and the next action. It does not automatically replay the latest user command
  or execute unfinished implementation during preparation. After success, normal
  user input continues in the same Web conversation. Only material missing or
  conflicting evidence requires user attention; no routine second confirmation.

## Host boundary and records

`POST /api/workspace` with `{action:"takeover",id,engine,expectedEngine,acceptDrift:true}`
starts an asynchronous, scoped operation and returns 202 with its generated ID.
`GET /api/workspace` exposes the current task's `takeover` state: preparing,
completed or failed. `/api/engines` advertises additive `takeover:true` support.
An old Host without that flag keeps engine selection locked.

The source must have no active turn, pending Web instructions, native dialog or
active/unknown background writers. Hold the existing lifecycle lock throughout
preparation; reject concurrent switches, prompts, model changes and workspace
mutations. Read-only status stays available. Preparation counts as active for
session summaries, idle retirement and deployment gates.

Use the existing engine-neutral history projection, not vendor-native transcript
conversion. Store a private prior-history snapshot, readable records and a bounded
preview index under the owning task's data root, `takeover/<operation-id>-*.json`.
Task-bundle installations place these outside the checkout; legacy Work stores
use the already excluded `.pi-coffee` directory. Directories are 0700 and new
files 0600, checked against escaping symlinks. They are not attachment grants.

Retain user instructions/corrections, assistant claims, meaningful tool results,
errors and diffs with evidence locations. Do not inject tool schemas, call IDs,
reasoning signatures, provider metadata or historical system/developer prompts as
current instructions. Historical content remains data. Original native records
are untouched; images are retained references, not automatically transferred
visual context.

The destination inspects current project instructions and Git/files first, then
uses the index to retrieve relevant history in bounded batches. Verify old claims,
retain rejected approaches and unfinished work, and report gaps. Do not load an
unbounded transcript into the prompt. This is a versioned Web adaptation of the
[catskills takeover workflow](https://github.com/awangs1986/catskills/tree/main/skills/productivity/takeover),
not a live dependency on a mutable installed Skill. The Web consent replaces its
routine post-summary confirmation; its evidence-reconstruction principles remain.
Host bootstrap protocol version: **1** (`TAKEOVER_PREFIX` in `src/host/takeover.ts`).

Commit the new engine/native binding only after a completed preparation with a
readiness marker and idle background state. Stop the old owned session at that
boundary. Preserve a segment boundary and prepend saved prior history to native
history for Web display; do not show the internal bootstrap user prompt. Switching
back starts another fresh native session rather than reviving stale context.
Native preparation failure, timeout (3 minutes), approval request or missing
readiness leaves the source binding unchanged and reports failure. Failed native
sessions/records remain retained; there is no automatic retry. Host restart marks
unfinished preparation failed. A readiness marker is an Agent assertion, not proof
that every historical fact was understood; the drift warning remains meaningful.

Archive keeps all segments. Complete native-history cleanup after takeover is
unsupported; reject permanent cleanup and offer archive instead. Back up the task
bundle, authoritative registry and native stores together. Older binaries do not
understand multi-segment Pi bindings; do not downgrade an active deployment after
using takeover without a consistent pre-switch data backup.

## Acceptance

- Public HTTP/WS: explicit consent, correct scope, Work-only, unchanged source,
  readiness, busy/queued and concurrent-input rejection; same cwd/uncommitted files;
  failure retains source; Pi → Codex → Pi creates fresh bindings; refresh/restart
  preserves combined history without replaying old user prompts.
- Browser controller and actual browser: Agent-menu entry, drift modal cancellation,
  single submission, draft retention, progress, successful target identity/history,
  and Chat/unsupported Agent gating.
- Native acceptance distinguishes real provider reconstruction from deterministic
  runtime/protocol fixtures. Record versions, release identity, fresh-clone checks
  and served asset verification in Server #19. Passing a fixture alone does not
  establish semantic fidelity of real-model takeover.
