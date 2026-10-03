# Conversation image delivery — Server #43

The durable transcript used the conversation run state to decide whether every
assistant reply was rendered as Markdown. A finished image message arriving while
its run was still active remained plain text, so neither the inline preview nor
the download action existed. Revision deduplication could retain that rendering
after the run settled. Starting another turn could affect restored old replies.

The display index now preserves per-message streaming status for Pi and Codex.
Completion changes its entity revision even if the text does not change. The
browser renders completed messages independently of the current turn and compares
rendering eligibility as well as entity revision. It still bounds large messages
and avoids parsing incomplete Markdown streams. This is display metadata only;
original native transcripts and model contexts are unchanged.

Image references bind when a scoped transfer grant arrives, including late grants.
Unavailable images show an explicit message instead of disappearing. Downloads use
the existing Host attachment endpoint. Outside-workspace and cross-task paths
remain denied; generated images must be placed in supported task directories.

## Verification

- Red unit tests: missing image/download DOM and absent streaming/completion status.
- `npm run check`: 94 files, 744 tests passed with system Git for local fixtures.
  The first run hit an inherited session Git wrapper, which rejected a fixture's
  local bare clone; no production credential configuration was changed.
- `scripts/probe-conversation-images.mjs`: actual Browser/Web/Host/Transfer flow,
  deterministic Pi RPC fixture, and V2 source enrollment. No paid model calls.
  Set `PROBE_SYNC_V2=1` for durable sync; omit it for the legacy path.
- Baseline browser replay with the old sync view: image locator timed out while
  the UI displayed the literal image Markdown. Patched view: inline preview,
  download byte equality, and reload/download during a continuing run passed.
- Browser unavailable-file case: visible error feedback; download remains 403.
- Independent security review: no blocking findings; existing scope/token,
  task ownership, realpath confinement and sanitization preserved. No dependencies.

Evidence is retained outside Git under the operator's disk-backed verification
folder. Source publication and deployed release identity are recorded in Issue #43.
