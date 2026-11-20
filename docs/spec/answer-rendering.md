# Assistant answers and file delivery

Accepted design, 2026-11-20. Implementation and browser acceptance are pending.
Server 1.07 (`7e41c86`) is the reviewed baseline. This contract applies to the
Browser, Web gateway and Host in Chat and Work.

A user who opens a completed answer can preview or download its verified
files again after switching Conversations, reconnecting, reloading or paging
back through history. Compact and Detailed present the same answer and files.
Implement the shared answer and file identity first, then failure recovery
and change-driven updates, then the format-specific previews below.

## Answer identity and retention

The Host owns the association between the authenticated account, Conversation,
originating native binding, stable answer key and verified task file. Reuse
the [observed-turn association](workbench-p1.md#files-under-an-answer). A
record holds the scoped file reference, display name, type and evidence needed
to detect replacement. The Host rechecks access and the recorded file version
when serving a delivery. A replacement at the same path must never supply
different bytes for the original delivery. A grant URL is temporary. Persist
only metadata with the association.

Keep each recorded association for the lifetime of its retained answer and
task, including after a Host restart. Read metadata for the answers on the
page being viewed. The 40-answer request size is a batch limit. Move beyond
v1.07's rolling 40-answer journal using bounded, keyed reads and writes. Keep
the existing limit of eight automatic deliveries per answer. Import surviving
journal entries idempotently. Older answers with no surviving record can still
resolve their explicit authorized references. Missing associations must never
be guessed from a filename, nearby turn or current directory listing.

Continue to associate observed outputs only where the adapter supplies a
reliable native answer identity. A generated Markdown file qualifies alongside
images and other supported deliverables. The workspace file list and answer
deliveries use the same file identity and preview capabilities. Each list
retains its own membership rules. An input attachment or unchanged workspace
file can be linked explicitly without becoming an output of this turn.

## One rendering path for authoritative answers

Live completion, reconnect, recent and older pages, and compatibility history
pass the same answer key, completion state, text and verified file references
to the same answer renderer. A disposable cache may paint inert text immediately.
When authoritative data arrives, restore actions on the corresponding answer.
Scope asynchronous results to the account, Conversation, binding and view
generation. Discard stale reads on a switch, reset or logout.

Keep the [text and scheduling budgets](local-first-conversation-sync.md#display-and-resource-budgets).
Streaming and large replies can use bounded text. Crossing the 8 KiB text
boundary, including a link split between text pages, must leave a verified
file reachable from its answer. This also covers explicit local Markdown links
without an automatic delivery record. Resolve references incrementally or on
demand. Rendering a page must never require parsing the entire native history.
Keep the [verified Word filename behavior](task-storage.md#word-document-delivery--2026-10-07-server-94)
for older answers. A verified explicit link does not create a historical
observed-turn association.

Preserve authored link text. Identify the same file across Markdown, native
image references and automatic deliveries so a single answer shows one set
of file actions. Several files keep the existing collapsible list. Renewing a
grant or appending text preserves expansion, focus and scroll position. An
answer without files takes no extra space.

## Resolve and display a task file

Interpret a Markdown destination as a URL reference. Decode its path escapes
once and keep query and fragment separate from the filename. A verified file
reference returned by the Host is already canonical. Resolve answer links
against the Conversation workspace and links inside a previewed Markdown file
against that document's directory. The Host checks the resolved file against
the existing [task roots and native-image import rules](task-storage.md).
A relative path, an allowed absolute path and a URL-escaped spelling of the
same authorized file resolve to one reference. Preserve existing external
link behavior and task-authorized legacy links.

A path printed by an Agent grants no access. A deliverable prepared in a
server temporary directory must first be materialized under an authorized
task root, normally `../artifacts/`. Deny paths outside the task, private
files and escaping symlinks, including encoded attempts to escape a root.
Web authenticates and forwards these requests. File access never starts an
Agent, submits a prompt or changes native history.

| Content | User-visible behavior |
| --- | --- |
| Task-owned PNG, SVG and other supported images | Offer Preview and Download from the answer for an explicit file link, embedded image or verified delivery. Render SVG as an image resource. Raw SVG in message markup stays subject to sanitization. A fenced SVG example stays copyable source. |
| Markdown file | Offer a sanitized document preview and download of the original bytes. Relative images go through the same task-scoped resolver. |
| HTML file or native visualization | Keep the original attachment download. An explicit Preview opens an isolated, static view. Active content cannot execute in the application, navigate it, access credentials or fetch other resources through its grant. |
| Other authorized files | Offer the original download, including ZIP and files above the existing preview limit. A missing renderer or oversized preview does not disable download. PDF enhancements, math and in-message diff rendering are later options. |

## Recovery and update cost

Track file loading separately from answer text and from the lifetime of a
grant. Distinguish loading, available, temporary failure with Retry, and a
confirmed missing, replaced or inaccessible file. Keep known filenames and
already verified actions visible through a transient metadata failure. Enable
file access only within a current grant.
Only a successful lookup can cache an empty delivery list.

Coalesce in-flight reads for the same scope and answer keys. Retry transient failures with bounded backoff while
the answer is relevant, and offer manual Retry after the automatic budget.
Renew an expired file grant within the current authorized scope and retry the
failed load even when the renewed URL is identical. An expired Web login
follows normal reauthentication. A definitive denial stops automatic retries.
Never persist grant URLs, credentials or preview bytes in the transcript cache.

Update only changed answers, files or newly visible rows. When streaming
formatted text, reuse stable blocks and update the growing tail. Reconcile the
finished answer within the text budget. Appending a chunk must not scan every
completed answer for links or rebuild their previews.
The Host broadcasts a session-list change only for an actual relevant change.
Reading files or status, or renewing a grant, cannot by itself trigger a
session-list broadcast and a new workspace read. Keep ordinary polling,
heartbeats and actual task-change notifications working.

## Browser acceptance

Use synthetic task files through the authenticated Web and Host in Chromium.
Click the actual controls, decode the preview where applicable, and compare
the downloaded filename and bytes with the fixture. A successful metadata
response or the presence of a DOM node alone does not establish delivery.

| Scenario | Required observation |
| --- | --- |
| Live to history | In Compact and Detailed, deliver a file without naming it in the text. Switch away and back, reload, reconnect and open older history through both v2 and compatibility views. The correct answer still offers the same bytes. Include more than 40 visible answers and, separately, more than 40 recorded file-bearing answers across a Host restart. |
| Legacy and long answers | Reopen a retained v1.07 journal entry and an older answer with only an explicit link. Test 8,192 and 8,193 UTF-8 bytes and a reference crossing a text-page boundary. Each authorized reference stays actionable with bounded rendering. Missing historical evidence creates no invented delivery. |
| Path and scope | Use spaces, Chinese characters, literal percent signs, equivalent escaped and allowed absolute paths. Duplicate references produce one file action group. Another task/account, temporary paths and escaping symlinks remain inaccessible. A delayed result from the previous selection cannot alter the new view. |
| Recovery | Fail the first delivery lookup with 503, then restore it. Expire an image grant and renew it with the same token. The controls recover in place and the image decodes without a page reload. Exercise manual Retry, confirmed removal/replacement and logout as separate outcomes. |
| Format and safety | Open a real SVG file, its ordinary file link, a fenced SVG example, Markdown containing a relative image, and an isolated HTML preview. Verify the expected presentation, original download bytes and that active markup cannot run in the parent page. An above-preview-limit binary still downloads. |
| Idle and streaming | From an idle open task, one scheduled workspace refresh must settle without more refreshes caused by its own read events. A genuine session change still reaches the sidebar. Append 20 text deltas with older answers visible and check that earlier file controls retain their nodes and no document-wide file rebinding occurs. |

The design draws on the separation of message blocks, file opening and
document previews in DeepSeek Harness. [Chat rendering](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/packages/client/ui-chat/README.md) · [Document previews](https://github.com/deepseek-ai/deepseek-harness/blob/2e39e70496aa02986ca6a820c5d497e816b69d7e/packages/client/ui-sidebar-documentpreview/README.md).
