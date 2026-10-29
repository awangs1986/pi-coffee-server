# Ordinary Host Git custody — 2026-10-29

Candidate for Server #131 / #141 under the accepted trusted-root boundary.
This is source evidence, not a production installation or backup receipt.

## Behavior

Ordinary Host Git runs under the same NativeWriterCustody as native adapters.
The private command-result channel lets HTTP Git operations return when Git
finishes while the supervisor retains a real shared source lock until its
adopted background helpers naturally exit. Git retains its environment, current
working directory, authentication, network and existing configuration behavior;
this does not add the experimental managed namespace or transport restrictions.
The existing `core.hooksPath=/dev/null` Host setting remains unchanged.

Every Host Git invocation enters the writer fence. Temporary index creation and
cleanup also stay inside admission. Capture cannot obtain an exclusive cut while
a Git helper is still writing, even after the original HTTP response returns.
A command timeout reports failure promptly without claiming its surviving
remote helper has stopped. Source producer coverage remains a separate authority
requirement; this change does not observe unrelated external processes.

## Evidence and limits

Public scoped Host HTTP `changes` uses a real Git fsmonitor that leaves a
synthetic background writer. The response succeeds, that writer continues,
the exclusive lease is refused, and natural completion later permits the cut.
A separate actual local HTTP Git server verifies synthetic Basic authentication,
output budgets and timely timeout while its remote helper remains in custody.
No provider round, real user data, production restart or deployment is involved.

The genuine first red was an obtainable exclusive cut while the helper wrote.
The second genuine red was a 200 ms Git timeout taking about 5.2 seconds to
return because a surviving helper held its stdio open. The result channel now
publishes a failed Git result at process exit while preserving helper custody.
Earlier missing-kernel and incorrect PATH fixture failures are environmental/test
setup failures, not product red evidence. A prior expectation of immediate
quiescence after timeout was incorrect: the fixture remote helper was still active.

`npm run build` passed. The final focused run of
`ordinary-workspace-git-custody`, `workspaces` and `managed-git-boundary` passed
12 tests in 3 files (76.92 seconds, no skipped tests). Private logs are retained
under the task evidence directory with the `ordinary-git-` prefix.
Main composition, combined source qualification, canonical checks and final
Browser/recovery acceptance remain separate integrated gates.

Three bounded mutation probes were detected and restored: bypass custody, omit
failed-process exit notification, and delay timeout. The omission probe failed
through mutated fallback cleanup; the delay probe separately failed the explicit
latency assertion (3443 ms versus a 2000 ms bound). These are focused checks,
not exhaustive mutation coverage.
