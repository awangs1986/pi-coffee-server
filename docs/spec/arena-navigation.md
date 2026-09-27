# Arena navigation and review

Owner correction, 2026-09-23. Server #4 and Agent #60.

## Task creation

New conversation defaults to Pi Chat, retaining its own VM directory. Chat only
allows Pi. Work allows Pi, Codex and Claude Code, with existing readiness gating,
a Gitea Project and starting branch. Returning the new-task selector to Chat
resets Agent to Pi. A created task retains its Agent; no context conversion or
implicit engine switching. Existing native local tasks created before this rule
remain accessible with their original files/history.

Server #20 (2026-09-27): while creating a Work task, a compact **New Gitea
project** action sits beside the repository selector. A single name dialog uses
the existing scoped project API to create and initialize a private Gitea
repository. Success refreshes the project list and selects its default branch
without changing the chosen Agent or unsent draft. Cancel/failure preserves the
previous selection; failures are shown explicitly. Disable duplicate creation
while a request is pending. Do not retarget a task or replace a project selection
the user changed while the request was in flight. Hide this shortcut for Chat
and already-bound tasks.

Pi credential import into Web Server is future consideration only. This change
does not implement it or move credentials, runtime, histories or file ownership.
Native Codex/Claude authentication remains their own user-VM authentication.

## Navigation

The upper-left PI Coffee menu owns Add project, Discover existing projects,
Active conversations and Archived conversations, alongside existing settings.
These global actions must not appear in the task footer. The new-Work creation
shortcut above is the explicit exception; import/discovery remain in the menu. The compact footer
retains task identity/project and the up-arrow for VM/path/task details/compaction.

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
New conversation exits search. Search closes the review card and Diff dialog.

## Diff

The right pane is the file-change summary with Diff/Checks tabs, counts, patch
download and View all changes, matching the supplied Arena list reference. A file
or View all changes opens a separate large Diff dialog, not a narrow inline patch.
The third supplied image defines its structure: Diff title, collapse-all,
Branch scope, Unified/Split controls, close, collapsible file headings, change
counts, code line numbers and red/green line backgrounds.

Unified shows old/new line numbers from hunk headers; Split places removed and
added lines alongside each other, leaving a blank side for unpaired lines. Scope
is the Host's existing branch comparison, with branch/base/target metadata in its
disclosure; do not advertise unsupported comparison bases. Empty/binary/oversize
patches and stale remote state are explicit. Syntax rendering escapes source.
Close or Escape returns to the prior surface. Task changes invalidate pending
review loads. Switching the display layout does not run Git or a model.

## Acceptance

Public browser-controller tests cover Pi Chat defaults, native Work readiness,
brand menu commands, opt-in review, task transitions, line numbers, actual paired
Split rows, file folding and close. Host HTTP tests reject new native Chat without
persisting a task; native lifecycle regressions use independent project clones.
Run npm run check from fresh clones. Browser visual acceptance uses synthetic
content on desktop, narrow and short viewports; live acceptance is read-only.
