# Review corrections and busy conversation switching — Server #44

The review of `872cf08...925009e` found retained cache bodies, missing restored
attachment downloads, stale buffered history and incorrect Git destination
admission. This change repairs those paths and the subsequently reported difficulty
switching away from a running task.

## Causes and changes

- A completed queue promise retained its returned transcript after state eviction.
  The internal serialization tail now resolves without a body; callers retain
  their own operation result. The 20-conversation reproduction no longer retains
  any evicted body through an actor's queue.
- V2 user rendering skipped the legacy uploaded-file marker parser. Both paths
  now share inert marker parsing; render/grant arrival attaches fresh task-scoped
  download URLs. Native text and cached grant policy remain unchanged.
- Older history edits updated only visible rows. Buffered records now receive
  replacements, appends and deletions before being revealed.
- Managed Git inferred destination from unrelated remotes in the caller's cwd.
  It now resolves the actual selected/default remote, push URLs, fetch groups,
  clone-local configuration and Git URL rewrite precedence. Disconnected GitHub
  targets still fail before transport; local/Gitea destinations remain usable.
- Busy sidebar redraw replaced a conversation row between pointerdown and click.
  Deferral now covers the entire selection gesture as well as action buttons,
  with cancellation, drag completion and blur releasing the pending redraw.
- Session command receipts and indexed run state share one lifecycle classifier.
  Interruption remains `uncertain` for delivery and `interrupted` for display.
- Official upstream Pi 1.0.1 fixes the inherited brace-expansion advisory with
  5.0.12. An attempted root override was rejected after actual installation proved
  Pi 1.0.0's shrinkwrap retained 5.0.9. No ineffective override or native patch is
  shipped. The four direct Pi packages are pinned to 1.0.1; plugin pins are retained.

## Verification

The original review cases and a real controller pointer-gesture test failed
before their fixes. `scripts/probe-busy-switch.mjs` also reproduces the lost row
with the baseline sidebar module, then passes with the corrected module using
real Browser/Web/Host and a deterministic native RPC process. Five one-gesture
switches displayed cached B in 10–34 ms while native A stayed running; no abort
was emitted. This is isolated acceptance, not a production latency guarantee.

The existing local-first browser probe passed both V2 and legacy protocols with
live 45K/225K-character output, 5 Hz switching, bounded 10,000-entry history,
hanging reads, draft/anchor retention and bounded worker count. Warm-switch p95
was about 33 ms on this test machine. These tests use synthetic data, no model fees
or user transcripts.

Targeted security review caught and corrected Git option/rewrite corner cases
before release: push `-u`, fetch groups, clone `-c`, direct push rewrites and
rewrite precedence. Recording-transport probes deny each disconnected GitHub
case. Existing scoped transfer/file checks remain enforced. No unresolved finding
remains in that targeted review. Installed dependency inspection and npm audit
confirm patched brace-expansion; native Pi package and child-runtime checks are
part of the complete suite.

Early validation also found a source-worker import resolution mismatch in the
shared lifecycle refactor; conditional source/release imports repaired it. A
stale native-child version expectation was updated for the intentional Pi patch.
Release checks, fresh-clone evidence and actual deployment identity are recorded
in [Issue #44](https://github.com/awangs1986/pi-coffee-server/issues/44).
