# Conversation-first browser delivery

Status: implemented source candidate v0.24 (2026-10-13); not deployed.
Owner decision: default synchronization carries the conversation and necessary
controls in the default Compact mode. Compact shows only user messages, assistant
replies and output results, without work-process groups, tool cards or command
logs. Detailed mode retains the existing process presentation. This is a
transport and display change, not native context compression or history deletion.

Implementation baseline: GitHub/Gitea main
`789a0d19555ad4adf639488e1b98a3d928046058`. Source validation is recorded in [the acceptance report](../reviews/conversation-display-20261013.md). Production activation and measured real-user speed improvement remain separate.

## User control: Compact and Detailed

Add a row labelled “上下文显示” immediately below “速度” in the composer settings
menu, with exactly two choices: “精简” (Compact) and “详细” (Detailed). The existing
“上下文” token-capacity selector (for example 500K) remains separate. This setting
changes browser display and delivery only, never the model's context window,
reasoning effort, speed tier, prompt, native session or compaction policy.

Compact is the default for new and existing conversations when no preference is
saved. Store the display preference per authenticated Web account, shared across
that account's conversations and restored after reload/login. Do not inherit
another account's preference. It applies to Chat and Work and all supported engines;
engines without speed selection still show this row in the corresponding settings
area. A display-mode change is allowed while a task runs and never restarts it.

- Compact: dialogue and output results only, with essential status and interactive
  controls preserved. No inline tool, command-output or process cards.
- Detailed: retain the existing tool calls, command output and work-process
  presentation, including its current folding and output bounds. Do not expand
  every historical log automatically or expose additional native hidden reasoning.

Switching to Detailed loads a bounded current page of available process evidence
and subscribes to relevant detail updates; older details load on demand. Switching
back to Compact removes process cards and stops unnecessary detail transfers.
Keep visible dialogue, drafts, attachments, scroll intent and pending questions.
A failed detail read leaves the dialogue readable with explicit retry feedback;
absence of evidence must not be presented as “no tool calls”. No new diagnostic
panel is required: Detailed is the user-facing route to existing process evidence.

## Ownership and preserved guarantees

Host owns the authorized browser projection of native history and live events.
The Web gateway authenticates and forwards; it does not classify native tools.
Engine-specific interpretation stays behind native Agent adapters. Complete
available native evidence stays on the Host under existing retention rules;
no extra model turn, summary generation, prompt injection or native compaction
is introduced. Ordinary Chat retains its zero-custom-system-prompt boundary.
Native execution, Fork, Handoff, recovery and MISHU inputs must not consume the
reduced browser projection as a replacement for their existing authoritative data.

Preserve [local-first synchronization](local-first-conversation-sync.md),
[conversation switching and recovery](conversation-switching.md),
[queue controls](input-queue.md) and [file delivery](task-storage.md).
Readiness and authoritative freshness remain separate from a fast cache paint.

## Compact delivery (default)

| Content | Browser behavior |
| --- | --- |
| User messages and assistant answers | Deliver readable text and supported formatting, including streamed answers; never summarize or silently omit an answer. |
| Running, waiting, stopped, completed and failed state | Deliver promptly with stable run identity; preserve unread-completion receipts. |
| Required questions, approvals and other actionable native dialogs | Deliver promptly with original identifiers and native acceptance semantics; never coalesce away a question or infer an answer. |
| Send acknowledgements, uncertain delivery, queue mutations and errors | Preserve reliable ordered control handling and existing recovery. |
| Work process | Do not display tool calls, command output, step counters or collapsed process cards in the main transcript. Do not send raw arguments, tool results, patches or intermediate reasoning bodies by default. |
| Brief assistant progress | Preserve user-facing assistant replies. Put replaceable execution progress in the existing compact status area, not a new work-log block. |
| Attachments, generated files and changed-file summaries | Preserve bounded authorized references and download/error behavior independently of omitted tool output; load bytes and diffs on demand. |
| Model, usage and connection metadata | Keep existing scoped authority, freshness and bounded update rules. |

Classify using native semantic types/channels where available. Do not infer that
assistant text is disposable from words such as “bash”, Markdown syntax or length.
When an adapter cannot distinguish progress from an answer, preserve assistant
text. Model-visible hidden reasoning must not be newly exposed by this feature.
Compact omits failed tools as well as successful tools, without replacement notices.
Detailed retains their error evidence. Agent/transport failures, questions and delivery
errors remain visible; they are not tool output. A generated file discoverable from tool evidence must
remain discoverable by the Host without sending that raw evidence to the Browser.

## Bounded detail delivery

