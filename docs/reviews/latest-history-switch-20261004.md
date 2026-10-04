# Latest history after a busy-conversation switch

Scope: [Server #45](https://github.com/awangs1986/pi-coffee-server/issues/45).
Baseline: `29cc818b47b0616127aaa328ade0a027a6cca84d`.

## Confirmed causes

1. The history view treated every scroll event near the top as reader navigation.
   Layout/anchor restoration also emits scroll events. Unrequested older-page
   loading displaced the newest entries from the bounded display window and
   persisted an older reading position across selection.
2. V2 admission accepted an old non-null source-check timestamp even when current
   source freshness was unknown. An unsupported native audit could leave an old
   index displayed instead of newer native history. Native startup also yields;
   admission must be rechecked against the actual page sent after connection.

Automatic paging now requires reader input, cleared on selection; the explicit
older-history button remains usable. Both admission checks require current source
verification. Otherwise explicit open uses the existing scoped native-history
path. Read-only index HTTP requests never start an Agent.

## Red/green evidence

- `test/history-scroll-intent.test.ts`: programmatic scroll removed the latest
  reply before the patch. It now preserves it, while wheel, keyboard and button
  navigation still load older history; intent does not cross conversations.
- `test/conversation-sync-http.test.ts`: a previously verified index followed by
  an unsupported audit omitted `LATEST_NATIVE_REPLY`. The patched open returns
  native history. A separate test invalidates verification during native startup;
  it failed before the second check and passes afterward. Known-current V2 still
  avoids entire-history RPC.
- `node scripts/probe-latest-history-switch.mjs`: actual Browser/Web/Host with
  isolated native RPC fixtures. A stays busy, B's native history gains a new
  reply, and B is selected again. With `PROBE_BASELINE_VIEW` pointing to the
  baseline view module, `LATEST_B_1` times out. The patched view shows it without
  entering older mode; A remains running. Two consecutive patched runs passed.
- `PROBE_SYNC_V2=1 node scripts/probe-conversation-images.mjs`: V2 preview,
  download, refresh and native-history fallback passed, including byte equality.
- Complete `npm run check`: 97 files / 762 tests passed.

Browser probes use the installed Chromium executable via `CHROMIUM_PATH`
(latest-history) or `PI_COFFEE_BROWSER_EXECUTABLE` (images). Synthetic screenshots
and logs are retained privately; no user history or credentials are committed.

## Live-data diagnostic and limits

A private loopback Web connected to the existing authorized Host compared the
latest native reply captured before each selection with the rendered DOM. The
unpatched view missed one of eight selections even though the index contained
that reply; older mode was unexpectedly active without reader scrolling.
Against the same Host, the patched frontend passed 8/8, with no unintended older
mode and a maximum observed selection-to-latest time of 543 ms. No prompt or abort
was sent and no JavaScript errors were reported. These measurements are diagnostic
samples, not a production latency guarantee or proof that every native format is
supported. Source-unknown sessions deliberately use the native fallback.

The previous checks established cache paint and clickability but did not assert
latest native reply visibility. The new browser probe makes that missing criterion
explicit. Security review found no new credential, authentication, user-scope,
input-sink or dependency issue in this diff.

At diagnosis time both live Web and Host remained `83da477`; later source commits
had only been staged. Publication, fresh-clone validation and activation evidence
are recorded separately in Issue #45. A staged release is not a deployed release.

Fresh-clone validation first caught the documentation vocabulary guard rejecting
ordinary uses of a retired mode word in this report. The wording was corrected;
no runtime or test behavior was changed for that failure.
