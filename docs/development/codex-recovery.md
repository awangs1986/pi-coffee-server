# Qualified Codex recovery

The Codex adapter is qualified for CLI **0.159.1**, state migration 58 and
history migration 7. `src/host/codex-schema-01591.json` records the exact observed
SQLite schemas and migration checksums. Other versions and unknown schema,
resource mappings or writers fail closed. This does not claim compatibility with
a later Codex source checkout.

Capture resolves `CODEX_HOME` and the effective SQLite home independently. The
shared coordinator holds one source-owned cut while the adapter uses SQLite's
backup API, including committed WAL rows, then captures the registered binding,
required rollout ancestry, indexes, workspace, task data and supported native
resources. A single database's online backup is not the group consistency
proof. Native exports occur only within the outer deferred capture lease.
Every member of a shared Pi/Codex checkpoint has one capture time and seal.

Recovery verifies the complete original seal before selecting the requested
member's materials. The original group seal remains in the approval digest and
is verified again before publication. The administrator approves the staged
revision, selected tasks, native bindings, exact file and row transitions,
checkpoint identity and real repository snapshot pins. Publication intent is
persisted before Host admission. Pins are renewed and held during execution.

The importer restores the original native and SQLite homes. It creates missing
native databases from the qualified schema and merges selected rows using bound
SQL values in transactions; it does not replace a live shared database or add
foreign receipt tables to Codex databases. Existing native IDs, unrelated rows,
accounts and shared indexes remain intact. Missing files use no-replace rename.
Explicit replacement requires a fresh, repository-read verified encrypted
safety checkpoint and exact approved preimages. The old file trees remain at
the staged exchange path. Shared global memory requires complete owner coverage
and a compatible target; unknown or conflicting context is rejected.

Historical queued input is retained only in an inert task archive. It is never
requeued. Active goals become paused, continuation deferrals are omitted, and
memory worker ownership and leases are cleared. Authentication is excluded;
configuration inventory requires reconfiguration rather than activating saved
credentials. Claude, Cursor and Grok are outside this release's protection
scope. Unsupported compressed/reverted rollout representations, attachment
mappings, external resource configuration and mixed historical engine lineage
are reported unavailable rather than silently omitted.

The durable Host journal records per-database started and done phases around
native SQL commits. Retries reconcile exact intended rows, files and append
prefixes; they cannot adopt an unrelated preexisting row as their own. The native
helper inherits the same open-file-description publication lock so an orphaned
helper cannot lose kernel exclusion merely because its controller closes its
copy. Durable source admission remains blocked after a partial publication
until the same approved operation reaches its completion receipt.

## Acceptance evidence

All fixtures are synthetic, isolated and use no provider turns. The ordinary
rollout fixture contains completed native user/agent lifecycle records and
canonical item IDs; it is not provider-generated history or `inject_items`.
The opt-in tests use real Restic and the pinned Codex app-server. Native
`thread/read` can return an empty turn list before resume, so the qualified
check asserts the original thread ID, calls `thread/resume`, then verifies the
original item IDs and content through `thread/read`.

- `test/codex-recovery.test.ts`: effective roots, committed WAL, unknown migration
  retaining the older point, encrypted recovery, native read/resume and bounded
  fork history with original IDs.
- `test/codex-restore-crash.test.ts`: SIGKILL after task files, after the first SQL
  commit before its receipt, after native publication and after registry import, plus a physically persisted half-index suffix;
  two restart workers converge while preserving neighbors and another account;
  the partial-index case checks the complete neighbor prefix byte-for-byte.
- `test/codex-recovery-rejections.test.ts`: unsupported CLI/configuration and
  unknown memory owners retain the prior point; late native row collisions
  reject publication without task registry adoption.
- `test/codex-shared-context.test.ts`: populated global/stage-one memory, paused
  goals, cleared worker ownership and inert selected queue history; an
  incompatible current global memory owner is rejected without overwriting it.
- `test/codex-replacement.test.ts`: selected file/row replacement with fresh
  encrypted mixed-account safety material and preserved neighbor/preimage;
  later manual file/SQL writes after approval are rejected.
- `test/codex-publication-fence.test.ts`: inherited kernel exclusion while the
  controller closes its publication descriptor, followed by approved retry.
- `test/codex-group-restore.test.ts`: Codex restoration from a mixed Pi/Codex
  account checkpoint, privacy projection and durable intent before Host entry.
- `test/codex-recovery-http-ui.test.ts`: authenticated administrator publication
  through browser controls, ordinary-user denial, foreign-account denial,
  passive history HTTP read and rendering of original conversation text.

Run after building, with `PI_COFFEE_TEST_RESTIC` pointing to the qualified real
Restic executable and `PI_COFFEE_TEST_CODEX_ROOT` to the pinned runtime root.
Without those variables, external-binary tests are explicitly skipped; a default
green test run alone is not the real-binary acceptance evidence.
