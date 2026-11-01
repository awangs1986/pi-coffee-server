---
status: accepted
---

# Independent completion speech with native Skill integration at the host boundary

The speech capability is independently versioned and requires explicit
per-user/per-conversation opt-in. Coffee supplies authorized completion data and
native Skill integration; the original task model generates its brief within the
original turn, and the speech package handles browser playback after settlement.
This makes speech independent of MISHU and avoids extra summary conversations,
while accepting a thin host-specific adapter for native inputs and read receipts.

The owner confirmed a standalone PI Coffee plugin with no MISHU integration in
this scope. Preserve the current Coffee structure: reuse existing seams and add
only narrowly required adapters, without a new daemon or plugin framework. Keep
speech policy inside the plugin and authorization/native execution inside Coffee.
Disabling or removing speech must preserve ordinary execution and complete replies.
Missing extension hooks must be identified before implementation; zero core edits
are not assumed.

Separate
post-completion summary turns were considered and rejected in the interview in
favor of the original model/turn; they would add execution, ordering and recursive
notification concerns. This decision preserves the existing Server/Pi-only source
boundary; it does not move native adapters into a speech package.

The owner accepted the MVP and requested the formal [specification](../spec/completion-speech.md).
The Server 0.67.0 candidate implements independently versioned package 0.1.0.
See the [integration and acceptance guide](../development/completion-speech.md).
Source delivery is distinct from production activation and actual device listening.
