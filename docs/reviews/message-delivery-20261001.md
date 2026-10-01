# Message delivery diagnosis — 2026-10-01

Scope: Server #23, messages disappearing after submission, missing native history
and no model response, followed by uncertain-delivery feedback. Source base:
`91871ace9b18cc4102c51c2035457f05db4de4a2`. The browser recovery change is
`2a4e8f7`; the additional delivery corrections are in this report's commit.

## Reproduced causes

1. Model, command, statistics and extension reads occupied the socket's ordered
   command queue. A deliberately suspended read followed by a prompt produced
   neither prompt ACK nor a native user entry. All four public WS regressions
   failed before the correction and passed after it.
2. A remote sync-status refresh held the conversation lock used by `markRun`.
   A real bare Git repository with upload-pack waiting on a test-controlled gate
   reproduced prompt starvation. A separate status lock allows run acceptance
   while the remote remains pending; lifecycle exclusion remains intact.
3. A silent native Codex model/list had no deadline. The actual adapter/stdio
   fixture failed the deadline assertion before correction. Native auxiliary
   requests now expire after ten seconds without terminating live conversations.
4. Browser history replacement erased optimistic user messages after a lost
   ACK, retaining only an uncertainty warning. Pi/Codex controller regressions
   reproduced this; a bounded owner/task/request outbox preserves manual recovery.

These independently reproducible paths explain how user input can fail to reach
native execution. Existing production logs do not identify which path triggered
every historical incident; successful metadata probes are not delivery evidence.

## Implementation boundaries

Auxiliary reads are coalesced per socket, bounded to sixteen outstanding keys,
and isolated from prompt/answer ordering. Late results after a session or setting
change are discarded. Timeout failures use a distinct metadata error and do not
end the browser's active reply or discard input queues. The underlying read stays
shared until it settles to prevent polling from multiplying stalled operations.

Codex initialization, model/config discovery, Skills and account-meter reads have
native RPC deadlines; model turns retain their existing lifetime. Sync-status
network waits use their own workspace lock. The browser keeps at most twenty
unconfirmed requests / eight MiB in page memory, checks existing wire limits
before clearing drafts, and never resends automatically. Recovery does not
survive a page reload or tab closure. Account changes and logout clear the data.

## Verification

- Red loops: `vitest run test/host-server.test.ts -t 'delivers a prompt while'`,
  the gated remote sync-check regression, the silent-native-model regression,
  and Pi/Codex unacknowledged-history-replacement controller regressions.
- Targeted checks: four files / 157 tests passed, including query coalescing,
  timeout recovery, active-turn preservation and Web-to-Host delivery/reconnect.
- `npm run check`: 58 files / 454 tests passed.
- Security review: no findings; user/task isolation, stale responses, bounded
  reads and lifecycle guards inspected. Original image File objects are excluded
  from the browser outbox's retained image data.
- Isolated real CLI check: native Codex 0.159.1, `gpt-6-luna`, medium effort,
  dedicated project clone and loopback Web/Host. Statistics were deliberately
  gated; prompt ACK arrived in 2,622 ms. The model returned the synthetic expected
  marker. Reconnecting recovered exactly one corresponding native user entry
  and the reply. No prompt was submitted to a production user conversation.
- The first isolated CLI startup failed with exit 127 because the diagnostic
  process PATH omitted the installed Node directory. Supplying that PATH made
  the same probe pass; production service configuration was not modified.
- No temporary debug logging, credentials, cookies or user transcripts are
  included in source. Private diagnostic artifacts remain outside the repository.

Source publication and deployment are separate. Production service activation is
not part of this diagnosis-and-submit task; current deployment identity must be
checked before any later rollout.
