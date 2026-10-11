# MISHU product source ownership — 2026-10-11

Canonical product source and feature tracker:
[awangs/pi-coffee-mishu](http://gitea/awangs/pi-coffee-mishu).
See its [source map](http://gitea/awangs/pi-coffee-mishu/src/branch/main/docs/source-ownership.md)
and [secretary experience SPEC](http://gitea/awangs/pi-coffee-mishu/src/branch/main/docs/secretary-experience.md).

The ownership audit found six product pieces maintained in Server: Codex role text,
MCP tool declaration, manager digest framing, report formatting, keyword replies,
and default reminder rules. They now come from the immutable package's pure
`pi-coffee-mishu/host-policy` export. Original Server modules preserve references
where callers rely on their paths. Product defaults are unchanged; the independent
package does not load Pi/Harness when used by Host or the native MCP child.

Host remains here by the owner's explicit decision. Authorization, scope/token and
binding checks, MCP transport guards, run/queue confirmation identity, persistent
watch/journal/receipt/task state, report admission/output recovery, native adapters
and Browser controls are not moved. The package accepts plain already-authorized
facts; it cannot choose accounts, read native history or perform execution.

This is not implementation of the nine secretary-experience feature tickets.
They remain future work. Feature issues belong in MISHU; migration of existing
Server #108–#116 is pending Gitea Issue authorization. The old product SPEC/research
paths retain pointers; no code or documentation move activates production.

Verification: the new plain-Node package test rejects Pi/Harness imports. A private
baseline comparison checked 106 representative role/quick/report outputs and the
complete default configuration against pre-move Server source with identical results.
Existing public HTTP/WS/native and package integration tests remain required,
including rejection of forged grants, source replacement and stale confirmation.
Release/fresh-clone results must be recorded separately from this design record.
