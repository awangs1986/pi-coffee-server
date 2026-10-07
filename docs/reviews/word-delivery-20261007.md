# Word delivery — 2026-10-07

Tracking: [Server #94](https://github.com/awangs1986/pi-coffee-server/issues/94).
Baseline: GitHub/Gitea main `79637cc8e00549c305c08363088bbf68786c5e7e`.

## Diagnosis and reproduction

Read-only inspection confirms the reported Chat actually produced both a valid
OLE Word `.doc` file and an OOXML `.docx` file, including copies in its artifacts
directory. The completed assistant response named those files instead of linking
them. Document contents, names and user transcripts are excluded from this record.

The artifact discovery filter included images, Markdown and PDF but excluded
Word. An authenticated transfer HTTP reproduction creates synthetic Unicode Word
outputs, then receives an empty artifact list. The Browser did not have a verified
filename-to-download binding for plain or inline-code filenames. Neither a failed
conversion nor document content rendered as text is needed to reproduce the gap.

## Change and acceptance

Word joins the existing bounded generated-file discovery. Download responses use
native Word MIME types while retaining attachment disposition, encoded filenames,
no-store and `nosniff`. Existing task grants and realpath containment remain the
authorization boundary; input attachments, private filenames and symlinks stay
excluded. No new authentication or file-serving route is introduced.

A display-only Browser controller resolves document references in completed,
bounded assistant replies after authorized artifact discovery. It preserves
existing Markdown links, fenced commands and user messages, rejects unknown and
ambiguous names, and handles late grants, renewed URLs and unavailable files.
Context/epoch checks discard late responses after user, task, selection or native
binding changes. No repeated workspace-artifact card, native system prompt,
attachment upload or Agent context injection is added.

Public regressions include authenticated transfer listing/download with exact
binary bytes and MIME/attachment headers, missing grants, traversal, input/private/
symlink exclusion; restored Chat through actual app.js; verified code/plain names,
missing/ambiguous candidates, incomplete replies, removed files, cross-task races,
grant renewal and substring rejection. Existing image behavior remains protected.
Independent security review found no actionable issue in the five checked areas.

The already-produced user files were copied, without overwriting anything, into a
new attachment subdirectory for the current conversation. Actual scoped HTTP
downloads match each source file's SHA-256 and use attachment disposition. Original
task files and transcripts were not changed; no provider/model turn was generated.
These private files and grant URLs are not committed or included in Issues.

Production remains on `5073c97`. Source verification/publication is separate from
activation; no Web/Host restart occurred. A UI/Host upgrade is required for the
new automatic filename binding and Word indexing in other conversations.
