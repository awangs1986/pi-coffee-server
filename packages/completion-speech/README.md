# Completion speech 0.1.2

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

## Build and package

Run the Server build, then `node scripts/pack-completion-speech.mjs`. The resulting
versioned tarball contains compiled policy, declarations, browser components,
fixed Skill and license. Packaging does not publish or activate a release.
The Server ships its exact source revision as an immutable bundle. The plugin
has its own SemVer; Server's formal version is a separate release identity.

Set `PI_COFFEE_COMPLETION_SPEECH=off` on Host to disable the integration. Account
and task opt-in defaults are off. The browser/system speech facility remains a
browser requirement. The integration loads policy and browser assets lazily;
a missing optional package must leave ordinary task execution usable. Retain
native history and task data during rollback. A Voice or browser change must not
alter the versioned native instruction slot.

Profile 0.1.0 stays pinned per Conversation. Future releases changing a profile
must retain the previous pinned profiles or explicitly report an unsupported
profile; they must never silently repin active Conversations. Provider cache
reuse is observed only when metrics exist, not inferred from stable instructions.

Automatic delivery applies to foreground and background completions. Viewing a
result controls the coffee indicator only; it neither skips nor cancels speech.
The durable delivery identity still prevents automatic replay after restart.


Delivery protocol 2 separates a 30-second reservation from a durable one-time
permission to invoke audio. Pending results survive disconnection for 24 hours;
unknown committed outcomes require explicit replay. The Browser polls over HTTP
independently of the Conversation socket, applies ten-second request deadlines,
and retries transport failures with bounded backoff and page-wake recovery.
Network recovery never requires clicking an audio-permission button.

Never restore a v1 state backup over a newer delivery ledger. A rollback to a
pre-protocol-2 runtime must set `PI_COFFEE_COMPLETION_SPEECH=off` before activation.
The private `.v1-backup` file is for investigation, not an automatic rollback input.
Keep matching Browser/Host artifacts; profile 0.1.0 and native history are unchanged.
