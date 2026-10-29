# Ordinary-permission backup integration — 2026-10-29

Status: candidate implementation in progress; not release acceptance.
Parent: [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130).
Draft: [PR #142](https://github.com/awangs1986/pi-coffee-server/pull/142).
This record preserves the accepted [trusted-root decision](backup-trusted-root-20261029.md)
and the actual [earlier canonical failures](backup-native-permission-20261028.md).
Neither production account was read or backed up by these tests.

## Integrated components

Baseline `5a935c5b31a5193b8695250437962040377fd81d` contains these normally
integrated components. It is not the remote main or a deployment identity.

| Component | Evidence and boundary |
| --- | --- |
| Ordinary descendant custody and physical writer fence | Actual shared lock survives detached native/Git helpers; new admission revokes capture. This proves supervised lifetimes, not arbitrary external producer coverage. |
| Independent trusted-root key worker | Kernel peer identity and application actor/scope/revision checks remain separate. Existing-point extraction is independent of live source readiness. |
| Exact checkpoint consumption | Explicit historical checkpoint selection survives newer points and scheduler restart; source export verifies the entire selected seal and retains its capture time. |
| Native factory provenance | Only actual built-in instances bound to the same custody/fence attest coverage. Arbitrary factories/callbacks remain executable but unknown. |
| Pi/Codex completed lifecycle | Actual history observation, normal close and terminal receipts bind native identity, roots and physical lease. A no-op launch or object construction cannot issue proof. |
| Ordinary Host Git | HTTP Git can finish while a detached helper retains its lock. Real HTTP Git authentication, output budgets, timeout and deferred private result cleanup are covered. See [Git evidence](backup-ordinary-git-20261029.md). |

Native factory/lifecycle source evidence lives in
`native/factory.ts`, `native-source-handoff.ts`, `native-custody.ts` and
`physical-writer-fence.ts`. It is separate from first enrollment, current graph
validation and public main composition.

## Executed checks and preserved failures

- Native lifecycle candidate `824d27c`: build and 7 files / 57 tests passed;
  two targeted mutants were detected and restored.
- Ordinary Git candidate `d7ca132`: build and 3 files / 12 tests passed;
  three targeted mutants were detected and restored. Independent review found
  the fallback cleanup race; followup `e72dde9` passed typecheck and all three
  Git tests after an actual failing unresponsive-executable fixture.
- Integration `3632749`: build passed, then 64 tests passed and 7 failed in
  an 11-file run. The failure remains recorded, not relabeled as success.
- The unchanged factory-only test under TasksMax128 observed the actual cgroup
  limit (`pids.events max=121`) and five failures. With identical source,
  tests and timeouts under TasksMax256 it passed all 15 tests, with zero new
  task-limit events and no OOM. This is a test-resource diagnosis, not a product
  or production configuration fix.
- The latest `5a935c5` combined checks await the subsequent main/source batch.

Private evidence is retained under the task's `backup-implementation-130`
directory. The native/Git merge handoff records the exact commands, commits,
resource observations and log names. No provider/model turn, production backup,
restore, restart, security configuration or real disk operation was performed.

## Open integrated gates

Existing-root enrollment and same-boot Host restart have separate actual
Pi/Codex candidate evidence, including two synthetic scopes. Main composition,
resource-limit followups and coherent service startup are still being integrated.
A machine reboot is distinct from a Host process restart: old-boot receipts
currently refuse qualification. Reconciliation must retain prior evidence,
require current native/graph proof and preserve unresolved delegated operations.
A legitimately deleted historical session must not silently turn into proof for
remaining tasks or permanently poison all future qualification. Those lifecycle
reconciliation cases are implementation work, not accepted exclusions.

Final ordinary-permission capture → repository → native restore, canonical
`npm run check`, Browser acceptance, test audit, independent review and fresh
checkout remain required. All active tickets remain open and PR #142 remains
draft. Component success never becomes an assertion that daily protection is
installed or that deployment has completed.
