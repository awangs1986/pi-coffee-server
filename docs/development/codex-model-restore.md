# Codex model selection after Host restart

Tracking: [Server #30](https://github.com/awangs1986/pi-coffee-server/issues/30).

The old adapter kept Web model and reasoning choices only in memory. If a user
selected Sol/high after the last turn, a Host restart resumed the native thread's
previous selection, such as Luna/low. A configured Host model was additionally
passed to every `thread/resume`, overwriting the native selection even for threads
with existing history. Model changes were therefore neither durable selections
nor restricted to new-thread defaults.

The correction extends existing per-thread context metadata with model/effort.
Atomic private writes complete before the selection is acknowledged. Settings
remain under the authenticated user's bookkeeping directory and follow native
rebinding when context is changed. Existing preset-only records remain readable.
Threads without saved Web choices resume using their native model; Host defaults
seed new threads only. No credential or native transcript migration is required.
An already lost, unused model choice cannot be reconstructed reliably; select it
again once after activation. The fix does not guess the user's previous choice.

The official [Codex app-server contract](https://developers.openai.com/codex/app-server/)
allows model/config overrides on `thread/resume`. An isolated installed CLI probe
confirmed native resume retained Sol/high with no model override, while explicitly
supplying Luna changed the effective model and reasoning.

## Repeatable verification

Run `npm run check` for the public authenticated WS restart regressions, native
history compatibility, independent selections, context rebinding, concurrent
model/effort updates and rejection/recovery after a metadata write failure.

After building, also run:

```sh
node scripts/probe-codex-model-restore.mjs /absolute/path/to/codex
```

The optional probe uses an installed native CLI with a fresh temporary Codex home
and a loopback Responses fixture. It makes no paid provider request and reads no
real account or user transcript. It materializes a synthetic Luna turn, selects
Sol/high without another prompt, reconstructs the factory, then checks both the
reported model controls and the next actual native request. A second restart
checks the now-used selection. All probe-owned processes and temporary data are
removed on exit. Choose a disk-backed `TMPDIR` on machines using tmpfs for `/tmp`.

The old `abfd895` adapter failed the real-CLI probe with `gpt-6-luna / low` after
selecting `gpt-6.1-sol / high`. The corrected adapter reports and sends Sol/high.
This verifies model/effort restoration, not the behavior or quality of a real model.
Source publication and production activation evidence are recorded separately
in the tracking Issue.
