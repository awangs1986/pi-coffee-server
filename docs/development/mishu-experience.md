# MISHU experience acceptance probes

Build the matching integration candidate, then run the installed immutable package:

```sh
npm run build
node scripts/probe-mishu-experience.mjs
MISHU_NOTIFICATION_ORDINARY_PENDING=1 node scripts/probe-mishu-notifications.mjs
```

The experience probe defaults to `node_modules/pi-coffee-mishu`. For source-only
diagnosis, explicitly set `MISHU_PLUGIN_ROOT=/absolute/plugin`; record that override
as source evidence rather than installed-artifact evidence.

The probe boots isolated real Web/Host/native Pi, actual Chromium and a deterministic
localhost synthetic provider. It owns synthetic source/targets and captures source,
installed package, native version and provider identities. Production services, genuine
conversations and paid credentials are not used. Screenshots, bounded native request
evidence and JSON verdicts are written under a private OS temporary directory.

Experience scenarios include desktop/mobile/short-window memory CRUD, cancel/export,
source-bound natural remember/correct/reopen/forget and disabled rejection, actual
no-tools native candidate preview/cancel/adopt, automatic default-off/configuration
cancel/enable/new fact application/pause, and mobile context-clear with explicit old
note-only restore that cannot restore authorization. The notification variant keeps
ordinary question A pending while source chat and target B run and B's automatic
report commits; it observes desktop/mobile/reconnect question persistence.

`test/mishu-memory-native.test.ts` separately loads the installed package and uses
real native `RpcClient.compact()` plus same-binding Host restart. It proves native
context/compaction continuity with a synthetic provider, not real-model interpretation.
A bounded real-provider semantic probe is separate and must record its configured
provider/model, exact synthetic user story and observed result without fallback.

Collaboration/finite-plan and answer-alone continuation probes are recorded in the
feature tickets alongside public HTTP/WS/controller regressions. Synthetic provider
requests verify wiring, isolation and mechanics; they do not prove an unrestricted
model will choose the right tool. Each actual criterion receives PASS/FAIL/UNVERIFIABLE
with evidence. No probe claims production activation. Kill only processes it starts.
