# Pending Web instructions

Delivery: [Server #18](https://github.com/awangs1986/pi-coffee-server/issues/18).

While a supported Agent is running, Web follow-up instructions remain in a Host-owned
queue until their turn. Every row has a stable random ID, revision, text and
private image payload. Native adapters still own prompts, tools, transcripts and
steering. Pi and Codex support native steering. Claude, Cursor and Grok support
Host follow-ups without immediate native steering; the latter contracts are
[Cursor/Claude](cursor-claude.md) and [Grok](grok-build.md).

- **Cancel** removes only the selected pending instruction. It does not abort the
  active run, change other entries or delete already-uploaded task attachments.
- **Edit** opens a separate text editor; it preserves the composer's unsent draft,
  queue position and image attachments. Saving compares the row's revision. The
  original instruction can start while the editor is open; a stale save fails
  explicitly and retains the edit text for the user to recover.
- **Insert now** submits the selected instruction through native steering while
  running, or a normal prompt if the turn has just ended. It never aborts the
  current task. Pi consumes steering at its next native opportunity; Codex uses
  native turn/steer. This does not promise instantaneous interruption of a tool.

For an engine without native steering, pending rows still permit edit/cancel but
do not advertise Insert now. Unsupported actions fail rather than silently being
converted into a different delivery mode.

Rows become immutable once sending starts. Concurrent tabs and double clicks
cannot send the same queued row twice. A failed or uncertain delivery is retained
as **Needs confirmation**, blocks automatic continuation, and is never retried
implicitly. The user can cancel it or explicitly retry after checking history;
retry warns that the prior delivery might already have executed. Failed rows can
be edited but remain paused. Ordinary native steering entries are informational:
they have already crossed the delivery boundary and are not retractable here.

The authenticated WebSocket's open session determines scope; requests cannot name
another user's or conversation's queue. Actions include ID and revision. State
snapshots restore rows after refresh or reconnection. Pending text, images and
mutations are never saved in browser storage. The queue holds at most 100 rows,
512 KiB of UTF-8 text and 16 MiB of encoded image data per live session.

Like the previous native follow-up queues, this is live Host memory, not a new
persistent job scheduler. Browser disconnects do not lose it. Pending/failed rows
prevent idle retirement, task lifecycle changes and context replacement. Session
summaries expose a queued count so deployments wait for both active turns and
queued instructions. Host restart must not be used to cancel or edit a queue.
An unexpected native exit pauses remaining instructions for explicit recovery.

Pi extension commands are rejected before buffering. Native input hooks, Skill
expansion and prompt templates run when an instruction is actually delivered,
using the native prompt/steer interface; editing does not run them. No Pi package
or installed native Agent files are modified by this feature.

Acceptance covers scoped WebSocket mutations, stale revisions, preserved images,
FIFO delivery, failure without automatic replay, cancellation/reconnection,
separate editor drafts and the Pi/Codex adapter delivery paths. The compact
queue shows roughly three rows before scrolling; it does not expand the page.

## Latest-turn bookkeeping

A pending instruction delivered as a new turn uses the same Host admission path
as an immediate prompt. Before native delivery, Host records the run and captures
the Work checkout baseline for the latest-turn Diff. Previous turns' edits remain
in Branch Diff but are excluded from the new turn's Diff, even when no browser
is attached. A native delivery failure marks the run interrupted while the queue
retains the instruction for explicit confirmation. Inserting an instruction into
an already streaming turn uses native steering and keeps that turn's baseline.
