# MISHU persistent tracking implementation

Integration branch for [Server #64](https://github.com/awangs1986/pi-coffee-server/issues/64).
Baseline: Server `3ff1661632bc9bbb746a6f6d8418ca63bdd18246`; independent plugin
`8b2b2ca87a3eee8cbe9ef3cf6781f5d57fda3353`.

## Scope and acceptance

Implement the accepted event-driven tracking slice of the
[MISHU contract](../spec/mishu.md), including canonical SPEC §10.1–10.7 and
A29–A35. Follow the dependency graph; preserve current native execution, ordinary
Chat, existing MISHU authorization, and per-user scope. No timers, new agents or
native permission delegation are added.

| Ticket | Deliverable | Blocked by | Evidence |
| --- | --- | --- | --- |
| #69 | Durable task briefs | None | Candidate implemented; public HTTP/WS and plugin/browser evidence, final artifact integration pending |
| #70 | Observe existing Pi work | #69 | Candidate implemented; exact native run evidence and actual source-model registration verified |
| #71 | Dispatch once with reply responsibility | #70 | Candidate implemented; durable Assignment and public native correlation checks; later model rerun unavailable upstream |
| #72 | Durable, restricted report generation | #70 | Candidate implemented; actual source-model native report commit and unique refreshed output verified |
| #73 | Automatic delayed-result reporting | #72 | Candidate implemented; deterministic native/browser delayed report and busy-source mobile stop verified |
| #74 | Bounded multi-task scheduling | #73 | In progress |
| #75 | Native-engine tracking capabilities | #73 | In progress |
| #76 | Upgrade recovery and integrated acceptance | #71, #74, #75 | Pending |

Tests cross the existing authenticated Host HTTP/WS and browser-controller
Interfaces, with real synthetic browser/native flows for acceptance. Each slice
owns its revocation, failure and restart checks; later integration does not defer
those guarantees. Model replies alone do not prove completion.

## Integration evidence through #73

Server candidate `d0c2852` and independent plugin candidate `e8ca1a3` preserve
Server main `74679e9`, including the recent sidebar activity and durable completion
changes. The plugin merge retains the registration and dispatch input repairs.
Combined public HTTP/native/queue checks passed 52 tests; the integrated plugin
check passed 140 tests. The #73 source candidate complete Server check passed
106 files / 889 tests. Source overrides were used for these checks; the installed
dependency is still MISHU 0.1.6 and does not contain this candidate implementation.

The actual configured source model produced durable on-demand reports in the #72
walk. Later requests returned upstream `model_not_found`; a failed attempt is not
automatic-report acceptance. Deterministic native/browser evidence remains
separate from actual model evidence.

The #73 restart tests initialize an account scope before reconciliation. #76 must
still establish unattended discovery of already-authorized persisted scopes at
actual Host startup, without a browser connection or API request. Scope recovery
alone does not establish this requirement.

This is a candidate PR, not production activation. Immutable artifact installation,
fresh-clone checks, complete acceptance mapping and final review remain pending.
The complete M01–M13 target includes later slices outside parent #64.
