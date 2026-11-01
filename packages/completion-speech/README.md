# Completion speech 0.1.0

Optional PI Coffee plugin: speech policy, versioned brief Skill, validation and
browser/system playback. No MISHU, native CLI, Gitea, daemon or Agent dependency.
The authorized adapter supplies task identities, current completion/read status,
abstract state persistence and native turn instruction slots. Complete answers remain
in native history; only bounded briefs and delivery identities live in this state.

The Skill adapts the action-first, low-distraction writing principles of
[ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), MIT licensed. The pinned
reference and attribution are recorded alongside the reviewed profile; the copied
license is LICENSE.upstream. Diagnosis assumptions and permanent activation are
not included. No upstream main content is fetched at runtime.

Turn instructions are pinned to 0.1.0 per selected conversation. Presentation,
queueing and voice settings must never mutate this fixed native instruction slot.