Complete available execution evidence remains on the Host. Detailed mode reads
bounded process pages using the existing transcript presentation. Scope all reads
to the authenticated account, Conversation, native binding/epoch and stable
run/entity identity. Never accept a client filesystem path as authority. Return
explicit unavailable, stale or truncated states, not an empty success. Large
output and patches remain pageable; leaving Detailed stops unnecessary detail
subscriptions. Subsequent cache reads are bounded and revision checked. Details
must not require starting an Agent or issuing a model request.

Opening, reconnecting, prefetching, indexed pages/changes and compatibility-native
history must apply the selected mode's projection before network transmission.
Browser-only hiding or CSS folding does not satisfy this requirement. Fetch the
latest conversation page first; fetch older messages on demand. Omitted process
steps must not consume the entire visible-message page budget and hide the latest
answer. Switching to Detailed or reading further detail must not trigger a complete-history download.

Process-detail transfers and background synchronization have bounded concurrency,
byte budgets and cancellation on obsolete view selection. They cannot block
foreground conversation selection, answers or interactive controls. Other running
conversations need lightweight status updates, not unsolicited detailed streams.

## Output results and copyability

The compatibility event renderer must finalize each completed assistant message
before navigation or history reload. Codex completion text is carried by the
message-end event's `text` field; Pi carries text in `message.content`. Both forms
must produce the same bounded Markdown, code-copy controls and scoped attachment
links as authoritative history. Completion closes that message's live rendering
boundary so a subsequent assistant message cannot overwrite its formatted result.
The existing sanitization, size limits and file authorization remain in force.

Assistant-authored scripts, code blocks, tables and other requested results remain
part of the dialogue with normal Markdown rendering and copy controls. Hiding a
command execution log must not hide a script the user asked the Agent to deliver.
Files, images and documents retain authorized preview/download references; the
existing separate Diff view stays available. Do not repeat workspace-artifact
cards every turn or substitute raw tool output for an assistant answer. A run
ending without an assistant answer shows its actual outcome; do not invent one.

## Ordering, recovery and compatibility

Filtering must not create apparent gaps in the existing contiguous revision log.
Define a versioned projection/capability with its own valid revision/watermark
semantics, or equivalent explicit advancement over omitted entries, before
implementation. Raw native cursors and projected cursors are not interchangeable.
Cache keys and persisted snapshots include display mode and projection version plus existing
account/binding identity; legacy rich snapshots must not masquerade as the new
compact projection. Mode changes invalidate obsolete in-flight view results; a
late Detailed response cannot repopulate a Compact view. A mode change uses a
consistent snapshot/watermark transition, not reuse of incompatible cursors. Projection migration invalidates disposable display caches,
not native history, drafts, unacknowledged messages or completion receipts.

Snapshot, replay and live updates must converge without duplicate answers or
missed terminal events. Coalesce replaceable progress updates with bounded delay;
flush final state and preserve meaningful event ordering. Do not coalesce away
answer deltas, prompt receipts, queue operations, questions or errors. Disconnects
must recover the latest answer/state and unresolved questions without automatically
resending prompts or replaying already accepted answers.

Late responses cannot repaint another Conversation or survive an account change.
Document version negotiation and bounded legacy fallback explicitly; do not
claim traffic reduction for a client/path still using complete legacy delivery.
This change does not replace heartbeat, reconnect or selection-race fixes.

## Acceptance and measurement

1. Capture before/after bytes, event counts, Host projection cost, browser parse/
   render time, long tasks, click-to-readable time and time-to-latest-answer using
   the same synthetic long/tool-heavy conversations. Report fixture, cold/warm
   cache, network conditions and compatibility mode. No unmeasured speedup claim.
2. Public HTTP/WS checks prove default history, changes, replay and live delivery
   exclude raw process bodies while retaining user text, answers and controls.
   Verify that Compact has no tool/log/process cards; Detailed retains current
   process rendering and fetches only scoped, bounded details.
3. Exercise all supported native adapters, including ambiguous assistant text,
   a huge tool output, a script answer, a tool error and a tool-produced download.
   Compare native history before/after to prove it was not reduced or rewritten.
4. Browser checks cover rapid A/B/A switching, a busy background conversation,
   older-message paging, mode changes and detail reads during streaming, stale responses,
   account changes and binding changes. Preserve scroll intent and readable answers.
5. Disconnect during an answer, question and queued send; reconnect and verify
   exact receipt/question identity, no repeated accepted dialog, no duplicate
   answer and correct running/completed/read state. Repeat after Host restart.
6. Test old/new client negotiation and cache migration, invalid or pruned cursors,
   revision advancement across omitted-only changes and failure of detail reads.
