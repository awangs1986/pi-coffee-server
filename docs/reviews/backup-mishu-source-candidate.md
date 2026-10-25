# MISHU notes in a task checkpoint (#130 / #131 candidate)

This is source-capture support, not a deployed backup or restore feature. The public checkpoint fixture uses real MISHU memory HTTP operations and native Pi JSONL, with a deliberately controlled synthetic writer set. It does not prove that unrestricted same-UID tools, external daemons, or a production account cannot write to those sources.

## Recovery material

`platform/mishu/notes-only-v1` identifies one private JSON object with `schemaVersion: 1`, `kind: "mishu-notes-only"`, and the owning `taskId`. The immutable object has this mandatory policy:

```json
{
  "restoreAs": "historical-notes-archive",
  "automaticContext": false,
  "operationalAuthority": false,
  "requireExplicitNoteAdoption": true
}
```

The restore adapter must preserve this object as an inert historical archive, not import it into any operational MISHU store. A later explicit note-adoption action is a separate authorized operation. IDs, bindings, citations and historical outcomes are provenance, never permission to resume an operation or fetch another task's data.

The projection includes only the selected task: all retained binding books, complete retained entry revisions/tombstones and historical operation-result notes from `memory.json` and its immutable predecessor snapshots; textual state/history from the current and retained v1 state; task briefs/facts/reports, pending user instructions, historical follow-up questions and ordinary clarification answers; candidate consolidation text with its copied evidence and previous note values; archived receipt results and inert assignment text. Source snapshots retain their filenames for historical attribution. Shared files are projected rather than copied wholesale, so another task's note text does not enter this task's object.

It excludes live role/selection settings, enabled flags, contacts, manager privileges, runnable assignments/followups/jobs, grants, execution permits, request IDs, operation IDs, fingerprints and idempotency databases. Quoted text can still describe past instructions; it remains untrusted historical text. There is no model request during capture.

Known schema versions and fields are validated; a novel source/dependency is incomplete rather than silently ignored. Files/directories must be bounded, regular, single-link and no-follow sources inside the scoped root. Capture fingerprints the selected source set and checks it again under the shared writer fence; a newly appearing source also revokes the cut. Fingerprints supplement writer admission, never replace an enforceable writer boundary. Unknown operational-only resources (usage/grant/watch/idempotency state) are not restored as authority.

## Evidence and limits

`test/mishu-backup-http.test.ts` verifies API-created edits, deletion tombstones, previous binding history and another synthetic task's isolation; candidate/question/receipt historical material is supplemented with explicit synthetic durable fixtures. It also walks the Host capture endpoint while a MISHU API write arrives, verifies the old immutable point survives, and rejects an unknown external dependency field and a symlink without modifying the target.

The initial red test failed because the prior adapter rejected every nonempty MISHU store. The subsequent targeted checks pass; logs remain outside the repository under the private implementation evidence directory. A later fixture setup failed because `SessionManager.create()` alone does not persist JSONL; adding a synthetic message established the real native source before capture. That failure log is retained, not hidden.

The coordinator still defaults to 1 GiB / 100,000 objects / 30 seconds. Overflow does not omit `node_modules`, untracked work or other selected material: capture fails and retains the old point. Trusted startup configurability and realistic large-workspace performance qualification remain integration work; these tests do not establish either.

Production-wide writer enforcement and existing-account enrollment remain unmet gates. Source ownership receipts and subreaper ancestry are not proof that all future source writes require Host admission.
