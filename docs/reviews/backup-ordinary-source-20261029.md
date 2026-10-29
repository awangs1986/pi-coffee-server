# Ordinary-permission backup integration — 2026-10-29

Status: candidate implementation in progress; not release acceptance.
Parent: [Server #130](https://github.com/awangs1986/pi-coffee-server/issues/130).
Draft: [PR #142](https://github.com/awangs1986/pi-coffee-server/pull/142).
This record preserves the accepted [trusted-root decision](backup-trusted-root-20261029.md)
and the actual [earlier canonical failures](backup-native-permission-20261028.md).
Neither production account was read or backed up by these tests.

## Integrated components

Composition baseline `de1e857254f357fc225ccac2dbd8d64131db8841` contains these normally
integrated components; fixed-role launcher integration is recorded separately. It is not the remote main or a deployment identity.

| Component | Evidence and boundary |
| --- | --- |
| Ordinary descendant custody and physical writer fence | Actual shared lock survives detached native/Git helpers; new admission revokes capture. This proves supervised lifetimes, not arbitrary external producer coverage. |
| Independent trusted-root key worker | Kernel peer identity and application actor/scope/revision checks remain separate. Existing-point extraction is independent of live source readiness. |
| Exact checkpoint consumption | Explicit historical checkpoint selection survives newer points and scheduler restart; source export verifies the entire selected seal and retains its capture time. |
| Native factory provenance | Only actual built-in instances bound to the same custody/fence attest coverage. Arbitrary factories/callbacks remain executable but unknown. |
| Pi/Codex completed lifecycle | Actual history observation, normal close and terminal receipts bind native identity, roots and physical lease. A no-op launch or object construction cannot issue proof. |
| Existing-root and interrupted-local recovery | `4b4bf40` requires exact dead local owner, current native graph/cut and durable receipt before state commit; rejected authorization or persistence failure retains pending work. |
| Boot and deleted historical sessions | `78060d4` retains schema2 boot-bound receipts; removed old bindings cannot witness a current store or poison an unrelated valid current witness. Prior-boot tests are simulated. |
| Owned native audit | `50cff3b` uses Pi SessionManager SDK and independent Codex history readers, preserving source/settings; new user work cancels only the reader. |
| Ordinary main/source endpoint | `98164b3` supplies actual grouped coordinator, current source authorization, no-viewer cold enrollment, exact-point Restic extraction and durable endpoint ownership across actual Host SIGKILL. |
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
- Existing/local authority candidate `4b4bf40`: build and 11 files / 95 tests
  passed, no skips; seven targeted mutants killed and restored.
- Boot/deletion candidate `78060d4`: build and 7 files / 36 tests passed;
  two targeted mutants killed and restored.
- Owned audit candidate `50cff3b`: build and 10 files / 79 tests passed;
  two targeted mutants killed and restored.
- Main/source candidate `98164b3`: final build and endpoint 6/6 passed;
  main plus prior endpoint suite passed 18/18, and four other files passed 19
  cases. These are 38 distinct scoped cases across recorded runs, not a combined
  38-case run. Ten targeted production mutants were killed and restored.
  [Composition evidence](backup-ordinary-composition-20261029.md) preserves
  transient capture envelopes, fixture corrections and an unexplained earlier
  Codex timeout. It does not relabel historical failures as passes.
- The exact merged candidate still requires final affected and canonical checks.

Private evidence is retained under the task's `backup-implementation-130`
directory. The native/Git merge handoff records the exact commands, commits,
resource observations and log names. No provider/model turn, production backup,
restore, restart, security configuration or real disk operation was performed.

## Open integrated gates

Existing-root enrollment, no-viewer cold Pi/Codex qualification and same-boot
Host restart now have actual subprocess evidence with synthetic stores. Tagged
local crash reconciliation, simulated prior-boot custody and legitimately deleted
historical sessions also have executed evidence; live/unknown/delegated cases
remain refused. None of this proves a real machine reboot or arbitrary remote
producer completion. The fixed-role service launcher has its own
[startup record](backup-ordinary-startup-20261029.md); it is not a service install.
Receipt verification still scans O(total receipts); no archive pruning was added.

Final ordinary-permission capture → repository → native restore, canonical
`npm run check`, Browser acceptance, test audit, independent review and fresh
checkout remain required. All active tickets remain open and PR #142 remains
draft. Component success never becomes an assertion that daily protection is
installed or that deployment has completed.

## Final-quality findings and repair evidence

The first final-quality actual-main tracer found a real circular prerequisite:
after the last task/history was lost and the synthetic Host restarted, restore
planning required current source history. A genuinely fresh empty Pi destination
could plan and approve but failed publication with unestablished custody. Earlier
busy-destination refusal and repository extraction did not cover these cases.
The dedicated destination repair is `d493cf2`; its
[contract and focused evidence](../development/restore-destination-authority.md)
preserve source proof and pending operations independently. Build and the focused
35-test regression passed; expanded eight boundary tests and three killed/restored
mutants are separately recorded. These counts are not one combined run.

The subsequent actual-main 20-case run reported 15 passes and five failures.
All six neighbor/last-task/fresh-destination Pi/Codex cases reached publication
and a cold source capture before opening a viewer. Subsequent Pi reopening
exposed an original/native-ID selection problem, and fresh Codex reopening
remained under diagnosis. One refusal-message assertion also needed reconciliation.
The native reopen failures remain acceptance blockers until corrected and rerun;
file restoration and cold capture alone are not complete native acceptance.

A fixed-role scheduler now has an actual successful dispatch tracer: authenticated
ordinary Host inventory and exact sealed point, delegated key worker, real Restic
repository-read verification and extracted history. Earlier launcher heartbeat
proof alone was insufficient. Its initial passing log also contains a separate
intentional fresh-Codex RED; it is not a passing whole-suite log.

The standalone real Chromium/Web/Host/Restic walk at `2c1c48c` passed explicit
approval/publication, preserved neighboring data, retention and continued the
same running job after the entire Chromium process exited. Source qualification
in that Browser fixture remains synthetic. The original checkpoint/history bytes
were read back, and console errors/native starts were absent. The final native
main, canonical, fresh clone and independent review gates remain open.

The corrected native reopen candidate `dac2e37` uses the durable Pi native binding
for create/read/list/delete and refuses missing history for a recovered task.
Its native-history suite passed 14 cases after real identity/deletion REDs. The
five selected failed main cases passed with actual `history.entries` assertions.
Fresh Codex's open error was the expected missing-live-configuration gate;
explicit new offline fixture configuration then allowed the original native
history to reopen. Earlier broad-frame neighbor checks are not accepted native
reopen evidence. The [restore/daily-worker report](backup-ordinary-restore-20261029.md)
retains the complete 15-pass/5-fail run, all corrections and the final 20-case run gate.
