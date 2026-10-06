# Retrospective P1–P2 guardrails — Server #81

Scope: automated lint/check/browser probes and CI, source-navigation corrections,
release tools, fail-fast verification receipts, sidebar reviewer matrix and
account-scoped Git publication. Production backend activation is excluded.

## Public acceptance seams

Owner approved CLI arguments/output/exit status, real browser interaction,
authenticated HTTP release status and isolated Forge/filesystem fixtures.

Targeted acceptance: 23 tests in six files. Tests cover fail-fast exit behavior,
receipt reuse/invalidation and review order, Unicode/binary Git publication,
remote leases/account selection, immutable staging/dependency containment,
browser HTTP served-byte verification/rollback without service restart, exact
fresh clones and scoped release identity forwarding.

Red/green regressions independently reproduced the activation baseline race,
unverified dependency copying, check-before-review publication, staged package
metadata mutation and symlinked dependency-root escape before fixes. The initial
standalone verifier also exposed the old undefined npm_execpath build command;
check.mjs now invokes npm explicitly.

## Review

Standards and Spec independently reviewed the candidate. Findings were resolved
and re-reviewed. Security found no remote authorization/secret exposure blockers;
its dependency-root containment note was fixed. The inherited source-map-js and
nested MCP SDK advisories were recorded, not silently repaired by an unrelated
native runtime upgrade. New ESLint/globals packages are pinned.

## Execution and deployment boundaries

The selected CI target is Windows's WSL, using the configured test computer.
An isolated runner must omit native profiles, account stores and production task
directories. Its actual Actions run and source publication receipts belong in
[Server #81](https://github.com/awangs1986/pi-coffee-server/issues/81).

Source publication is distinct from CI success, fresh-clone acceptance, staging,
browser activation and backend activation. No Web/Host interruption is included.
The authenticated release HTTP API requires a later approved backend deployment.

## WSL calibration

The first actual Actions run reached all 879 tests and correctly failed (871
passed, eight failed). Missing Python and a Chromium XInput library were added to
the private CI bootstrap. Two workers removed cold native-subprocess contention.
An isolated WSL run also reproduced the completion-test frame-order assumption:
an unsolicited pre-prompt session list was buffered before the explicit list
request. The reader now waits for the required conversation state, preserving
all retirement/restart assertions and existing timeout failures. No tests are
skipped and no timeouts are extended. The initially writable launcher mount was
corrected to read-only, with writable mounts limited to runner and synthetic home;
actual listener mount probes and the final workflow are recorded in Issue #81.
