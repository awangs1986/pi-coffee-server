# Workbench availability, delivery and plugin provenance

Status: implemented in the source candidate, 2026-11-19. Publication and production
activation are recorded separately.

## Agent availability

The Agent menu can receive the supported engines and Chat/Work rules without
probing native executables. Each engine has an independent readiness read. A
slow or failed engine must leave other ready engines selectable. Discovery
does not start a conversation or submit a model request. Duplicate checks for
the same engine and scope share the in-flight inspection. A recent observation,
including a negative result, may be reused for display. Explicit retry checks
the selected engine again. Creation, restoration and Takeover retain their
execution-time readiness checks.

The menu distinguishes checking, ready, unsupported task type, login required,
unconfigured and temporarily unverified. A client with a previous observation
may show it with its time and label it as stale after a failed refresh. Transient
failures never mean “Host disabled”. Requests and observations are discarded on
an identity change. Older Web/Host versions continue with the aggregate catalog.

Acceptance: suspend one synthetic CLI probe and observe a ready engine over the
authenticated Web path before the slow probe finishes. Check per-engine retry,
duplicate-read coalescing and a failed fetch that does not blank other entries.
Existing Chat and Work restrictions, models and defaults remain authoritative.

## Files under an answer

The Host can associate verified deliverables produced during an observed turn
with its last completed, identifiable assistant answer. Associate by native
message identity, independent of the answer text and display order. The Host
compares bounded task-file observations before execution and after settlement.
Automatic association currently covers Pi, Codex and Claude in registered task
bundles. It never assigns unchanged files, user attachments, hidden runtime
data, credentials or files from another task. If either observation or the
message identity is unavailable, omit the automatic association. Existing
explicit in-answer links still work, including older native image links. External
CLI turns and previously saved history are not inferred retroactively.

The UI displays available downloads beneath that answer in Compact and Detailed
mode. Several outputs use a collapsed list. An answer without verified files
uses no extra space. A removed or replaced file stays visibly unavailable on the
next check. Refreshing or reopening the task preserves the association. The scoped download grant
rechecks the file when clicked; HTML downloads as an attachment. The association
contains file metadata and message identities, not file bodies or transcript
text. A metadata journal alongside task data retains up to 40 answers and eight
files per answer. Writing it never changes the native session. Incomplete/expired observations do not label
unrelated answers. Renewing the same task's download grant updates active links
in place. A background grant refresh preserves the delivery row and its expanded
state and reuses verified metadata for the same conversation and native binding.

Acceptance: an observed reply with no filename in its text creates HTML and Word
outputs, and a pre-existing file is left untouched. Only the new outputs appear
under the correct answer, through live display and history reopen. Removing an
output greys it out; unrelated replies, another account, uploads, symlinks and
out-of-scope paths are excluded. No provider calls are needed in fixtures.

## Plugin source and effective version

Extend the authenticated release panel for Coffee-owned Harness, LSP, Handoff
and MISHU packages. Show source repository, verified release tag and source
commit, locked artifact version and integrity digest, and the installed version
reported by the Host process. Show whether the bundled root is selected for Pi
sessions, disabled, conditionally selected, missing, or overridden. “Selected”
describes Host configuration for eligible sessions and is not proof that a
particular CLI process loaded its extensions.

Use the lockfile associated with the running Host and an explicit mapping of
qualified artifact identities to source commits. Do not assign the current
plugin main to a running artifact or equate a local override with the pinned
source. Show unknown when evidence is absent and keep older releases compatible.
When qualifying a new artifact, update the source tag and digest mapping in
`src/host/plugin-provenance.ts` using the release evidence. The Web exposes only
public identity, version, digest and selection fields. It never forwards package paths, local environment, registry credentials or raw
package manifests. These changes do not move source branches or change what is
installed.

Acceptance: distinguish a selected release pin, an explicit override or disabled
root, missing source metadata and an older Host. Verify that the Web panel
reflects the routed Host's report, even when the Web release is different.
