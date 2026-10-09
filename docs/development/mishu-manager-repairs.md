# MISHU manager review repairs — 2026-10-09

This integrates the supplied manager patch with current Server main and the
previously verified native Codex/Luna secretary candidate. It does not deploy or
restart production services. The independent plugin is manager.2; manager.1's
uploaded archive is retained as historical input, never replaced in place.

## Root causes and regression seams

| Failure | Cause and correction | Regression |
|---|---|---|
| Events disappear after crash recovery | Sealed torn segments must never be appended again, even if their first record is incomplete; reserve the sequence and report the gap. | `test/mishu-manager-regressions.test.ts` initial/nonempty segment recovery; independent rotated-empty-segment probe |
| Unread digest events disappear | Whole-journal head was acknowledged after only 500 reads; acknowledge the scanned cursor. | Same file, 501st error event |
| Excluded tasks raise stuck alerts | Deadline paths omitted the incoming-event scope guard. | Same file, excluded secretary |
| Setup cancellation still saves | Optional confirmation coerced cancellation to false; explicit visibility choice precedes the single final confirmation. | Plugin `test/coffee-manager.test.ts`, public command/HTTP boundary |
| New view-all grant survives failed save | Separate authorization files committed at different times; validated Config.manager now shares state.json's transaction and rollback. | `test/mishu-http.test.ts` injected persistence failure via public request |
| Replaced native context leaks into digest | Saved platform IDs were treated as current grants; model-facing panel/digest checks use current exact bindings. | Same HTTP file, changed native binding |
| Stale confirmation affects new work | Confirmation omitted run/queue identity and authorization generation. Capture both, recheck after awaits; narrow run abort preserves unrelated queue input. | Same HTTP file: new run, reset, suspended authorization race, edited/new queue rows |
| Archived message can execute again | Body retention also erased dedup identity; durable SQLite identities now outlive body retention. Read/parse failures fail closed. | Regression file and existing HTTP rotation/replay check |
| Repeated user confirmations | Only current-turn text could prove user intent; request-bound earlier same-task proof now survives successful turns, with bounded retention. | Grant regression and native Codex HTTP/WS follow-up |
| Cancelled/failed input becomes later authority | Proof was collected before queue admission or appended to another run's grant. Capture final text at actual delivery, remove canceled/uncertain request proof, never mix failed steering into the original grant. | Codex canceled-queue regression and public failed-steer HTTP regression |
| Codex integration regresses | Older patch lacked Codex source/token integration and used a different authorization schema. Preserve native foreground/binding fences; translate native MCP authorizationQuote to v2 and expose manager reads/queue. | `test/mishu-codex-http.test.ts`; Browser/native probe |

The quote proof is provenance, not semantic task authorization. Latest user scope,
revocations and constraints still govern the native model. Stronger independent
task-scoped semantic authorization and unverified Codex automatic-report recovery
remain explicitly unmet in the current specs. Explicit repeat dispatch uses fresh
current-turn proof; same-task continuation does not require restating consent.

## Review and validation

Parallel Standards, Spec and Security re-review closed the original findings and
additional crash, queue/steer revocation and authorization-race cases. Tests first
failed on the exact reported behavior (including HTTP 200 where 409 was required)
before each corresponding correction passed. The new request-proof seam is Session
actual delivery, with public HTTP/WS coverage, rather than browser pre-enqueue input.

The corrected plugin passed its 165 checks, including its native Pi/Harness
fixture. All 45 files in the packed manager.2 artifact match its source; Server's
lockfile pins the exact SHA512. Local checking consumes that package's bytes.

The actual-main startup probe passed with two independently recovered user scopes,
zero target replays, no disabled-scope wakes and preserved corrupt/future stores.
Its synthetic provider now matches the actor's direct marker at the start of a
message, not marker names echoed in untrusted watch summaries. This fixture repair
was confirmed by rerunning the original failing startup command.

Final merge gates (results recorded in private verification receipts):

- `npm run check:release` after the final review receipt: lint, build, complete
  Vitest suite and nine Chromium platform probes (including current-main attachment drafts).
- `node scripts/probe-mishu-codex.mjs`: synthetic native transport plus real
  Browser/Web/Host, setup cancellation/responsiveness, explicit visibility,
  v2 authorized execution and original-thread continuity.
- `MISHU_REAL_CODEX=1 node scripts/probe-mishu-codex.mjs`: isolated authenticated
  Codex 0.159.1 / gpt-6-luna; Pi target uses native Pi RPC with a synthetic provider.
- Pi Browser setup/task/dispatch probes cover the extra visibility selection.
- Independent clean-clone check of the accepted source and immutable artifact.

No real user task was reused, cleared or replayed. Evidence directories, credentials,
capabilities and model transcripts stay private. GitHub publication, Gitea mirroring
and production activation are separate outcomes; this document alone proves none
of them. Current GitHub OAuth returned 401 during preparation; only the selected
Coffee account may publish when that authorization is restored.
