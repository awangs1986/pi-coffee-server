# Cross-user reference candidate review

Scope: Server #162, changes from `e256440`, version 0.95 candidate.
Review performed serially under the repository's no-unapproved-fan-out rule.

## Behavior

`/cross-user <id>` is a Web command that imports a bounded dialogue snapshot into
an existing idle destination. It is not an Agent Skill, native slash passthrough,
source-session open, Fork or task-control capability. HTTP and composer regressions
initially failed because the route and interception were absent; both now pass.
The three focused test files passed 94 tests before the final canonical check.

The snapshot excludes thinking/tool records, identifies the source, and labels
truncation. Delayed results cannot enter a different task/account or overwrite a
changed draft. Existing prompt delivery handling owns the single submitted turn.
Reference text remains historical input; it does not authorize source filesystem
access or become persistent system guidance.

## Security

No blocking findings after the serial review. Checked and clean:

- No credentials or production transcripts added; no new dependencies.
- Web requires route-file Gitea login, configured Origin and an operator-enabled
  same-Host sharing policy. The private Host read route retains bearer/scoped
  authorization and is absent from generic Browser forwarding.
- Destination ownership and exactly one source match are required. IDs are
  validated; Browser-provided routes, account selectors and extra fields fail.
- Routes/login are revalidated after reads. Ordinary task/file/mutation routes
  keep their existing account boundary. Source lookup is not a filesystem scan.
- Passive native readers and a two-read Host limit prevent this command from
  starting a source Agent or a batch of model sessions.

No open user-policy question: the owner selected read-only context import.
Imported dialogue may contain sensitive text already written in that dialogue;
sharing is intentional, not automatic secret redaction. Disabling the feature
cannot retract text already imported into another native conversation.

## Release boundary

Source candidate only. Deployment requires the checked Web/Host release and
`PI_COFFEE_CROSS_USER_READ=1` on the shared-Host Web service. No other user's
production history or credentials were inspected during this implementation.

The first canonical run found one pre-existing Claude Fork acceptance race: the
test waited for an internal compatibility flag and reopened before durable
publication. It now waits for `preparation_get.status=completed`, matching the
existing Codex acceptance. Runtime readiness checks were not weakened.

Final `npm run check` exited 0: lint/build, 1,722 tests (136 optional skipped),
3 isolated runtime-temp tests and all 17 Chromium probes passed. No live model
turn or production cross-account read was used. `git diff --check` passed.