7. Verify menu placement, default Compact for existing/new tasks, account-scoped
   persistence across conversations/reload, and separation from token capacity.
   Switch modes repeatedly during a busy turn and question, with delayed detail
   responses; no task restart, prompt replay, missing answer or obsolete repaint.
8. Use synthetic fixtures and existing passive evidence first. Bulk real Agent
   creation/awakening remains subject to the [batch policy](batch-agent-execution.md).
   Implementation, measured source acceptance and deployment are separate gates.

## Implemented wire contract and compatibility

The Browser explicitly requests `displayMode: "compact" | "detailed"` on `open`.
Legacy clients that omit it retain Detailed behavior. HTTP `page`, `changes` and
`content` accept the same `displayMode` query value; invalid values are rejected.
Omission retains the legacy Detailed contract. Use matching v0.24 Browser/Host
assets for Compact transport; this is not a compatible Browser-only activation
on an older Host. Native execution permissions and provider configuration do not
change.

An opened socket accepts `set_display_mode` with a mode and request ID, using the
existing Conversation/binding fence. It changes this subscriber's projection and
returns bounded history, queue state and an acknowledgement. It does not close the
execution socket or submit a native prompt. Body replay excludes interactive
questions already present in the view. Tagged history and process payloads from an obsolete
mode cannot repaint the new mode. Dialogue deltas, questions, errors and run
completion remain deliverable during the transition regardless of their mode tag. Failed display reads keep the running task's
state and allow retry by selecting the current mode again.

Compact index pages select visible entities before applying page limits. Tool
updates become content-free `setMetadata` operations with their original operation
ID/revision, preserving contiguous log advancement. Tool failures also become payload-free operations; Compact adds no failure notes. Detailed keeps the
existing tool entities and content endpoints. Page cursors include the display
mode; crossing modes requires a new snapshot. Compact content reads reject tool
bodies. Native history is never rewritten by this projection.

The account preference is persisted by `POST /api/workspace` with
`{action: "conversation_display", mode}`. It is restored through the existing
scoped workspace read. IndexedDB keys distinguish account, display projection v2
and mode; legacy previews lacking a matching mode are misses. Explicit cache
invalidation clears all mode variants. Mode changes invalidate obsolete read and
render generations while preserving native/model state, drafts and questions.

`src/host/conversation-projection.ts` supplies the native-neutral projection;
`src/host/conversation-index-worker.ts` applies it before pagination/log transfer;
`src/host/server.ts` owns scoped HTTP and WS delivery. `public/history-process.js`
remains the Detailed renderer, not the Compact traffic filter. Pi incremental
text delivery omits cumulative partial/message copies, tool arguments and thinking
bodies. Existing authorization for files/downloads and the separate Diff view
remains unchanged.

Source tests cover authenticated HTTP/WS, account preference persistence, all five
engine menu variants, pending questions, drafts, late responses and display-read
failure while busy. `scripts/probe-conversation-display.mjs` runs real Chromium,
Web and Host against synthetic adapters for both history protocols, with no model
turn. Its fixture shows reduced page bytes, not a production latency claim.

The existing navigation work is tracked in
[Server #47](https://github.com/awangs1986/pi-coffee-server/issues/47).
Creating the follow-up Issue and publishing this candidate require available
account-scoped GitHub credentials; the configured broker returned “GitHub credential
unavailable” during this task. No alternate/global identity is used. Production
rollout, fresh-public-clone validation and long-running real-user measurements are
still pending; no production service was restarted.

### Display-read isolation (v0.24 review fix)

`set_display_mode` starts an auxiliary read outside the ordered task-command lane.
A stalled snapshot cannot delay prompt delivery, question answers or queue controls.
Each socket permits one underlying display read; overlapping requests receive
`display_busy`. The metadata deadline yields `display_read_timeout`; it does not
cancel the native task or permit unbounded replacement reads. The pending slot is
released only when the underlying read settles. Late results after timeout,
disconnection or a changed session/binding/display generation are discarded.
If live events advance while the read is pending, `display_stale` preserves the
already-painted dialogue instead of overwriting it. Retry the selected mode after
the read settles. A display refresh replays transcript bodies only, never historical
questions or lifecycle transitions. Browser and Host share event classification in
`public/display-events.js`; the native transcript remains unchanged.

Web HTTP and Web/Host Upgrade boundaries reject malformed request targets with
400 and contain handler failures so an unauthenticated malformed URL cannot
terminate the service. Isolated child-process regression tests also verify that
health and authentication enforcement still work after rejection.
