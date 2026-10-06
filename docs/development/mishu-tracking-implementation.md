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
| #69 | Durable task briefs | None | Pending |
| #70 | Observe existing Pi work | #69 | Pending |
| #71 | Dispatch once with reply responsibility | #70 | Pending |
| #72 | Durable, restricted report generation | #70 | Pending |
| #73 | Automatic delayed-result reporting | #72 | Pending |
| #74 | Bounded multi-task scheduling | #73 | Pending |
| #75 | Native-engine tracking capabilities | #73 | Pending |
| #76 | Upgrade recovery and integrated acceptance | #71, #74, #75 | Pending |

Tests cross the existing authenticated Host HTTP/WS and browser-controller
Interfaces, with real synthetic browser/native flows for acceptance. Each slice
owns its revocation, failure and restart checks; later integration does not defer
those guarantees. Model replies alone do not prove completion.

This draft records intended work, not implementation or production activation.
Source publication, immutable plugin artifacts, fresh-clone checks, review and
actual deployment evidence must be recorded separately as they become available.
